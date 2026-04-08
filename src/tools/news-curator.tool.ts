import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const trendingCuratorTool = new DynamicStructuredTool({
  name: 'curate_trending_repos',
  description: 'Saves the curated list of top GitHub trending repos with summaries.',
  schema: z.object({
    repos: z
      .array(
        z.object({
          repo_name: z.string().describe('Full repo name e.g. owner/repo'),
          url: z.string().describe('GitHub URL'),
          description: z.string().describe('Repo description'),
          language: z.string().describe('Primary language'),
          stars: z.number().describe('Total star count'),
          today_stars: z.number().describe('Stars gained today'),
          summary: z.string().describe('1-2 sentence summary of why this repo is interesting for a TS/JS developer'),
          tags: z.array(z.string()).describe('3-5 lowercase tags for classification e.g. ["ai", "framework", "typescript", "bundler", "devtools"]'),
        })
      )
      .describe('Top 5-8 curated trending repos, ranked by relevance'),
  }),
  func: async ({ repos }) => {
    const now = new Date().toISOString()

    console.log(`📦 Curated ${repos.length} trending repos`)

    return JSON.stringify({ repos, created_at: now, updated_at: now })
  },
})
