# AI News Digest — Design

**Date:** 2026-07-31
**Status:** Approved, ready for implementation plan

## Goal

A daily job that finds the top 4 AI industry news stories via Tavily and delivers them to Telegram, alongside the existing GitHub Trending digest. Runnable locally with a single command, exactly like the KPI and trending jobs.

## Why "hottest" is a query problem, not a ranking problem

Tavily's `score` field is relevance-to-the-query, not popularity. There is no engagement metric in the API. Two live probes against the real endpoint on 2026-07-31 make the point:

Query `"artificial intelligence"`, no domain filter — top results by score:

```
0.630  Why AI Is Changing What It Means to Be Intelligent   (facultyfocus.com)
0.614  Artificial Intelligence in Clinical Trials
0.561  artificial intelligence – Live Healthy Live Well
```

Query `"major AI model releases, funding, and industry announcements"` scoped to tech/business outlets — top results by score:

```
0.395  Moonshot AI Surpasses Funding Goal to Hit $35 Billion Value  (bloomberg.com)
0.359  Anthropic rolls out Opus 5 AI model in efficiency upgrade     (reuters.com)
0.344  Pangram raises $9M as AI content floods the internet          (techcrunch.com)
```

The good results score *lower*. Chasing a higher score would make the digest worse. The quality lever is the query and `include_domains`; ranking is then just "take Tavily's order", consistent with the trending job's existing principle that selection is a sort, not a judgement call.

## Pipeline

```
Tavily search (days=1, domain-scoped, max_results=10)
  → drop URLs already in ai_news
  → take the first 4 in Tavily's order
  → send via Telegram
  → upsert all 4 with the sent flag
```

Fetching 10 to send 4 leaves slack: dedupe removes already-sent stories, and without headroom a busy news day would deliver fewer than four.

## Components

### `src/tools/ai-news-search.tool.ts` (new)

`DynamicStructuredTool` named `search_ai_news`. Schema takes `query`, `days`, `maxResults`, `domains`, all defaulted from constants so the job calls it with no arguments.

Posts to `https://api.tavily.com/search` with `Authorization: Bearer ${TAVILY_API_KEY}` and body `{ query, topic: 'news', days, max_results, search_depth: 'advanced', include_domains }`. Verified working against the live API.

Throws when `TAVILY_API_KEY` is unset and on non-2xx, matching `news-telegram.tool.ts`. Maps each result to `AiNewsItem`:

| Tavily field | `AiNewsItem` field | Note |
|---|---|---|
| `title` | `title` | |
| `url` | `url` | dedupe key |
| `content` | `snippet` | truncated to 200 chars |
| `published_date` | `published_date` | RFC-1123 (`Fri, 31 Jul 2026 04:00:00 GMT`) → ISO |
| — | `source` | `new URL(url).hostname`, `www.` stripped |

`score` and `raw_content` are dropped — neither reaches the digest.

### `src/tools/ai-news-telegram.tool.ts` (new)

Mirrors `trendingTelegramTool`: HTML `parse_mode`, numbered emoji, `disable_web_page_preview`. Per article:

```
1️⃣ <b>Anthropic rolls out Opus 5 AI model</b>
📰 reuters.com · 2026-07-31
<i>Anthropic said the new model cuts inference cost while…</i>
🔗 <a href="…">Read more</a>
```

Snippets are already truncated at the search tool, but the 200-char bound is re-asserted here — the same reason the trending tool bounds at 140 in code: Telegram hard-fails the whole message past 4096 chars, so the bound belongs where the message is built.

### `src/agent/utils.ts`

Move `escapeHtml` out of `news-telegram.tool.ts` and export it here. Two telegram tools now need it; `utils.ts` already holds the shared helpers.

### `src/storage/own-db.ts`

New table in `initDb()`:

```sql
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
CREATE UNIQUE INDEX IF NOT EXISTS ai_news_url_key ON ai_news (url);
```

`published_date` is nullable — Tavily omits it on some results.

Two functions:

- `findSeenUrls(urls: string[]): Promise<Set<string>>` — one `SELECT url FROM ai_news WHERE url = ANY($1)`, not a query per article.
- `saveAiNews(items: AiNewsLog[]): Promise<void>` — upsert on `url`, following `saveTrendingRepos`. `created_at` keeps its original value so it still reads as "first seen".

### `src/agent/index.ts`

`WorkCoordinator.runAiNewsAgent()`, plus one private helper per step, matching the existing `runNewsAgent` layout: `searchAiNews`, `dropSeen`, `sendAiNewsTelegram`, `saveAiNews`. Exported as `runAiNewsAgent` alongside the other named exports.

### `src/constants/index.ts`

```ts
export const AI_NEWS_TOP_N = 4
export const AI_NEWS_FETCH_N = 10        // over-fetch so dedupe still leaves 4
export const AI_NEWS_LOOKBACK_DAYS = 1
export const AI_NEWS_SNIPPET_MAX = 200
export const AI_NEWS_QUERY = 'major AI model releases, funding, and industry announcements'
export const AI_NEWS_DOMAINS = [
  'techcrunch.com', 'theverge.com', 'arstechnica.com', 'venturebeat.com',
  'wired.com', 'reuters.com', 'bloomberg.com', 'theinformation.com',
]
export const AI_NEWS_CRON_TIME = '30 22 * * *'  // 8:30 AM AEST, 30 min after trending
```

### `src/schemas/index.ts`

```ts
export const AiNewsItemSchema = z.object({
  title: z.string(),
  url: z.string(),
  source: z.string(),
  snippet: z.string(),
  published_date: z.string().nullable(),
})
export const AiNewsLogSchema = AiNewsItemSchema.extend({
  sent: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type AiNewsItem = z.infer<typeof AiNewsItemSchema>
export type AiNewsLog = z.infer<typeof AiNewsLogSchema>
```

## Local testing

The job must be runnable end-to-end from the terminal, the same way `pnpm start` and `pnpm news` are.

- `src/jobs/registry.ts` — register `ai-news` with `AI_NEWS_CRON_TIME`, `DEFAULT_CRONJOB_TIMEZONE`, and `runAiNewsAgent`. This makes it appear in `pnpm jobs` and work via `pnpm run dev --job=ai-news`.
- `package.json` — `"ai-news": "pnpm run dev --job=ai-news"`.

`pnpm ai-news` then does the real thing locally: live Tavily call, local Postgres via `DATABASE_URL`, real Telegram message to `TELEGRAM_CHAT_ID`. Same shape as the manual-KPI and trending verifications.

One-time: re-run `pnpm run setup` to create `ai_news`. `initDb` is `CREATE TABLE IF NOT EXISTS` throughout, so it is safe against the existing database.

Because dedupe suppresses repeats, a second `pnpm ai-news` inside the same news cycle correctly sends fewer than 4 — or nothing. That is the feature working, not a failure. `DELETE FROM ai_news;` resets local state for a clean re-test.

## Error handling

Follows the existing jobs exactly: try/catch per step, `logger.error`, `notifyError(context, err)` to Telegram, and a return rather than a throw so one failed step cannot take down the process.

- Missing `TAVILY_API_KEY` → throw from the tool, caught by the step, notified.
- Tavily non-2xx → same path, error body included in the message.
- Zero results, or every result already sent → log and skip both send and save. Not an error.
- Telegram send fails → still persist, with `sent: false`. Matches the trending job, and means a failed send does not silently lose the articles.

No LLM in this pipeline, so there is no `curator.graph` retry loop and one fewer failure mode than the trending digest.

## Testing

One new file, `src/tools/ai-news-search.test.ts`, using `node:test` with a stubbed global `fetch`, matching the existing suite:

1. Maps a Tavily payload to `AiNewsItem` — `source` derived from the hostname with `www.` stripped, `published_date` normalised to ISO, `score`/`raw_content` dropped.
2. Tolerates a result with no `published_date` (`null`, not a crash).
3. Truncates a snippet past `AI_NEWS_SNIPPET_MAX`, leaves a short one untouched.
4. Throws on non-2xx, with the status in the message.
5. Throws when `TAVILY_API_KEY` is unset.

Dedupe and the top-4 slice live in a pure exported function, `selectUnseen(items, seenUrls, topN)`, exported from `ai-news-search.tool.ts` for testing — the same way `news-curator.agent.ts` exports `mergeSummaries`. That keeps these two cases in the same file, with no database:

6. Dedupe drops seen URLs and still yields 4 when the fetch returned 10.
7. Fewer than 4 survivors sends what remains rather than padding.

## Deployment

`.github/workflows/ai-news.yml`, copied from `morning-news.yml` with:

- `cron: '30 22 * * *'`
- `TAVILY_API_KEY: ${{ secrets.TAVILY_API_KEY }}` added to `env` (new repo secret required)
- no `LLM_API_KEY` — this pipeline never calls a model
- `run: pnpm ai-news`

`.env.example` and `README.md` updated: the new key, the new command in the commands table, and the pipeline in the "How it works" section.

## Out of scope

- LLM-written summaries. Tavily's snippets are used as-is; revisit only if the raw excerpts read badly in practice.
- Making the query or domain list configurable at runtime. They are constants; edit and redeploy.
- Backfill or historical reporting over `ai_news`. The table exists for dedupe.
