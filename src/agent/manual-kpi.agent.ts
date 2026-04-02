import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { manualKpiTool } from '../tools/manual-kpi.tool.js'
import { DEFAULT_LLM } from '../constants/index.js'
import { MANUAL_PROMPT } from './prompt.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 })

export const manualKpiAgent = createAgent({
  model: llm,
  tools: [manualKpiTool],
  systemPrompt: MANUAL_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
