import { cleanupAgent } from './cleanup.agent.js'
import { githubAgent } from './github.agent.js'
import { manualKpiAgent } from './manual-kpi.agent.js'
import { diaryAgent } from './diary.agent.js'
import { quizGeneratorAgent } from './quiz-generator.agent.js'
import { quizVerifierAgent } from './quiz-verifier.agent.js'
import { quizEmailAgent } from './quiz-email.agent.js'
import { quizTelegramAgent } from './quiz-telegram.agent.js'
import { saveKpiRecord, saveQuizLog } from '../storage/own-db.js'
import { sectionLogger } from '../utils/logger.js'

type AgentResult = { messages: Array<{ _getType?: () => string; content: unknown }> }

export class WorkCoordinator {
  // ── Shared helper ────────────────────────────────────────────────────────────
  private static toolOutput(result: AgentResult, toolName: string): string {
    const msg = result.messages.find((m) => m._getType?.() === 'tool' && (m as { name?: string }).name === toolName)
    if (!msg) return ''

    const content = msg.content

    // LangChain sometimes returns content as an array of content blocks
    if (Array.isArray(content)) {
      const block = content.find((c: unknown) => typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text')
      return block ? (block as { text: string }).text : JSON.stringify(content)
    }

    return `${content ?? ''}`
  }

  // ── Automated (crontab) — no human input required ─────────────────────────
  static async runCleanup(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]

    sectionLogger(`🧹 Oh My Workers — Cleanup — ${today}`)

    await cleanupAgent.invoke({
      messages: [{ role: 'user', content: 'Run the stale data cleanup now.' }],
    })

    sectionLogger(`✅ Cleanup complete for ${today}`)
  }

  // ── Interactive (manual) — requires human at keyboard ──────────────────────
  static async runDailyJobs(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const username = process.env.TARGET_GITHUB_USERNAME
    const now = new Date().toISOString()

    sectionLogger(`🤖 Oh my workers — ${today}`)

    // ── Phase 1: Cleanup + GitHub run in parallel ────────────────────────────
    console.log('⚡️ Phase 1: Running cleanup and GitHub fetch in parallel...\n')

    if (!username) {
      console.error('❌ GitHub username not set in environment variables.')
      return
    }

    const [, githubResult] = await Promise.all([
      cleanupAgent.invoke({
        messages: [{ role: 'user', content: 'Run the stale data cleanup now.' }],
      }),
      githubAgent.invoke({
        messages: [{ role: 'user', content: `Fetch GitHub activity for username "${username}" on date "${today}".` }],
      }),
    ])

    // ── Phase 2: Manual input (interactive, sequential) ──────────────────────
    console.log('\n⚡️ Phase 2: Collecting manual activities...')

    const manualResult = await manualKpiAgent.invoke({
      messages: [{ role: 'user', content: 'Ask the engineer what else they did today.' }],
    })

    let activities: string[] = []
    try {
      const parsed = JSON.parse(WorkCoordinator.toolOutput(manualResult, 'collect_manual_kpi_input'))
      activities = parsed.activities ?? []
    } catch {
      activities = []
    }

    // ── Phase 3: Conditional — diary only if manual input was provided ────────
    if (activities.length === 0) {
      console.log('\n⏭️ No manual activities provided — skipping diary, saving GitHub KPI only.\n')

      let githubData: { summary?: string; commits?: unknown[]; pullRequests?: unknown[] } = {}
      try {
        githubData = JSON.parse(WorkCoordinator.toolOutput(githubResult, 'fetch_github_activity'))
      } catch {
        githubData = {}
      }

      await saveKpiRecord({
        github_summary: githubData.summary ?? '',
        commits_count: (githubData.commits as unknown[])?.length ?? 0,
        prs_count: (githubData.pullRequests as unknown[])?.length ?? 0,
        activities: [],
        created_at: now,
        updated_at: now,
      })

      console.log('✅ GitHub KPI record saved.')
    } else {
      console.log(`\n⚡️ Phase 3: Generating daily KPI report (${activities.length} manual activities recorded)...\n`)

      await diaryAgent.invoke({
        messages: [
          {
            role: 'user',
            content: `Write and save today's KPI report using the data below.\n\nGitHub activity:\n${WorkCoordinator.toolOutput(githubResult, 'fetch_github_activity')}\n\nManual activities:\n${WorkCoordinator.toolOutput(manualResult, 'collect_manual_kpi_input')}`,
          },
        ],
      })
    }

    sectionLogger(`✅ All jobs complete for ${today}`)
  }

  // ── Daily TypeScript Quiz — generate, verify, email ────────────────────────
  static async runQuizAgent(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const now = new Date().toISOString()
    const difficulties = ['beginner', 'intermediate', 'advanced'] as const
    const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)]

    sectionLogger(`📘 Oh My Workers — TypeScript Quiz — ${today}`)

    let quiz: { question: string; answer: string; explanation: string; difficulty: string; topic: string } | null = null
    let approved = false
    let feedback = ''
    let sent = false

    // ── Step 1: Generate ────────────────────────────────────────────────────
    console.log(`⚡️ Generating ${difficulty} TypeScript quiz...\n`)

    const genResult = await quizGeneratorAgent.invoke({
      messages: [{ role: 'user', content: `Generate a ${difficulty} TypeScript quiz question now.` }],
    })

    try {
      quiz = JSON.parse(WorkCoordinator.toolOutput(genResult, 'generate_typescript_quiz'))
    } catch {
      console.error('❌ Failed to parse generated quiz — aborting.')
      return
    }

    // ── Step 2: Verify (up to 3 attempts) ──────────────────────────────────
    console.log('⚡️ Verifying quiz accuracy...\n')

    let parseErrorCount = 0
    const MAX_PARSE_ERRORS = 3

    for (let attempt = 1; attempt <= 3; attempt++) {
      const verifyResult = await quizVerifierAgent.invoke({
        messages: [
          {
            role: 'user',
            content: `Review this TypeScript quiz for accuracy:\n\nQuestion: ${quiz?.question ?? ''}\n\nAnswer: ${quiz?.answer ?? ''}\n\nExplanation: ${quiz?.explanation ?? ''}`,
          },
        ],
      })

      let verdict: { approved: boolean; feedback: string; confidence_score: number } | null = null

      try {
        const raw = WorkCoordinator.toolOutput(verifyResult, 'verify_typescript_quiz')
        verdict = JSON.parse(raw)
      } catch (err) {
        parseErrorCount++
        
        console.error(`❌ Failed to parse verifier result on attempt ${attempt} (parse error ${parseErrorCount}/${MAX_PARSE_ERRORS}):`, err instanceof Error ? err.message : err)
        
        if (parseErrorCount >= MAX_PARSE_ERRORS) {
          console.error('❌ Too many parse errors — aborting verification.')
          break
        }
        
        attempt-- // retry verification without consuming an attempt
        
        continue
      }

      feedback = verdict?.feedback ?? ''
      approved = verdict?.approved ?? false

      if (approved) break

      console.log(`⚠️ Attempt ${attempt} rejected — regenerating...\n`)

      if (attempt < 3) {
        const regenResult = await quizGeneratorAgent.invoke({
          messages: [
            {
              role: 'user',
              content: `Generate a new ${difficulty} TypeScript quiz. Previous attempt was rejected with feedback: ${verdict?.feedback ?? ''}`,
            },
          ],
        })

        try {
          quiz = JSON.parse(WorkCoordinator.toolOutput(regenResult, 'generate_typescript_quiz'))
        } catch {
          console.error(`❌ Failed to parse regenerated quiz on attempt ${attempt}`)
        }
      }
    }

    // ── Step 3: Send via email + Telegram in parallel if approved ──────────
    if (approved && quiz) {
      console.log('\n⚡️ Sending quiz via email and Telegram...\n')

      const quizContent = `Question: ${quiz.question}\n\nAnswer: ${quiz.answer}\n\nExplanation: ${quiz.explanation}\n\nDifficulty: ${quiz.difficulty}\n\nTopic: ${quiz.topic}\n\nVerifier feedback: ${feedback}`

      await Promise.all([
        quizEmailAgent.invoke({
          messages: [{ role: 'user', content: `Send this TypeScript quiz via email now.\n\n${quizContent}` }],
        }),
        quizTelegramAgent.invoke({
          messages: [{ role: 'user', content: `Send this TypeScript quiz via Telegram now.\n\n${quizContent}` }],
        }),
      ])

      sent = true
    } else {
      console.log('\n⏭️ Quiz rejected after 3 attempts — skipping email and Telegram.\n')
    }

    // ── Step 4: Save to DB ──────────────────────────────────────────────────
    if (quiz) {
      await saveQuizLog({
        question: quiz.question,
        answer: quiz.answer,
        explanation: quiz.explanation,
        difficulty: quiz.difficulty as 'beginner' | 'intermediate' | 'advanced',
        topic: quiz.topic,
        approved,
        feedback,
        sent,
        created_at: now,
        updated_at: now,
      })
    }

    sectionLogger(`✅ Quiz job complete for ${today}`)
  }
}

// ── Named exports for backwards compatibility with index.ts and scheduler.ts ───
export const { runCleanup, runDailyJobs, runQuizAgent } = WorkCoordinator
