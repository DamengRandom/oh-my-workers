// Parses a GitHub pull request URL into its owner / repo / number parts.

export type ParsedPr = {
  owner: string
  repo: string
  number: number
}

const PR_URL_REGEX = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i

export function parsePrUrl(url: string): ParsedPr {
  const match = url.trim().match(PR_URL_REGEX)

  if (!match) {
    throw new Error(`Invalid GitHub PR URL: "${url}". Expected a URL like https://github.com/<owner>/<repo>/pull/<number>`)
  }

  const [, owner, repo, number] = match

  return { owner, repo, number: Number(number) }
}
