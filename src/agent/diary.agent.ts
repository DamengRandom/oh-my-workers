import { createAgent } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { diaryTool } from '../tools/diary.tool.js'
import { DIARY_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 })

export const diaryAgent = createAgent({
  model: llm,
  tools: [diaryTool],
  systemPrompt: DIARY_PROMPT,
})
