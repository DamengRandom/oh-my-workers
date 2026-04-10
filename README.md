# Oh My Workers

A personal AI agent suite for software engineers. Runs daily jobs automatically via GitHub Actions:

- **5pm Sydney** — fetches GitHub activity, asks what else you did, generates a KPI diary report
- **8am Sydney** — scrapes GitHub trending repos (TypeScript/JavaScript), deduplicates against recent sends, curates top picks with an LLM, delivers via Telegram

Built with TypeScript, LangChain, and Claude.

<video src="https://github.com/user-attachments/assets/1c37e4f1-4a8a-4100-8a07-9cedfa7e745f" width="600" height="360" controls></video>

---

## How it works

**KPI pipeline (5pm):**
```
Phase 1 (parallel):  cleanupAgent + githubAgent
Phase 2 (sequential): manualKpiAgent ← waits for your input
Phase 3 (sequential): diaryAgent ← writes report from Phase 1+2 data
```

**GitHub Trending pipeline (8am):**
```
Scrape GitHub trending (TS + JS)
    ↓
Dedup against DB (last 7 days)
    ↓
LLM curator → picks top 5-8, writes summaries + tags
    ↓
Telegram delivery → saved to github_trending table
```

The curator generates 3-5 tags per repo (e.g. `#ai`, `#framework`, `#bundler`) for future vector search classification.

---

## Setup

### 1. Install

```bash
pnpm install
cp .env.example .env
```

### 2. Configure `.env`

```env
ANTHROPIC_API_KEY=
GITHUB_TOKEN=                  # github.com/settings/tokens (read:user, repo scopes)
TARGET_GITHUB_USERNAME=

DATABASE_URL=postgresql://postgres:password@localhost:5432/work_coordinator
COMPANY_DB_URL=postgresql://user:password@company-host:5432/company_db

# Telegram
TELEGRAM_BOT_TOKEN=            # @BotFather on Telegram → /newbot
TELEGRAM_CHAT_ID=              # message @userinfobot to get your ID, then start your bot first
```

### 3. Initialize database

```bash
pnpm run setup
```

> Using Neon? Pass the URL inline: `DATABASE_URL="postgresql://...?sslmode=require" pnpm run setup`
> Remove `&channel_binding=require` from Neon URLs — the `pg` library doesn't support it.

### 4. Test

```bash
pnpm start   # runs all KPI jobs now
pnpm news    # runs GitHub trending pipeline now
```

---

## Automate via GitHub Actions (recommended)

Push to GitHub, then add these secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | from console.anthropic.com |
| `NEON_WORK_COORDINATOR_DB_URL` | Neon connection string (remove `&channel_binding=require`) |
| `NEON_MOCK_COMPANY_DB_URL` | Neon connection string for company DB |
| `COMPANY_CLEANUP_TABLE` | table to clean, e.g. `mockTestUsers` |
| `COMPANY_CLEANUP_THRESHOLD_DAYS` | stale threshold, e.g. `30` |
| `TARGET_GITHUB_USERNAME` | your GitHub username |
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `TELEGRAM_CHAT_ID` | from @userinfobot |

![GitHub Actions secrets](/src/assets/images/github-actions-secrets.png)

Workflows run automatically. Trigger manually: **Actions** tab → select workflow → **Run workflow**.

The **Daily KPI Report** workflow has a form — enter comma-separated activities before clicking Run.

---

## Automate locally (macOS crontab)

```bash
crontab -e
```

Add (replace paths with your own):
```
PATH=/Users/yourname/.nvm/versions/node/v22.14.0/bin:/opt/homebrew/bin:/usr/bin:/bin
TZ=Australia/Sydney
0 17 * * * /opt/homebrew/bin/pnpm --prefix /path/to/project cleanup >> /path/to/project/data/cron.log 2>&1
```

> Mac must be awake at 5pm. GitHub Actions is more reliable for unattended runs.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm run setup` | One-time DB table creation |
| `pnpm cleanup` | Stale data deletion only (used by crontab) — alias for `--job=cleanup` |
| `pnpm start` | GitHub fetch + manual KPI input + diary report — alias for `--job=daily-kpi` |
| `pnpm news` | Scrape GitHub trending, curate, send via Telegram — alias for `--job=news` |
| `pnpm jobs` | List every registered job with its cron schedule |
| `pnpm run dev --job=<name>` | Run any registered job by name (generic dispatch) |
| `pnpm dev` | Long-running daemon (fires scheduled jobs via node-cron) |
| `pnpm seed-mock` | Seed expired mock users into company DB |
| `pnpm format` | Auto-format with Prettier |
| `pnpm tsc` | TypeScript type check |

---

## Project structure

```
src/
├── agent/
│   ├── index.ts                # WorkCoordinator — orchestrates all agents
│   ├── prompt.ts               # System prompts for all agents
│   ├── cleanup.agent.ts
│   ├── github.agent.ts
│   ├── manual-kpi.agent.ts
│   ├── diary.agent.ts
│   ├── news-curator.agent.ts   # LLM curator for trending repos
│   └── news-telegram.agent.ts  # Telegram delivery agent
├── tools/                      # DynamicStructuredTool implementations
│   ├── trending-scrape.tool.ts # GitHub trending HTML scraper
│   ├── news-curator.tool.ts    # Curate + tag trending repos
│   └── news-telegram.tool.ts   # Format + send Telegram message
├── jobs/
│   ├── registry.ts             # Generic Job registry — add new cron jobs here
│   └── scheduler.ts            # node-cron loop over registry
├── storage/                    # PostgreSQL queries (own-db + company-db)
├── schemas/index.ts            # Zod schemas
└── index.ts                    # Entry point + CLI flags
.github/workflows/
├── cleanup.yml                 # Daily 5pm cleanup
├── daily-kpi.yml               # Manual KPI trigger (workflow_dispatch)
├── seed-mock-users.yml         # Daily 4:30pm mock data seeding
└── morning-news.yml            # Daily 8am GitHub trending digest
```

---

## Database tables

| Table | Description |
|---|---|
| `kpi` | Daily GitHub activity records (commits, PRs, manual activities) |
| `diary` | AI-generated daily KPI reports |
| `cleanup_log` | Company DB cleanup history (deleted count, errors) |
| `github_trending` | Trending repos with summaries, tags, and sent status |

---

## Changing companies

Update `COMPANY_DB_URL` in `.env`. No code changes needed.
