#!/usr/bin/env node
import 'dotenv/config'
import { reviewPullRequest } from './pr-review.agent.js'
import { formatReview } from './review-formatter.js'

// Deterministic guardrail #1: fail fast (with a clear message) if the environment is not
// configured, instead of crashing deep inside a tool call later. This is plain code, not an agent.
function assertEnv(): void {
  const required = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'REPO_PATH']
  const missing = required.filter((name) => !process.env[name])

  if (missing.length > 0) {
    console.error(`❌ Missing required environment variable(s): ${missing.join(', ')}`)
    console.error('   Set them in your environment or a .env file (see .env.example).')
    process.exit(1)
  }
}

async function main(): Promise<void> {
  // process.argv = ['node', '/path/to/cli.js', '<pr-url>', ...]. The first real argument is index 2.
  const prUrl = process.argv[2]

  // Deterministic guardrail #2: no URL provided → print usage and exit.
  if (!prUrl) {
    console.error('Usage: omw-review <github-pr-url>')
    console.error('Example: omw-review https://github.com/acme/widgets/pull/42')
    process.exit(1)
  }

  assertEnv()

  // reviewPullRequest parses/validates the URL (throws on a bad one), runs the agent, and
  // returns the structured findings. The formatter turns them into the coloured terminal report.
  const result = await reviewPullRequest(prUrl)

  console.log('\n' + formatReview(result) + '\n')
}

main().catch((err) => {
  console.error('❌ PR review failed:', err instanceof Error ? err.message : err)

  process.exit(1)
})
