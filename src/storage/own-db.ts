import { Pool } from 'pg'
import type { KpiRecord, DiaryEntry, CleanupResult } from '../schemas/index.js'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// ─── Setup ────────────────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kpi (
      id             SERIAL PRIMARY KEY,
      github_summary TEXT    NOT NULL,
      commits_count  INTEGER NOT NULL DEFAULT 0,
      prs_count      INTEGER NOT NULL DEFAULT 0,
      activities     TEXT[]  NOT NULL DEFAULT '{}',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS diary (
      id         SERIAL PRIMARY KEY,
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cleanup_log (
      id            SERIAL PRIMARY KEY,
      company_table TEXT    NOT NULL,
      deleted_count INTEGER NOT NULL DEFAULT 0,
      failed_count  INTEGER NOT NULL DEFAULT 0,
      status        TEXT    NOT NULL,
      errors        TEXT[]  NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  console.log('✅ Own database tables ready')
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function saveKpiRecord(record: KpiRecord): Promise<void> {
  await pool.query(
    `INSERT INTO kpi (github_summary, commits_count, prs_count, activities, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [record.github_summary, record.commits_count, record.prs_count,
     record.activities, record.created_at, record.updated_at]
  )
}

export async function saveDiaryEntry(entry: DiaryEntry): Promise<void> {
  await pool.query(
    `INSERT INTO diary (content, created_at, updated_at) VALUES ($1, $2, $3)`,
    [entry.content, entry.created_at, entry.updated_at]
  )
}

export async function saveCleanupLog(result: CleanupResult, tableName: string): Promise<void> {
  await pool.query(
    `INSERT INTO cleanup_log (company_table, deleted_count, failed_count, status, errors, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tableName, result.deleted_count, result.failed_count, result.status,
     result.errors ?? [], result.created_at, result.updated_at]
  )
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

export async function closeOwnDb(): Promise<void> {
  await pool.end()
}
