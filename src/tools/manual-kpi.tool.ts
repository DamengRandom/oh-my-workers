import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import * as readline from 'readline'
import { logger, prompt } from '../utils/logger.js'

// Read activities from env var (GitHub Actions) or fall back to interactive readline (local terminal)
async function collectActivities(): Promise<string[]> {
  const now = new Date().toISOString()

  // CI mode: MANUAL_ACTIVITIES is set via workflow_dispatch input
  if (process.env.MANUAL_ACTIVITIES) {
    const activities = process.env.MANUAL_ACTIVITIES.split(',')
      .map((a) => a.trim())
      .filter((a) => a.length > 0)

    // non-interactive: this is a log, not a prompt
    logger.info({ activities, at: now }, `📝 Activities received from GitHub Actions input (${activities.length})`)

    return activities
  }

  prompt('\n──────────────────────────────────────────')
  prompt('📝 Anything else you did today?')
  prompt('📝 (Enter each activity on a new line)')
  prompt('📝 Type "done" when finished.\n')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const activities: string[] = []

  rl.setPrompt('  > ')
  rl.prompt()

  for await (const line of rl) {
    const input = line.trim()

    if (input.toLowerCase() === 'done' || input === '') break

    activities.push(input)
    rl.prompt()
  }

  rl.close()

  prompt('──────────────────────────────────────────\n')

  return activities
}

export const manualKpiTool = new DynamicStructuredTool({
  name: 'collect_manual_kpi_input',
  description:
    'Asks the engineer to describe anything they did today that is not captured in GitHub — such as meetings, code reviews, planning sessions, documentation, or mentoring.',
  schema: z.object({}),
  func: async () => {
    const now = new Date().toISOString()
    const activities = await collectActivities()

    logger.info(`✅ Recorded ${activities.length} manual activities`)

    return JSON.stringify({ activities, created_at: now, updated_at: now })
  },
})
