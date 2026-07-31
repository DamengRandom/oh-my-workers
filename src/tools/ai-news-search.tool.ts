import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { logger } from '../utils/logger.js'
import { AI_NEWS_DOMAINS, AI_NEWS_FETCH_N, AI_NEWS_LOOKBACK_DAYS, AI_NEWS_QUERY, AI_NEWS_SNIPPET_MAX } from '../constants/index.js'
import type { AiNewsItem } from '../schemas/index.js'

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

// Only the fields the digest actually uses. `score` and `raw_content` come back
// too and are deliberately dropped — see selectUnseen for why score is unused.
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

// Tavily returns RFC-1123 ("Fri, 31 Jul 2026 04:00:00 GMT"). Postgres accepts it,
// but normalising here means the stored value and the message agree.
function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null

  const parsed = new Date(raw)

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

// Exported for testing, and because the digest's whole selection policy is these
// three lines: drop what was already sent, keep Tavily's order, take the top N.
// Tavily's `score` is relevance to the query, not popularity — sorting by it
// promotes whatever best matches the words, not what matters. The query and the
// domain allowlist do the quality work instead.
export function selectUnseen(items: AiNewsItem[], seenUrls: Set<string>, topN: number): AiNewsItem[] {
  return items.filter((item) => !seenUrls.has(item.url)).slice(0, topN)
}

export function toAiNewsItems(results: TavilyResult[]): AiNewsItem[] {
  return results.flatMap((r) => {
    // A result with no URL cannot be deduped, stored, or linked — drop it.
    if (!r.url) return []

    const snippet = r.content ?? ''

    return [
      {
        title: r.title?.trim() || r.url,
        url: r.url,
        source: hostnameOf(r.url),
        snippet: snippet.length > AI_NEWS_SNIPPET_MAX ? `${snippet.slice(0, AI_NEWS_SNIPPET_MAX - 1).trimEnd()}…` : snippet,
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
    const apiKey = process.env.TAVILY_API_KEY ?? ''

    if (!apiKey) throw new Error('TAVILY_API_KEY is not set in environment variables')

    const response = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        topic: 'news',
        days,
        max_results: maxResults,
        search_depth: 'advanced',
        include_domains: domains,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Tavily API error ${response.status}: ${body}`)
    }

    const data = (await response.json()) as { results?: TavilyResult[] }
    const items = toAiNewsItems(data.results ?? [])

    logger.info(`🔍 Tavily returned ${items.length} AI news results from the last ${days} day(s)`)

    return JSON.stringify(items)
  },
})
