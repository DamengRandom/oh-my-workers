import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'

let dbDown = false
let parallelCalls = false
let queriesRun = 0

// own-db.ts builds its pool when the module loads, so the stub has to land first.
;(Pool.prototype as unknown as { query: unknown }).query = async () => {
  if (dbDown) throw new Error('connect ECONNREFUSED 10.0.0.5:5432')

  queriesRun += 1

  return { rows: [{ id: 1, title: 'stub row' }], rowCount: 1 }
}

const alerts: string[] = []

type LlmMessage = { role: string; content?: unknown }
type LlmRequest = { tools?: { function: { name: string } }[]; messages: LlmMessage[] }

const ANSWER = { role: 'assistant', content: 'There are 5 rows from the last 5 days.' }
const APOLOGY = { role: 'assistant', content: 'Sorry, I could not run that query — the database is unreachable.' }

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

let callId = 0

const fn = (name: string, args: unknown) => ({
  id: `${name}-${(callId += 1)}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

const toolCall = (...calls: ReturnType<typeof fn>[]) => ({ role: 'assistant', content: null, tool_calls: calls })

// First turn: ask the model, which calls the named-query tool. Second turn
// (a tool result is now in the transcript): answer in prose — an apology if
// the tool came back with the DB error, the row-based answer otherwise.
function llmReply(body: LlmRequest) {
  const toolMsgs = body.messages.filter((m) => m.role === 'tool')

  if (!toolMsgs.length) return toolCall(fn('run_named_query', { name: 'listAiNews' }))

  if (toolMsgs.some((m) => String(m.content).includes('ECONNREFUSED'))) return APOLOGY

  // A model that wants a preset and a SELECT of its own in the same turn — the
  // second of those crosses the run limit.
  if (parallelCalls && toolMsgs.length === 1) {
    return toolCall(fn('run_named_query', { name: 'listKpi' }), fn('run_sql_query', { query: 'SELECT count(*) FROM diary' }))
  }

  return ANSWER
}

function recordAlert(body: { text: string }): Response {
  alerts.push(body.text)

  return new Response('{"ok":true}', { status: 200 })
}

globalThis.fetch = (async (target: unknown, init: { body?: string }) => {
  const url = String(target)

  if (url.includes('openrouter')) return completion(llmReply(JSON.parse(String(init.body))))
  if (url.includes('telegram')) return recordAlert(JSON.parse(String(init.body)))

  throw new Error(`unexpected fetch: ${url}`)
}) as unknown as typeof fetch

process.env.LLM_API_KEY = 'test-key'
process.env.TELEGRAM_BOT_TOKEN = 'test-token'
process.env.TELEGRAM_CHAT_ID = 'chat'
process.env.ASK_DB_QUESTION = 'How many AI news stories came in over the last 5 days?'

const { runAskDb } = await import('./index.ts')

beforeEach(() => {
  alerts.length = 0
  dbDown = false
  parallelCalls = false
  queriesRun = 0
})

// Captures what runAskDb prints without corrupting the test runner's own stdout.
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const real = process.stdout.write.bind(process.stdout)
  let out = ''

  process.stdout.write = ((chunk: string) => {
    out += chunk
    return true
  }) as typeof process.stdout.write

  try {
    await fn()
  } finally {
    process.stdout.write = real
  }

  return out
}

test('answers the question after running the tool the model picked', async () => {
  const out = await captureStdout(runAskDb)

  assert.match(out, /There are 5 rows from the last 5 days\./)
  assert.deepEqual(alerts, [])
})

// The agent runtime catches tool errors itself and feeds them back to the
// model as a ToolMessage, so invoke() never throws here — the model's own
// reply carries the failure. No Telegram alert: unlike the scheduled jobs,
// someone is watching this one interactively and already sees the reply.
test('surfaces a DB failure in the reply instead of crashing or paging', async () => {
  dbDown = true

  const out = await captureStdout(runAskDb)

  assert.match(out, /database is unreachable/)
  assert.deepEqual(alerts, [])
})

// Two tools are registered, so a turn can name both at once. The run limit has
// to blunt the calls it cannot afford and let the model answer, not abort the
// run — an aborted run reaches the user as a blank line and a pager alert.
test('still answers when one turn asks for both tools and crosses the run limit', async () => {
  parallelCalls = true

  const out = await captureStdout(runAskDb)

  assert.match(out, /There are 5 rows from the last 5 days\./)
  assert.deepEqual(alerts, [])
  assert.equal(queriesRun, 2)
})
