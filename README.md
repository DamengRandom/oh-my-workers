# Oh My Workers

A personal AI agent that runs every day at 5pm Sydney time to collect your GitHub activity, ask for anything else you did, and generate a daily work KPI report saved to your database.

Built with TypeScript, LangChain, and Claude Code.

**Two ways to run automatically:**
- **GitHub Actions + Neon** (recommended) — runs in the cloud, no Mac needed, free
- **macOS crontab** — runs locally, Mac must be awake at 5pm

---

## What it does

```
5pm Sydney time
    ↓
Phase 1 (parallel):
  cleanupAgent ──┐  both run at the same time
  githubAgent  ──┘
    ↓
Phase 2 (sequential, interactive):
  manualKpiAgent  ← waits for your keyboard input (to type what did today, part of your KPI report if you need to check on it later on)
    ↓
Phase 3 (sequential, depends on Phase 1+2):
  diaryAgent  ← receives GitHub + manual data, writes report
```

| Agent | Job | Runs |
|---|---|---|
| `cleanupAgent` | Deletes stale records from company DB (older than 30 days) | Parallel with GitHub |
| `githubAgent` | Fetches today's commits and PRs from GitHub | Parallel with cleanup |
| `manualKpiAgent` | Asks you to type in anything GitHub didn't capture | After Phase 1 |
| `diaryAgent` | Writes daily KPI report, saves to `kpi` and `diary` tables | After Phase 2 |

---

## Tech stack

- **TypeScript + Node.js**
- **LangChain.js** — multi-agent orchestration
- **Claude (Anthropic)** — AI brain for each agent
- **GitHub Actions** — daily 5pm cloud cron trigger (recommended)
- **Neon PostgreSQL** — free cloud database
- **crontab (macOS)** — alternative local trigger
- **node-cron** — alternative daemon-based trigger
- **Octokit** — GitHub REST API
- **Zod** — output schema validation
- **PostgreSQL** — stores KPI records, diary entries, and cleanup logs

---

## Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL running locally or remotely (see DB Setup below)
- Anthropic API key
- GitHub personal access token

---

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
ANTHROPIC_API_KEY=        # from console.anthropic.com
GITHUB_TOKEN=             # from github.com/settings/tokens (read:user, repo scopes)
GITHUB_USERNAME=           # your GitHub username or email

DATABASE_URL=postgresql://postgres:password@localhost:5432/work_coordinator

# Update these when you change jobs (This is company specific database URL)
COMPANY_DB_URL=postgresql://user:password@company-host:5432/company_db
```

### 3. Create the database

In SQL client (or psql), create a database named `work_coordinator`.
The app creates all tables automatically on first run.

See **DB Setup** section below for a step-by-step SQL client guide.

### 4. Initialize the database (one-time only)

```bash
pnpm run setup
```

> **Note:** If using Neon or another remote database, pass the URL inline to avoid modifying `.env` (‼️IMPORTANT):
> ```bash
> DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require" pnpm run setup
> ```
> Do NOT include `&channel_binding=require` — the `pg` library doesn't support it and will fail with an auth error.

This creates the `kpi`, `diary`, and `cleanup_log` tables. You only need to run this once — tables persist across restarts.

### 5. Test immediately

```bash
pnpm start
```

Runs all jobs right now and exits. Use this to verify everything works before setting up the daily schedule.

### 6. Automate — run daily at 5pm (macOS crontab)‼️‼️‼️

crontab is the simplest way to trigger the project automatically every day at 5pm without keeping a terminal open. Your Mac just needs to be awake at 5pm.

**Step 1** — Collect the paths you need:

```bash
which node    # e.g. /Users/yourname/.nvm/versions/node/v22.14.0/bin/node
which pnpm    # e.g. /opt/homebrew/bin/pnpm
```

> **Important — nvm users:** crontab runs with a minimal `PATH` that does not include nvm or Homebrew.
> If you manage Node.js with nvm, `node` will not be found unless you explicitly add its path.
> This causes a silent `env: node: No such file or directory` error and the job is skipped.
> Always set `PATH` as the first line of your crontab (see Step 3).

**Step 2** — Open your crontab:

```bash
crontab -e
```

**Step 3** — Add these three lines (replace paths with your own):

```
PATH=/your/node/bin:/opt/homebrew/bin:/usr/bin:/bin
TZ=Australia/Sydney
0 17 * * * /opt/homebrew/bin/pnpm --prefix /your/project/path cleanup >> /your/project/path/data/cron.log 2>&1
```

Example for nvm + Homebrew on macOS:

```
PATH=/Users/yourname/.nvm/versions/node/v22.14.0/bin:/opt/homebrew/bin:/usr/bin:/bin
TZ=Australia/Sydney
0 17 * * * /opt/homebrew/bin/pnpm --prefix /Users/yourname/projects/oh-my-workers cleanup >> /Users/yourname/projects/oh-my-workers/data/cron.log 2>&1
```

Save and close. The job is now registered.

> `pnpm cleanup` only runs the **stale data deletion** — no human input needed, safe to run unattended.
> Run `pnpm start` manually when you are at your laptop to complete the GitHub KPI summary and diary report.

**Step 4** — Verify it was saved:

```bash
crontab -l
```

**Step 5** — Test it immediately before waiting for 5pm:

```bash
# Simulate the exact crontab command with the same PATH
PATH=/your/node/bin:/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/pnpm --prefix /your/project/path cleanup
```

If you see `✅ Cleanup complete` in the output, the crontab will work at 5pm.

**To check logs after it runs:**

```bash
cat data/cron.log
```

**Common errors and fixes:**

| Error in cron.log | Cause | Fix |
|---|---|---|
| `env: node: No such file or directory` | nvm node path not in crontab PATH | Add `PATH=...nvm.../bin:...` as first line |
| `pnpm: command not found` | Homebrew not in crontab PATH | Use full path `/opt/homebrew/bin/pnpm` |
| `ENOENT .env` | Wrong working directory | Use `--prefix /full/path/to/project` |

**To remove the crontab entry later:**

```bash
crontab -e   # delete the two lines and save
```

> **Note:** crontab requires your Mac to be awake at 5pm. If your Mac is asleep, the job is skipped until the next day. For guaranteed daily runs, use GitHub Actions instead (see below).

---

### 7. Automate — run daily at 5pm via GitHub Actions (recommended, free, no Mac needed)

GitHub Actions runs the cleanup job in the cloud at 5pm Sydney time every day — even if your Mac is off.

**Prerequisites:**
- Push this repo to GitHub
- Create a free [Neon](https://neon.tech) account and create two databases: `work_coordinator` and `mock_company` (or your real company DB)
- Initialize both databases (see Step 4 above)

**Step 1 — Add GitHub repository secrets:**

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com |
| `NEON_WORK_COORDINATOR_DB_URL` | Neon connection string for `work_coordinator` (remove `&channel_binding=require`) |
| `NEON_MOCK_COMPANY_DB_URL` | Neon connection string for your company DB (remove `&channel_binding=require`) |
| `COMPANY_CLEANUP_TABLE` | table name to clean (e.g. `mockTestUsers`) |
| `COMPANY_CLEANUP_THRESHOLD_DAYS` | days before a record is considered stale (e.g. `30`) |

Like this (👨‍🍳) -> For Production Only:
![alt text](/src/assets/images/github-actions-secrets.png)

> **Important:** When copying connection strings from Neon, remove `&channel_binding=require` from the end.
> The `pg` library does not support this parameter and will fail with `password authentication failed`.

**Step 2 — Trigger manually to test:**

Go to your repo → **Actions** tab → **Daily Stale Data Cleanup** → **Run workflow** → click the green button.

Watch the logs — it should delete stale records and write to your `cleanup_log` table.

**Step 3 — It runs automatically from now on:**

The workflow file `.github/workflows/cleanup.yml` is already configured with:
```yaml
- cron: '0 7 * * *'   # 7:00 AM UTC = 5:00 PM AEST (Sydney)
```

No further setup needed. Push your code and it runs every day.

> `pnpm cleanup` (what GitHub Actions runs) handles **stale data deletion only** — no human input needed.
> Run `pnpm start` manually at your laptop for the full GitHub KPI + diary report.

---

## Available commands

| Command | Interactive? | What it does |
|---|---|---|
| `pnpm setup` | No | One-time DB table creation |
| `pnpm cleanup` | No | Runs stale data deletion only — used by crontab |
| `pnpm start` | Yes | Runs GitHub fetch + manual KPI input + diary report |
| `pnpm dev` | No | Starts long-running daemon (fires at 5pm via node-cron) |
| `pnpm format` | No | Auto-format all TypeScript files with Prettier |
| `pnpm format:check` | No | Check formatting without modifying files |
| `pnpm tsc` | No | TypeScript type check |

---

## Project structure

```
work-coordinator/
├── src/
│   ├── agent/
│   │   ├── index.ts            # Orchestrates all 4 agents
│   │   ├── cleanup.agent.ts    # Stale data cleanup agent
│   │   ├── github.agent.ts     # GitHub activity agent
│   │   ├── manual-kpi.agent.ts # Manual input agent
│   │   └── diary.agent.ts      # KPI report writer agent
│   ├── tools/
│   │   ├── github.tool.ts      # Octokit GitHub API tool
│   │   ├── cleanup.tool.ts     # Company DB cleanup tool
│   │   ├── manual-kpi.tool.ts  # Readline prompt tool
│   │   └── diary.tool.ts       # Save report to DB + markdown
│   ├── jobs/
│   │   └── scheduler.ts        # node-cron 5pm Sydney schedule
│   ├── storage/
│   │   └── own-db.ts               # PostgreSQL queries (own DB)
│   │   └── company-db.ts               # PostgreSQL queries (company DB)
│   ├── schemas/
│   │   └── index.ts            # Zod schemas for all data structures   
│   ├── utils/
│   │   └── logger.ts            # Logger for the app
│   ├── constants/
│   │   └── index.ts            # Constants for the app
│   └── index.ts                # Entry point
├── data/                       # Show in your local environment
│   ├── todos.md                # Job definitions (human-readable) 
│   └── diary/                  # Generated daily markdown reports
├── .env.example
└── README.md
```

---

## Database tables

### `kpi` — daily GitHub activity records
| Column | Type | Description |
|---|---|---|
| id | SERIAL | Primary key |
| github_summary | TEXT | AI-written summary of GitHub activity |
| commits_count | INTEGER | Number of commits today |
| prs_count | INTEGER | Number of PRs today |
| activities | TEXT[] | Manual activities you entered |
| created_at | TIMESTAMPTZ | When the record was created |
| updated_at | TIMESTAMPTZ | When the record was last updated |

### `diary` — daily KPI reports
| Column | Type | Description |
|---|---|---|
| id | SERIAL | Primary key |
| content | TEXT | Full AI-generated KPI report |
| created_at | TIMESTAMPTZ | When the report was created |
| updated_at | TIMESTAMPTZ | When the report was last updated |

### `cleanup_log` — company DB cleanup history
| Column | Type | Description |
|---|---|---|
| id | SERIAL | Primary key |
| company_table | TEXT | Which table was cleaned |
| deleted_count | INTEGER | How many records were deleted |
| failed_count | INTEGER | How many deletions failed |
| status | TEXT | success / partial / failed |
| errors | TEXT[] | Error messages if any |
| created_at | TIMESTAMPTZ | When the cleanup ran |
| updated_at | TIMESTAMPTZ | — |

---

## Changing companies

When you change jobs, update three lines in `.env`:

```env
COMPANY_DB_URL=postgresql://...new company connection...
```

No code changes needed.

## Mock test user data for testing (Local environment) - TESTING ONLY Purpose ⚠️⚠️⚠️

Attempt to insert some data for your local postgresql db `mock_company`, to test the project if you like this feature.

```sql
psql -h 127.0.0.1 -U damonwu -d mock_company -c "
  INSERT INTO \"mockTestUsers\" (username, email, phone, address, gender, created_at, updated_at) VALUES
    ('fresh_user_1', 'fresh1@test.com', '0411111111', '1 George St, Sydney', 'male',   NOW() - INTERVAL '1 day',  NOW() - INTERVAL '1 day'),
    ('fresh_user_2', 'fresh2@test.com', '0422222222', '2 Pitt St, Sydney',   'female', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
    ('fresh_user_3', 'fresh3@test.com', NULL,         '3 Kent St, Sydney',   'male',   NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),
    ('fresh_user_4', 'fresh4@test.com', '0444444444', '4 Park St, Sydney',   'female', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
    ('fresh_user_5', 'fresh5@test.com', '0455555555', '5 York St, Sydney',   'male',   NOW() - INTERVAL '10 days',NOW() - INTERVAL '10 days'),
    ('fresh_user_6', 'fresh6@test.com', NULL,         '6 King St, Sydney',   'female', NOW() - INTERVAL '14 days',NOW() - INTERVAL '14 days'),
    ('fresh_user_7', 'fresh7@test.com', '0477777777', '7 Queen St, Sydney',  'male',   NOW() - INTERVAL '20 days',NOW() - INTERVAL '20 days'),
    ('fresh_user_8', 'fresh8@test.com', '0488888888', '8 Market St, Sydney', 'female', NOW() - INTERVAL '25 days',NOW() - INTERVAL '25 days'),
    ('fresh_user_9', 'fresh9@test.com', NULL,         '9 Bridge St, Sydney', 'male',   NOW() - INTERVAL '28 days',NOW() - INTERVAL '28 days'),
    ('fresh_user_10','fresh10@test.com','0410101010', '10 Macquarie St, Sydney','female',NOW() - INTERVAL '29 days',NOW() - INTERVAL '29 days'),
    ('expired_user_1', 'expired1@test.com', '0411000001', '1 Old Rd, Melbourne',  'male',   NOW() - INTERVAL '31 days', NOW() - INTERVAL '31 days'),
    ('expired_user_2', 'expired2@test.com', NULL,         '2 Old Rd, Melbourne',  'female', NOW() - INTERVAL '35 days', NOW() - INTERVAL '35 days'),
    ('expired_user_3', 'expired3@test.com', '0433000003', '3 Old Rd, Melbourne',  'male',   NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
    ('expired_user_4', 'expired4@test.com', '0444000004', '4 Old Rd, Melbourne',  'female', NOW() - INTERVAL '45 days', NOW() - INTERVAL '45 days'),
    ('expired_user_5', 'expired5@test.com', NULL,         '5 Old Rd, Melbourne',  'male',   NOW() - INTERVAL '50 days', NOW() - INTERVAL '50 days'),
    ('expired_user_6', 'expired6@test.com', '0466000006', '6 Old Rd, Melbourne',  'female', NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days'),
    ('expired_user_7', 'expired7@test.com', '0477000007', '7 Old Rd, Melbourne',  'male',   NOW() - INTERVAL '75 days', NOW() - INTERVAL '75 days'),
    ('expired_user_8', 'expired8@test.com', NULL,         '8 Old Rd, Melbourne',  'female', NOW() - INTERVAL '90 days', NOW() - INTERVAL '90 days'),
    ('expired_user_9', 'expired9@test.com', '0499000009', '9 Old Rd, Melbourne',  'male',   NOW() - INTERVAL '120 days',NOW() - INTERVAL '120 days'),
    ('expired_user_10','expired10@test.com','0410000010','10 Old Rd, Melbourne',  'female', NOW() - INTERVAL '180 days',NOW() - INTERVAL '180 days');

  SELECT
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS fresh_count,
    COUNT(*) FILTER (WHERE created_at <  NOW() - INTERVAL '30 days') AS expired_count,
    COUNT(*) AS total
  FROM \"mockTestUsers\";
"
```