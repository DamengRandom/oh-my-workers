import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeSummaries } from './news-curator.agent.ts'
import { TrendingRepo } from '../schemas/index.ts'

const repo = (name: string, todayStars: number): TrendingRepo => ({
  name,
  url: `https://github.com/${name}`,
  description: `${name} description`,
  language: 'TypeScript',
  stars: 1000,
  todayStars,
})

test('keeps the caller ordering and takes numbers from the scrape, not the model', () => {
  const repos = [repo('a/one', 500), repo('b/two', 300)]

  // model returns them out of order and with wrong star counts embedded in prose
  const merged = mergeSummaries(repos, [
    { repo_name: 'b/two', summary: 'second', tags: ['cli'] },
    { repo_name: 'a/one', summary: 'first', tags: ['ai'] },
  ])

  assert.deepEqual(
    merged.map((r) => r.repo_name),
    ['a/one', 'b/two']
  )
  assert.equal(merged[0].today_stars, 500)
  assert.equal(merged[1].today_stars, 300)
  assert.equal(merged[0].summary, 'first')
})

test('drops repos the model invented', () => {
  const merged = mergeSummaries(
    [repo('a/one', 10)],
    [
      { repo_name: 'a/one', summary: 'real', tags: ['ai'] },
      { repo_name: 'ghost/repo', summary: 'hallucinated', tags: ['ai'] },
    ]
  )

  assert.equal(merged.length, 1)
  assert.equal(merged[0].repo_name, 'a/one')
})

test('drops repos the model skipped rather than emitting a blank summary', () => {
  const merged = mergeSummaries([repo('a/one', 10), repo('b/two', 5)], [{ repo_name: 'a/one', summary: 'only one', tags: ['ai'] }])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].repo_name, 'a/one')
})
