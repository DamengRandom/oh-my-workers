export const DEFAULT_LLM = 'nvidia/nemotron-3-ultra-550b-a55b:free'
export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1'
export const LLM_FALLBACK_MODELS = ['nvidia/nemotron-3-super-120b-a12b:free']
// How many repos make the digest, ranked by stars gained today.
export const TRENDING_TOP_N = 8
export const TELEGRAM_MAX_CHARS = 4096
export const LANGSMITH_URL = 'https://smith.langchain.com'
export const TRENDING_SUMMARY_MAX = 140
export const TRENDING_TAGS_MAX = 5
export const TRENDING_TAG_MAX = 24
export const COMPANY_CLEANUP_TABLE = 'mockTestUsers'
export const COMPANY_CLEANUP_THRESHOLD_DAYS = '30'
// ── AI news digest (Tavily) ──────────────────────────────────────────────────
export const AI_NEWS_TOP_N = 4 // How many stories make the digest.
export const AI_NEWS_FETCH_N = 10
export const AI_NEWS_LOOKBACK_DAYS = 1
export const AI_NEWS_SNIPPET_MAX = 200
export const AI_NEWS_TITLE_MAX = 200
export const AI_NEWS_QUERY = 'new AI model releases, developer tools, and open source AI software'
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
export const NEWS_CRON_TIME = '0 7 * * *' // 7:00 AM Sydney
export const AI_NEWS_CRON_TIME = '30 7 * * *' // 7:30 AM Sydney — 30 min after the trending digest
