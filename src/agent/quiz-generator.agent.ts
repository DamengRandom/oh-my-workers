import { createAgent } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { quizGeneratorTool } from '../tools/quiz-generator.tool.js'
import { QUIZ_GENERATOR_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 1 }) // temperature=1 for creative variety

export const quizGeneratorAgent = createAgent({
  model: llm,
  tools: [quizGeneratorTool],
  systemPrompt: QUIZ_GENERATOR_PROMPT,
})
