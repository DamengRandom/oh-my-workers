// Model used for the review reasoning. Sonnet balances code-reasoning quality and cost;
export const REVIEW_LLM = 'claude-haiku-4-5'

// Caps how many times the agent may read/search context before it must produce a verdict.
export const MAX_REVIEW_TOOL_CALLS = 30
