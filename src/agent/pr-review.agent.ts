import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { getPrDiffTool, readFileTool, searchCodeTool } from '../tools/pr-review.tool.js'
import { PR_REVIEW_PROMPT } from './prompt.js'
import { REVIEW_LLM, MAX_REVIEW_TOOL_CALLS } from '../constants/index.js'
import { ReviewResultSchema, type ReviewResult } from '../schemas/index.js'
import { parsePrUrl } from '../utils/pr-url.js'

const llm = new ChatAnthropic({ model: REVIEW_LLM, temperature: 0 })

// Unlike the single-call fetch agents, the reviewer loops: read the diff, pull in
// context with read_file/search_code, then judge. The tool-call limit caps that loop.
export const prReviewAgent = createAgent({
  model: llm,
  tools: [getPrDiffTool, readFileTool, searchCodeTool],
  systemPrompt: PR_REVIEW_PROMPT,
  responseFormat: ReviewResultSchema,
  middleware: [toolCallLimitMiddleware({ runLimit: MAX_REVIEW_TOOL_CALLS, exitBehavior: 'end' })],
})

// Orchestrator shared by the Task 1 dev script and the future Task 2 CLI.
export async function reviewPullRequest(prUrl: string): Promise<ReviewResult> {
  const { owner, repo, number } = parsePrUrl(prUrl)

  console.log(`🔍 Reviewing ${owner}/${repo} PR #${number} ...\n`)

  const result = await prReviewAgent.invoke({
    messages: [
      {
        role: 'user',
        content: `Review this pull request. owner="${owner}", repo="${repo}", prNumber=${number}. Start by calling get_pr_diff, then investigate the surrounding code before reporting any issues.`,
      },
    ],
  })

  return result.structuredResponse
}
