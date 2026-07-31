import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { createLlm } from './llm.js'
import { diaryTool } from '../tools/diary.tool.js'
import { DIARY_PROMPT } from './prompt.js'

// Lazy for the same reason as githubAgent — see the comment there.
let agent: ReturnType<typeof createAgent> | undefined

export const diaryAgent = () =>
  (agent ??= createAgent({
    model: createLlm(),
    tools: [diaryTool],
    systemPrompt: DIARY_PROMPT,
    middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
  }))
