import { Pool } from 'pg'
import type { CleanupResult } from '../schemas/index.js'
import { saveCleanupLog } from './own-db.js'
import { COMPANY_CLEANUP_TABLE, COMPANY_CLEANUP_THRESHOLD_DAYS } from '../constants/index.js'

const pool = new Pool({ connectionString: process.env.COMPANY_DB_URL })

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export async function deleteStaleCompanyRecords(): Promise<CleanupResult> {
  const table = COMPANY_CLEANUP_TABLE
  const thresholdDays = parseInt(COMPANY_CLEANUP_THRESHOLD_DAYS, 10)
  const now = new Date().toISOString()

  if (!table) {
    throw new Error('COMPANY_CLEANUP_TABLE is not set in environment variables')
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - thresholdDays)

  let deleted_count = 0
  let failed_count = 0
  const errors: string[] = []
  let status: CleanupResult['status'] = 'success'

  try {
    // Table name comes from env — not user input, safe to interpolate
    const result = await pool.query(`DELETE FROM "${table}" WHERE created_at < $1`, [cutoff.toISOString()])

    deleted_count = result.rowCount ?? 0
    console.log(`✓ Deleted ${deleted_count} stale records from "${table}" (older than ${thresholdDays} days)`)
  } catch (err) {
    failed_count = 1
    status = 'failed'

    const message = err instanceof Error ? err.message : String(err)

    errors.push(message)
    console.error(`✗ Cleanup failed for "${table}": ${message}`)
  }

  const cleanupResult: CleanupResult = {
    deleted_count,
    failed_count,
    status,
    errors,
    created_at: now,
    updated_at: now,
  }

  await saveCleanupLog(cleanupResult, table)
  return cleanupResult
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

export async function closeCompanyDb(): Promise<void> {
  await pool.end()
}
