import { logger } from '../utils/logger.js'

/**
 * Posts an HTML message to the configured Telegram chat.
 *
 * Both digests reached Telegram through the same twenty lines — read two env
 * vars, validate them, POST, check the status, log. This is that, once.
 * Message building stays in the tools; only delivery lives here.
 *
 * Throws on missing credentials and on any non-2xx, so callers can report the
 * failure through notifyError rather than guessing.
 */
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
