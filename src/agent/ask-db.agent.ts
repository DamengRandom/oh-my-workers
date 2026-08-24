import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { createLlm } from './llm.js'
import { namedQueryTool, sqlQueryTool } from '../tools/sql-query.tool.js'
import { ASK_DB_PROMPT } from './prompt.js'

let agent: ReturnType<typeof createAgent> | undefined

export const askDbAgent = () =>
  (agent ??= createAgent({
    model: createLlm(),
    tools: [namedQueryTool, sqlQueryTool],
    systemPrompt: ASK_DB_PROMPT,
    middleware: [toolCallLimitMiddleware({ runLimit: 2, exitBehavior: 'end' })],
  }))
