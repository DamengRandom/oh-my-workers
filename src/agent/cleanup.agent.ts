import { createAgent } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { cleanupTool } from '../tools/cleanup.tool.js'
import { CLEANUP_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 })

export const cleanupAgent = createAgent({
  model: llm,
  tools: [cleanupTool],
  systemPrompt: CLEANUP_PROMPT,
})
