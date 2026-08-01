import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { notifyError } from './utils.ts'

const realFetch = globalThis.fetch
let sent: { text: string; parse_mode: string } | null = null
let status = 200

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  process.env.TELEGRAM_CHAT_ID = '12345'
  sent = null
  status = 200
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    sent = JSON.parse(init.body)
    return new Response(JSON.stringify({ ok: status === 200 }), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

test('escapes markup in the error so Telegram can parse the alert', async () => {
  await notifyError('AI news search', new Error('Tavily API error 502: <html><body>upstream connect error</body></html>'))

  assert.ok(sent)
  assert.equal(sent!.parse_mode, 'HTML')
  assert.ok(!sent!.text.includes('<html>'), 'raw <html> would 400')
  assert.ok(sent!.text.includes('&lt;html&gt;'), 'the error text should survive, escaped')
  // The alert's own formatting must stay intact.
  assert.ok(sent!.text.includes('<b>Error:</b>'))
})

test('escapes markup in the context too', async () => {
  await notifyError('<script>', new Error('boom'))

  assert.ok(!sent!.text.includes('<script>'))
})

// The alert is a summary, so it points at the full trace rather than carrying it.
test('links to LangSmith for the full error', async () => {
  await notifyError('AI news search', new Error('boom'))

  assert.ok(sent!.text.includes('https://smith.langchain.com'))
})

// Escaping expands the text, so the raw cut has to leave room for the worst case.
test('keeps an oversized error inside Telegram limit', async () => {
  await notifyError('AI news search', new Error('"'.repeat(5000)))

  assert.ok(sent!.text.length <= 4096, `message was ${sent!.text.length} chars`)
})

test('never emits a half-escaped entity', async () => {
  await notifyError('AI news search', new Error('"'.repeat(5000)))

  const errorLine = sent!.text.split('\n').find((l) => l.startsWith('<b>Error:</b>'))!

  assert.ok(!/&[a-z]*$/i.test(errorLine), `error line ended with a partial entity: ${errorLine.slice(-10)}`)
})

test('logs rather than silently dropping a rejected alert', async () => {
  status = 400

  const errors: unknown[] = []
  const { logger } = await import('../utils/logger.ts')
  const original = logger.error.bind(logger)
  logger.error = ((...args: unknown[]) => errors.push(args)) as typeof logger.error

  try {
    await notifyError('AI news search', new Error('boom'))
  } finally {
    logger.error = original
  }

  assert.equal(errors.length, 1, 'a rejected alert must leave a trace')
})
