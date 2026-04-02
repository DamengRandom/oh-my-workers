import { createAgent } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { quizVerifierTool } from '../tools/quiz-verifier.tool.js'
import { QUIZ_VERIFIER_PROMPT } from './prompt.js'
import { DEFAULT_LLM } from '../constants/index.js'

const llm = new ChatAnthropic({ model: DEFAULT_LLM, temperature: 0 }) // temperature=0 for strict deterministic review

export const quizVerifierAgent = createAgent({
  model: llm,
  tools: [quizVerifierTool],
  systemPrompt: QUIZ_VERIFIER_PROMPT,
})
