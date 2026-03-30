import 'dotenv/config'
import { initDb } from './storage/own-db.js'
import { startScheduler } from './jobs/scheduler.js'
import { runDailyJobs } from './agent/index.js'

async function main(): Promise<void> {
  // Run DB setup once with: pnpm dev --setup
  if (process.argv.includes('--setup')) {
    await initDb()
    console.log('✅ Database setup complete. Run pnpm dev --run or pnpm start for normal use.')
    process.exit(0)
  }
  // Run functionalities manually with: pnpm dev --run
  if (process.argv.includes('--run')) {
    await runDailyJobs()
    console.log('✅ Daily jobs completed successfully.')
    process.exit(0)
  }

  startScheduler()
  console.log('✅ Scheduler started — daily jobs will run at 5:00pm Sydney time')
}

main().catch((err) => {
  console.error('Fatal system error:', err)

  process.exit(1)
})
