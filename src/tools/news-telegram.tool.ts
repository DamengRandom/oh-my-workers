import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const newsTelegramTool = new DynamicStructuredTool({
  name: 'send_news_telegram',
  description: 'Sends the curated daily AI news digest via Telegram.',
  schema: z.object({
    articles: z
      .array(
        z.object({
          title: z.string(),
          url: z.string(),
          summary: z.string(),
        })
      )
      .describe('The curated AI news articles to send'),
  }),
  func: async ({ articles }) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
    const chatId = process.env.TELEGRAM_CHAT_ID ?? ''
    const today = new Date().toISOString().split('T')[0]

    if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables')
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID is not set in environment variables')

    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣']

    const articleLines = articles.map((a, i) => {
      const num = numberEmojis[i] ?? `${i + 1}.`
      return [
        `${num} <b>${escapeHtml(a.title)}</b>`,
        `<i>${escapeHtml(a.summary)}</i>`,
        `🔗 <a href="${a.url}">Read more</a>`,
      ].join('\n')
    })

    const message = [
      `☀️ <b>Good Morning! Daily AI Dev Digest</b>`,
      `📅 ${escapeHtml(today)}  ·  TS / JS / Node.js`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '',
      articleLines.join('\n\n'),
      '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      `📊 ${articles.length} stories  ·  Powered by Tavily`,
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

    console.log(`✅ AI News Telegram message sent to chat ${chatId}`)

    return JSON.stringify({ success: true, chat_id: chatId, date: today })
  },
})
