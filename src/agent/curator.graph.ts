import { StateGraph, StateSchema, START, END } from '@langchain/langgraph'
import { z } from 'zod'
import { TrendingRepoOutputSchema, type CuratedRepo } from '../schemas/index.js'

import { truncate } from './utils.ts'
import { TrendingRepo } from '../schemas/index.ts'

const CuratedRepoOutputSchema = z.object({ repos: z.array(TrendingRepoOutputSchema) })

export type CurateFn = (repos: TrendingRepo[], feedback?: string) => Promise<string>
export type CuratorResult = { curated: CuratedRepo[] | null; error: string | null }

const MAX_ATTEMPTS = 2
const EXCERPT_MAX = 300

const CuratorState = new StateSchema({
  repos: z.custom<TrendingRepo[]>(),
  curated: z.custom<CuratedRepo[] | null>(),
  error: z.custom<string | null>(),
  attempts: z.custom<number>(),
})

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function curateNode(state: { repos: TrendingRepo[]; error: string | null; attempts: number }, curate: CurateFn) {
  let raw: string
  try {
    raw = await curate(state.repos, state.error || undefined)
  } catch (err) {
    return { error: `curate() threw: ${errorMessage(err)}`, attempts: state.attempts + 1 }
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    return {
      error: `curator output was not valid JSON (${errorMessage(err)}) — ${raw.length} chars: ${truncate(raw, EXCERPT_MAX)}`,
      attempts: state.attempts + 1,
    }
  }

  const parsed = CuratedRepoOutputSchema.safeParse(json)
  if (!parsed.success) {
    return { error: `curator output did not match the expected schema: ${parsed.error.message}`, attempts: state.attempts + 1 }
  }

  // The caller only ever passes a non-empty list, so nothing to curate means the
  // curator matched none of the repos it was given — a failure, and a retryable
  // one, since the feedback tells the model to echo repo_name exactly.
  if (!parsed.data.repos.length) {
    return {
      error: `curator returned summaries for none of the ${state.repos.length} repos it was given — repo_name must match exactly, e.g. "${state.repos[0]?.name}"`,
      attempts: state.attempts + 1,
    }
  }

  return { curated: parsed.data.repos, error: null }
}

export async function runCuratorGraph(repos: TrendingRepo[], curate: CurateFn): Promise<CuratorResult> {
  const graph = new StateGraph(CuratorState)
    .addNode('curate', (state) => curateNode(state, curate))
    .addEdge(START, 'curate')
    .addConditionalEdges('curate', (state) => (state.curated || state.attempts >= MAX_ATTEMPTS ? END : 'curate'))
    .compile()

  const result = await graph.invoke({ repos, curated: null, error: null, attempts: 0 })

  return { curated: result.curated, error: result.error }
}
