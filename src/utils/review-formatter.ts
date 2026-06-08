import type { ReviewResult, ReviewFinding } from '../schemas/index.js'

// Minimal ANSI colors — no extra dependency.
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
} as const

const SEVERITY_ORDER: ReviewFinding['severity'][] = ['critical', 'high', 'medium', 'low']

const SEVERITY_COLOR: Record<ReviewFinding['severity'], string> = {
  critical: COLORS.red,
  high: COLORS.red,
  medium: COLORS.yellow,
  low: COLORS.blue,
}

function color(text: string, c: string): string {
  return `${c}${text}${COLORS.reset}`
}

export function formatReview(result: ReviewResult): string {
  const lines: string[] = []

  lines.push(color('PR Review', COLORS.bold))
  lines.push('')
  lines.push(result.summary)
  lines.push('')

  if (result.findings.length === 0) {
    lines.push(color('✅ No bugs, security, or performance issues found.', COLORS.blue))
    return lines.join('\n')
  }

  // Stable ordering: most severe first.
  const sorted = [...result.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))

  lines.push(color(`Found ${sorted.length} issue(s):`, COLORS.bold))
  lines.push('')

  sorted.forEach((f, i) => {
    const tag = color(`${f.severity.toUpperCase()} · ${f.category}`, SEVERITY_COLOR[f.severity])
    const location = color(`${f.file}:${f.line}`, COLORS.gray)
    lines.push(`${color(`${i + 1}.`, COLORS.bold)} ${tag} — ${color(f.title, COLORS.bold)}`)
    lines.push(`   ${location}`)
    lines.push(`   ${f.explanation}`)
    lines.push(`   ${color('Suggestion:', COLORS.dim)} ${f.suggestion}`)
    lines.push('')
  })

  return lines.join('\n')
}
