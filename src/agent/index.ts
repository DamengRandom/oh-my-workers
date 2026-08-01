import { githubAgent } from './github.agent.js'
import { diaryAgent } from './diary.agent.js'
import { curateTrending } from './news-curator.agent.js'
import { cleanupTool } from '../tools/cleanup.tool.js'
import { manualKpiTool } from '../tools/manual-kpi.tool.js'
import { trendingTelegramTool } from '../tools/news-telegram.tool.js'
import { trendingScrapeTool } from '../tools/trending-scrape.tool.js'
import { aiNewsSearchTool, selectUnseen } from '../tools/ai-news-search.tool.js'
import { aiNewsTelegramTool } from '../tools/ai-news-telegram.tool.js'
import { saveKpiRecord, saveTrendingRepos, saveAiNews, findSeenUrls } from '../storage/own-db.js'
import { sectionLogger, logger } from '../utils/logger.js'
import { notifyError, parseJson, toolOutput } from './utils.ts'
import { AgentResult, AiNewsItem, CuratedRepo, TrendingRepo } from '../schemas/index.ts'
import { runCuratorGraph } from './curator.graph.ts'
import { toKpiRecord } from './kpi-record.ts'
import { AI_NEWS_TOP_N, TRENDING_TOP_N } from '../constants/index.js'

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

    try {
      await saveKpiRecord(toKpiRecord(toolOutput(githubResult, 'fetch_github_activity'), now))
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
      await diaryAgent().invoke({
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
      githubAgent().invoke({
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

    return curateTrending(newRepos, feedback)
  }

  // Step 4: deliver the digest via Telegram. Returns the repo names that went out.
  private static async sendTelegram(repos: CuratedRepo[]): Promise<Set<string>> {
    logger.info('⚡️ Sending trending digest via Telegram...')

    try {
      const raw = await trendingTelegramTool.invoke({ repos })
      const { delivered } = parseJson<{ delivered?: string[] }>(raw, {})

      return new Set(delivered ?? [])
    } catch (err) {
      logger.error({ err }, '❌ Telegram delivery failed')
      await notifyError('Trending Telegram delivery', err)
      return new Set()
    }
  }

  // Step 5: persist the curated repos, tagging each with whether it was delivered.
  private static async saveTrending(repos: CuratedRepo[], delivered: Set<string>, now: string): Promise<void> {
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
          sent: delivered.has(r.repo_name),
          created_at: now,
          updated_at: now,
        }))
      )
      logger.info(`✅ Saved ${repos.length} trending repos to database (${delivered.size} marked sent).`)
    } catch (err) {
      logger.error({ err }, '❌ Failed to save trending repos')
      await notifyError('saveTrendingRepos', err)
    }
  }

  // ── AI news digest: helpers ────────────────────────────────────────────────

  // Step 1: search Tavily. Returns null on failure (already notified).
  private static async searchAiNews(): Promise<AiNewsItem[] | null> {
    logger.info('⚡️ Searching AI news via Tavily...')

    try {
      const raw = await aiNewsSearchTool.invoke({})

      return JSON.parse(raw) as AiNewsItem[]
    } catch (err) {
      logger.error({ err }, '❌ AI news search failed')

      await notifyError('AI news search', err)

      return null
    }
  }

  // Step 2: drop stories already sent, keep Tavily's order, take the top N.
  // A DB failure here is not fatal — better a possible repeat than no digest.
  private static async pickFreshStories(items: AiNewsItem[]): Promise<AiNewsItem[]> {
    let seen = new Set<string>()

    try {
      seen = await findSeenUrls(items.map((i) => i.url))
    } catch (err) {
      logger.error({ err }, '⚠️ Could not check for already-sent stories — continuing without dedupe')
    }

    const fresh = selectUnseen(items, seen, AI_NEWS_TOP_N)

    logger.info(`📰 ${fresh.length} fresh stories (${seen.size} of ${items.length} already sent)`)

    return fresh
  }

  // Step 3: deliver the digest via Telegram. Returns whether the send succeeded.
  private static async sendAiNewsTelegram(items: AiNewsItem[]): Promise<boolean> {
    logger.info('⚡️ Sending AI news digest via Telegram...')

    try {
      await aiNewsTelegramTool.invoke({ items })
      return true
    } catch (err) {
      logger.error({ err }, '❌ AI news Telegram delivery failed')
      await notifyError('AI news Telegram delivery', err)
      return false
    }
  }

  // Step 4: persist the stories, tagging whether delivery succeeded. Saved even
  // on a failed send, so a Telegram outage does not silently lose the digest.
  private static async saveAiNewsItems(items: AiNewsItem[], sent: boolean, now: string): Promise<void> {
    try {
      await saveAiNews(items.map((item) => ({ ...item, sent, created_at: now, updated_at: now })))
      logger.info(`✅ Saved ${items.length} AI news stories to database.`)
    } catch (err) {
      logger.error({ err }, '❌ Failed to save AI news stories')
      await notifyError('saveAiNews', err)
    }
  }

  // ── Daily AI news — search, dedupe, send via Telegram ─────────────────────

  static async runAiNewsAgent(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const now = new Date().toISOString()

    sectionLogger(`🤖 Oh My Workers — AI News — ${today}`)

    // ── Step 1: Search Tavily ───────────────────────────────────────────────
    const results = await WorkCoordinator.searchAiNews()
    if (!results) return

    if (!results.length) {
      logger.info('⏭️ No AI news found — skipping.')
      return
    }

    // ── Step 2: Drop already-sent stories, keep the top N ───────────────────
    const fresh = await WorkCoordinator.pickFreshStories(results)

    if (!fresh.length) {
      logger.info('⏭️ Every story was already sent — skipping send and save.')
      return
    }

    // ── Step 3: Send via Telegram ───────────────────────────────────────────
    const sent = await WorkCoordinator.sendAiNewsTelegram(fresh)

    // ── Step 4: Save to DB ──────────────────────────────────────────────────
    await WorkCoordinator.saveAiNewsItems(fresh, sent, now)

    sectionLogger(`✅ AI News job complete for ${today}`)
  }

  // Steps 1-2 together: scrape, then rank. Returns null when there is nothing
  // worth curating — a failed scrape (already notified) or an empty page.
  private static async collectTopRepos(): Promise<TrendingRepo[] | null> {
    const allRepos = await WorkCoordinator.scrapeTrending()
    if (!allRepos) return null

    if (!allRepos.length) {
      logger.info('⏭️ No trending repos found — skipping.')
      return null
    }

    return WorkCoordinator.rankByGrowth(allRepos)
  }

  // Step 3 with its failure handling: null means stop, and the alert has already been sent.
  private static async curateOrNotify(topRepos: TrendingRepo[]): Promise<CuratedRepo[] | null> {
    const { curated, error } = await runCuratorGraph(topRepos, WorkCoordinator.curateRepos)

    if (!curated) {
      logger.error({ err: error }, '❌ Trending curation failed after retries')

      await notifyError('Trending curator agent', error ?? 'curation failed after retries')

      return null
    }

    return curated
  }

  // ── Daily GitHub Trending — scrape, dedup, curate, send via Telegram ─────

  static async runNewsAgent(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const now = new Date().toISOString()

    sectionLogger(`🤖 Oh My Workers — GitHub Trending — ${today}`)

    // ── Steps 1-2: Scrape GitHub trending, rank, keep the top N ─────────────
    const topRepos = await WorkCoordinator.collectTopRepos()
    if (!topRepos) return

    // ── Step 3: Write summaries via LLM ─────────────────────────────────────
    const curated = await WorkCoordinator.curateOrNotify(topRepos)
    if (!curated) return

    // ── Step 4: Send via Telegram ───────────────────────────────────────────
    const delivered = await WorkCoordinator.sendTelegram(curated)

    // ── Step 5: Save to DB ──────────────────────────────────────────────────
    await WorkCoordinator.saveTrending(curated, delivered, now)

    sectionLogger(`✅ GitHub Trending job complete for ${today}`)
  }
}

// ── Named exports for backwards compatibility with index.ts and registry.ts ───
export const { runCleanup, runDailyJobs, runNewsAgent, runAiNewsAgent } = WorkCoordinator
