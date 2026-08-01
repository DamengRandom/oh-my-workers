import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createLlm, failLoudlyOnProviderError } from './llm.ts'
import { DEFAULT_LLM, LLM_FALLBACK_MODELS } from '../constants/index.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(body: string, init: { status?: number; contentType?: string } = {}) {
  const { status = 200, contentType = 'application/json' } = init

  globalThis.fetch = (async () => new Response(body, { status, headers: { 'content-type': contentType } })) as typeof fetch
}

test('throws on an HTTP 200 error body with no choices', async () => {
  stubFetch(JSON.stringify({ error: { message: 'Upstream error from Nvidia: ResourceExhausted (32/32)', code: 502 } }))

  await assert.rejects(() => failLoudlyOnProviderError('https://example.test'), /ResourceExhausted \(32\/32\)/)
})

test('includes the status code so the alert says what happened', async () => {
  stubFetch(JSON.stringify({ error: { message: 'boom' } }))

  await assert.rejects(() => failLoudlyOnProviderError('https://example.test'), /HTTP 200/)
})

test('falls back to the raw error when the provider omits a message', async () => {
  stubFetch(JSON.stringify({ error: { code: 502 } }))

  await assert.rejects(() => failLoudlyOnProviderError('https://example.test'), /502/)
})

test('passes a normal completion straight through', async () => {
  stubFetch(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))

  const res = await failLoudlyOnProviderError('https://example.test')

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { choices: [{ message: { content: 'OK' } }] })
})

test('does not throw when choices are present alongside an error', async () => {
  stubFetch(JSON.stringify({ error: { message: 'partial' }, choices: [{ message: { content: 'OK' } }] }))

  const res = await failLoudlyOnProviderError('https://example.test')

  assert.equal(res.status, 200)
})

test('leaves non-2xx responses for the SDK to handle', async () => {
  stubFetch(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 })

  const res = await failLoudlyOnProviderError('https://example.test')

  assert.equal(res.status, 429)
})

test('ignores non-JSON bodies', async () => {
  stubFetch('<html>gateway timeout</html>', { contentType: 'text/html' })

  const res = await failLoudlyOnProviderError('https://example.test')

  assert.equal(res.status, 200)
})

// Body claims JSON but is truncated — must not mask the SDK's own error handling.
test('ignores malformed JSON that claims to be JSON', async () => {
  stubFetch('{"error": {"message": "trunc', { contentType: 'application/json' })

  const res = await failLoudlyOnProviderError('https://example.test')

  assert.equal(res.status, 200)
})

// The guard clones before reading, so the SDK must still be able to read the body.
test('leaves the response body readable for the caller', async () => {
  stubFetch(JSON.stringify({ choices: [{ message: { content: 'still here' } }] }))

  const res = await failLoudlyOnProviderError('https://example.test')
  const parsed = (await res.json()) as { choices: { message: { content: string } }[] }

  assert.equal(parsed.choices[0].message.content, 'still here')
})

test('every configured fallback actually reaches OpenRouter', () => {
  const key = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL

  process.env.LLM_API_KEY = 'dummy'
  delete process.env.LLM_MODEL

  try {
    const { modelKwargs } = createLlm() as unknown as { modelKwargs: { models: string[] } }

    assert.equal(modelKwargs.models[0], DEFAULT_LLM, 'primary must be tried first')
    for (const fb of LLM_FALLBACK_MODELS) {
      assert.ok(modelKwargs.models.includes(fb), `configured fallback silently dropped: ${fb}`)
    }
  } finally {
    if (key !== undefined) process.env.LLM_API_KEY = key
    else delete process.env.LLM_API_KEY
    if (model !== undefined) process.env.LLM_MODEL = model
  }
})
