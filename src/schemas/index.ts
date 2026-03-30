import { z } from 'zod'

// --- GitHub activity ---
export const CommitSchema = z.object({
  repo: z.string(),
  message: z.string(),
  sha: z.string(),
  url: z.string(),
})

export const PullRequestSchema = z.object({
  title: z.string(),
  repo: z.string(),
  url: z.string(),
  status: z.enum(['open', 'closed', 'merged']),
  number: z.number(),
})

export const GitHubDigestSchema = z.object({
  commits: z.array(CommitSchema),
  pullRequests: z.array(PullRequestSchema),
  summary: z.string(), // AI-written plain English summary
  created_at: z.string(),
  updated_at: z.string(),
})

// --- GitHub KPI input (from Job 2) ---
export const GithubKpiInputSchema = z.object({
  github_summary: z.string(),
  commits_count: z.number(),
  prs_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
})

// --- Manual KPI input (from Job 3) ---
export const ManualKpiInputSchema = z.object({
  activities: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
})

// --- KPI table row: combines GitHub + manual input ---
export const KpiRecordSchema = GithubKpiInputSchema.merge(ManualKpiInputSchema)

// --- Diary table row (saved to DB after Job 4) ---
export const DiaryEntrySchema = z.object({
  content: z.string(), // full AI-generated KPI report
  created_at: z.string(),
  updated_at: z.string(),
})

// --- Cleanup result (Job 1) ---
export const CleanupResultSchema = z.object({
  deleted_count: z.number(),
  failed_count: z.number(),
  status: z.enum(['success', 'partial', 'failed']),
  errors: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

// TypeScript types inferred from schemas
export type GitHubDigest = z.infer<typeof GitHubDigestSchema>
export type GithubKpiInput = z.infer<typeof GithubKpiInputSchema>
export type ManualKpiInput = z.infer<typeof ManualKpiInputSchema>
export type KpiRecord = z.infer<typeof KpiRecordSchema>
export type DiaryEntry = z.infer<typeof DiaryEntrySchema>
export type CleanupResult = z.infer<typeof CleanupResultSchema>
