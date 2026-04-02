import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

// Escape HTML special characters to prevent XSS from AI-generated content
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Convert markdown ```lang ... ``` blocks into styled <pre><code> blocks.
// Plain text outside code blocks is escaped and rendered with whitespace preserved.
function renderMarkdown(text: string): string {
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g
  const parts: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Plain text before this code block
    if (match.index > lastIndex) {
      const plain = escapeHtml(text.slice(lastIndex, match.index)).replace(/\n/g, '<br>')
      parts.push(`<span style="font-size:14px;line-height:1.7;">${plain}</span>`)
    }

    // Code block
    const code = escapeHtml(match[2].trim())
    parts.push(
      `<pre style="background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:6px;font-family:'Courier New',monospace;font-size:13px;line-height:1.6;overflow-x:auto;margin:12px 0;white-space:pre-wrap;word-break:break-word;">${code}</pre>`,
    )

    lastIndex = match.index + match[0].length
  }

  // Remaining plain text after last code block
  if (lastIndex < text.length) {
    const plain = escapeHtml(text.slice(lastIndex)).replace(/\n/g, '<br>')
    parts.push(`<span style="font-size:14px;line-height:1.7;">${plain}</span>`)
  }

  return parts.join('')
}

export const quizEmailTool = new DynamicStructuredTool({
  name: 'send_quiz_email',
  description: 'Sends the approved TypeScript quiz question and answer via email.',
  schema: z.object({
    question: z.string().describe('The TypeScript quiz question'),
    answer: z.string().describe('The correct answer'),
    explanation: z.string().describe('Explanation of the answer'),
    difficulty: z.string().describe('Difficulty level: beginner, intermediate, or advanced'),
    topic: z.string().describe('TypeScript topic covered'),
    feedback: z.string().describe('Verifier feedback notes'),
  }),
  func: async ({ question, answer, explanation, difficulty, topic, feedback }) => {
    const recipient = process.env.QUIZ_EMAIL_RECIPIENT ?? ''
    const today = new Date().toISOString().split('T')[0]
    const difficultyEmoji = difficulty === 'beginner' ? '🟢' : difficulty === 'intermediate' ? '🟡' : '🔴'

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 680px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a2e; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">
          📘 Daily TypeScript Quiz — ${today}
        </h2>
        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">
          ${difficultyEmoji} ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} &nbsp;·&nbsp; 🏷️ ${topic}
        </p>

        <h3 style="color: #1e293b; margin-top: 24px;">❓ Question</h3>
        <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 4px;">
          ${renderMarkdown(question)}
        </div>

        <h3 style="color: #1e293b; margin-top: 24px;">✅ Answer</h3>
        <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; border-radius: 4px;">
          ${renderMarkdown(answer)}
        </div>

        <h3 style="color: #1e293b; margin-top: 24px;">💡 Explanation</h3>
        <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px;">
          ${renderMarkdown(explanation)}
        </div>

        ${
          feedback
            ? `<p style="color: #94a3b8; font-size: 12px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
          🔍 Verified by AI reviewer: ${escapeHtml(feedback)}
        </p>`
            : ''
        }
      </div>
    `

    if (!process.env.GMAIL_USER) {
      throw new Error('GMAIL_USER is not set in environment variables')
    }

    if (!process.env.GMAIL_APP_PASSWORD) {
      throw new Error('GMAIL_APP_PASSWORD is not set in environment variables')
    }

    if (!recipient) {
      throw new Error('QUIZ_EMAIL_RECIPIENT is not set in environment variables')
    }

    try {
      await transporter.verify()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Gmail authentication failed: ${message} — check GMAIL_USER and GMAIL_APP_PASSWORD in .env`)
    }

    await transporter.sendMail({
      from: `"Oh My Workers 🤖" <${process.env.GMAIL_USER}>`,
      to: recipient,
      subject: `📘 TypeScript Quiz ${today} — ${difficultyEmoji} ${topic}`,
      html,
    })

    console.log(`✅ Quiz email sent to ${recipient}`)

    return JSON.stringify({ success: true, sent_to: recipient, date: today })
  },
})
