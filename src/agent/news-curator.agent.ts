import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { createLlm } from './llm.js'
import { trendingCuratorTool } from '../tools/news-curator.tool.js'
import { TRENDING_CURATOR_PROMPT } from './prompt.js'

export const trendingCuratorAgent = createAgent({
  model: createLlm(0.5),
  tools: [trendingCuratorTool],
  systemPrompt: TRENDING_CURATOR_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
