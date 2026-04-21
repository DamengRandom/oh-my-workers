import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { trendingCuratorTool } from '../tools/news-curator.tool.js'
import { TRENDING_CURATOR_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0.5 })

export const trendingCuratorAgent = createAgent({
  model: llm,
  tools: [trendingCuratorTool],
  systemPrompt: TRENDING_CURATOR_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
