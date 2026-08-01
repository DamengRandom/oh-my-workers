import { parseJson } from './utils.ts'
import type { KpiRecord } from '../schemas/index.ts'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function describeActivity(commits: number, prs: number): string {
  return `${plural(commits, 'commit')}, ${plural(prs, 'PR')} on GitHub`
}

export function toKpiRecord(githubOutput: string, now: string): KpiRecord {
  const data = parseJson<{ summary?: string; commits?: unknown[]; pullRequests?: unknown[] }>(githubOutput, {})
  const isDigest = Array.isArray(data.commits) || Array.isArray(data.pullRequests)
  const commits_count = data.commits?.length ?? 0
  const prs_count = data.pullRequests?.length ?? 0
  const github_summary = data.summary?.trim() || (isDigest ? describeActivity(commits_count, prs_count) : '')

  return {
    github_summary,
    commits_count,
    prs_count,
    activities: [],
    created_at: now,
    updated_at: now,
  }
}
