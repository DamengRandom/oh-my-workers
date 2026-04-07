import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { newsSearchTool } from '../tools/news-search.tool.js'
import { NEWS_SEARCH_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 })

export const newsSearchAgent = createAgent({
  model: llm,
  tools: [newsSearchTool],
  systemPrompt: NEWS_SEARCH_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
