import { DynamicStructuredTool } from '@langchain/core/tools'
import { tavily } from '@tavily/core'
import { z } from 'zod'

export const newsSearchTool = new DynamicStructuredTool({
  name: 'search_ai_news',
  description: 'Searches for the latest AI news from the past 24 hours using Tavily.',
  schema: z.object({
    query: z.string().describe('Search query for AI news'),
  }),
  func: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
      throw new Error('TAVILY_API_KEY is not set in environment variables')
    }

    const client = tavily({ apiKey })

    const response = await client.search(query, {
      topic: 'news',
      maxResults: 5,
      timeRange: 'day',
      searchDepth: 'advanced',
    })

    const articles = response.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }))

    console.log(`🔍 Tavily returned ${articles.length} AI news articles`)

    return JSON.stringify(articles)
  },
})
