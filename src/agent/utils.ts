import { logger } from '../utils/logger.js'
import { AgentResult } from '../schemas/index.ts'

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Ellipsis included in the budget, so the result is never longer than max.
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function toolOutput(result: AgentResult, toolName: string): string {
  const msg = result.messages.find((m) => m._getType?.() === 'tool' && (m as { name?: string }).name === toolName)
  if (!msg) return ''

  const content = msg.content

  // LangChain sometimes returns content as an array of content blocks
  if (Array.isArray(content)) {
    const block = content.find((c: unknown) => typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text')
    return block ? (block as { text: string }).text : JSON.stringify(content)
  }

  return `${content ?? ''}`
}

export function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function notifyError(context: string, error: unknown): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) return

  const message = [
    `⚠️ <b>Oh My Workers — Job Failed</b>`,
    ``,
    `<b>Where:</b> ${context}`,
    `<b>Error:</b> ${error instanceof Error ? error.message : String(error)}`,
  ].join('\n')

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to notify error to Telegram')
  }
}
