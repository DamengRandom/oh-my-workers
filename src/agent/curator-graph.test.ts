import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCuratorGraph } from './curator.graph.ts'
import { TrendingRepo } from '../schemas/index.ts'

const sampleRepos: TrendingRepo[] = [
  { name: 'foo/bar', url: 'https://github.com/foo/bar', description: 'test repo', language: 'typescript', stars: 100, todayStars: 5 },
]

const validCuratorOutput = JSON.stringify({
  repos: [
    {
      repo_name: 'foo/bar',
      url: 'https://github.com/foo/bar',
      description: 'test repo',
      language: 'typescript',
      stars: 100,
      today_stars: 5,
      summary: 'a test repo',
      tags: ['typescript'],
    },
  ],
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

test('non-JSON output names the parse failure and includes the offending text, not a generic Zod null error', async () => {
  const fakeCurate = async () => 'this is not json at all'

  const result = await runCuratorGraph(sampleRepos, fakeCurate)

  assert.equal(result.curated, null)
  assert.match(result.error ?? '', /not valid JSON/)
  assert.match(result.error ?? '', /this is not json at all/)
})

test('a long non-JSON response is truncated in the recorded error, with the original length reported', async () => {
  const longRaw = 'x'.repeat(500)
  const fakeCurate = async () => longRaw

  const result = await runCuratorGraph(sampleRepos, fakeCurate)

  assert.equal(result.curated, null)
  assert.match(result.error ?? '', /500 chars/)
  assert.ok((result.error ?? '').length < longRaw.length, 'expected the excerpt to be bounded, not a full raw dump')
})

test('well-formed JSON that fails the schema produces a distinguishably different error from a parse failure', async () => {
  const fakeCurate = async () => JSON.stringify({ repos: [{ nope: true }] })

  const result = await runCuratorGraph(sampleRepos, fakeCurate)

  assert.equal(result.curated, null)
  assert.match(result.error ?? '', /did not match the expected schema/)
  assert.doesNotMatch(result.error ?? '', /not valid JSON/)
})

const emptyCuratorOutput = JSON.stringify({ repos: [] })

test('treats an empty curation as a failure, not a quiet day', async () => {
  const fakeCurate = async () => emptyCuratorOutput

  const result = await runCuratorGraph(sampleRepos, fakeCurate)

  assert.equal(result.curated, null, 'an empty result must not be reported as success')
  assert.match(result.error ?? '', /none of the 1 repos/)
})

test('retries an empty curation and tells the model which name to echo', async () => {
  let calls = 0
  const feedback: (string | undefined)[] = []
  const fakeCurate = async (_repos: TrendingRepo[], fb?: string) => {
    calls++
    feedback.push(fb)
    return calls === 1 ? emptyCuratorOutput : validCuratorOutput
  }

  const result = await runCuratorGraph(sampleRepos, fakeCurate)

  assert.equal(calls, 2, 'an empty curation should be retried')
  assert.equal(result.curated?.[0].repo_name, 'foo/bar')
  assert.match(feedback[1] ?? '', /foo\/bar/, 'the retry should name the repo the model failed to match')
})

test('an exception thrown by curate() is caught and recorded instead of crashing the graph', async () => {
  const fakeCurate = async () => {
    throw new Error('rate limited')
  }

  const result = await runCuratorGraph(sampleRepos, fakeCurate)

  assert.equal(result.curated, null)
  assert.match(result.error ?? '', /curate\(\) threw/)
  assert.match(result.error ?? '', /rate limited/)
})

test('a non-Error value thrown by curate() is still stringified into the recorded error', async () => {
  const fakeCurate = async () => {
    throw 'connection reset'
  }

  const result = await runCuratorGraph(sampleRepos, fakeCurate)

  assert.equal(result.curated, null)
  assert.match(result.error ?? '', /curate\(\) threw/)
  assert.match(result.error ?? '', /connection reset/)
})
