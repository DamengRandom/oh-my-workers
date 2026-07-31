import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { logger } from '../utils/logger.js'
import { escapeHtml } from '../agent/utils.js'
import { AI_NEWS_SNIPPET_MAX } from '../constants/index.js'

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
    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
    const chatId = process.env.TELEGRAM_CHAT_ID ?? ''
    const today = new Date().toISOString().split('T')[0]

    if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables')
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID is not set in environment variables')

    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣']

    const storyLines = items.map((item, i) => {
      const num = numberEmojis[i] ?? `${i + 1}.`
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

    const message = [
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

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Telegram API error ${response.status}: ${body}`)
    }

    logger.info(`✅ AI news Telegram message sent to chat ${chatId}`)

    return JSON.stringify({ success: true, chat_id: chatId, date: today })
  },
})
