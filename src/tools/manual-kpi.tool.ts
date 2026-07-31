import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import * as readline from 'readline'
import { logger, prompt } from '../utils/logger.js'

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()

      resolve(answer.trim())
    })
  })
}

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

  // Local mode: interactive readline prompt. These go straight to stdout — a
  // timestamped, levelled log line would not read as a question, and pino's
  // stream does not interleave predictably with readline's own output.
  prompt('\n──────────────────────────────────────────')
  prompt('📝 Anything else you did today?')
  prompt('📝 (Enter each activity on a new line)')
  prompt('📝 Type "done" when finished.\n')

  const activities: string[] = []

  while (true) {
    const input = await promptUser('  > ')

    if (input.toLowerCase() === 'done' || input === '') break
    if (input.length > 0) activities.push(input)
  }

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
