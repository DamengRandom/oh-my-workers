import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { AIMessage } from '@langchain/core/messages'
import { getPrDiffTool, readFileTool, searchCodeTool } from './pr-review.tool.js'
import { PR_REVIEW_PROMPT } from './prompt.js'
import { REVIEW_LLM, MAX_REVIEW_TOOL_CALLS } from './constants.js'
import { ReviewResultSchema, type ReviewResult } from './schemas.js'
import { parsePrUrl } from './pr-url.js'

const llm = new ChatAnthropic({ model: REVIEW_LLM, temperature: 0 })

// The reviewer loops: read the diff, pull in context with read_file/search_code, then judge.
// The tool-call limit caps that loop.
//
// NOTE: we deliberately do NOT use createAgent's `responseFormat` here. In this langchain
// build, combining structured-output machinery with an afterModel middleware produces
// concurrent writes to the internal `jumpTo` channel (INVALID_CONCURRENT_GRAPH_UPDATE).
// Instead the agent returns a plain-text review, and we convert it to the typed
// ReviewResult in a separate withStructuredOutput call below.
export const prReviewAgent = createAgent({
  model: llm,
  tools: [getPrDiffTool, readFileTool, searchCodeTool],
  systemPrompt: PR_REVIEW_PROMPT,
  middleware: [toolCallLimitMiddleware({ runLimit: MAX_REVIEW_TOOL_CALLS, exitBehavior: 'end' })],
})

// A separate, single-shot model call that turns the agent's free-text review into the
// typed ReviewResult. Runs outside the agent graph, so it avoids the jumpTo conflict.
const structuredLlm = new ChatAnthropic({ model: REVIEW_LLM, temperature: 0 }).withStructuredOutput(ReviewResultSchema)

// Extract the text of the agent's final assistant message (content may be a string or
// an array of content blocks).
function finalMessageText(messages: Array<{ content: unknown }>): string {
  const last = [...messages].reverse().find((m) => AIMessage.isInstance(m))
  const content = last?.content

  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((block) => (typeof block === 'object' && block !== null && 'text' in block ? (block as { text: string }).text : '')).join('')
  }

  return ''
}

// Orchestrator: parse the URL, run the review agent, then structure its findings.
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

  const reviewText = finalMessageText(result.messages)

  console.log('\n🧩 Structuring findings...\n')

  return structuredLlm.invoke(
    `Convert the following code-review notes into the structured schema. Preserve every finding exactly; do not invent new ones.\n\n${reviewText}`
  )
}
