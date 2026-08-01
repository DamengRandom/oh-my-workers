import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toKpiRecord } from './kpi-record.ts'

const NOW = '2026-07-31T00:00:00.000Z'

// The real tool hardcodes summary: '' and the agent is told not to touch it, so
// this is what every GitHub-only day actually looks like.
test('describes the activity when the agent supplied no summary', () => {
  const record = toKpiRecord(JSON.stringify({ summary: '', commits: [1, 2, 3, 4], pullRequests: [1, 2, 3, 4, 5, 6] }), NOW)

  assert.equal(record.github_summary, '4 commits, 6 PRs on GitHub')
})

test('singularises a one-commit, one-PR day', () => {
  const record = toKpiRecord(JSON.stringify({ commits: [1], pullRequests: [1] }), NOW)

  assert.equal(record.github_summary, '1 commit, 1 PR on GitHub')
})

// A genuine quiet day still reads as a day, not as a missing record.
test('describes a zero-activity day rather than leaving it blank', () => {
  const record = toKpiRecord(JSON.stringify({ commits: [], pullRequests: [] }), NOW)

  assert.equal(record.github_summary, '0 commits, 0 PRs on GitHub')
})

test('maps a complete GitHub payload', () => {
  const record = toKpiRecord(JSON.stringify({ summary: 'shipped the thing', commits: [1, 2, 3], pullRequests: [1] }), NOW)

  assert.equal(record.github_summary, 'shipped the thing')
  assert.equal(record.commits_count, 3)
  assert.equal(record.prs_count, 1)
  assert.deepEqual(record.activities, [])
  assert.equal(record.created_at, NOW)
  assert.equal(record.updated_at, NOW)
})

// The GitHub tool output is relayed through an LLM, so any field can go missing.
// Zeros are the right answer here — but only if they come from genuinely absent
// data, which is what these cases pin down.
test('defaults every missing field rather than throwing', () => {
  const record = toKpiRecord(JSON.stringify({}), NOW)

  assert.equal(record.github_summary, '')
  assert.equal(record.commits_count, 0)
  assert.equal(record.prs_count, 0)
})

test('survives unparseable output', () => {
  const record = toKpiRecord('not json at all {{{', NOW)

  assert.equal(record.github_summary, '')
  assert.equal(record.commits_count, 0)
  assert.equal(record.prs_count, 0)
})

test('survives an empty string', () => {
  const record = toKpiRecord('', NOW)

  assert.equal(record.commits_count, 0)
})

test('handles a summary with no commit or PR arrays', () => {
  const record = toKpiRecord(JSON.stringify({ summary: 'meetings all day' }), NOW)

  assert.equal(record.github_summary, 'meetings all day')
  assert.equal(record.commits_count, 0)
  assert.equal(record.prs_count, 0)
})

test('counts empty arrays as zero, not missing', () => {
  const record = toKpiRecord(JSON.stringify({ summary: 'quiet day', commits: [], pullRequests: [] }), NOW)

  assert.equal(record.commits_count, 0)
  assert.equal(record.prs_count, 0)
})

// A real 0-commit day and a broken payload both produce zeros, so the summary is
// the only thing distinguishing them downstream. Worth keeping honest.
test('keeps the summary when counts are legitimately zero', () => {
  const record = toKpiRecord(JSON.stringify({ summary: 'no code today', commits: [], pullRequests: [] }), NOW)

  assert.equal(record.github_summary, 'no code today')
})
