import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { createLlm } from './llm.js'
import { githubTool } from '../tools/github.tool.js'
import { GITHUB_PROMPT } from './prompt.js'

let agent: ReturnType<typeof createAgent> | undefined

export const githubAgent = () =>
  (agent ??= createAgent({
    model: createLlm(),
    tools: [githubTool],
    systemPrompt: GITHUB_PROMPT,
    middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
  }))
