import cron from 'node-cron'
import { runDailyJobs } from '../agent/index.js'
import { DEFAULT_CRONJOB_TIME, DEFAULT_CRONJOB_TIMEZONE } from '../constants/index.js'

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

  console.log(`⏰ Scheduler started — daily jobs will run at ${DEFAULT_CRONJOB_TIME} ${DEFAULT_CRONJOB_TIMEZONE}`)
}
