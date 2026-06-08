import { DynamicStructuredTool } from '@langchain/core/tools'
import { Octokit } from '@octokit/rest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const execFileAsync = promisify(execFile)

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

// Resolve the local clone root once. Every file/search tool is sandboxed to this directory.
function repoRoot(): string {
  const root = process.env.REPO_PATH
  if (!root) throw new Error('REPO_PATH is not set — point it at the local clone of the repo being reviewed.')
  return path.resolve(root)
}

// Resolve a repo-relative path and refuse anything that escapes the clone (path-traversal guard).
// path.resolve() is purely lexical and does NOT follow symlinks, so we resolve the real path
// (via realpathSync) before checking containment — otherwise a symlink committed inside the repo
// and pointing outside (e.g. link -> /etc) could be used to read files beyond REPO_PATH.
function resolveInsideRepo(relativePath: string): string {
  const root = realpathSync(repoRoot())
  const resolved = path.resolve(root, relativePath)

  let real = resolved
  try {
    real = realpathSync(resolved)
  } catch {
    throw new Error(`Refusing to read "${relativePath}" — it does not exist.`)
  }

  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error(`Refusing to read "${relativePath}" — it resolves outside REPO_PATH.`)
  }
  return resolved
}

// ── get_pr_diff: the one network call — fetch what changed in the PR ──────────
export const getPrDiffTool = new DynamicStructuredTool({
  name: 'get_pr_diff',
  description:
    'Fetches the changed files and their diffs (patches) for a pull request, plus the base/head branches. Call this FIRST to see what the PR changed.',
  schema: z.object({
    owner: z.string().describe('Repository owner (org or user)'),
    repo: z.string().describe('Repository name'),
    prNumber: z.number().describe('Pull request number'),
  }),
  func: async ({ owner, repo, prNumber }) => {
    const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, { owner, repo, pull_number: prNumber, per_page: 100 })

    const result = {
      title: pr.title,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      changedFiles: files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? '(no textual diff — binary or too large)',
      })),
    }

    console.log(`✅ get_pr_diff: ${result.changedFiles.length} changed file(s) in PR #${prNumber} (${result.headBranch} → ${result.baseBranch})`)

    return JSON.stringify(result)
  },
})

// ── read_file: read any file from the local clone to gather context ───────────
export const readFileTool = new DynamicStructuredTool({
  name: 'read_file',
  description:
    'Reads a file from the local checkout of the repository so you can inspect the surrounding code (callers, definitions, types) before deciding whether a change is a real issue. Path is relative to the repo root.',
  schema: z.object({
    path: z.string().describe('Repo-relative path of the file to read, e.g. "src/utils/parser.ts"'),
  }),
  func: async ({ path: relativePath }) => {
    const absolutePath = resolveInsideRepo(relativePath)

    let contents: string
    try {
      contents = await readFile(absolutePath, 'utf8')
    } catch {
      console.log(`⚠️ read_file: could not read "${relativePath}"`)
      return JSON.stringify({ path: relativePath, error: 'File not found or unreadable in the local clone.' })
    }

    // Prefix line numbers so the agent can cite accurate file:line references.
    const numbered = contents
      .split('\n')
      .map((line, i) => `${i + 1}\t${line}`)
      .join('\n')

    console.log(`✅ read_file: ${relativePath} (${contents.split('\n').length} lines)`)

    return JSON.stringify({ path: relativePath, contents: numbered })
  },
})

// ── search_code: grep the local clone to find callers / definitions ───────────
export const searchCodeTool = new DynamicStructuredTool({
  name: 'search_code',
  description:
    'Searches the local checkout for a string or symbol (e.g. a function name) to locate its definition and callers. Use this to understand how changed code is used elsewhere before judging it.',
  schema: z.object({
    query: z.string().describe('Literal text or symbol to search for'),
    glob: z.string().optional().describe('Optional file glob to narrow the search, e.g. "*.ts"'),
  }),
  func: async ({ query, glob }) => {
    const root = repoRoot()
    // --no-follow is ripgrep's default; we pin it explicitly so the search can never be made to
    // traverse a symlink out of the repo (defence-in-depth, matching the read_file guard).
    const args = ['--line-number', '--no-heading', '--color', 'never', '--max-count', '50', '--fixed-strings', '--no-follow']
    if (glob) args.push('--glob', glob)
    args.push('--', query, root)

    try {
      const { stdout } = await execFileAsync('rg', args, { maxBuffer: 1024 * 1024 })
      // Trim absolute prefix back to repo-relative paths for readability.
      const matches = stdout
        .split('\n')
        .filter(Boolean)
        .slice(0, 100)
        .map((line) => line.replace(`${root}${path.sep}`, ''))

      console.log(`✅ search_code: "${query}" → ${matches.length} match(es)`)
      return JSON.stringify({ query, matches })
    } catch (err) {
      // ripgrep exits with code 1 when there are no matches — that's not an error for us.
      const e = err as { code?: number }
      if (e.code === 1) {
        console.log(`✅ search_code: "${query}" → 0 matches`)
        return JSON.stringify({ query, matches: [] })
      }
      console.log(`⚠️ search_code failed for "${query}"`)
      return JSON.stringify({ query, error: 'Search failed.' })
    }
  },
})
