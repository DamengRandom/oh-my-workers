import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { createLlm } from './llm.js'
import { cleanupTool } from '../tools/cleanup.tool.js'
import { CLEANUP_PROMPT } from './prompt.js'

export const cleanupAgent = createAgent({
  model: createLlm(),
  tools: [cleanupTool],
  systemPrompt: CLEANUP_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
