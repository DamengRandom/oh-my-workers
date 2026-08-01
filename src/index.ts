import { logger } from './utils/logger.js'
import 'dotenv/config'
import { initDb } from './storage/own-db.js'
import { jobs, findJobByCliArg } from './jobs/registry.js'

function printJobs(): void {
  logger.info('Available jobs 📋:')

  for (const j of jobs) {
    const scheduledJobs = j.schedule ? ` [${j.schedule}]` : ' [manual]'

    logger.info(`  --job=${j.name}${scheduledJobs}  — ${j.description}`)
  }
}

async function main(): Promise<void> {
  // One-time DB setup: pnpm setup
  if (process.argv.includes('--setup')) {
    await initDb()

    logger.info('✅ Database setup complete.')
    process.exit(0)
  }

  // List registered jobs: pnpm dev --list-jobs
  if (process.argv.includes('--list-jobs')) {
    printJobs()

    process.exit(0)
  }

  // Generic job runner: pnpm dev --job=<name>
  const job = findJobByCliArg(process.argv)

  if (job) {
    await initDb()
    await job.run()

    process.exit(0)
  }

  logger.info('No job specified. Use --job=<name> to run one, or --list-jobs to see all.')
  printJobs()
  process.exit(0)
}

main().catch((err) => {
  logger.error({ err }, 'Fatal system error ⚠️❌⚠️❌')

  process.exit(1)
})
