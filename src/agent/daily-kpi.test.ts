import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'

const DB_DOWN = 'connect ECONNREFUSED 10.0.0.5:5432'
const TODAY = '2026-08-18'

let dbDown = false
let repliesInProse = false
let githubUnauthorized = false

const kpiRows: unknown[][] = []

// own-db.ts builds its pool when the module loads, so the stub has to land first.
;(Pool.prototype as unknown as { query: unknown }).query = async (text: unknown, params: unknown[]) => {
  if (dbDown && /INSERT INTO (kpi|diary)/.test(String(text))) throw new Error(DB_DOWN)

  if (/INSERT INTO kpi/.test(String(text))) kpiRows.push(params)

  return { rows: [], rowCount: 0 }
}

const alerts: string[] = []

type LlmRequest = { tools?: { function: { name: string } }[]; messages: { role: string }[] }

const DONE = { role: 'assistant', content: 'done' }
const PROSE = { role: 'assistant', content: 'Here is your KPI report: one commit, one PR. Great work!' }

const SAVED_REPORT = {
  report_content: 'A solid day.',
  github_summary: 'no commits, no PRs on GitHub',
  commits_count: 0,
  prs_count: 0,
  activities: ['Reviewed 3 PRs'],
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

function completion(message: Record<string, unknown>): Response {
  return jsonResponse({
    id: 'stub',
    object: 'chat.completion',
    created: 0,
    model: 'stub',
    choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
}

const toolCall = (name: string, args: unknown) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})

const offeredTools = (body: LlmRequest) => (body.tools ?? []).map((t) => t.function.name)

const diaryReply = () => (repliesInProse ? PROSE : toolCall('save_daily_kpi_report', SAVED_REPORT))

function llmReply(body: LlmRequest) {
  if (body.messages.some((m) => m.role === 'tool')) return DONE

  const offered = offeredTools(body)

  if (offered.includes('fetch_github_activity')) return toolCall('fetch_github_activity', { username: 'octocat', date: TODAY })
  if (offered.includes('save_daily_kpi_report')) return diaryReply()

  return DONE
}

function recordAlert(body: { text: string }): Response {
  alerts.push(body.text)

  return new Response('{"ok":true}', { status: 200 })
}

function githubSearch(): Response {
  if (!githubUnauthorized) return jsonResponse({ total_count: 0, items: [] })

  return new Response(JSON.stringify({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

globalThis.fetch = (async (target: unknown, init: { body?: string }) => {
  const url = String(target)

  if (url.includes('api.github.com/search/')) return githubSearch()
  if (url.includes('openrouter')) return completion(llmReply(JSON.parse(String(init.body))))
  if (url.includes('telegram')) return recordAlert(JSON.parse(String(init.body)))

  throw new Error(`unexpected fetch: ${url}`)
}) as unknown as typeof fetch

process.env.LLM_API_KEY = 'test-key'
process.env.GITHUB_TOKEN = 'test-token'
process.env.TARGET_GITHUB_USERNAME = 'octocat'
process.env.TELEGRAM_BOT_TOKEN = 'test-token'
process.env.TELEGRAM_CHAT_ID = 'chat'
process.env.MANUAL_ACTIVITIES = 'Reviewed 3 PRs'

const { runDailyJobs } = await import('./index.ts')

beforeEach(() => {
  alerts.length = 0
  kpiRows.length = 0
  dbDown = false
  repliesInProse = false
  githubUnauthorized = false
  process.env.MANUAL_ACTIVITIES = 'Reviewed 3 PRs'
})

// The GitHub-only path already alerts on exactly this failure, so a day carrying
// manual activities must not be the one that loses them quietly.
test('alerts when the database refuses the KPI report the diary agent tried to save', async () => {
  dbDown = true

  await runDailyJobs()

  assert.equal(alerts.length, 1, 'a lost KPI day must leave an alert')
  assert.match(alerts[0], /Diary agent/)
  assert.match(alerts[0], /ECONNREFUSED/)
})

test('alerts when the model answers in prose and never calls the save tool', async () => {
  repliesInProse = true

  await runDailyJobs()

  assert.equal(alerts.length, 1, 'a report that was never saved must leave an alert')
  assert.match(alerts[0], /never called it/)
})

test('stays quiet when the report is actually saved', async () => {
  await runDailyJobs()

  assert.deepEqual(alerts, [])
})

// A commas-only value takes the non-interactive branch and yields no activities,
// which is the path that persists a GitHub-only record.
test('records no KPI day at all when the GitHub fetch was refused', async () => {
  githubUnauthorized = true
  process.env.MANUAL_ACTIVITIES = ','

  await runDailyJobs()

  assert.deepEqual(kpiRows, [], 'a day whose activity was never fetched must not be saved as zero activity')
})

test('alerts when the GitHub fetch was refused rather than reporting a quiet day', async () => {
  githubUnauthorized = true
  process.env.MANUAL_ACTIVITIES = ','

  await runDailyJobs()

  assert.equal(alerts.length, 1, 'an unfetched GitHub day must leave an alert')
  assert.match(alerts[0], /GitHub agent/)
  assert.match(alerts[0], /Bad credentials/)
})

test('does not hand the diary agent an error message as the day’s GitHub activity', async () => {
  githubUnauthorized = true

  await runDailyJobs()

  assert.deepEqual(kpiRows, [], 'the diary path must not write a report about data it never received')
  assert.equal(alerts.length, 1)
  assert.match(alerts[0], /Bad credentials/)
})
