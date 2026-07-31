import { logger } from '../utils/logger.js'
import { Pool } from 'pg'
import type { KpiRecord, DiaryEntry, CleanupResult, TrendingRepoLog, AiNewsLog } from '../schemas/index.js'

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

    -- saveTrendingRepos upserts on this. Fails if the table already holds
    -- duplicate repo_names — run scripts/dedupe-trending.ts first.
    CREATE UNIQUE INDEX IF NOT EXISTS github_trending_repo_name_key ON github_trending (repo_name);

    CREATE TABLE IF NOT EXISTS ai_news (
      id             SERIAL PRIMARY KEY,
      title          TEXT NOT NULL,
      url            TEXT NOT NULL,
      source         TEXT NOT NULL DEFAULT '',
      snippet        TEXT NOT NULL DEFAULT '',
      published_date TIMESTAMPTZ,
      sent           BOOLEAN NOT NULL DEFAULT false,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- The digest dedupes on url: a story already in this table is never sent twice.
    CREATE UNIQUE INDEX IF NOT EXISTS ai_news_url_key ON ai_news (url);
  `)

  // The T15 AI news feature (removed in T20) left an ai_news table behind on any
  // database it ever ran against — including production. CREATE TABLE IF NOT
  // EXISTS silently keeps that older shape, so inserts fail on the missing
  // columns until it is brought forward. Its `summary` held what is now
  // `snippet`, so the rename preserves the old rows as dedupe history.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ai_news' AND column_name = 'summary'
      ) THEN
        ALTER TABLE ai_news RENAME COLUMN summary TO snippet;
      END IF;
    END $$;

    ALTER TABLE ai_news ADD COLUMN IF NOT EXISTS source         TEXT NOT NULL DEFAULT '';
    ALTER TABLE ai_news ADD COLUMN IF NOT EXISTS snippet        TEXT NOT NULL DEFAULT '';
    ALTER TABLE ai_news ADD COLUMN IF NOT EXISTS published_date TIMESTAMPTZ;
  `)
  logger.info('✅ Own database tables ready')
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

// One row per repo. A repo that trends again updates in place — star counts stay
// current instead of going stale behind a dedup filter. created_at keeps its
// original value, so it still reads as "first seen".
export async function saveTrendingRepos(repos: TrendingRepoLog[]): Promise<void> {
  for (const repo of repos) {
    await pool.query(
      `INSERT INTO github_trending (repo_name, url, description, language, stars, today_stars, summary, tags, sent, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (repo_name) DO UPDATE SET
         url         = EXCLUDED.url,
         description = EXCLUDED.description,
         language    = EXCLUDED.language,
         stars       = EXCLUDED.stars,
         today_stars = EXCLUDED.today_stars,
         summary     = EXCLUDED.summary,
         tags        = EXCLUDED.tags,
         sent        = EXCLUDED.sent,
         updated_at  = EXCLUDED.updated_at`,
      [
        repo.repo_name,
        repo.url,
        repo.description,
        repo.language,
        repo.stars,
        repo.today_stars,
        repo.summary,
        repo.tags,
        repo.sent,
        repo.created_at,
        repo.updated_at,
      ]
    )
  }
}

// One row per story, keyed on url. A story that resurfaces updates in place
// rather than inserting a duplicate — created_at keeps its original value, so it
// still reads as "first seen".
export async function saveAiNews(items: AiNewsLog[]): Promise<void> {
  for (const item of items) {
    await pool.query(
      `INSERT INTO ai_news (title, url, source, snippet, published_date, sent, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (url) DO UPDATE SET
         title          = EXCLUDED.title,
         source         = EXCLUDED.source,
         snippet        = EXCLUDED.snippet,
         published_date = EXCLUDED.published_date,
         sent           = EXCLUDED.sent,
         updated_at     = EXCLUDED.updated_at`,
      [item.title, item.url, item.source, item.snippet, item.published_date, item.sent, item.created_at, item.updated_at]
    )
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

// One query for the whole batch, not one per story.
export async function findSeenUrls(urls: string[]): Promise<Set<string>> {
  if (!urls.length) return new Set()

  const { rows } = await pool.query<{ url: string }>(`SELECT url FROM ai_news WHERE url = ANY($1)`, [urls])

  return new Set(rows.map((r) => r.url))
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

export async function closeOwnDb(): Promise<void> {
  await pool.end()
}
