import { StateGraph, StateSchema, START, END } from '@langchain/langgraph'
import { z } from 'zod'
import { TrendingRepoOutputSchema, type CuratedRepo } from '../schemas/index.js'

import { parseJson } from './utils.ts'
import { TrendingRepo } from '../schemas/index.ts'

const CuratedRepoOutputSchema = z.object({ repos: z.array(TrendingRepoOutputSchema) })

export type CurateFn = (repos: TrendingRepo[], feedback?: string) => Promise<string>
export type CuratorResult = { curated: CuratedRepo[] | null; error: string | null }

const MAX_ATTEMPTS = 2

const CuratorState = new StateSchema({
  repos: z.custom<TrendingRepo[]>(),
  curated: z.custom<CuratedRepo[] | null>(),
  error: z.custom<string | null>(),
  attempts: z.custom<number>(),
})

export async function runCuratorGraph(repos: TrendingRepo[], curate: CurateFn): Promise<CuratorResult> {
  const graph = new StateGraph(CuratorState)
    .addNode('curate', async (state) => {
      const raw = await curate(state.repos, state.error || undefined)
      const parsed = CuratedRepoOutputSchema.safeParse(parseJson<unknown>(raw, null))

      if (parsed.success) return { curated: parsed.data.repos, error: null }

      return { error: parsed.error.message, attempts: state.attempts + 1 }
    })
    .addEdge(START, 'curate')
    .addConditionalEdges('curate', (state) => (state.curated || state.attempts >= MAX_ATTEMPTS ? END : 'curate'))
    .compile()

  const result = await graph.invoke({ repos, curated: null, error: null, attempts: 0 })

  return { curated: result.curated, error: result.error }
}
