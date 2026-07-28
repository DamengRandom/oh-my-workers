import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { createLlm } from './llm.js'
import { trendingTelegramTool } from '../tools/news-telegram.tool.js'
import { TRENDING_TELEGRAM_PROMPT } from './prompt.js'

export const trendingTelegramAgent = createAgent({
  model: createLlm(),
  tools: [trendingTelegramTool],
  systemPrompt: TRENDING_TELEGRAM_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
