import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toSafeSelect } from './own-db.ts'

test('passes a plain SELECT through unchanged, adding LIMIT 200', () => {
  assert.equal(toSafeSelect('SELECT * FROM ai_news'), 'SELECT * FROM ai_news LIMIT 200')
})

test('leaves an existing LIMIT alone', () => {
  assert.equal(toSafeSelect('select * from ai_news limit 5'), 'select * from ai_news limit 5')
})

test('strips a single trailing semicolon', () => {
  assert.equal(toSafeSelect('SELECT 1;'), 'SELECT 1 LIMIT 200')
})

test('rejects a second statement chained after the first', () => {
  assert.throws(() => toSafeSelect('SELECT 1; DROP TABLE ai_news'), /single statement/)
})

test('rejects anything that is not a SELECT', () => {
  assert.throws(() => toSafeSelect('DELETE FROM ai_news'), /Only SELECT/)
  assert.throws(() => toSafeSelect('UPDATE ai_news SET sent = true'), /Only SELECT/)
})

test('rejects a SELECT that smuggles a write keyword, e.g. SELECT INTO', () => {
  assert.throws(() => toSafeSelect('SELECT * INTO backup FROM ai_news'), /disallowed keyword/)
})
