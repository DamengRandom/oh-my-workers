import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const quizGeneratorTool = new DynamicStructuredTool({
  name: 'generate_typescript_quiz',
  description: 'Generates a TypeScript coding question with a complete answer and explanation at the specified difficulty level.',
  schema: z.object({
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).describe('Difficulty level of the quiz question'),
    topic: z.string().describe('TypeScript topic to focus on, e.g. generics, utility types, type guards'),
    question: z.string().describe('The quiz question with a code example'),
    answer: z.string().describe('The complete correct answer including working code'),
    explanation: z.string().describe('Clear explanation of why the answer is correct and how it works'),
  }),
  func: async ({ difficulty, topic, question, answer, explanation }) => {
    const now = new Date().toISOString()

    console.log(`📝 Generated ${difficulty} TypeScript quiz on topic: ${topic}`)

    return JSON.stringify({ difficulty, topic, question, answer, explanation, created_at: now, updated_at: now })
  },
})
