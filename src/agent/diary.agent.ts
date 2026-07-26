import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { createLlm } from './llm.js'
import { diaryTool } from '../tools/diary.tool.js'
import { DIARY_PROMPT } from './prompt.js'

export const diaryAgent = createAgent({
  model: createLlm(),
  tools: [diaryTool],
  systemPrompt: DIARY_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
