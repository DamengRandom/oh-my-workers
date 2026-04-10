import { runDailyJobs, runCleanup, runNewsAgent } from '../agent/index.js'
import {
  DEFAULT_CRONJOB_TIME,
  DEFAULT_CRONJOB_TIMEZONE,
  NEWS_CRON_TIME,
} from '../constants/index.js'

/**
 * A Job is a single unit of scheduled work.
 *
 * - `name`        stable identifier — used by CLI (`--job=<name>`) and logs
 * - `description` one-line human-readable summary shown by `--list-jobs`
 * - `schedule`    cron expression for the in-process scheduler. Omit for
 *                 interactive/manual-only jobs that are never auto-scheduled
 * - `timezone`    IANA timezone name (defaults to DEFAULT_CRONJOB_TIMEZONE)
 * - `run`         the actual pipeline — hand-written, not generalized
 */
export type Job = {
  name: string
  description: string
  schedule?: string
  timezone?: string
  run: () => Promise<void>
}

export const jobs: Job[] = [
  {
    name: 'cleanup',
    description: 'Stale data cleanup (automated, no human input required)',
    schedule: DEFAULT_CRONJOB_TIME,
    timezone: DEFAULT_CRONJOB_TIMEZONE,
    run: runCleanup,
  },
  {
    name: 'daily-kpi',
    description: 'Interactive daily KPI pipeline (GitHub fetch + manual input + diary)',
    run: runDailyJobs,
  },
  {
    name: 'news',
    description: 'GitHub trending scrape, curate, and Telegram delivery',
    schedule: NEWS_CRON_TIME,
    timezone: DEFAULT_CRONJOB_TIMEZONE,
    run: runNewsAgent,
  },
]

export function findJobByName(name: string): Job | undefined {
  return jobs.find((j) => j.name === name)
}

export function findJobByCliArg(argv: string[]): Job | undefined {
  const prefix = '--job='
  const arg = argv.find((a) => a.startsWith(prefix))

  if (!arg) return undefined

  return findJobByName(arg.slice(prefix.length))
}
