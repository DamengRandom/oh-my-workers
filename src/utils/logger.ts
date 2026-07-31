import pino from 'pino'
import pretty from 'pino-pretty'

export const logger = pino(
  { level: process.env.LOG_LEVEL || 'info' },
  pretty({
    colorize: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
    sync: true,
  })
)

export function sectionLogger(word: string): void {
  logger.info(`${'─'.repeat(50)}\n${word}\n${'─'.repeat(50)}`)
}

export function prompt(text: string): void {
  process.stdout.write(`${text}\n`)
}
