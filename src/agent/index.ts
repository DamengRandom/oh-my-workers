import { cleanupAgent } from './cleanup.agent.js'
import { githubAgent } from './github.agent.js'
import { manualKpiAgent } from './manual-kpi.agent.js'
import { diaryAgent } from './diary.agent.js'
import { saveKpiRecord } from '../storage/own-db.js'
import { sectionLogger } from '../utils/logger.js'

// ── Automated (crontab) — no human input required ─────────────────────────────
export async function runCleanup(): Promise<void> {
  const today = new Date().toISOString().split('T')[0]

  sectionLogger(`🧹 Oh My Workers — Cleanup — ${today}`)

  await cleanupAgent.invoke({
    messages: [{ role: 'user', content: 'Run the stale data cleanup now.' }],
  })

  sectionLogger(`✅ Cleanup complete for ${today}`)
}

// ── Interactive (manual) — requires human at keyboard ─────────────────────────
export async function runDailyJobs(): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const username = process.env.GITHUB_USERNAME
  const now = new Date().toISOString()

  sectionLogger(`🤖 Oh my workers — ${today}`)

  // ── Phase 1: Cleanup + GitHub run in parallel ──────────────────────────────
  console.log('⚡️ Phase 1: Running cleanup and GitHub fetch in parallel...\n')

  // Extract the raw JSON output from the tool message (not the AI's final text reply)
  const toolOutput = (result: { messages: Array<{ _getType?: () => string; content: unknown }> }, toolName: string): string => {
    const msg = result.messages.find((m) => m._getType?.() === 'tool' && (m as { name?: string }).name === toolName)

    return `${msg?.content ?? ''}`
  }

  if (!username) {
    console.error('❌ GitHub username not set in environment variables.')
    return
  }

  const [, githubResult] = await Promise.all([
    cleanupAgent.invoke({
      messages: [{ role: 'user', content: 'Run the stale data cleanup now.' }],
    }),
    githubAgent.invoke({
      messages: [{ role: 'user', content: `Fetch GitHub activity for username "${username}" on date "${today}".` }],
    }),
  ])

  // ── Phase 2: Manual input (interactive, sequential) ────────────────────────
  console.log('\n⚡️ Phase 2: Collecting manual activities...')

  const manualResult = await manualKpiAgent.invoke({
    messages: [{ role: 'user', content: 'Ask the engineer what else they did today.' }],
  })

  // Parse manual input from the tool message (not Claude's final text summary)
  let activities: string[] = []

  try {
    const parsed = JSON.parse(toolOutput(manualResult, 'collect_manual_kpi_input'))
    activities = parsed.activities ?? []
  } catch {
    activities = []
  }

  // ── Phase 3: Conditional — diary only if manual input was provided ──────────
  if (activities.length === 0) {
    console.log('\n⏭️ No manual activities provided — skipping diary, saving GitHub KPI only.\n')

    let githubData: { summary?: string; commits?: unknown[]; pullRequests?: unknown[] } = {}
    try {
      githubData = JSON.parse(toolOutput(githubResult, 'fetch_github_activity'))
    } catch {
      githubData = {}
    }

    await saveKpiRecord({
      github_summary: githubData.summary ?? '',
      commits_count: (githubData.commits as unknown[])?.length ?? 0,
      prs_count: (githubData.pullRequests as unknown[])?.length ?? 0,
      activities: [],
      created_at: now,
      updated_at: now,
    })

    console.log('✅ GitHub KPI record saved.')
  } else {
    console.log(`\n⚡️ Phase 3: Generating daily KPI report (${activities.length} manual activities recorded)...\n`)

    await diaryAgent.invoke({
      messages: [
        {
          role: 'user',
          content: `Write and save today's KPI report using the data below.\n\nGitHub activity:\n${toolOutput(githubResult, 'fetch_github_activity')}\n\nManual activities:\n${toolOutput(manualResult, 'collect_manual_kpi_input')}`,
        },
      ],
    })
  }

  sectionLogger(`✅ All jobs complete for ${today}`)
}
