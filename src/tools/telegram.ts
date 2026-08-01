import { logger } from '../utils/logger.js'

export async function sendTelegramMessage(html: string, label: string): Promise<string> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
  const chatId = process.env.TELEGRAM_CHAT_ID ?? ''

  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables')
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is not set in environment variables')

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Telegram API error ${response.status}: ${body}`)
  }

  logger.info(`✅ ${label} Telegram message sent to chat ${chatId}`)

  return chatId
}
