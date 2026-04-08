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
      try {
        const parsed = JSON.parse(WorkCoordinator.toolOutput(manualResult, 'collect_manual_kpi_input'))
        
        activities = parsed.activities ?? []
      } catch {
        activities = []
      }
    }

    // ── Phase 3: Conditional — diary only if manual input was provided ────────
    if (activities.length === 0) {
      console.log('\n⏭️ No manual activities provided — skipping diary, saving GitHub KPI only.\n')

      let githubData: { summary?: string; commits?: unknown[]; pullRequests?: unknown[] } = {}
      
      try {
        githubData = JSON.parse(WorkCoordinator.toolOutput(githubResult, 'fetch_github_activity'))
      } catch {
        githubData = {}
      }

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
    } else {
      console.log(`\n⚡️ Phase 3: Generating daily KPI report (${activities.length} manual activities recorded)...\n`)

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

    sectionLogger(`✅ All jobs complete for ${today}`)
  }

  // ── Daily GitHub Trending — scrape, dedup, curate, send via Telegram ─────

  static async runNewsAgent(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const now = new Date().toISOString()

    sectionLogger(`🤖 Oh My Workers — GitHub Trending — ${today}`)

    // ── Step 1: Scrape GitHub trending ──────────────────────────────────────
    console.log('⚡️ Scraping GitHub trending repos...\n')

    let allRepos: TrendingRepo[]
    try {
      const raw = await trendingScrapeTool.invoke({ languages: ['typescript', 'javascript'] })
      
      allRepos = JSON.parse(raw)
    } catch (err) {
      console.error('❌ Trending scrape failed:', err instanceof Error ? err.message : err)
      
      await WorkCoordinator.notifyError('Trending scrape', err)
      
      return
    }

    if (!allRepos.length) {
      console.log('⏭️ No trending repos found — skipping.\n')
      
      return
    }

    // ── Step 2: Dedup against recent DB entries ─────────────────────────────
    console.log('⚡️ Deduplicating against recent repos...\n')

    let newRepos: TrendingRepo[]
    try {
      const recentNames = await getRecentRepoNames(7)
      
      newRepos = allRepos.filter((r) => !recentNames.has(r.name))
      
      console.log(`📊 ${allRepos.length} scraped, ${allRepos.length - newRepos.length} duplicates removed, ${newRepos.length} new`)
    } catch (err) {
      console.error('⚠️ Dedup query failed, proceeding with all repos:', err instanceof Error ? err.message : err)
      
      newRepos = allRepos
    }

    if (!newRepos.length) {
      console.log('⏭️ All repos already sent recently — skipping.\n')
      
      return
    }

    // ── Step 3: Curate and summarize via LLM ────────────────────────────────
    console.log('⚡️ Curating top repos...\n')

    let curated: { repos: Array<{ repo_name: string; url: string; description: string; language: string; stars: number; today_stars: number; summary: string; tags: string[] }> }
    
    try {
      const curateResult = await trendingCuratorAgent.invoke({
        messages: [{ role: 'user', content: `Curate the top trending GitHub repos from these results. Pick the top 5-8 most interesting ones:\n\n${JSON.stringify(newRepos)}` }],
      })
      
      curated = JSON.parse(WorkCoordinator.toolOutput(curateResult, 'curate_trending_repos'))
    } catch (err) {
      console.error('❌ Trending curation failed:', err instanceof Error ? err.message : err)
      
      await WorkCoordinator.notifyError('Trending curator agent', err)

      return
    }

    if (!curated.repos.length) {
      console.log('⏭️ No repos curated — skipping send and save.\n')
      return
    }

    // ── Step 4: Send via Telegram ───────────────────────────────────────────
    console.log('⚡️ Sending trending digest via Telegram...\n')

    let sent = false
    
    try {
      await trendingTelegramAgent.invoke({
        messages: [
          {
            role: 'user',
            content: `Send this GitHub trending digest via Telegram now.\n\n${JSON.stringify(curated.repos)}`,
          },
        ],
      })
      sent = true
    } catch (err) {
      console.error('❌ Telegram delivery failed:', err instanceof Error ? err.message : err)
      await WorkCoordinator.notifyError('Trending Telegram agent', err)
    }

    // ── Step 5: Save to DB ──────────────────────────────────────────────────
    try {
      await saveTrendingRepos(
        curated.repos.map((r) => ({
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
      console.log(`✅ Saved ${curated.repos.length} trending repos to database.`)
    } catch (err) {
      console.error('❌ Failed to save trending repos:', err instanceof Error ? err.message : err)
      await WorkCoordinator.notifyError('saveTrendingRepos', err)
    }

    sectionLogger(`✅ GitHub Trending job complete for ${today}`)
  }
}

// ── Named exports for backwards compatibility with index.ts and scheduler.ts ───
export const { runCleanup, runDailyJobs, runNewsAgent } = WorkCoordinator
