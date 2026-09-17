import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toSafeSelect } from './own-db.ts'

test('passes a plain SELECT through unchanged, adding LIMIT 200', () => {
  assert.equal(toSafeSelect('SELECT * FROM ai_news'), 'SELECT * FROM ai_news\nLIMIT 200')
})

test('leaves an existing LIMIT alone', () => {
  assert.equal(toSafeSelect('select * from ai_news limit 5'), 'select * from ai_news limit 5')
})

test('strips a single trailing semicolon', () => {
  assert.equal(toSafeSelect('SELECT 1;'), 'SELECT 1\nLIMIT 200')
})

test('caps a query that ends in a line comment instead of appending into it', () => {
  assert.equal(toSafeSelect('SELECT * FROM kpi -- newest first'), 'SELECT * FROM kpi -- newest first\nLIMIT 200')
  assert.equal(toSafeSelect('SELECT * FROM kpi\n-- how many commits today?'), 'SELECT * FROM kpi\n-- how many commits today?\nLIMIT 200')
})

test('still caps when a comment only mentions the word limit', () => {
  assert.equal(toSafeSelect('SELECT * FROM kpi -- limit to the newest day'), 'SELECT * FROM kpi -- limit to the newest day\nLIMIT 200')
  assert.equal(toSafeSelect('SELECT * FROM kpi /* limit 10 */'), 'SELECT * FROM kpi /* limit 10 */\nLIMIT 200')
})

test('leaves a real LIMIT alone even when a comment follows it', () => {
  assert.equal(toSafeSelect('SELECT * FROM kpi LIMIT 5 -- newest first'), 'SELECT * FROM kpi LIMIT 5 -- newest first')
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
