import { cleanupAgent } from './cleanup.agent.js'
import { githubAgent } from './github.agent.js'
import { manualKpiAgent } from './manual-kpi.agent.js'
import { diaryAgent } from './diary.agent.js'
import { curateTrending } from './news-curator.agent.js'
import { trendingTelegramTool } from '../tools/news-telegram.tool.js'
import { trendingScrapeTool } from '../tools/trending-scrape.tool.js'
import { saveKpiRecord, saveTrendingRepos } from '../storage/own-db.js'
import { sectionLogger } from '../utils/logger.js'
import { notifyError, parseJson, toolOutput } from './utils.ts'
import { AgentResult, CuratedRepo, TrendingRepo } from '../schemas/index.ts'
import { runCuratorGraph } from './curator.graph.ts'
import { TRENDING_TOP_N } from '../constants/index.js'

export class WorkCoordinator {
  // ── Automated (crontab) — no human input required ─────────────────────────

  static async runCleanup(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]

    sectionLogger(`🧹 Oh My Workers — Cleanup — ${today}`)

    try {
      await cleanupAgent.invoke({
        messages: [{ role: 'user', content: 'Run the stale data cleanup now.' }],
      })
      sectionLogger(`✅ Cleanup complete for ${today}`)
    } catch (err) {
      console.error('❌ Cleanup agent failed:', err instanceof Error ? err.message : err)
      await notifyError('Cleanup agent', err)
    }
  }

  // ── Daily jobs: helpers ───────────────────────────────────────────────────

  // Phase 2: ask the engineer for manual activities. Failures are non-critical,
  // so this swallows errors and returns an empty activity list.
  private static async collectManualActivities(): Promise<{ manualResult: AgentResult | null; activities: string[] }> {
    let manualResult: AgentResult | null = null

    try {
      manualResult = await manualKpiAgent.invoke({
        messages: [{ role: 'user', content: 'Ask the engineer what else they did today.' }],
      })
    } catch (err) {
      console.error('❌ Manual KPI agent failed:', err instanceof Error ? err.message : err)
      await notifyError('Manual KPI agent', err)
      // non-critical — continue with GitHub data only
    }

    let activities: string[] = []

    if (manualResult) {
      const parsed = parseJson<{ activities?: string[] }>(toolOutput(manualResult, 'collect_manual_kpi_input'), {})
      activities = parsed.activities ?? []
    }

    return { manualResult, activities }
  }

  // Phase 3a: no manual activities — persist a GitHub-only KPI record.
  private static async saveGithubOnlyKpi(githubResult: AgentResult, now: string): Promise<void> {
    console.log('\n⏭️ No manual activities provided — skipping diary, saving GitHub KPI only.\n')

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
      console.log('✅ GitHub KPI record saved.')
    } catch (err) {
      console.error('❌ Failed to save KPI record:', err instanceof Error ? err.message : err)

      await notifyError('saveKpiRecord', err)
    }
  }

  // Phase 3b: manual activities present — generate and save the full KPI report.
  private static async generateDiaryReport(githubResult: AgentResult, manualResult: AgentResult | null, activityCount: number): Promise<void> {
    console.log(`\n⚡️ Phase 3: Generating daily KPI report (${activityCount} manual activities recorded)...\n`)

    try {
      await diaryAgent.invoke({
        messages: [
          {
            role: 'user',
            content: `Write and save today's KPI report using the data below.\n\nGitHub activity:\n${toolOutput(githubResult, 'fetch_github_activity')}\n\nManual activities:\n${manualResult ? toolOutput(manualResult, 'collect_manual_kpi_input') : ''}`,
          },
        ],
      })
    } catch (err) {
      console.error('❌ Diary agent failed:', err instanceof Error ? err.message : err)

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
      console.error('❌ GitHub username not set in environment variables.')
      await notifyError('Daily jobs startup', 'TARGET_GITHUB_USERNAME is not set')
      return
    }

    // ── Phase 1: Cleanup + GitHub run in parallel ────────────────────────────
    console.log('⚡️ Phase 1: Running cleanup and GitHub fetch in parallel...\n')

    const [cleanupSettled, githubSettled] = await Promise.allSettled([
      cleanupAgent.invoke({
        messages: [{ role: 'user', content: 'Run the stale data cleanup now.' }],
      }),
      githubAgent.invoke({
        messages: [{ role: 'user', content: `Fetch GitHub activity for username "${username}" on date "${today}".` }],
      }),
    ])

    if (cleanupSettled.status === 'rejected') {
      console.error('❌ Cleanup agent failed:', cleanupSettled.reason)

      await notifyError('Cleanup agent (daily jobs)', cleanupSettled.reason)
      // non-critical — continue with GitHub + diary
    }

    if (githubSettled.status === 'rejected') {
      console.error('❌ GitHub agent failed:', githubSettled.reason)

      await notifyError('GitHub agent', githubSettled.reason)

      return // can't generate a meaningful KPI report without GitHub data
    }

    const githubResult = githubSettled.value

    // ── Phase 2: Manual input (interactive, sequential) ──────────────────────
    console.log('\n⚡️ Phase 2: Collecting manual activities...')

    const { manualResult, activities } = await WorkCoordinator.collectManualActivities()

    // ── Phase 3: Conditional — diary only if manual input was provided ────────
    if (activities.length === 0) {
      await WorkCoordinator.saveGithubOnlyKpi(githubResult, now)
    } else {
      await WorkCoordinator.generateDiaryReport(githubResult, manualResult, activities.length)
    }

    sectionLogger(`✅ All jobs complete for ${today}`)
  }

  // ── GitHub Trending: helpers ───────────────────────────────────────────────

  // Step 1: scrape GitHub trending. Returns null on failure (already notified).
  private static async scrapeTrending(): Promise<TrendingRepo[] | null> {
    console.log('⚡️ Scraping GitHub trending repos...\n')

    try {
      const raw = await trendingScrapeTool.invoke({ languages: ['typescript', 'javascript'] })

      return JSON.parse(raw) as TrendingRepo[]
    } catch (err) {
      console.error('❌ Trending scrape failed:', err instanceof Error ? err.message : err)

      await notifyError('Trending scrape', err)

      return null
    }
  }

  // Step 2: rank by stars gained today and keep the top N. Selection is a sort,
  // not a judgement call — the model never sees the repos that lost.
  private static rankByGrowth(newRepos: TrendingRepo[]): TrendingRepo[] {
    const top = [...newRepos].sort((a, b) => b.todayStars - a.todayStars).slice(0, TRENDING_TOP_N)

    console.log(`📈 Top ${top.length} by stars gained today: ${top[0]?.todayStars ?? 0} down to ${top.at(-1)?.todayStars ?? 0}`)

    return top
  }

  // Step 3: write summaries for the ranked repos. One attempt — retries and final
  // failure notification are handled by runCuratorGraph / runNewsAgent.
  private static async curateRepos(newRepos: TrendingRepo[], feedback?: string): Promise<string> {
    console.log('⚡️ Writing digest summaries...\n')

    try {
      return await curateTrending(newRepos, feedback)
    } catch (err) {
      console.error('❌ Trending curation attempt failed:', err instanceof Error ? err.message : err)

      return ''
    }
  }

  // Step 4: deliver the digest via Telegram. Returns whether the send succeeded.
  private static async sendTelegram(repos: CuratedRepo[]): Promise<boolean> {
    console.log('⚡️ Sending trending digest via Telegram...\n')

    try {
      await trendingTelegramTool.invoke({ repos })
      return true
    } catch (err) {
      console.error('❌ Telegram delivery failed:', err instanceof Error ? err.message : err)
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
      console.log(`✅ Saved ${repos.length} trending repos to database.`)
    } catch (err) {
      console.error('❌ Failed to save trending repos:', err instanceof Error ? err.message : err)
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
      console.log('⏭️ No trending repos found — skipping.\n')
      return
    }

    // ── Step 2: Rank by stars gained today, keep the top N ──────────────────
    const topRepos = WorkCoordinator.rankByGrowth(allRepos)

    // ── Step 3: Write summaries via LLM ─────────────────────────────────────
    const { curated, error } = await runCuratorGraph(topRepos, WorkCoordinator.curateRepos)

    if (!curated) {
      console.error('❌ Trending curation failed after retries:', error)

      await notifyError('Trending curator agent', error ?? 'curation failed after retries')

      return
    }

    if (!curated.length) {
      console.log('⏭️ No repos curated — skipping send and save.\n')
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
