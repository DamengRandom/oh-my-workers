import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendTelegramMessage } from './telegram.ts'

async function withEnvAndFetch(env: NodeJS.ProcessEnv, stub: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const savedEnv = { ...process.env }
  const realFetch = globalThis.fetch

  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
  Object.assign(process.env, env)
  globalThis.fetch = stub

  try {
    await fn()
  } finally {
    globalThis.fetch = realFetch
    process.env = savedEnv
  }
}

// Doubles as the assertion that a misconfigured job never reaches the network.
const failIfCalled: typeof fetch = async () => {
  throw new Error('fetch should not be called when credentials are missing')
}

test('throws when the bot token is missing', async () => {
  await withEnvAndFetch({ TELEGRAM_CHAT_ID: 'chat' }, failIfCalled, async () => {
    await assert.rejects(() => sendTelegramMessage('hi', 'Test'), /TELEGRAM_BOT_TOKEN is not set/)
  })
})

test('throws when the chat id is missing', async () => {
  await withEnvAndFetch({ TELEGRAM_BOT_TOKEN: 'token' }, failIfCalled, async () => {
    await assert.rejects(() => sendTelegramMessage('hi', 'Test'), /TELEGRAM_CHAT_ID is not set/)
  })
})

test('posts HTML to the bot endpoint with previews disabled', async () => {
  let url = ''
  let body: Record<string, unknown> = {}

  await withEnvAndFetch(
    { TELEGRAM_BOT_TOKEN: 'secret-token', TELEGRAM_CHAT_ID: '12345' },
    async (target, init) => {
      url = String(target)
      body = JSON.parse(String(init?.body))
      return new Response('{"ok":true}', { status: 200 })
    },
    async () => {
      assert.equal(await sendTelegramMessage('<b>digest</b>', 'Test'), '12345')
    }
  )

  assert.equal(url, 'https://api.telegram.org/botsecret-token/sendMessage')
  assert.equal(body.chat_id, '12345')
  assert.equal(body.text, '<b>digest</b>')
  assert.equal(body.parse_mode, 'HTML')
  // link previews would bury an 8-story digest under thumbnails
  assert.equal(body.disable_web_page_preview, true)
})

test('surfaces the status and body so notifyError can report what happened', async () => {
  await withEnvAndFetch(
    { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: 'chat' },
    async () => new Response('Bad Request: message is too long', { status: 400 }),
    async () => {
      await assert.rejects(() => sendTelegramMessage('x', 'Test'), /Telegram API error 400: Bad Request: message is too long/)
    }
  )
})
