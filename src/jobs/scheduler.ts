import cron from 'node-cron'
import { DEFAULT_CRONJOB_TIMEZONE } from '../constants/index.js'
import { jobs, type Job } from './registry.js'

/**
 * Register every job in the registry that declares a `schedule` with
 * node-cron. Jobs without a schedule (e.g. the interactive daily-kpi job)
 * are skipped here and only run on-demand via the CLI. In production,
 * GitHub Actions drives the same jobs directly via `pnpm dev --job=<name>`.
 */
export function startScheduler(): void {
  const scheduled: Job[] = jobs.filter((j) => !!j.schedule)

  for (const job of scheduled) {
    if (!job.schedule) continue

    cron.schedule(
      job.schedule,
      async () => {
        try {
          await job.run()
        } catch (err) {
          console.error(`❌ Job "${job.name}" failed:`, err)
        }
      },
      { timezone: job.timezone ?? DEFAULT_CRONJOB_TIMEZONE }
    )
  }

  const summary = scheduled
    .map((j) => `${j.name}@${j.schedule} (${j.timezone ?? DEFAULT_CRONJOB_TIMEZONE})`)
    .join(', ')

  console.log(`⏰ Scheduler started — ${summary}`)
}
