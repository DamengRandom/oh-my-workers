import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'

const DB_DOWN = 'connect ECONNREFUSED 10.0.0.5:5432'

let dbDown = false
let repliesInProse = false

// own-db.ts builds its pool when the module loads, so the stub has to land first.
;(Pool.prototype as unknown as { query: unknown }).query = async (text: unknown) => {
  if (dbDown && /INSERT INTO (kpi|diary)/.test(String(text))) throw new Error(DB_DOWN)

  return { rows: [], rowCount: 0 }
}

const alerts: string[] = []

function completion(message: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      id: 'stub',
      object: 'chat.completion',
      created: 0,
      model: 'stub',
      choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

const call = (name: string, args: unknown) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } })

const EMPTY_SEARCH = { total_count: 0, items: [] }

globalThis.fetch = (async (target: unknown, init: { body?: string }) => {
  const url = String(target)
  const body = init?.body ? JSON.parse(init.body) : null

  if (url.includes('api.github.com/search/'))
    return new Response(JSON.stringify(EMPTY_SEARCH), { status: 200, headers: { 'content-type': 'application/json' } })

  if (url.includes('telegram')) {
    alerts.push(body.text)

    return new Response('{"ok":true}', { status: 200 })
  }

  if (url.includes('openrouter')) {
    const tools: { function: { name: string } }[] = body.tools ?? []
    const answered = body.messages.some((m: { role: string }) => m.role === 'tool')

    if (!answered && tools.some((t) => t.function.name === 'fetch_github_activity')) {
      return completion({
        role: 'assistant',
        content: null,
        tool_calls: [call('fetch_github_activity', { username: 'octocat', date: '2026-08-18' })],
      })
    }

    if (!answered && tools.some((t) => t.function.name === 'save_daily_kpi_report')) {
      if (repliesInProse) return completion({ role: 'assistant', content: 'Here is your KPI report: one commit, one PR. Great work!' })

      return completion({
        role: 'assistant',
        content: null,
        tool_calls: [
          call('save_daily_kpi_report', {
            report_content: 'A solid day.',
            github_summary: 'no commits, no PRs on GitHub',
            commits_count: 0,
            prs_count: 0,
            activities: ['Reviewed 3 PRs'],
          }),
        ],
      })
    }

    return completion({ role: 'assistant', content: 'done' })
  }

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
  dbDown = false
  repliesInProse = false
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
