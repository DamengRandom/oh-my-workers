import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const quizVerifierTool = new DynamicStructuredTool({
  name: 'verify_typescript_quiz',
  description: 'Reviews a TypeScript quiz question and answer for technical accuracy. Returns approved=true only if confidence is high.',
  schema: z.object({
    question: z.string().describe('The quiz question to verify'),
    answer: z.string().describe('The answer to verify for correctness'),
    explanation: z.string().describe('The explanation to verify for completeness and accuracy'),
    approved: z.boolean().describe('Whether the quiz passes quality review (confidence >= 8/10)'),
    confidence_score: z.number().min(1).max(10).describe('Confidence score from 1-10 on the accuracy of the answer'),
    feedback: z.string().describe('Detailed feedback on what is correct, incorrect, or missing'),
  }),
  func: async ({ question, answer, explanation, approved, confidence_score, feedback }) => {
    const status = approved ? '✅ Approved' : '❌ Rejected'

    console.log(`${status} — confidence: ${confidence_score}/10`)

    if (!approved) {
      console.log(`📑 Feedback: ${feedback}`)
    }

    return JSON.stringify({ question, answer, explanation, approved, confidence_score, feedback })
  },
})
