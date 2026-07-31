import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { escapeHtml } from '../agent/utils.js'
import { sendTelegramMessage } from './telegram.js'

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

    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣']

    const repoLines = repos.map((r, i) => {
      const num = numberEmojis[i] ?? `${i + 1}.`
      // ponytail: the prompt asks for <140 chars, this is what actually guarantees it.
      // Telegram hard-fails the whole message past 4096, so the bound lives in code.
      const summary = r.summary.length > 140 ? `${r.summary.slice(0, 137)}...` : r.summary
      return [
        `${num} <b>${escapeHtml(r.repo_name)}</b>`,
        `⭐ ${r.stars.toLocaleString()} (+${r.today_stars} today) · ${escapeHtml(r.language)}`,
        `<i>${escapeHtml(summary)}</i>`,
        `🏷 ${r.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}`,
        `🔗 <a href="${escapeHtml(r.url)}">View on GitHub</a>`,
      ].join('\n')
    })

    const message = [
      `🔥 <b>GitHub Trending — Daily Digest</b>`,
      `📅 ${escapeHtml(today)}  ·  TypeScript / JavaScript`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '',
      repoLines.join('\n\n'),
      '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      `📊 ${repos.length} repos  ·  Powered by GitHub Trending`,
    ].join('\n')

    const chatId = await sendTelegramMessage(message, 'Trending repos')

    return JSON.stringify({ success: true, chat_id: chatId, date: today })
  },
})
