import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

// notifyError returns without sending when either credential is missing, and the
// jobs exit 0 whatever happens — so a workflow that omits these reports a green
// run on a day it lost.
const ALERTING_WORKFLOWS = ['ai-news.yml', 'cleanup.yml', 'daily-kpi.yml', 'morning-news.yml']

for (const file of ALERTING_WORKFLOWS) {
  test(`${file} passes the Telegram credentials its failure alerts need`, () => {
    const workflow = readFileSync(`${root}.github/workflows/${file}`, 'utf8')

    assert.match(workflow, /TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/)
    assert.match(workflow, /TELEGRAM_CHAT_ID: \$\{\{ secrets\.TELEGRAM_CHAT_ID \}\}/)
  })
}
