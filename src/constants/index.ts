export const DEFAULT_LLM = 'nvidia/nemotron-3-ultra-550b-a55b:free'
export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1'
// Free, tool-capable models OpenRouter falls back to when the primary is at
// capacity. Order matters — first available wins.
export const LLM_FALLBACK_MODELS = ['nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-31b-it:free', 'openai/gpt-oss-20b:free']
// How many repos make the digest, ranked by stars gained today.
export const TRENDING_TOP_N = 8
export const COMPANY_CLEANUP_TABLE = 'mockTestUsers'
export const COMPANY_CLEANUP_THRESHOLD_DAYS = '30'
// ── AI news digest (Tavily) ──────────────────────────────────────────────────
// How many stories make the digest.
export const AI_NEWS_TOP_N = 4
// Over-fetch: dedupe drops stories already sent, so asking for exactly 4 would
// deliver fewer than 4 on any day with repeats.
export const AI_NEWS_FETCH_N = 10
export const AI_NEWS_LOOKBACK_DAYS = 1
export const AI_NEWS_SNIPPET_MAX = 200
// Telegram drops the whole message past 4096 chars rather than truncating, and
// titleOf falls back to the full url when Tavily returns a blank title.
export const AI_NEWS_TITLE_MAX = 200
// Tavily's `score` is relevance to this query, not popularity — a vague query
// like "artificial intelligence" scores wellness blogs above model launches.
// Digest quality lives here and in AI_NEWS_DOMAINS, not in the ranking.
//
// Scope is AI *technology*: new models, developer tools, releases. Wording the
// query around releases and tools is what keeps funding rounds and stock moves
// out — asking for "industry announcements" pulled in ETFs and defence news.
export const AI_NEWS_QUERY = 'new AI model releases, developer tools, and open source AI software'
// Tech press for launches and product news, developer sources for tooling and
// releases. Deliberately no reuters/bloomberg — their AI coverage is finance,
// which is what dragged in stock and ETF stories.
//
// ponytail: an allowlist, not a hard filter — Tavily treats include_domains as a
// strong hint, so the occasional off-list SEO listicle still slips through. Add
// exclude_domains only if one actually reaches a digest.
export const AI_NEWS_DOMAINS = [
  'techcrunch.com',
  'theverge.com',
  'arstechnica.com',
  'venturebeat.com',
  'theregister.com',
  'infoworld.com',
  'zdnet.com',
  'simonwillison.net',
  'github.blog',
  'huggingface.co',
  'marktechpost.com',
]

export const DEFAULT_CRONJOB_TIME = '0 17 * * *'
export const DEFAULT_CRONJOB_TIMEZONE = 'Australia/Sydney' // Change to Your local time zone when you need to use this constant value
export const NEWS_CRON_TIME = '0 8 * * *' // 8:00 AM Sydney
export const AI_NEWS_CRON_TIME = '30 8 * * *' // 8:30 AM Sydney — 30 min after the trending digest
