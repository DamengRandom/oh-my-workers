import 'dotenv/config'
import { initDb } from './storage/own-db.js'
import { startScheduler } from './jobs/scheduler.js'
import { runDailyJobs, runCleanup, runNewsAgent } from './agent/index.js'

async function main(): Promise<void> {
  // One-time DB setup: pnpm setup
  if (process.argv.includes('--setup')) {
    await initDb()
    console.log('✅ Database setup complete.')
    process.exit(0)
  }

  // Automated cleanup only (no human input) — used by crontab: pnpm cleanup
  if (process.argv.includes('--cleanup')) {
    await runCleanup()
    process.exit(0)
  }

  // Interactive KPI jobs — run manually when at laptop: pnpm start
  if (process.argv.includes('--run')) {
    await runDailyJobs()
    process.exit(0)
  }

  // Daily AI news — search, curate, send via Telegram: pnpm news
  if (process.argv.includes('--news')) {
    await runNewsAgent()
    process.exit(0)
  }

  startScheduler()
  console.log('✅ Scheduler started — daily jobs will run at 5:00pm Sydney time')
}

main().catch((err) => {
  console.error('Fatal system error:', err)

  process.exit(1)
})
