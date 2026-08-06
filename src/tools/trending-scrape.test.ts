import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trendingScrapeTool } from './trending-scrape.tool.ts'
import type { TrendingRepo } from '../schemas/index.ts'

// Trimmed to the fragments the parser keys off, copied from a live
// https://github.com/trending/javascript?since=daily response.
const article = (name: string, stars: string, today: string) => `
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/${name}">${name.replace('/', ' / ')}</a>
  </h2>
  <p class="col-9 color-fg-muted my-1 pr-4">a repo</p>
  <div class="f6 color-fg-muted mt-2">
    <span itemprop="programmingLanguage">JavaScript</span>
    <a href="/${name}/stargazers"><svg aria-hidden="true"></svg>
        ${stars}</a>
    <span class="d-inline-block float-sm-right"><svg aria-hidden="true"></svg>
        ${today}
</span>  </div>
</article>`

async function scrape(html: string): Promise<TrendingRepo[]> {
  const real = globalThis.fetch

  globalThis.fetch = (async () => new Response(html, { status: 200 })) as typeof fetch

  try {
    return JSON.parse(await trendingScrapeTool.invoke({ languages: ['javascript'] })) as TrendingRepo[]
  } finally {
    globalThis.fetch = real
  }
}

test('reads the singular "1 star today" GitHub renders, not just the plural form', async () => {
  const repos = await scrape(article('OWASP/threat-dragon', '1,554', '1 star today') + article('addyosmani/agent-skills', '2,100', '226 stars today'))

  assert.equal(repos[0].todayStars, 1, 'a repo that gained one star must not be recorded as gaining none')
  assert.equal(repos[1].todayStars, 226)
})

test('still parses the plural form, thousands separator and all', async () => {
  const repos = await scrape(article('TencentCloud/TencentDB-Agent-Memory', '15,584', '1,892 stars today'))

  assert.equal(repos[0].todayStars, 1892)
  assert.equal(repos[0].stars, 15584)
})

test('falls back to zero only when the growth line is genuinely absent', async () => {
  const repos = await scrape(article('foo/bar', '10', ''))

  assert.equal(repos[0].todayStars, 0)
  assert.equal(repos[0].name, 'foo/bar')
})
