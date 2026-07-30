import { ChatOpenAI } from '@langchain/openai'
import { DEFAULT_LLM, DEFAULT_LLM_BASE_URL } from '../constants/index.js'

export const createLlm = (temperature = 0) => {
  const apiKey = process.env.LLM_API_KEY

  if (!apiKey) throw new Error('LLM_API_KEY is not set — the agents have no model to call')

  return new ChatOpenAI({
    model: process.env.LLM_MODEL || DEFAULT_LLM,
    apiKey,
    temperature,
    configuration: { baseURL: process.env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL },
  })
}
