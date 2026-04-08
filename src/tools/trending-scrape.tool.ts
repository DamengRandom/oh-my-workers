import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export interface TrendingRepo {
  name: string // e.g. "owner/repo"
  url: string
  description: string
  language: string
  stars: number
  todayStars: number
}

function parseTrendingHtml(html: string): TrendingRepo[] {
  const repos: TrendingRepo[] = []
  const articleRegex = /<article class="Box-row">([\s\S]*?)<\/article>/g

  let match: RegExpExecArray | null
  while ((match = articleRegex.exec(html)) !== null) {
    const block = match[1]

    // Repo name: <h2> ... <a href="/owner/repo"> owner / repo </a>
    const nameMatch = block.match(/<h2[\s\S]*?<a[^>]*href="\/([^"]+)"/)
    if (!nameMatch) continue
    const name = nameMatch[1].trim()

    // Description
    const descMatch = block.match(/<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : ''

    // Language
    const langMatch = block.match(/<span itemprop="programmingLanguage">([\s\S]*?)<\/span>/)
    const language = langMatch ? langMatch[1].trim() : ''

    // Total stars — matches the first standalone star count (not the "stars today" one)
    const starsMatch = block.match(/href="\/[^"]*\/stargazers"[^>]*>\s*([\d,]+)\s*<\/a>/)
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ''), 10) : 0

    // Stars today
    const todayMatch = block.match(/([\d,]+)\s+stars\s+today/)
    const todayStars = todayMatch ? parseInt(todayMatch[1].replace(/,/g, ''), 10) : 0

    repos.push({
      name,
      url: `https://github.com/${name}`,
      description,
      language,
      stars,
      todayStars,
    })
  }

  return repos
}

export const trendingScrapeTool = new DynamicStructuredTool({
  name: 'scrape_github_trending',
  description: 'Scrapes GitHub trending repos for TypeScript and JavaScript (daily).',
  schema: z.object({
    languages: z
      .array(z.string())
      .default(['typescript', 'javascript'])
      .describe('Languages to scrape from GitHub trending'),
  }),
  func: async ({ languages }) => {
    const allRepos: TrendingRepo[] = []
    const seen = new Set<string>()

    for (const lang of languages) {
      const url = `https://github.com/trending/${lang}?since=daily`
      const response = await fetch(url)

      if (!response.ok) {
        console.error(`❌ Failed to fetch trending/${lang}: ${response.status}`)
        continue
      }

      const html = await response.text()
      const repos = parseTrendingHtml(html)

      for (const repo of repos) {
        if (!seen.has(repo.name)) {
          seen.add(repo.name)
          allRepos.push(repo)
        }
      }
    }

    console.log(`🔍 Scraped ${allRepos.length} trending repos from GitHub`)

    return JSON.stringify(allRepos)
  },
})
