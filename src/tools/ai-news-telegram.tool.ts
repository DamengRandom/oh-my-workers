import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { escapeHtml, truncate } from '../agent/utils.js'
import { sendTelegramMessage } from './telegram.js'
import { AI_NEWS_SNIPPET_MAX, AI_NEWS_TITLE_MAX } from '../constants/index.js'
import type { AiNewsItem } from '../schemas/index.js'

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣']

function storyEntry(item: AiNewsItem, index: number): string {
  const num = NUMBER_EMOJIS[index] ?? `${index + 1}.`
  const snippet = truncate(item.snippet, AI_NEWS_SNIPPET_MAX)
  const title = truncate(item.title, AI_NEWS_TITLE_MAX)
  const published = item.published_date?.split('T')[0] ?? 'recent'

  const lines = [`${num} <b>${escapeHtml(title)}</b>`, `📰 ${escapeHtml(item.source)} · ${escapeHtml(published)}`]

  if (snippet) lines.push(`<i>${escapeHtml(snippet)}</i>`)

  lines.push(`🔗 <a href="${escapeHtml(item.url)}">Read more</a>`)

  return lines.join('\n')
}

export function buildAiNewsMessage(items: AiNewsItem[], today: string): string {
  const storyLines = items.map(storyEntry)

  return [
    `🧠 <b>AI News — Daily Digest</b>`,
    `📅 ${escapeHtml(today)}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
    storyLines.join('\n\n'),
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `📊 ${items.length} ${items.length === 1 ? 'story' : 'stories'}  ·  Powered by Tavily`,
  ].join('\n')
}

export const aiNewsTelegramTool = new DynamicStructuredTool({
  name: 'send_ai_news_telegram',
  description: 'Sends the daily AI news digest via Telegram.',
  schema: z.object({
    items: z
      .array(
        z.object({
          title: z.string(),
          url: z.string(),
          source: z.string(),
          snippet: z.string(),
          published_date: z.string().nullable(),
        })
      )
      .describe('The AI news stories to send'),
  }),
  func: async ({ items }) => {
    const today = new Date().toISOString().split('T')[0]
    const chatId = await sendTelegramMessage(buildAiNewsMessage(items, today), 'AI news')

    return JSON.stringify({ success: true, chat_id: chatId, date: today })
  },
})
