import { createAgent } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { quizEmailTool } from '../tools/quiz-email.tool.js'
import { QUIZ_EMAIL_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 })

export const quizEmailAgent = createAgent({
  model: llm,
  tools: [quizEmailTool],
  systemPrompt: QUIZ_EMAIL_PROMPT,
})
