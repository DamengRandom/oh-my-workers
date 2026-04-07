import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { newsCuratorTool } from '../tools/news-curator.tool.js'
import { NEWS_CURATOR_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 })

export const newsCuratorAgent = createAgent({
  model: llm,
  tools: [newsCuratorTool],
  systemPrompt: NEWS_CURATOR_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
