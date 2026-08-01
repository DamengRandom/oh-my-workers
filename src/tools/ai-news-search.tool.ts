import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { logger } from '../utils/logger.js'
import { AI_NEWS_DOMAINS, AI_NEWS_FETCH_N, AI_NEWS_LOOKBACK_DAYS, AI_NEWS_QUERY, AI_NEWS_SNIPPET_MAX } from '../constants/index.js'
import { truncate } from '../agent/utils.js'
import type { AiNewsItem } from '../schemas/index.js'

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

type TavilyResult = {
  title?: string
  url?: string
  content?: string
  published_date?: string | null
}

// "reuters.com", not "https://www.reuters.com/tech/..." — this is a byline, not a link.
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null

  const parsed = new Date(raw)

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

async function searchTavily(body: Record<string, unknown>): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY ?? ''

  if (!apiKey) throw new Error('TAVILY_API_KEY is not set in environment variables')

  const response = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Tavily API error ${response.status}: ${await response.text()}`)
  }

  const data = (await response.json()) as { results?: TavilyResult[] }

  return data.results ?? []
}

export function selectUnseen(items: AiNewsItem[], seenUrls: Set<string>, topN: number): AiNewsItem[] {
  return items.filter((item) => !seenUrls.has(item.url)).slice(0, topN)
}

function titleOf(r: TavilyResult): string {
  return r.title?.trim() || String(r.url)
}

export function toAiNewsItems(results: TavilyResult[]): AiNewsItem[] {
  return results.flatMap((r) => {
    // A result with no URL cannot be deduped, stored, or linked — drop it.
    if (!r.url) return []

    return [
      {
        title: titleOf(r),
        url: r.url,
        source: hostnameOf(r.url),
        snippet: truncate(r.content ?? '', AI_NEWS_SNIPPET_MAX),
        published_date: toIsoDate(r.published_date),
      },
    ]
  })
}

export const aiNewsSearchTool = new DynamicStructuredTool({
  name: 'search_ai_news',
  description: 'Searches recent AI industry news (model releases, funding, announcements) via Tavily.',
  schema: z.object({
    query: z.string().default(AI_NEWS_QUERY).describe('The news search query'),
    days: z.number().default(AI_NEWS_LOOKBACK_DAYS).describe('How many days back to search'),
    maxResults: z.number().default(AI_NEWS_FETCH_N).describe('How many results to fetch before dedupe'),
    domains: z.array(z.string()).default(AI_NEWS_DOMAINS).describe('Restrict results to these news outlets'),
  }),
  func: async ({ query, days, maxResults, domains }) => {
    const results = await searchTavily({
      query,
      topic: 'news',
      days,
      max_results: maxResults,
      search_depth: 'advanced',
      include_domains: domains,
    })

    const items = toAiNewsItems(results)

    logger.info(`🔍 Tavily returned ${items.length} AI news results from the last ${days} day(s)`)

    return JSON.stringify(items)
  },
})
