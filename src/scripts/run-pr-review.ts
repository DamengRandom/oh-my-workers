import 'dotenv/config'
import { reviewPullRequest } from '../agent/pr-review.agent.js'
import { formatReview } from '../utils/review-formatter.js'

// Task 1: hardcode the PR URL here. CLI arg parsing comes in Task 2.
// Use a real PR you can access; make sure REPO_PATH points at a local clone with the PR's branch checked out.
const PR_URL = 'https://github.com/your-company/the-repo/pull/123'

async function main(): Promise<void> {
  const result = await reviewPullRequest(PR_URL)
  console.log('\n' + formatReview(result) + '\n')
}

main().catch((err) => {
  console.error('Fatal error during PR review:', err instanceof Error ? err.message : err)
  process.exit(1)
})
