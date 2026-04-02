import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { quizTelegramTool } from '../tools/quiz-telegram.tool.js'
import { QUIZ_TELEGRAM_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 })

export const quizTelegramAgent = createAgent({
  model: llm,
  tools: [quizTelegramTool],
  systemPrompt: QUIZ_TELEGRAM_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: 1, exitBehavior: 'end' })],
})
