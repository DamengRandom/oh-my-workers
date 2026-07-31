import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { escapeHtml } from '../agent/utils.js'
import { sendTelegramMessage } from './telegram.js'
import { AI_NEWS_SNIPPET_MAX } from '../constants/index.js'
import type { AiNewsItem } from '../schemas/index.js'

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣']

// ponytail: no title bound, because at AI_NEWS_TOP_N=4 the worst case is ~2100
// chars against Telegram's 4096. Titles are unbounded though, so ~8 long entries
// would overflow — and Telegram drops the whole message rather than truncating.
// Bound the title if TOP_N grows; the length test in ai-news-telegram.test.ts
// fails first if it does.

// Exported for testing: all the formatting decisions live here, so the tool's
// own func stays a plain HTTP call.
export function buildAiNewsMessage(items: AiNewsItem[], today: string): string {
  const storyLines = items.map((item, i) => {
    const num = NUMBER_EMOJIS[i] ?? `${i + 1}.`
    // The search tool already truncates, but Telegram hard-fails the whole
    // message past 4096 chars — so the bound is re-asserted where the message
    // is built, same as the trending digest.
    const snippet = item.snippet.length > AI_NEWS_SNIPPET_MAX ? `${item.snippet.slice(0, AI_NEWS_SNIPPET_MAX - 1)}…` : item.snippet
    const published = item.published_date?.split('T')[0] ?? 'recent'

    const lines = [`${num} <b>${escapeHtml(item.title)}</b>`, `📰 ${escapeHtml(item.source)} · ${escapeHtml(published)}`]

    // Tavily occasionally returns an empty excerpt — skip the line rather than
    // leaving a blank one in the digest.
    if (snippet) lines.push(`<i>${escapeHtml(snippet)}</i>`)

    lines.push(`🔗 <a href="${escapeHtml(item.url)}">Read more</a>`)

    return lines.join('\n')
  })

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
