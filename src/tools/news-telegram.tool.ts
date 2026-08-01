import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { logger } from '../utils/logger.js'
import { escapeHtml, truncate } from '../agent/utils.js'
import { sendTelegramMessage } from './telegram.js'
import { TELEGRAM_MAX_CHARS, TRENDING_SUMMARY_MAX, TRENDING_TAG_MAX, TRENDING_TAGS_MAX } from '../constants/index.js'
import type { CuratedRepo } from '../schemas/index.js'

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣']

function repoEntry(repo: CuratedRepo, index: number): string {
  const num = NUMBER_EMOJIS[index] ?? `${index + 1}.`
  const summary = truncate(repo.summary, TRENDING_SUMMARY_MAX)
  const tags = repo.tags
    .slice(0, TRENDING_TAGS_MAX)
    .map((t) => `#${escapeHtml(truncate(t, TRENDING_TAG_MAX))}`)
    .join(' ')

  const lines = [
    `${num} <b>${escapeHtml(repo.repo_name)}</b>`,
    `⭐ ${repo.stars.toLocaleString()} (+${repo.today_stars} today) · ${escapeHtml(repo.language)}`,
    `<i>${escapeHtml(summary)}</i>`,
  ]

  if (tags) lines.push(`🏷 ${tags}`)

  lines.push(`🔗 <a href="${escapeHtml(repo.url)}">View on GitHub</a>`)

  return lines.join('\n')
}

function assemble(repos: CuratedRepo[], today: string): string {
  return [
    `🔥 <b>GitHub Trending — Daily Digest</b>`,
    `📅 ${escapeHtml(today)}  ·  TypeScript / JavaScript`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
    repos.map(repoEntry).join('\n\n'),
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📊 ${repos.length} ${repos.length === 1 ? 'repo' : 'repos'}  ·  Powered by GitHub Trending`,
  ].join('\n')
}

export function fitRepos(repos: CuratedRepo[], today: string): CuratedRepo[] {
  let kept = repos

  while (kept.length > 1 && assemble(kept, today).length > TELEGRAM_MAX_CHARS) kept = kept.slice(0, -1)

  return kept
}

export function buildTrendingMessage(repos: CuratedRepo[], today: string): string {
  return assemble(fitRepos(repos, today), today)
}

export const trendingTelegramTool = new DynamicStructuredTool({
  name: 'send_trending_telegram',
  description: 'Sends the curated daily GitHub trending digest via Telegram.',
  schema: z.object({
    repos: z
      .array(
        z.object({
          repo_name: z.string(),
          url: z.string(),
          description: z.string(),
          language: z.string(),
          stars: z.number(),
          today_stars: z.number(),
          summary: z.string(),
          tags: z.array(z.string()),
        })
      )
      .describe('The curated trending repos to send'),
  }),
  func: async ({ repos }) => {
    const today = new Date().toISOString().split('T')[0]
    const kept = fitRepos(repos, today)

    if (kept.length < repos.length) {
      logger.warn(
        `✂️ Digest too long for Telegram — dropped ${repos.length - kept.length} of ${repos.length} repos: ${repos
          .slice(kept.length)
          .map((r) => r.repo_name)
          .join(', ')}`
      )
    }

    const chatId = await sendTelegramMessage(assemble(kept, today), 'Trending repos')

    return JSON.stringify({ success: true, chat_id: chatId, date: today, delivered: kept.map((r) => r.repo_name) })
  },
})
