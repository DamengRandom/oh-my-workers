import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))

// Port 1 is closed, so initDb() rejects and main()'s catch handler runs for real.
const UNREACHABLE_DB = 'postgres://u:p@127.0.0.1:1/db'

test('a fatal error is logged with its cause, not dropped', async () => {
  const result = await run(process.execPath, ['--import', 'tsx', 'src/index.ts', '--setup'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: UNREACHABLE_DB },
    timeout: 60_000,
  }).catch((err: { stdout?: string; stderr?: string }) => err)

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  assert.match(output, /Fatal system error/)
  assert.match(output, /ECONNREFUSED/, 'the cause is the only artefact an unattended run leaves behind')
})
