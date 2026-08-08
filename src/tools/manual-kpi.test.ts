import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const toolUrl = new URL('./manual-kpi.tool.ts', import.meta.url).href
const root = fileURLToPath(new URL('../..', import.meta.url))

const SCRIPT = `
  const { manualKpiTool } = await import(${JSON.stringify(toolUrl)})
  process.stdout.write('RESULT:' + (await manualKpiTool.invoke({})))
`

// readline writes the prompt to stdout, which would corrupt the test runner's own
// channel — so the tool runs in a child, the way a workflow step runs it.
function collect(typed: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', SCRIPT], {
      cwd: root,
      env: { ...process.env, MANUAL_ACTIVITIES: '' },
      stdio: [typed === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })

    let out = ''

    child.stdout?.on('data', (chunk) => (out += chunk))
    child.stdin?.end(typed ?? '')

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('collect_manual_kpi_input never settled'))
    }, 60_000)

    child.on('error', reject)
    child.on('exit', () => {
      clearTimeout(timer)
      resolve(out.slice(out.indexOf('RESULT:') + 'RESULT:'.length))
    })
  })
}

const activitiesFrom = (out: string) => JSON.parse(out).activities

test('returns no activities when stdin is closed rather than waiting for input that can never arrive', async () => {
  const out = await collect(null)

  assert.ok(out.startsWith('{'), 'the tool must settle on a closed stdin, not leave the job hanging')
  assert.deepEqual(activitiesFrom(out), [])
})

test('still records an activity that arrived before stdin ended', async () => {
  assert.deepEqual(activitiesFrom(await collect('Reviewed 3 PRs\n')), ['Reviewed 3 PRs'])
})

test('still treats a blank line as the end of input', async () => {
  assert.deepEqual(activitiesFrom(await collect('Paired on the auth bug\n\n')), ['Paired on the auth bug'])
})

// Every line lands in one stdin chunk here, which is what a paste looks like.
test('keeps every activity when the lines arrive together rather than one at a time', async () => {
  assert.deepEqual(activitiesFrom(await collect('Reviewed 3 PRs\nRan the release\nMentored a junior\ndone\n')), [
    'Reviewed 3 PRs',
    'Ran the release',
    'Mentored a junior',
  ])
})
