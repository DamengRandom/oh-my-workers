import cron from 'node-cron'
import { runDailyJobs, runNewsAgent } from '../agent/index.js'
import { DEFAULT_CRONJOB_TIME, DEFAULT_CRONJOB_TIMEZONE, NEWS_CRON_TIME } from '../constants/index.js'

export function startScheduler(): void {
  // Runs every day at 5:00pm Sydney time
  // node-cron uses IANA timezone names
  cron.schedule(
    DEFAULT_CRONJOB_TIME,
    async () => {
      try {
        await runDailyJobs()
      } catch (err) {
        console.error('❌  Daily jobs failed:', err)
      }
    },
    { timezone: DEFAULT_CRONJOB_TIMEZONE }
  )

  cron.schedule(
    NEWS_CRON_TIME,
    async () => {
      try {
        await runNewsAgent()
      } catch (err) {
        console.error('❌ AI News job failed:', err)
      }
    },
    { timezone: DEFAULT_CRONJOB_TIMEZONE }
  )

  console.log(`⏰ Scheduler started — daily jobs at ${DEFAULT_CRONJOB_TIME}, news at ${NEWS_CRON_TIME} (${DEFAULT_CRONJOB_TIMEZONE})`)
}
