import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTrendingHtml } from './trending-scrape.tool.ts'

// Trimmed from a real github.com/trending/typescript?since=daily response.
const article = (description: string) => `
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/melgarafael/DeskcommCRM" data-view-component="true" class="Link"><svg class="octicon"></svg>
    <span data-view-component="true" class="text-normal">melgarafael /</span>
    DeskcommCRM</a>  </h2>
  <p class="col-9 color-fg-muted my-1 tmp-pr-4">
    ${description}
  </p>
  <div class="f6 color-fg-muted mt-2">
    <span itemprop="programmingLanguage">TypeScript</span>
    <a href="/melgarafael/DeskcommCRM/stargazers" class="Link"><svg class="octicon"></svg>
    386</a>
    <span data-view-component="true" class="d-inline-block float-sm-right">
      <svg class="octicon"></svg>
      28 stars today
    </span>  </div>
</article>`

// Same shape, but the counts vary — copied from github.com/trending/javascript?since=daily.
const articleWithCounts = (name: string, stars: string, today: string) => `
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

const descriptionOf = (raw: string) => parseTrendingHtml(article(raw))[0].description

test('decodes the escaped ampersand GitHub emits in repo descriptions', () => {
  assert.equal(descriptionOf('Open alternative to Kommo, Octadesk &amp; Intercom'), 'Open alternative to Kommo, Octadesk & Intercom')
})

test('decodes the rest of the entities a description can carry', () => {
  assert.equal(descriptionOf('Type-safe &lt;div&gt; helpers'), 'Type-safe <div> helpers')
  assert.equal(descriptionOf('The &quot;batteries included&quot; runtime'), 'The "batteries included" runtime')
  assert.equal(descriptionOf('Rust&#39;s borrow checker, in TS'), "Rust's borrow checker, in TS")
  assert.equal(descriptionOf('Ship it &#x1F680; fast'), 'Ship it 🚀 fast')
})

test('a decoded angle bracket is text, not markup to strip a second time', () => {
  assert.equal(descriptionOf('Render &lt;Suspense&gt; on the server'), 'Render <Suspense> on the server')
})

test('leaves something that only looks like an entity untouched', () => {
  assert.equal(descriptionOf('Sold &notanentity; separately'), 'Sold &notanentity; separately')
  assert.equal(descriptionOf('Costs AT&T money'), 'Costs AT&T money')
  assert.equal(descriptionOf('Out of range &#9999999; here'), 'Out of range &#9999999; here')
})

test('still reads the name, language and both star counts', () => {
  const [repo] = parseTrendingHtml(article('A CRM'))

  assert.equal(repo.name, 'melgarafael/DeskcommCRM')
  assert.equal(repo.url, 'https://github.com/melgarafael/DeskcommCRM')
  assert.equal(repo.language, 'TypeScript')
  assert.equal(repo.stars, 386)
  assert.equal(repo.todayStars, 28)
})

test('reads the singular "1 star today" GitHub renders, not just the plural form', () => {
  const repos = parseTrendingHtml(
    articleWithCounts('OWASP/threat-dragon', '1,554', '1 star today') + articleWithCounts('addyosmani/agent-skills', '2,100', '226 stars today')
  )

  assert.equal(repos[0].todayStars, 1, 'a repo that gained one star must not be recorded as gaining none')
  assert.equal(repos[1].todayStars, 226)
})

test('still parses the plural form, thousands separator and all', () => {
  const [repo] = parseTrendingHtml(articleWithCounts('TencentCloud/TencentDB-Agent-Memory', '15,584', '1,892 stars today'))

  assert.equal(repo.todayStars, 1892)
  assert.equal(repo.stars, 15584)
})

test('falls back to zero only when the growth line is genuinely absent', () => {
  const [repo] = parseTrendingHtml(articleWithCounts('foo/bar', '10', ''))

  assert.equal(repo.todayStars, 0)
  assert.equal(repo.name, 'foo/bar')
})
