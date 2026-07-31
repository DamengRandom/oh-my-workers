import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aiNewsSearchTool, selectUnseen, toAiNewsItems } from './ai-news-search.tool.ts'
import { AI_NEWS_SNIPPET_MAX } from '../constants/index.ts'
import type { AiNewsItem } from '../schemas/index.ts'

const item = (url: string): AiNewsItem => ({
  title: `story at ${url}`,
  url,
  source: 'example.com',
  snippet: 'snippet',
  published_date: null,
})

// Runs fn with a stubbed global fetch, restoring the real one afterwards.
async function withFetch(stub: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const real = globalThis.fetch

  globalThis.fetch = stub

  try {
    await fn()
  } finally {
    globalThis.fetch = real
  }
}

const okResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

// ── Mapping ──────────────────────────────────────────────────────────────────

test('maps a Tavily result onto the fields the digest uses', () => {
  const [mapped] = toAiNewsItems([
    {
      title: '  Anthropic rolls out Opus 5  ',
      url: 'https://www.reuters.com/tech/anthropic-opus-5',
      content: 'Anthropic said the new model cuts inference cost.',
      published_date: 'Thu, 30 Jul 2026 19:03:00 GMT',
      // Tavily also returns these — neither should survive.
      score: 0.359,
      raw_content: 'the entire page text',
    } as never,
  ])

  assert.equal(mapped.title, 'Anthropic rolls out Opus 5')
  assert.equal(mapped.source, 'reuters.com') // www. stripped
  assert.equal(mapped.published_date, '2026-07-30T19:03:00.000Z')
  assert.deepEqual(Object.keys(mapped).sort(), ['published_date', 'snippet', 'source', 'title', 'url'])
})

test('keeps a missing published_date as null instead of an invalid date', () => {
  const [noDate] = toAiNewsItems([{ url: 'https://a.com/x', title: 't', content: 'c' }])
  const [badDate] = toAiNewsItems([{ url: 'https://a.com/y', title: 't', content: 'c', published_date: 'not a date' }])

  assert.equal(noDate.published_date, null)
  assert.equal(badDate.published_date, null)
})

test('truncates a long snippet and leaves a short one alone', () => {
  const long = 'x'.repeat(AI_NEWS_SNIPPET_MAX + 500)
  const [truncated] = toAiNewsItems([{ url: 'https://a.com/x', title: 't', content: long }])
  const [short] = toAiNewsItems([{ url: 'https://a.com/y', title: 't', content: 'short one' }])

  assert.equal(truncated.snippet.length, AI_NEWS_SNIPPET_MAX)
  assert.ok(truncated.snippet.endsWith('…'))
  assert.equal(short.snippet, 'short one')
})

test('drops a result with no url — it cannot be deduped, stored, or linked', () => {
  const items = toAiNewsItems([
    { title: 'orphan', content: 'c' },
    { url: 'https://a.com/x', title: 'keeper' },
  ])

  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'keeper')
})

// ── Selection ────────────────────────────────────────────────────────────────

test('drops already-sent urls and still fills the digest from the over-fetch', () => {
  const fetched = Array.from({ length: 10 }, (_, i) => item(`https://a.com/${i}`))
  const seen = new Set(['https://a.com/0', 'https://a.com/1', 'https://a.com/2'])

  const picked = selectUnseen(fetched, seen, 4)

  assert.equal(picked.length, 4)
  assert.deepEqual(
    picked.map((p) => p.url),
    ['https://a.com/3', 'https://a.com/4', 'https://a.com/5', 'https://a.com/6']
  )
})

test('sends what survives rather than padding when fewer than N are fresh', () => {
  const fetched = [item('https://a.com/0'), item('https://a.com/1'), item('https://a.com/2')]
  const seen = new Set(['https://a.com/0'])

  assert.equal(selectUnseen(fetched, seen, 4).length, 2)
  assert.equal(selectUnseen(fetched, new Set(fetched.map((f) => f.url)), 4).length, 0)
})

test('preserves Tavily ordering — score is relevance, not popularity, so it is never re-sorted', () => {
  const fetched = [item('https://a.com/first'), item('https://a.com/second')]

  assert.deepEqual(
    selectUnseen(fetched, new Set(), 4).map((p) => p.url),
    ['https://a.com/first', 'https://a.com/second']
  )
})

// ── Tool boundary ────────────────────────────────────────────────────────────

test('throws when TAVILY_API_KEY is missing', async () => {
  const saved = process.env.TAVILY_API_KEY
  delete process.env.TAVILY_API_KEY

  try {
    await assert.rejects(() => aiNewsSearchTool.invoke({}), /TAVILY_API_KEY is not set/)
  } finally {
    if (saved !== undefined) process.env.TAVILY_API_KEY = saved
  }
})

test('throws with the status code so the Telegram alert says what happened', async () => {
  process.env.TAVILY_API_KEY = 'test-key'

  await withFetch(
    async () => new Response('usage limit exceeded', { status: 432 }),
    async () => {
      await assert.rejects(() => aiNewsSearchTool.invoke({}), /Tavily API error 432: usage limit exceeded/)
    }
  )
})

test('sends the query, the domain allowlist and the news topic to Tavily', async () => {
  process.env.TAVILY_API_KEY = 'test-key'

  let sent: Record<string, unknown> = {}

  await withFetch(
    async (_url, init) => {
      sent = JSON.parse(String(init?.body))
      return okResponse({ results: [] })
    },
    async () => {
      await aiNewsSearchTool.invoke({ query: 'custom query', days: 3, maxResults: 7, domains: ['reuters.com'] })
    }
  )

  assert.equal(sent.query, 'custom query')
  assert.equal(sent.topic, 'news')
  assert.equal(sent.days, 3)
  assert.equal(sent.max_results, 7)
  assert.deepEqual(sent.include_domains, ['reuters.com'])
})

test('returns an empty list when Tavily returns no results field at all', async () => {
  process.env.TAVILY_API_KEY = 'test-key'

  await withFetch(
    async () => okResponse({}),
    async () => {
      assert.deepEqual(JSON.parse(await aiNewsSearchTool.invoke({})), [])
    }
  )
})
