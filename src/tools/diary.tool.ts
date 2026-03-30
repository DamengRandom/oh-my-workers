import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'
import { saveDiaryEntry, saveKpiRecord } from '../storage/own-db.js'

export const diaryTool = new DynamicStructuredTool({
  name: 'save_daily_kpi_report',
  description:
    'Saves the final daily KPI report to the diary table in the database and writes a markdown file. Also saves the structured KPI record to the kpi table.',
  schema: z.object({
    report_content: z.string().describe('The full AI-generated daily KPI report in plain English'),
    github_summary: z.string().describe('Short summary of GitHub activity'),
    commits_count: z.number().describe('Total number of commits today'),
    prs_count: z.number().describe('Total number of pull requests today'),
    activities: z.array(z.string()).describe('Manual activities entered by the engineer'),
  }),
  func: async ({ report_content, github_summary, commits_count, prs_count, activities }) => {
    const now = new Date().toISOString()
    const dateStr = now.split('T')[0] // YYYY-MM-DD

    // Save to kpi table
    await saveKpiRecord({
      github_summary,
      commits_count,
      prs_count,
      activities,
      created_at: now,
      updated_at: now,
    })

    // Save to diary table
    await saveDiaryEntry({
      content: report_content,
      created_at: now,
      updated_at: now,
    })

    // Also write a local markdown file for easy reading
    const diaryDir = path.join(process.cwd(), 'data', 'diary')

    if (!fs.existsSync(diaryDir)) fs.mkdirSync(diaryDir, { recursive: true })

    const filePath = path.join(diaryDir, `${dateStr}.md`)

    fs.writeFileSync(filePath, `# Daily KPI Report — ${dateStr}\n\n${report_content}`)

    console.log(`✅ KPI report saved to database and ${filePath}`)

    return JSON.stringify({ success: true, date: dateStr, file: filePath })
  },
})
