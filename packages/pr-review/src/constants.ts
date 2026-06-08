// Model used for the review reasoning. Haiku 4.5 is the most cost-efficient model
// ($1 / $5 per 1M tokens); we deliberately trade some review depth for cost here.
export const REVIEW_LLM = 'claude-haiku-4-5'

// Caps how many times the agent may read/search context before it must produce a
// verdict. This is the primary bound on worst-case token spend: the agent re-sends
// the whole message history on every turn, so the last calls are the most expensive
// ones — keep this tight.
export const MAX_REVIEW_TOOL_CALLS = 18

// Bounds on individual tool outputs. Tool results are re-sent on every subsequent
// model turn, so capping their size compounds across the whole review.
export const MAX_READ_LINES = 400 // max lines returned by read_file in one call
export const MAX_PATCH_LINES = 300 // max patch lines per file in get_pr_diff
export const MAX_SEARCH_MATCHES = 30 // max matches returned by search_code
