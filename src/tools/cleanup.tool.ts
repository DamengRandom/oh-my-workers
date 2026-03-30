import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { deleteStaleCompanyRecords } from '../storage/company-db.js'
import { COMPANY_CLEANUP_TABLE, COMPANY_CLEANUP_THRESHOLD_DAYS } from '../constants/index.js'

export const cleanupTool = new DynamicStructuredTool({
  name: 'delete_stale_company_records',
  description:
    'Deletes stale records from the company database table that are older than the configured threshold (default 30 days). Saves the cleanup result to the local cleanup_log table.',
  schema: z.object({}), // no inputs — everything comes from env vars
  func: async () => {
    const table = COMPANY_CLEANUP_TABLE
    const days = COMPANY_CLEANUP_THRESHOLD_DAYS

    console.log(`➡️ Running cleanup on "${table}" (threshold: ${days} days)...`)

    const result = await deleteStaleCompanyRecords()

    console.log(`✅ Cleanup complete: ${result.deleted_count} deleted, ${result.failed_count} failed, status: ${result.status}`)

    return JSON.stringify(result)
  },
})
