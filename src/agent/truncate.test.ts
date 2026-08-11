import { test } from 'node:test'
import assert from 'node:assert/strict'
import { truncate } from './utils.ts'

// A cut that lands between the two halves of a surrogate pair leaves a code unit
// that is not a character — it reaches Telegram and Postgres as "�".
test('never leaves half of an astral character at the cut', () => {
  assert.equal(truncate('a'.repeat(198) + '😀 rest of the sentence', 200), 'a'.repeat(198) + '…')
})

test('keeps the astral characters that fit whole', () => {
  assert.equal(truncate('😀'.repeat(5) + 'tail', 10), '😀'.repeat(4) + '…')
})

test('still truncates plain text at the bound', () => {
  assert.equal(truncate('x'.repeat(50), 10), 'x'.repeat(9) + '…')
  assert.equal(truncate('short', 10), 'short')
  assert.equal(truncate('ab cd', 4), 'ab…')
})
