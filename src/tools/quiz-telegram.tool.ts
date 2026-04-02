import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

// Escape HTML special characters for Telegram HTML parse mode
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Convert markdown ```lang ... ``` blocks to Telegram <pre><code> blocks.
// Plain text outside code blocks is HTML-escaped.
function renderHtml(text: string): string {
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g
  const parts: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)))
    }

    const code = escapeHtml(match[2].trim())
    parts.push(`<pre><code>${code}</code></pre>`)

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)))
  }

  return parts.join('')
}

export const quizTelegramTool = new DynamicStructuredTool({
  name: 'send_quiz_telegram',
  description: 'Sends the approved TypeScript quiz question and answer via Telegram.',
  schema: z.object({
    question: z.string().describe('The TypeScript quiz question'),
    answer: z.string().describe('The correct answer'),
    explanation: z.string().describe('Explanation of the answer'),
    difficulty: z.string().describe('Difficulty level: beginner, intermediate, or advanced'),
    topic: z.string().describe('TypeScript topic covered'),
    feedback: z.string().describe('Verifier feedback notes'),
  }),
  func: async ({ question, answer, explanation, difficulty, topic, feedback }) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
    const chatId = process.env.TELEGRAM_CHAT_ID ?? ''
    const today = new Date().toISOString().split('T')[0]
    const difficultyEmoji = difficulty === 'beginner' ? '🟢' : difficulty === 'intermediate' ? '🟡' : '🔴'

    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables')
    }

    if (!chatId) {
      throw new Error('TELEGRAM_CHAT_ID is not set in environment variables')
    }

    const message = [
      `📘 <b>Daily TypeScript Quiz — ${escapeHtml(today)}</b>`,
      `${difficultyEmoji} ${escapeHtml(difficulty.charAt(0).toUpperCase() + difficulty.slice(1))} · 🏷️ ${escapeHtml(topic)}`,
      '',
      `❓ <b>Question</b>`,
      renderHtml(question),
      '',
      `✅ <b>Answer</b>`,
      renderHtml(answer),
      '',
      `💡 <b>Explanation</b>`,
      renderHtml(explanation),
      ...(feedback ? ['', `🔍 <i>Verified by AI reviewer</i>`] : []),
    ].join('\n')

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Telegram API error ${response.status}: ${body}`)
    }

    console.log(`✅ Quiz Telegram message sent to chat ${chatId}`)

    return JSON.stringify({ success: true, chat_id: chatId, date: today })
  },
})
