import { parseJson } from './utils.ts'
import type { KpiRecord } from '../schemas/index.ts'

// Lives in its own module so it can be tested without importing agent/index.ts,
// which pulls in the agents — and those call createLlm() at module load, so a
// test would need a live LLM_API_KEY just to check JSON parsing.
//
// Every field is defensive: the GitHub tool output is LLM-relayed, so any of it
// can be missing. Silently writing zeros is the failure nobody notices, which is
// exactly why this half is separated and covered.
export function toKpiRecord(githubOutput: string, now: string): KpiRecord {
  const data = parseJson<{ summary?: string; commits?: unknown[]; pullRequests?: unknown[] }>(githubOutput, {})

  return {
    github_summary: data.summary ?? '',
    commits_count: data.commits?.length ?? 0,
    prs_count: data.pullRequests?.length ?? 0,
    activities: [],
    created_at: now,
    updated_at: now,
  }
}
