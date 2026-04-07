import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const newsCuratorTool = new DynamicStructuredTool({
  name: 'curate_ai_news',
  description: 'Saves the curated list of top AI news articles with summaries.',
  schema: z.object({
    articles: z
      .array(
        z.object({
          title: z.string().describe('Article title'),
          url: z.string().describe('Direct link to the article'),
          summary: z.string().describe('1-2 sentence summary of why this matters'),
        })
      )
      .describe('Top 5-8 curated AI news articles, ranked by importance'),
  }),
  func: async ({ articles }) => {
    const now = new Date().toISOString()

    console.log(`📰 Curated ${articles.length} AI news articles`)

    return JSON.stringify({ articles, created_at: now, updated_at: now })
  },
})
