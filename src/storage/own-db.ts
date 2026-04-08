import { Pool } from 'pg'
import type { KpiRecord, DiaryEntry, CleanupResult, TrendingRepoLog } from '../schemas/index.js'

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

    CREATE TABLE IF NOT EXISTS github_trending (
      id          SERIAL PRIMARY KEY,
      repo_name   TEXT    NOT NULL,
      url         TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      language    TEXT    NOT NULL DEFAULT '',
      stars       INTEGER NOT NULL DEFAULT 0,
      today_stars INTEGER NOT NULL DEFAULT 0,
      summary     TEXT    NOT NULL DEFAULT '',
      tags        TEXT[]  NOT NULL DEFAULT '{}',
      sent        BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  console.log('✅ Own database tables ready')
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function saveKpiRecord(record: KpiRecord): Promise<void> {
  await pool.query(
    `INSERT INTO kpi (github_summary, commits_count, prs_count, activities, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [record.github_summary, record.commits_count, record.prs_count, record.activities, record.created_at, record.updated_at]
  )
}

export async function saveDiaryEntry(entry: DiaryEntry): Promise<void> {
  await pool.query(`INSERT INTO diary (content, created_at, updated_at) VALUES ($1, $2, $3)`, [entry.content, entry.created_at, entry.updated_at])
}

export async function saveCleanupLog(result: CleanupResult, tableName: string): Promise<void> {
  await pool.query(
    `INSERT INTO cleanup_log (company_table, deleted_count, failed_count, status, errors, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tableName, result.deleted_count, result.failed_count, result.status, result.errors ?? [], result.created_at, result.updated_at]
  )
}

export async function getRecentRepoNames(days: number = 7): Promise<Set<string>> {
  const result = await pool.query<{ repo_name: string }>(
    `SELECT DISTINCT repo_name FROM github_trending WHERE created_at > NOW() - INTERVAL '1 day' * $1`,
    [days]
  )
  return new Set(result.rows.map((r) => r.repo_name))
}

export async function saveTrendingRepos(repos: TrendingRepoLog[]): Promise<void> {
  for (const repo of repos) {
    await pool.query(
      `INSERT INTO github_trending (repo_name, url, description, language, stars, today_stars, summary, tags, sent, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [repo.repo_name, repo.url, repo.description, repo.language, repo.stars, repo.today_stars, repo.summary, repo.tags, repo.sent, repo.created_at, repo.updated_at]
    )
  }
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

export async function closeOwnDb(): Promise<void> {
  await pool.end()
}
