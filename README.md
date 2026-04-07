# Oh My Workers

A personal AI agent suite for software engineers. Runs daily jobs automatically via GitHub Actions:

- **5pm Sydney** — fetches GitHub activity, asks what else you did, generates a KPI diary report
- **8am Sydney** — generates a TypeScript quiz, verifies it with a second AI reviewer, sends via email + Telegram

Built with TypeScript, LangChain, and Claude.

<video src="https://1qa33vobhw.ucarecd.net/f61ac3b2-3d3f-4b21-86b2-7cf8c3beb2a5/" width="600" height="360" controls></video>

---

## How it works

**KPI pipeline (5pm):**
```
Phase 1 (parallel):  cleanupAgent + githubAgent
Phase 2 (sequential): manualKpiAgent ← waits for your input
Phase 3 (sequential): diaryAgent ← writes report from Phase 1+2 data
```

**Quiz pipeline (8am):**
```
quizGeneratorAgent → quizVerifierAgent (approve if confidence ≥ 8/10, up to 3 attempts)
    ↓ approved
quizEmailAgent + quizTelegramAgent (parallel) → saved to quiz_log
```

The generator uses `temperature: 1` for variety; the verifier uses `temperature: 0` for strict accuracy. Two separate Claude calls, two different prompts — catches hallucinations before delivery.

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

# Quiz — email
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=            # Google Account → Security → 2FA → App Passwords
QUIZ_EMAIL_RECIPIENT=your@gmail.com

# Quiz — Telegram
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
pnpm quiz    # runs quiz pipeline now
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
| `GMAIL_USER` | your Gmail address |
| `GMAIL_APP_PASSWORD` | 16-char App Password from Google Account |
| `QUIZ_EMAIL_RECIPIENT` | email to receive the quiz |
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
| `pnpm cleanup` | Stale data deletion only (used by crontab) |
| `pnpm start` | GitHub fetch + manual KPI input + diary report |
| `pnpm quiz` | Generate, verify, and send today's TypeScript quiz |
| `pnpm dev` | Long-running daemon (fires at 5pm via node-cron) |
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
│   ├── quiz-generator.agent.ts
│   ├── quiz-verifier.agent.ts
│   ├── quiz-email.agent.ts
│   └── quiz-telegram.agent.ts
├── tools/                      # DynamicStructuredTool implementations
├── jobs/scheduler.ts           # node-cron schedules
├── storage/                    # PostgreSQL queries (own-db + company-db)
├── schemas/index.ts            # Zod schemas
└── index.ts                    # Entry point + CLI flags
.github/workflows/
├── cleanup.yml                 # Daily 5pm cleanup
├── daily-kpi.yml               # Manual KPI trigger (workflow_dispatch)
├── seed-mock-users.yml         # Daily 4:30pm mock data seeding
└── morning-quiz.yml            # Daily 8am TypeScript quiz
```

---

## Database tables

| Table | Description |
|---|---|
| `kpi` | Daily GitHub activity records (commits, PRs, manual activities) |
| `diary` | AI-generated daily KPI reports |
| `cleanup_log` | Company DB cleanup history (deleted count, errors) |
| `quiz_log` | Quiz history (question, answer, approved, sent flags) |

---

## Changing companies

Update `COMPANY_DB_URL` in `.env`. No code changes needed.
