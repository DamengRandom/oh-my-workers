# Oh My Workers

A personal AI agent suite for software engineers. Runs daily jobs automatically via GitHub Actions:

- **5pm Sydney** — fetches GitHub activity, asks what else you did, generates a KPI diary report
- **8am Sydney** — scrapes GitHub trending repos (TypeScript/JavaScript), ranks them by stars gained today, has an LLM write the summaries, delivers via Telegram
- **8:30am Sydney** — searches AI technology news via Tavily (new models, dev tools, releases), drops stories already sent, delivers the top 4 via Telegram

Built with TypeScript, LangChain/LangGraph, and any OpenAI-compatible LLM (defaults to OpenRouter, free tier). More detail in the [wiki](https://github.com/DamengRandom/oh-my-workers/wiki).

---

## How it works

**KPI pipeline (5pm):** `cleanupTool + githubAgent` (parallel) → `manualKpiTool` (waits for your input) → `diaryAgent` (writes report)

Cleanup and manual input are plain tool calls — there is no decision for a model to make, so they skip the agent loop entirely.

**GitHub Trending pipeline (8am):**
```
Scrape (TS + JS) → Rank by stars gained today (top 8) → LLM writes summaries → Telegram → upserted to DB
```

Selection is a sort, not a judgement call: the model only writes prose, and star counts, URLs and ordering come from the scrape, so it cannot corrupt the numbers on the digest.

The curator is a small LangGraph retry loop: if the LLM's output doesn't parse, it retries once with the parse error as feedback; if it still fails, the job alerts you via Telegram instead of failing silently. See [Curator Retry Graph](https://github.com/DamengRandom/oh-my-workers/wiki/Curator-Retry-Graph).

**AI news pipeline (8:30am):**
```
Tavily search (last 24h, tech press + dev blogs) → drop urls already sent → top 4 → Telegram → saved to DB
```

Scope is AI *technology* — new models, developer tools, releases. Finance-led outlets are deliberately absent: their AI coverage is funding rounds and stock moves, not software.

No model in this pipeline — Tavily's own article excerpts are the summaries, so there is nothing to hallucinate and nothing to retry.

Tavily's `score` is relevance to the query, not popularity: search `"artificial intelligence"` and a wellness blog outscores a model launch. So digest quality lives in `AI_NEWS_QUERY` and `AI_NEWS_DOMAINS`, and ranking is simply Tavily's own order. It fetches 10 to send 4 — dedupe drops stories already delivered, and the slack keeps the digest full.

---

## Setup

```bash
pnpm install
cp .env.example .env     # fill in your keys — see below
pnpm run setup            # create database tables
pnpm news                 # test the GitHub trending pipeline
pnpm start                # test the KPI pipeline
pnpm test                 # run the unit test suite
```

Minimum required in `.env`:

```env
LLM_API_KEY=              # any OpenAI-compatible provider; defaults to OpenRouter
GITHUB_TOKEN=              # github.com/settings/tokens (read:user, repo scopes)
TARGET_GITHUB_USERNAME=
DATABASE_URL=postgresql://postgres:password@localhost:5432/work_coordinator
COMPANY_DB_URL=postgresql://user:password@company-host:5432/company_db
TELEGRAM_BOT_TOKEN=        # @BotFather on Telegram → /newbot
TELEGRAM_CHAT_ID=          # message @userinfobot, then start your bot first
TAVILY_API_KEY=            # app.tavily.com → API Keys (free tier works)
```

`LANGSMITH_TRACING` / `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT` are optional (see below). Using Neon? Drop `&channel_binding=require` from the connection string — `pg` doesn't support it.

---

## Observability (LangSmith)

Optional tracing for every LangChain/LangGraph call — free tier (5,000 traces/month) comfortably covers this project. Set the three `LANGSMITH_*` vars in `.env` (get a key at [smith.langchain.com](https://smith.langchain.com)) — no code changes needed.

![LangSmith trace logs](/src/assets/images/langsmith-logs.png)

---

## Automate via GitHub Actions (recommended)

Push to GitHub, add these secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `LLM_API_KEY` | from openrouter.ai/keys (free tier works) |
| `NEON_WORK_COORDINATOR_DB_URL` | Neon connection string (no `&channel_binding=require`) |
| `NEON_MOCK_COMPANY_DB_URL` | Neon connection string for company DB |
| `COMPANY_CLEANUP_TABLE` | table to clean, e.g. `mockTestUsers` |
| `COMPANY_CLEANUP_THRESHOLD_DAYS` | stale threshold, e.g. `30` |
| `TARGET_GITHUB_USERNAME` | your GitHub username |
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `TELEGRAM_CHAT_ID` | from @userinfobot |
| `TAVILY_API_KEY` | from app.tavily.com (free tier works) |
| `LANGSMITH_API_KEY` | optional |

![GitHub Actions secrets](/src/assets/images/github-actions-secrets.png)

Trigger manually: **Actions tab → select workflow → Run workflow**. The Daily KPI Report workflow takes comma-separated activities as input.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm run setup` | One-time DB table creation |
| `pnpm cleanup` | Stale data deletion only — alias for `--job=cleanup` |
| `pnpm start` | GitHub fetch + manual KPI input + diary report — alias for `--job=daily-kpi` |
| `pnpm news` | Scrape, curate, send via Telegram — alias for `--job=news` |
| `pnpm ai-news` | Tavily AI news search, dedupe, send via Telegram — alias for `--job=ai-news` |
| `pnpm jobs` | List every registered job with its cron schedule |
| `pnpm run dev --job=<name>` | Run any registered job by name |
| `pnpm seed-mock` | Seed expired mock users into company DB |
| `pnpm test` | Run the unit test suite (`node:test` via `tsx`) |
| `pnpm tsc` | TypeScript type check |
| `pnpm format` | Auto-format with Prettier |

---

## Project structure

```
src/
├── agent/
│   ├── index.ts                # WorkCoordinator — orchestrates all agents
│   ├── prompt.ts                # System prompts for all agents
│   ├── llm.ts                  # Shared model factory (any OpenAI-compatible provider)
│   ├── utils.ts                 # Shared helpers: toolOutput, parseJson, notifyError
│   ├── curator.graph.ts        # LangGraph: self-correcting retry loop for curation
│   ├── curator-graph.test.ts    # Unit tests for the curator retry graph
│   └── *.agent.ts               # One focused agent per task
├── tools/                      # DynamicStructuredTool implementations
├── jobs/registry.ts             # Job definitions + CLI dispatch (add jobs here)
├── storage/                    # PostgreSQL queries (own-db + company-db)
├── schemas/index.ts            # Zod schemas + shared types (TrendingRepo, CuratedRepo, ...)
└── index.ts                     # Entry point + CLI flags
.github/workflows/               # cleanup, daily-kpi, seed-mock-users, morning-news
```

---

## Database tables

| Table | Description |
|---|---|
| `kpi` | Daily GitHub activity records |
| `diary` | AI-generated daily KPI reports |
| `cleanup_log` | Company DB cleanup history (Functionality no longer supported) |
| `github_trending` | Trending repos with summaries, tags, sent status |

---

## Changing companies

Update `COMPANY_DB_URL` in `.env`. No code changes needed.
