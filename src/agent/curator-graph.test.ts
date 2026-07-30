import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCuratorGraph } from './curator.graph.ts'
import { TrendingRepo } from '../tools/trending-scrape.tool.ts'

const sampleRepos: TrendingRepo[] = [{ name: 'foo/bar', url: 'https://github.com/foo/bar', description: 'test repo', language: 'typescript', stars: 100, todayStars: 5 }]

const validCuratorOutput = JSON.stringify({
  repos: [{ repo_name: 'foo/bar', url: 'https://github.com/foo/bar', description: 'test repo', language: 'typescript', stars: 100, today_stars: 5, summary: 'a test repo', tags: ['typescript'] }],
})

test('returns curated repos when the curator succeeds on the first attempt', async () => {
  const fakeCurate = async () => validCuratorOutput

  const result = await runCuratorGraph(sampleRepos, fakeCurate)

  assert.equal(result.curated?.length, 1)
  assert.equal(result.curated?.[0].repo_name, 'foo/bar')
  assert.equal(result.error, null)
})

test('retries once when the curator returns invalid JSON, then succeeds', async () => {
  let calls = 0
  const fakeCurate = async () => {
    calls++
    return calls === 1 ? 'not valid json {{{' : validCuratorOutput
  }

  const result = await runCuratorGraph(sampleRepos, fakeCurate)

  assert.equal(calls, 2)
  assert.equal(result.curated?.[0].repo_name, 'foo/bar')
  assert.equal(result.error, null)
})

test('gives up after exhausting retries — curated is null, not an empty array, and error is set', async () => {
  let calls = 0
  const fakeCurate = async () => {
    calls++
    return 'always broken'
  }

  const result = await runCuratorGraph(sampleRepos, fakeCurate)

  assert.equal(calls, 2) // 1 initial attempt + 1 retry, then give up
  assert.equal(result.curated, null)
  assert.ok(result.error, 'expected a validation error to be surfaced, not swallowed')
})
