import cron from 'node-cron'
import { runDailyJobs, runQuizAgent } from '../agent/index.js'
import { DEFAULT_CRONJOB_TIME, DEFAULT_CRONJOB_TIMEZONE, QUIZ_CRON_TIME } from '../constants/index.js'

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
    QUIZ_CRON_TIME,
    async () => {
      try {
        await runQuizAgent()
      } catch (err) {
        console.error('❌ Quiz job failed:', err)
      }
    },
    { timezone: DEFAULT_CRONJOB_TIMEZONE }
  )

  console.log(`⏰ Scheduler started — daily jobs at ${DEFAULT_CRONJOB_TIME}, quiz at ${QUIZ_CRON_TIME} (${DEFAULT_CRONJOB_TIMEZONE})`)
}
