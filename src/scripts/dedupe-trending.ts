import 'dotenv/config'
import { Pool } from 'pg'

// One-time migration: github_trending was an append-only log, so a repo that
// trended on several days has several rows. saveTrendingRepos now upserts, which
// needs a unique index on repo_name — this collapses each repo to its newest row
// and adds that index.
//
// Dry run by default. Pass --apply to actually delete.
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const url = process.env.DATABASE_URL

  if (!url) throw new Error('DATABASE_URL is not set')

  const pool = new Pool({ connectionString: url })
  const { hostname } = new URL(url)

  try {
    const before = await pool.query<{ total: number; names: number }>(
      'SELECT COUNT(*)::int total, COUNT(DISTINCT repo_name)::int names FROM github_trending'
    )
    const { total, names } = before.rows[0]

    console.log(`target      : ${hostname}`)
    console.log(`rows        : ${total}`)
    console.log(`distinct    : ${names}`)
    console.log(`to delete   : ${total - names}`)

    if (!apply) {
      console.log('\nDRY RUN — nothing changed. Re-run with --apply to delete the older duplicate rows.')
      return
    }

    // Keep the most recently created row per repo_name, drop the rest.
    const deleted = await pool.query(`
      DELETE FROM github_trending a
      USING github_trending b
      WHERE a.repo_name = b.repo_name
        AND (a.created_at, a.id) < (b.created_at, b.id)
    `)

    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS github_trending_repo_name_key ON github_trending (repo_name)')

    const after = await pool.query<{ total: number; names: number }>(
      'SELECT COUNT(*)::int total, COUNT(DISTINCT repo_name)::int names FROM github_trending'
    )

    console.log(`\ndeleted     : ${deleted.rowCount}`)
    console.log(`rows now    : ${after.rows[0].total} (${after.rows[0].names} distinct)`)
    console.log('unique index: created ✅')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
