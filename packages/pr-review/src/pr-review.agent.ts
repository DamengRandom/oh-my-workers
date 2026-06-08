import { createAgent, toolCallLimitMiddleware } from 'langchain'
import { ChatAnthropic } from '@langchain/anthropic'
import { AIMessage, SystemMessage } from '@langchain/core/messages'
import { getPrDiffTool, readFileTool, searchCodeTool } from './pr-review.tool.js'
import { PR_REVIEW_PROMPT } from './prompt.js'
import { REVIEW_LLM, MAX_REVIEW_TOOL_CALLS } from './constants.js'
import { ReviewResultSchema, type ReviewResult } from './schemas.js'
import { parsePrUrl } from './pr-url.js'

// `cache_control` is a per-call option that makes ChatAnthropic place a prompt-cache breakpoint
// on the last block of every request. In an agent loop that re-sends the full message history
// each turn, this caches the growing conversation prefix incrementally — later turns read the
// prior diff and file contents at ~0.1x input price instead of reprocessing them at full rate.
// We attach it via withConfig (the @langchain/core 1.x replacement for bind); createAgent still
// binds the tools onto the underlying model and merges this option through (see langchain's
// _simpleBindTools, which preserves the RunnableBinding's kwargs/config when binding tools).
const llm = new ChatAnthropic({ model: REVIEW_LLM, temperature: 0 }).withConfig({ cache_control: { type: 'ephemeral' } })

// The reviewer loops: read the diff, pull in context with read_file/search_code, then judge.
// The tool-call limit caps that loop.
//
// NOTE: we deliberately do NOT use createAgent's `responseFormat` here. In this langchain
// build, combining structured-output machinery with an afterModel middleware produces
// concurrent writes to the internal `jumpTo` channel (INVALID_CONCURRENT_GRAPH_UPDATE).
// Instead the agent returns a plain-text review, and we convert it to the typed
// ReviewResult in a separate withStructuredOutput call below.
//
// The systemPrompt is passed as a SystemMessage with a cache_control breakpoint so the
// (stable) system prompt + tool definitions are cached once and reused on every turn.
export const prReviewAgent = createAgent({
  model: llm,
  tools: [getPrDiffTool, readFileTool, searchCodeTool],
  systemPrompt: new SystemMessage({
    content: [{ type: 'text', text: PR_REVIEW_PROMPT, cache_control: { type: 'ephemeral' } }],
  }),
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

  // LangGraph's default recursionLimit (25 super-steps ≈ 12 tool round-trips) is lower than
  // our tool-call budget, so without this the graph throws GRAPH_RECURSION_LIMIT before the
  // toolCallLimitMiddleware can gracefully end the run. 2 * N + 1 leaves room for N tool calls.
  const result = await prReviewAgent.invoke(
    {
      messages: [
        {
          role: 'user',
          content: `Review this pull request. owner="${owner}", repo="${repo}", prNumber=${number}. Start by calling get_pr_diff, then investigate the surrounding code before reporting any issues.`,
        },
      ],
    },
    { recursionLimit: 2 * MAX_REVIEW_TOOL_CALLS + 1 }
  )

  const reviewText = finalMessageText(result.messages)

  console.log('\n🧩 Structuring findings...\n')

  return structuredLlm.invoke(
    `Convert the following code-review notes into the structured schema. Preserve every finding exactly; do not invent new ones.\n\n${reviewText}`
  )
}
