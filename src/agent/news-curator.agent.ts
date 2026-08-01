import { z } from 'zod'
import { createLlm } from './llm.js'
import { TRENDING_CURATOR_PROMPT } from './prompt.js'
import type { TrendingRepo } from '../schemas/index.js'

const SummarySchema = z.object({
  repos: z.array(
    z.object({
      repo_name: z.string(),
      summary: z.string(),
      tags: z.array(z.string()),
    })
  ),
})

export function mergeSummaries(repos: TrendingRepo[], summaries: z.infer<typeof SummarySchema>['repos']) {
  const byName = new Map(summaries.map((s) => [s.repo_name, s]))

  return repos.flatMap((r) => {
    const s = byName.get(r.name)

    if (!s) return []

    return [
      {
        repo_name: r.name,
        url: r.url,
        description: r.description,
        language: r.language,
        stars: r.stars,
        today_stars: r.todayStars,
        summary: s.summary,
        tags: s.tags,
      },
    ]
  })
}

export async function curateTrending(repos: TrendingRepo[], feedback?: string): Promise<string> {
  const listing = repos.map((r) => `${r.name} (${r.todayStars} stars today, ${r.stars} total, ${r.language}) — ${r.description}`).join('\n')

  const content = feedback
    ? `Write the digest entries for these repos:\n\n${listing}\n\nYour previous response could not be parsed (${feedback}). Return output matching the required schema exactly.`
    : `Write the digest entries for these repos:\n\n${listing}`

  const result = await createLlm(0.5)
    .withStructuredOutput(SummarySchema)
    .invoke([
      { role: 'system', content: TRENDING_CURATOR_PROMPT },
      { role: 'user', content },
    ])

  return JSON.stringify({ repos: mergeSummaries(repos, result.repos) })
}
