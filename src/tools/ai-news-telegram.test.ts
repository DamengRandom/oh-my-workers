import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aiNewsTelegramTool, buildAiNewsMessage } from './ai-news-telegram.tool.ts'
import { AI_NEWS_SNIPPET_MAX, AI_NEWS_TITLE_MAX, AI_NEWS_TOP_N } from '../constants/index.ts'
import type { AiNewsItem } from '../schemas/index.ts'

const story = (over: Partial<AiNewsItem> = {}): AiNewsItem => ({
  title: 'Anthropic rolls out Opus 5',
  url: 'https://reuters.com/opus-5',
  source: 'reuters.com',
  snippet: 'A new model tops the benchmarks.',
  published_date: '2026-07-30T19:03:00.000Z',
  ...over,
})

test('numbers the stories and shows source, date and link', () => {
  const message = buildAiNewsMessage([story(), story({ title: 'Second' })], '2026-07-31')

  assert.match(message, /1️⃣ <b>Anthropic rolls out Opus 5<\/b>/)
  assert.match(message, /2️⃣ <b>Second<\/b>/)
  assert.match(message, /📰 reuters\.com · 2026-07-30/) // date only, not the ISO time
  assert.match(message, /<a href="https:\/\/reuters\.com\/opus-5">Read more<\/a>/)
})

test('escapes html so a stray bracket cannot break Telegram parse_mode', () => {
  const message = buildAiNewsMessage([story({ title: 'Rust & <script>alert(1)</script>', snippet: 'a < b && c > d' })], '2026-07-31')

  assert.match(message, /Rust &amp; &lt;script&gt;/)
  assert.match(message, /a &lt; b &amp;&amp; c &gt; d/)
  // the tags the digest itself emits must survive escaping
  assert.match(message, /<b>Rust/)
  assert.ok(!message.includes('<script>'))
})

test('truncates an over-long snippet at the bound', () => {
  const message = buildAiNewsMessage([story({ snippet: 'x'.repeat(AI_NEWS_SNIPPET_MAX + 200) })], '2026-07-31')
  const italics = message.match(/<i>(.*?)<\/i>/)

  assert.ok(italics)
  assert.equal(italics[1].length, AI_NEWS_SNIPPET_MAX)
  assert.ok(italics[1].endsWith('…'))
})

test('truncates an over-long title at the bound', () => {
  const message = buildAiNewsMessage([story({ title: 'T'.repeat(AI_NEWS_TITLE_MAX + 200) })], '2026-07-31')
  const bold = message.match(/1️⃣ <b>(.*?)<\/b>/)

  assert.ok(bold)
  assert.equal(bold[1].length, AI_NEWS_TITLE_MAX)
  assert.ok(bold[1].endsWith('…'))
})

test('escapes a quote in the url so it cannot close the href attribute early', () => {
  const message = buildAiNewsMessage([story({ url: 'https://example.com/a"onmouseover="x' })], '2026-07-31')

  assert.match(message, /<a href="https:\/\/example\.com\/a&quot;onmouseover=&quot;x">Read more<\/a>/)
  // exactly two quotes on that line — the ones the digest itself emits
  const href = message.split('\n').find((l) => l.includes('<a href='))
  assert.equal(href?.match(/"/g)?.length, 2)
})

test('omits the snippet line entirely when Tavily returned an empty excerpt', () => {
  const message = buildAiNewsMessage([story({ snippet: '' })], '2026-07-31')

  assert.ok(!message.includes('<i>'))
  assert.match(message, /📰 reuters\.com/) // the rest of the entry is intact
})

test('falls back to "recent" when the story has no published date', () => {
  assert.match(buildAiNewsMessage([story({ published_date: null })], '2026-07-31'), /📰 reuters\.com · recent/)
})

test('counts stories with the right plural', () => {
  assert.match(buildAiNewsMessage([story()], '2026-07-31'), /📊 1 story /)
  assert.match(buildAiNewsMessage([story(), story()], '2026-07-31'), /📊 2 stories /)
})

// Telegram rejects the whole message past 4096, so a digest that overflows is
// not truncated — it is lost. Title and snippet are both bounded now, so this
// really is the worst case, and it fails if TOP_N is raised past what the
// format can carry.
test('a worst-case digest stays inside the 4096-char limit Telegram hard-fails at', () => {
  const worst = Array.from({ length: AI_NEWS_TOP_N }, () =>
    story({
      title: 'T'.repeat(AI_NEWS_TITLE_MAX + 500),
      snippet: 's'.repeat(AI_NEWS_SNIPPET_MAX + 500),
      url: `https://example.com/${'u'.repeat(80)}`,
    })
  )

  assert.ok(buildAiNewsMessage(worst, '2026-07-31').length < 4096)
})

test('throws when the Telegram credentials are missing', async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID

  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID

  try {
    await assert.rejects(() => aiNewsTelegramTool.invoke({ items: [story()] }), /TELEGRAM_BOT_TOKEN is not set/)

    process.env.TELEGRAM_BOT_TOKEN = 'token'

    await assert.rejects(() => aiNewsTelegramTool.invoke({ items: [story()] }), /TELEGRAM_CHAT_ID is not set/)
  } finally {
    if (token !== undefined) process.env.TELEGRAM_BOT_TOKEN = token
    else delete process.env.TELEGRAM_BOT_TOKEN
    if (chat !== undefined) process.env.TELEGRAM_CHAT_ID = chat
  }
})

test('surfaces the Telegram status code so the alert says what happened', async () => {
  const real = globalThis.fetch

  process.env.TELEGRAM_BOT_TOKEN = 'token'
  process.env.TELEGRAM_CHAT_ID = 'chat'
  globalThis.fetch = async () => new Response('Bad Request: message is too long', { status: 400 })

  try {
    await assert.rejects(() => aiNewsTelegramTool.invoke({ items: [story()] }), /Telegram API error 400: Bad Request: message is too long/)
  } finally {
    globalThis.fetch = real
  }
})
