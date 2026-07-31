import { ChatOpenAI } from '@langchain/openai'
import { DEFAULT_LLM, DEFAULT_LLM_BASE_URL, LLM_FALLBACK_MODELS } from '../constants/index.js'

// ponytail: OpenRouter answers HTTP 200 with an {error} body and NO `choices`
// when the upstream provider is capacity-exhausted ("Worker local total request
// limit reached (32/32)"). The OpenAI SDK sees 200, doesn't throw, and hands back
// an empty result — which only blows up later inside LangChain as
// `Cannot read properties of undefined (reading 'message')`, nowhere near the
// real cause. Convert it to a real error here so retries and alerts can see it.
const failLoudlyOnProviderError: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)

  if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return res

  let parsed: { error?: { message?: string }; choices?: unknown[] }

  try {
    parsed = JSON.parse(await res.clone().text())
  } catch {
    return res // not JSON we understand — let the SDK deal with it
  }

  if (parsed?.error && !parsed?.choices) {
    throw new Error(`LLM provider error (HTTP ${res.status}): ${parsed.error.message ?? JSON.stringify(parsed.error)}`)
  }

  return res
}

export const createLlm = (temperature = 0) => {
  const apiKey = process.env.LLM_API_KEY

  if (!apiKey) throw new Error('LLM_API_KEY is not set — the agents have no model to call')

  const model = process.env.LLM_MODEL || DEFAULT_LLM

  return new ChatOpenAI({
    model,
    apiKey,
    temperature,
    // OpenRouter routes to the next model when one errors or is at capacity.
    // It rejects more than 3 entries, primary included.
    modelKwargs: { models: [model, ...LLM_FALLBACK_MODELS.filter((m) => m !== model)].slice(0, 3) },
    configuration: {
      baseURL: process.env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL,
      fetch: failLoudlyOnProviderError,
    },
  })
}
