import { parseJson } from './utils.ts'
import type { KpiRecord } from '../schemas/index.ts'

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
