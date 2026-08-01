import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrendingMessage } from './news-telegram.tool.ts'
import { TELEGRAM_MAX_CHARS, TRENDING_SUMMARY_MAX, TRENDING_TAG_MAX, TRENDING_TAGS_MAX, TRENDING_TOP_N } from '../constants/index.ts'
import type { CuratedRepo } from '../schemas/index.ts'

const repo = (over: Partial<CuratedRepo> = {}): CuratedRepo => ({
  repo_name: 'facebook/react',
  url: 'https://github.com/facebook/react',
  description: 'A library for web and native user interfaces',
  language: 'JavaScript',
  stars: 238000,
  today_stars: 412,
  summary: 'The library that popularised the component model.',
  tags: ['ui', 'framework'],
  ...over,
})

test('numbers the repos and shows stars, language, tags and link', () => {
  const message = buildTrendingMessage([repo(), repo({ repo_name: 'vuejs/core' })], '2026-08-01')

  assert.match(message, /1️⃣ <b>facebook\/react<\/b>/)
  assert.match(message, /2️⃣ <b>vuejs\/core<\/b>/)
  assert.match(message, /⭐ 238,000 \(\+412 today\) · JavaScript/)
  assert.match(message, /🏷 #ui #framework/)
  assert.match(message, /<a href="https:\/\/github\.com\/facebook\/react">View on GitHub<\/a>/)
})

test('escapes html so a stray bracket cannot break Telegram parse_mode', () => {
  const message = buildTrendingMessage([repo({ repo_name: 'a<b>&c', summary: 'x < y && z' })], '2026-08-01')

  assert.match(message, /a&lt;b&gt;&amp;c/)
  assert.match(message, /x &lt; y &amp;&amp; z/)
  assert.ok(!message.includes('<b>&c'))
})

test('truncates an over-long summary at the bound', () => {
  const message = buildTrendingMessage([repo({ summary: 'S'.repeat(TRENDING_SUMMARY_MAX + 200) })], '2026-08-01')
  const italics = message.match(/<i>(.*?)<\/i>/)

  assert.ok(italics)
  assert.equal(italics[1].length, TRENDING_SUMMARY_MAX)
})

test('caps both the number of tags and the length of each one', () => {
  const message = buildTrendingMessage(
    [repo({ tags: Array.from({ length: TRENDING_TAGS_MAX + 20 }, () => 'T'.repeat(TRENDING_TAG_MAX + 30)) })],
    '2026-08-01'
  )
  const rendered = message.match(/🏷 (.*)/)?.[1] ?? ''
  const tags = rendered.split(' ')

  assert.equal(tags.length, TRENDING_TAGS_MAX)
  for (const t of tags) assert.ok(t.length <= TRENDING_TAG_MAX + 1, `tag too long: ${t.length}`) // +1 for the leading #
})

test('omits the tag line entirely when the curator returned none', () => {
  const message = buildTrendingMessage([repo({ tags: [] })], '2026-08-01')

  assert.ok(!message.includes('🏷'))
  assert.match(message, /⭐ 238,000/) // the rest of the entry is intact
})

test('one repo with a pathological tags array cannot cost the whole digest', () => {
  const normal = Array.from({ length: TRENDING_TOP_N - 1 }, () => repo())
  const badApple = repo({ tags: Array.from({ length: 40 }, (_, i) => `machine-learning-infrastructure-tag-${i}`) })

  const message = buildTrendingMessage([...normal, badApple], '2026-08-01')

  assert.ok(message.length <= TELEGRAM_MAX_CHARS, `message was ${message.length} chars`)
  assert.match(message, /8️⃣/) // all eight still made it
})

test('a worst-case digest stays inside the limit Telegram hard-fails at', () => {
  const worst = Array.from({ length: TRENDING_TOP_N }, () =>
    repo({
      repo_name: 'R'.repeat(140),
      summary: 'S'.repeat(TRENDING_SUMMARY_MAX + 500),
      tags: Array.from({ length: TRENDING_TAGS_MAX + 10 }, () => 'T'.repeat(TRENDING_TAG_MAX + 10)),
      url: `https://github.com/${'u'.repeat(120)}`,
    })
  )

  assert.ok(buildTrendingMessage(worst, '2026-08-01').length <= TELEGRAM_MAX_CHARS)
})

test('drops trailing repos rather than emitting a message Telegram will reject', () => {
  const bomb = Array.from({ length: TRENDING_TOP_N }, () => repo({ summary: '&'.repeat(TRENDING_SUMMARY_MAX) }))
  const message = buildTrendingMessage(bomb, '2026-08-01')

  assert.ok(message.length <= TELEGRAM_MAX_CHARS, `message was ${message.length} chars`)
})
