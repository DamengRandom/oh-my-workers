export const DEFAULT_LLM = 'nvidia/nemotron-3-ultra-550b-a55b:free'
export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1'
// Free, tool-capable models OpenRouter falls back to when the primary is at
// capacity. Order matters — first available wins.
export const LLM_FALLBACK_MODELS = ['nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-31b-it:free', 'openai/gpt-oss-20b:free']
// How many repos make the digest, ranked by stars gained today.
export const TRENDING_TOP_N = 8
export const COMPANY_CLEANUP_TABLE = 'mockTestUsers'
export const COMPANY_CLEANUP_THRESHOLD_DAYS = '30'
export const DEFAULT_CRONJOB_TIME = '0 17 * * *'
export const DEFAULT_CRONJOB_TIMEZONE = 'Australia/Sydney' // Change to Your local time zone when you need to use this constant value
export const NEWS_CRON_TIME = '0 22 * * *' // 8:00 AM AEST (UTC+10) / 9:00 AM AEDT (UTC+11, Oct-Apr)
