import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const quizGeneratorTool = new DynamicStructuredTool({
  name: 'generate_typescript_quiz',
  description: 'Generates a TypeScript coding question with a complete answer and explanation at the specified difficulty level.',
  schema: z.object({
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).describe('Difficulty level of the quiz question'),
    topic: z.string().describe('TypeScript topic covered, e.g. generics, enums, infer keyword'),
    question: z.string().describe('Short quiz question: 1–3 sentences + code snippet max 8 lines'),
    answer: z.string().describe('Correct answer: 1–2 sentences + working code max 6 lines'),
    explanation: z.string().describe('Why the answer is correct: 2–4 sentences max, no padding'),
  }),
  func: async ({ difficulty, topic, question, answer, explanation }) => {
    const now = new Date().toISOString()

    console.log(`📝 Generated ${difficulty} TypeScript quiz on topic: ${topic}`)

    return JSON.stringify({ difficulty, topic, question, answer, explanation, created_at: now, updated_at: now })
  },
})
