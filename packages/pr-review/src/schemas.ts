import { z } from 'zod'

// A single review finding: a real bug, security, or performance issue with a precise location.
export const ReviewFindingSchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  category: z.enum(['bug', 'security', 'performance']),
  file: z.string().describe('Repo-relative path of the file the issue is in'),
  line: z.number().describe('Line number in the changed file where the issue occurs'),
  title: z.string().describe('Short one-line summary of the issue'),
  explanation: z.string().describe('Why this is a real issue, referencing the surrounding code that was inspected'),
  suggestion: z.string().describe('Concrete fix or change to resolve the issue'),
})

export const ReviewResultSchema = z.object({
  summary: z.string().describe('One-paragraph overall assessment of the PR'),
  findings: z.array(ReviewFindingSchema),
})

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>
export type ReviewResult = z.infer<typeof ReviewResultSchema>
