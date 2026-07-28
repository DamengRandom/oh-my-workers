import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { createLlm } from './llm.js'
import { manualKpiTool } from '../tools/manual-kpi.tool.js'
import { MANUAL_PROMPT } from './prompt.js'

export const manualKpiAgent = createAgent({
  model: createLlm(),
  tools: [manualKpiTool],
  systemPrompt: MANUAL_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
