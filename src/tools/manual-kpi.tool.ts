import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import * as readline from 'readline'

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()

      resolve(answer.trim())
    })
  })
}

export const manualKpiTool = new DynamicStructuredTool({
  name: 'collect_manual_kpi_input',
  description:
    'Asks the engineer to describe anything they did today that is not captured in GitHub — such as meetings, code reviews, planning sessions, documentation, or mentoring.',
  schema: z.object({}),
  func: async () => {
    const now = new Date().toISOString()

    console.log('\n──────────────────────────────────────────')
    console.log('📝 Anything else you did today?')
    console.log('📝 (Enter each activity on a new line)')
    console.log('📝 Type "done" when finished.\n')

    const activities: string[] = []

    while (true) {
      const input = await promptUser('  > ')

      if (input.toLowerCase() === 'done' || input === '') break
      if (input.length > 0) activities.push(input)
    }

    console.log('──────────────────────────────────────────\n')
    console.log(`✅ Recorded ${activities.length} manual activities`)

    return JSON.stringify({ activities, created_at: now, updated_at: now })
  },
})
