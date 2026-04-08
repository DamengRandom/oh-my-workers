import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
    const chatId = process.env.TELEGRAM_CHAT_ID ?? ''
    const today = new Date().toISOString().split('T')[0]

    if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables')
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID is not set in environment variables')

    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣']

    const repoLines = repos.map((r, i) => {
      const num = numberEmojis[i] ?? `${i + 1}.`
      return [
        `${num} <b>${escapeHtml(r.repo_name)}</b>`,
        `⭐ ${r.stars.toLocaleString()} (+${r.today_stars} today) · ${escapeHtml(r.language)}`,
        `<i>${escapeHtml(r.summary)}</i>`,
        `🏷 ${r.tags.map((t) => `#${t}`).join(' ')}`,
        `🔗 <a href="${r.url}">View on GitHub</a>`,
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

    console.log(`✅ Trending repos Telegram message sent to chat ${chatId}`)

    return JSON.stringify({ success: true, chat_id: chatId, date: today })
  },
})
