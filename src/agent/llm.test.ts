import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { failLoudlyOnProviderError } from './llm.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(body: string, init: { status?: number; contentType?: string } = {}) {
  const { status = 200, contentType = 'application/json' } = init

  globalThis.fetch = (async () => new Response(body, { status, headers: { 'content-type': contentType } })) as typeof fetch
}

// The real payload that took the trending job down: HTTP 200, an `error` object,
// and no `choices`. The OpenAI SDK treats 200 as success and hands back an empty
// result, which only explodes later as `undefined.message`.
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

// A body carrying BOTH an error and choices is a partial success — the SDK can
// still read a completion out of it, so it must not be turned into a throw.
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
