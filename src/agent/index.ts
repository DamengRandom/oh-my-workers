import { githubAgent } from './github.agent.js'
import { diaryAgent } from './diary.agent.js'
import { curateTrending } from './news-curator.agent.js'
import { cleanupTool } from '../tools/cleanup.tool.js'
import { manualKpiTool } from '../tools/manual-kpi.tool.js'
import { trendingTelegramTool } from '../tools/news-telegram.tool.js'
import { trendingScrapeTool } from '../tools/trending-scrape.tool.js'
import { saveKpiRecord, saveTrendingRepos } from '../storage/own-db.js'
import { sectionLogger, logger } from '../utils/logger.js'
import { notifyError, parseJson, toolOutput } from './utils.ts'
import { AgentResult, CuratedRepo, TrendingRepo } from '../schemas/index.ts'
import { runCuratorGraph } from './curator.graph.ts'
import { TRENDING_TOP_N } from '../constants/index.js'

export class WorkCoordinator {
  // Deprecated SOON - because this is just for demo only
  static async runCleanup(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]

    sectionLogger(`🧹 Oh My Workers — Cleanup — ${today}`)

    try {
      await cleanupTool.invoke({})
      sectionLogger(`✅ Cleanup complete for ${today}`)
    } catch (err) {
      logger.error({ err }, '❌ Cleanup failed')
      await notifyError('Cleanup', err)
    }
  }

  // ── Daily jobs: helpers ───────────────────────────────────────────────────

  // Phase 2: ask the engineer for manual activities. Failures are non-critical,
  // so this swallows errors and returns an empty activity list.
  private static async collectManualActivities(): Promise<{ manualOutput: string; activities: string[] }> {
    let manualOutput = ''

    try {
      manualOutput = await manualKpiTool.invoke({})
    } catch (err) {
      logger.error({ err }, '❌ Manual KPI input failed')
      await notifyError('Manual KPI input', err)
      // non-critical — continue with GitHub data only
    }

    const parsed = parseJson<{ activities?: string[] }>(manualOutput, {})

    return { manualOutput, activities: parsed.activities ?? [] }
  }

  // Phase 3a: no manual activities — persist a GitHub-only KPI record.
  private static async saveGithubOnlyKpi(githubResult: AgentResult, now: string): Promise<void> {
    logger.info('⏭️ No manual activities provided — skipping diary, saving GitHub KPI only.')

    const githubData = parseJson<{ summary?: string; commits?: unknown[]; pullRequests?: unknown[] }>(
      toolOutput(githubResult, 'fetch_github_activity'),
      {}
    )

    try {
      await saveKpiRecord({
        github_summary: githubData.summary ?? '',
        commits_count: (githubData.commits as unknown[])?.length ?? 0,
        prs_count: (githubData.pullRequests as unknown[])?.length ?? 0,
        activities: [],
        created_at: now,
        updated_at: now,
      })
      logger.info('✅ GitHub KPI record saved.')
    } catch (err) {
      logger.error({ err }, '❌ Failed to save KPI record')

      await notifyError('saveKpiRecord', err)
    }
  }

  // Phase 4: manual activities present — generate and save the full KPI report.
  private static async generateDiaryReport(githubResult: AgentResult, manualOutput: string, activityCount: number): Promise<void> {
    logger.info(`⚡️ Phase 3: Generating daily KPI report (${activityCount} manual activities recorded)...`)

    try {
      await diaryAgent.invoke({
        messages: [
          {
            role: 'user',
            content: `Write and save today's KPI report using the data below.\n\nGitHub activity:\n${toolOutput(githubResult, 'fetch_github_activity')}\n\nManual activities:\n${manualOutput}`,
          },
        ],
      })
    } catch (err) {
      logger.error({ err }, '❌ Diary agent failed')

      await notifyError('Diary agent', err)
    }
  }

  // ── Interactive (manual) — requires human at keyboard ──────────────────────

  static async runDailyJobs(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const username = process.env.TARGET_GITHUB_USERNAME
    const now = new Date().toISOString()

    sectionLogger(`🤖 Oh my workers — ${today}`)

    if (!username) {
      logger.error('❌ GitHub username not set in environment variables.')
      await notifyError('Daily jobs startup', 'TARGET_GITHUB_USERNAME is not set')
      return
    }

    // ── Phase 1: Cleanup + GitHub run in parallel ────────────────────────────
    logger.info('⚡️ Phase 1: Running cleanup and GitHub fetch in parallel...')

    const [cleanupSettled, githubSettled] = await Promise.allSettled([
      cleanupTool.invoke({}),
      githubAgent.invoke({
        messages: [{ role: 'user', content: `Fetch GitHub activity for username "${username}" on date "${today}".` }],
      }),
    ])

    if (cleanupSettled.status === 'rejected') {
      logger.error({ err: cleanupSettled.reason }, '❌ Cleanup failed')

      await notifyError('Cleanup (daily jobs)', cleanupSettled.reason)
    }

    if (githubSettled.status === 'rejected') {
      logger.error({ err: githubSettled.reason }, '❌ GitHub agent failed')

      await notifyError('GitHub agent', githubSettled.reason)

      return // can't generate a meaningful KPI report without GitHub data
    }

    const githubResult = githubSettled.value

    // ── Phase 2: Manual input (interactive, sequential) ──────────────────────
    logger.info('⚡️ Phase 2: Collecting manual activities...')

    const { manualOutput, activities } = await WorkCoordinator.collectManualActivities()

    // ── Phase 3: Conditional — diary only if manual input was provided ────────
    if (activities.length === 0) {
      await WorkCoordinator.saveGithubOnlyKpi(githubResult, now)
    } else {
      await WorkCoordinator.generateDiaryReport(githubResult, manualOutput, activities.length)
    }

    sectionLogger(`✅ All jobs complete for ${today}`)
  }

  // ── GitHub Trending: helpers ───────────────────────────────────────────────

  // Step 1: scrape GitHub trending. Returns null on failure (already notified).
  private static async scrapeTrending(): Promise<TrendingRepo[] | null> {
    logger.info('⚡️ Scraping GitHub trending repos...')

    try {
      const raw = await trendingScrapeTool.invoke({ languages: ['typescript', 'javascript'] })

      return JSON.parse(raw) as TrendingRepo[]
    } catch (err) {
      logger.error({ err }, '❌ Trending scrape failed')

      await notifyError('Trending scrape', err)

      return null
    }
  }

  // Step 2: rank by stars gained today and keep the top N. Selection is a sort,
  // not a judgement call — the model never sees the repos that lost.
  private static rankByGrowth(newRepos: TrendingRepo[]): TrendingRepo[] {
    const top = [...newRepos].sort((a, b) => b.todayStars - a.todayStars).slice(0, TRENDING_TOP_N)

    logger.info(`📈 Top ${top.length} by stars gained today: ${top[0]?.todayStars ?? 0} down to ${top.at(-1)?.todayStars ?? 0}`)

    return top
  }

  // Step 3: write summaries for the ranked repos. One attempt — retries and final
  // failure notification are handled by runCuratorGraph / runNewsAgent.
  private static async curateRepos(newRepos: TrendingRepo[], feedback?: string): Promise<string> {
    logger.info('⚡️ Writing digest summaries...')

    try {
      return await curateTrending(newRepos, feedback)
    } catch (err) {
      logger.error({ err }, '❌ Trending curation attempt failed')

      return ''
    }
  }

  // Step 4: deliver the digest via Telegram. Returns whether the send succeeded.
  private static async sendTelegram(repos: CuratedRepo[]): Promise<boolean> {
    logger.info('⚡️ Sending trending digest via Telegram...')

    try {
      await trendingTelegramTool.invoke({ repos })
      return true
    } catch (err) {
      logger.error({ err }, '❌ Telegram delivery failed')
      await notifyError('Trending Telegram delivery', err)
      return false
    }
  }

  // Step 5: persist the curated repos, tagging whether delivery succeeded.
  private static async saveTrending(repos: CuratedRepo[], sent: boolean, now: string): Promise<void> {
    try {
      await saveTrendingRepos(
        repos.map((r) => ({
          repo_name: r.repo_name,
          url: r.url,
          description: r.description,
          language: r.language,
          stars: r.stars,
          today_stars: r.today_stars,
          summary: r.summary,
          tags: r.tags,
          sent,
          created_at: now,
          updated_at: now,
        }))
      )
      logger.info(`✅ Saved ${repos.length} trending repos to database.`)
    } catch (err) {
      logger.error({ err }, '❌ Failed to save trending repos')
      await notifyError('saveTrendingRepos', err)
    }
  }

  // ── Daily GitHub Trending — scrape, dedup, curate, send via Telegram ─────

  static async runNewsAgent(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const now = new Date().toISOString()

    sectionLogger(`🤖 Oh My Workers — GitHub Trending — ${today}`)

    // ── Step 1: Scrape GitHub trending ──────────────────────────────────────
    const allRepos = await WorkCoordinator.scrapeTrending()
    if (!allRepos) return

    if (!allRepos.length) {
      logger.info('⏭️ No trending repos found — skipping.')
      return
    }

    // ── Step 2: Rank by stars gained today, keep the top N ──────────────────
    const topRepos = WorkCoordinator.rankByGrowth(allRepos)

    // ── Step 3: Write summaries via LLM ─────────────────────────────────────
    const { curated, error } = await runCuratorGraph(topRepos, WorkCoordinator.curateRepos)

    if (!curated) {
      logger.error({ err: error }, '❌ Trending curation failed after retries')

      await notifyError('Trending curator agent', error ?? 'curation failed after retries')

      return
    }

    if (!curated.length) {
      logger.info('⏭️ No repos curated — skipping send and save.')
      return
    }

    // ── Step 4: Send via Telegram ───────────────────────────────────────────
    const sent = await WorkCoordinator.sendTelegram(curated)

    // ── Step 5: Save to DB ──────────────────────────────────────────────────
    await WorkCoordinator.saveTrending(curated, sent, now)

    sectionLogger(`✅ GitHub Trending job complete for ${today}`)
  }
}

// ── Named exports for backwards compatibility with index.ts and registry.ts ───
export const { runCleanup, runDailyJobs, runNewsAgent } = WorkCoordinator
