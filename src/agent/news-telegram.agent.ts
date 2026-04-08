import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { trendingTelegramTool } from '../tools/news-telegram.tool.js'
import { TRENDING_TELEGRAM_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 })

export const trendingTelegramAgent = createAgent({
  model: llm,
  tools: [trendingTelegramTool],
  systemPrompt: TRENDING_TELEGRAM_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
