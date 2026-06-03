import { cleanupAgent } from './cleanup.agent.js'
import { githubAgent } from './github.agent.js'
import { manualKpiAgent } from './manual-kpi.agent.js'
import { diaryAgent } from './diary.agent.js'
import { trendingCuratorAgent } from './news-curator.agent.js'
import { trendingTelegramAgent } from './news-telegram.agent.js'
import { trendingScrapeTool, type TrendingRepo } from '../tools/trending-scrape.tool.js'
import { saveKpiRecord, saveTrendingRepos, getRecentRepoNames } from '../storage/own-db.js'
import { sectionLogger } from '../utils/logger.js'

type AgentResult = { messages: Array<{ _getType?: () => string; content: unknown }> }

type CuratedRepo = {
  repo_name: string
  url: string
  description: string
  language: string
  stars: number
  today_stars: number
  summary: string
  tags: string[]
}

export class WorkCoordinator {
  // ── Shared helpers ────────────────────────────────────────────────────────

  private static toolOutput(result: AgentResult, toolName: string): string {
    const msg = result.messages.find((m) => m._getType?.() === 'tool' && (m as { name?: string }).name === toolName)
    if (!msg) return ''

    const content = msg.content

    // LangChain sometimes returns content as an array of content blocks
    if (Array.isArray(content)) {
      const block = content.find((c: unknown) => typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text')
      return block ? (block as { text: string }).text : JSON.stringify(content)
    }

    return `${content ?? ''}`
  }

  // Parse JSON, returning a fallback on any error instead of throwing.
  private static parseJson<T>(raw: string, fallback: T): T {
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  // Send a Telegram alert when an agent or job fails.
  // Never throws — error notifications must not cause further errors.
  private static async notifyError(context: string, error: unknown): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (!token || !chatId) return

    const message = [
      `⚠️ <b>Oh My Workers — Job Failed</b>`,
      ``,
      `<b>Where:</b> ${context}`,
      `<b>Error:</b> ${error instanceof Error ? error.message : String(error)}`,
    ].join('\n')

    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
      })
    } catch {
      // intentionally silent — notifyError must never throw
    }
  }

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
      await WorkCoordinator.notifyError('Cleanup agent', err)
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
      await WorkCoordinator.notifyError('Manual KPI agent', err)
      // non-critical — continue with GitHub data only
    }

    let activities: string[] = []
    if (manualResult) {
      const parsed = WorkCoordinator.parseJson<{ activities?: string[] }>(WorkCoordinator.toolOutput(manualResult, 'collect_manual_kpi_input'), {})
      activities = parsed.activities ?? []
    }

    return { manualResult, activities }
  }

  // Phase 3a: no manual activities — persist a GitHub-only KPI record.
  private static async saveGithubOnlyKpi(githubResult: AgentResult, now: string): Promise<void> {
    console.log('\n⏭️ No manual activities provided — skipping diary, saving GitHub KPI only.\n')

    const githubData = WorkCoordinator.parseJson<{ summary?: string; commits?: unknown[]; pullRequests?: unknown[] }>(
      WorkCoordinator.toolOutput(githubResult, 'fetch_github_activity'),
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
      await WorkCoordinator.notifyError('saveKpiRecord', err)
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
            content: `Write and save today's KPI report using the data below.\n\nGitHub activity:\n${WorkCoordinator.toolOutput(githubResult, 'fetch_github_activity')}\n\nManual activities:\n${manualResult ? WorkCoordinator.toolOutput(manualResult, 'collect_manual_kpi_input') : ''}`,
          },
        ],
      })
    } catch (err) {
      console.error('❌ Diary agent failed:', err instanceof Error ? err.message : err)
      await WorkCoordinator.notifyError('Diary agent', err)
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
      await WorkCoordinator.notifyError('Daily jobs startup', 'TARGET_GITHUB_USERNAME is not set')
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
      await WorkCoordinator.notifyError('Cleanup agent (daily jobs)', cleanupSettled.reason)
      // non-critical — continue with GitHub + diary
    }

    if (githubSettled.status === 'rejected') {
      console.error('❌ GitHub agent failed:', githubSettled.reason)
      await WorkCoordinator.notifyError('GitHub agent', githubSettled.reason)
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
      await WorkCoordinator.notifyError('Trending scrape', err)
      return null
    }
  }

  // Step 2: drop repos seen in the last 7 days. Falls back to all repos on error.
  private static async dedupRepos(allRepos: TrendingRepo[]): Promise<TrendingRepo[]> {
    console.log('⚡️ Deduplicating against recent repos...\n')

    try {
      const recentNames = await getRecentRepoNames(7)
      const newRepos = allRepos.filter((r) => !recentNames.has(r.name))
      console.log(`📊 ${allRepos.length} scraped, ${allRepos.length - newRepos.length} duplicates removed, ${newRepos.length} new`)
      return newRepos
    } catch (err) {
      console.error('⚠️ Dedup query failed, proceeding with all repos:', err instanceof Error ? err.message : err)
      return allRepos
    }
  }

  // Step 3: curate + summarize via LLM. Returns null on failure (already notified).
  private static async curateRepos(newRepos: TrendingRepo[]): Promise<CuratedRepo[] | null> {
    console.log('⚡️ Curating top repos...\n')

    try {
      const curateResult = await trendingCuratorAgent.invoke({
        messages: [
          {
            role: 'user',
            content: `Curate the top trending GitHub repos from these results. Pick the top 5-8 most interesting ones:\n\n${JSON.stringify(newRepos)}`,
          },
        ],
      })
      const curated = WorkCoordinator.parseJson<{ repos?: CuratedRepo[] }>(WorkCoordinator.toolOutput(curateResult, 'curate_trending_repos'), {})
      return curated.repos ?? []
    } catch (err) {
      console.error('❌ Trending curation failed:', err instanceof Error ? err.message : err)
      await WorkCoordinator.notifyError('Trending curator agent', err)
      return null
    }
  }

  // Step 4: deliver the digest via Telegram. Returns whether the send succeeded.
  private static async sendTelegram(repos: CuratedRepo[]): Promise<boolean> {
    console.log('⚡️ Sending trending digest via Telegram...\n')

    try {
      await trendingTelegramAgent.invoke({
        messages: [
          {
            role: 'user',
            content: `Send this GitHub trending digest via Telegram now.\n\n${JSON.stringify(repos)}`,
          },
        ],
      })
      return true
    } catch (err) {
      console.error('❌ Telegram delivery failed:', err instanceof Error ? err.message : err)
      await WorkCoordinator.notifyError('Trending Telegram agent', err)
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
      await WorkCoordinator.notifyError('saveTrendingRepos', err)
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

    // ── Step 2: Dedup against recent DB entries ─────────────────────────────
    const newRepos = await WorkCoordinator.dedupRepos(allRepos)

    if (!newRepos.length) {
      console.log('⏭️ All repos already sent recently — skipping.\n')
      return
    }

    // ── Step 3: Curate and summarize via LLM ────────────────────────────────
    const repos = await WorkCoordinator.curateRepos(newRepos)
    if (!repos) return

    if (!repos.length) {
      console.log('⏭️ No repos curated — skipping send and save.\n')
      return
    }

    // ── Step 4: Send via Telegram ───────────────────────────────────────────
    const sent = await WorkCoordinator.sendTelegram(repos)

    // ── Step 5: Save to DB ──────────────────────────────────────────────────
    await WorkCoordinator.saveTrending(repos, sent, now)

    sectionLogger(`✅ GitHub Trending job complete for ${today}`)
  }
}

// ── Named exports for backwards compatibility with index.ts and scheduler.ts ───
export const { runCleanup, runDailyJobs, runNewsAgent } = WorkCoordinator
