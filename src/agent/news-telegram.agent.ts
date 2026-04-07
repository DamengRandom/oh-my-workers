import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { newsTelegramTool } from '../tools/news-telegram.tool.js'
import { NEWS_TELEGRAM_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 })

export const newsTelegramAgent = createAgent({
  model: llm,
  tools: [newsTelegramTool],
  systemPrompt: NEWS_TELEGRAM_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
