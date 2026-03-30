import { createAgent } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { githubTool } from '../tools/github.tool.js'
import { GITHUB_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 })

export const githubAgent = createAgent({
  model: llm,
  tools: [githubTool],
  systemPrompt: GITHUB_PROMPT,
})
