import { z } from 'zod'
import { createLlm } from './llm.js'
import { TRENDING_CURATOR_PROMPT } from './prompt.js'
import { TrendingRepoOutputSchema } from '../schemas/index.js'

const CuratedOutputSchema = z.object({ repos: z.array(TrendingRepoOutputSchema) })

// ponytail: one structured-output call, not an agent. The old curate_trending_repos
// tool just echoed its own input back, so the tool loop bought nothing — and its
// post-tool "done" model call is what threw away a good 92s curation when the
// provider returned an error body with no choices. Retries live in curator.graph.
export async function curateTrending(content: string): Promise<string> {
  const result = await createLlm(0.5)
    .withStructuredOutput(CuratedOutputSchema)
    .invoke([
      { role: 'system', content: TRENDING_CURATOR_PROMPT },
      { role: 'user', content },
    ])

  return JSON.stringify(result)
}
