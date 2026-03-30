import { DynamicStructuredTool } from '@langchain/core/tools'
import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import { GitHubDigestSchema } from '../schemas/index.js'

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

export const githubTool = new DynamicStructuredTool({
  name: 'fetch_github_activity',
  description: "Fetches all of today's GitHub commits and pull requests for the engineer, then returns a structured summary.",
  schema: z.object({
    username: z.string().describe('GitHub username to fetch activity for'),
    date: z.string().describe('Date to fetch activity for in YYYY-MM-DD format'),
  }),
  func: async ({ username, date }) => {
    const now = new Date().toISOString()

    // Fetch today's commits
    const commitsResponse = await octokit.rest.search.commits({
      q: `author:${username} committer-date:${date}`,
      per_page: 100,
    })

    const commits = commitsResponse.data.items.map((item) => ({
      repo: item.repository.full_name,
      message: item.commit.message.split('\n')[0], // first line only
      sha: item.sha.substring(0, 7),
      url: item.html_url,
    }))

    // Fetch today's pull requests (created or updated today)
    const prsResponse = await octokit.rest.search.issuesAndPullRequests({
      q: `author:${username} type:pr updated:${date}`,
      per_page: 100,
    })

    const pullRequests = prsResponse.data.items.map((item) => {
      let status: 'open' | 'closed' | 'merged' = 'open'

      if (item.pull_request?.merged_at) status = 'merged'
      else if (item.state === 'closed') status = 'closed'

      return {
        title: item.title,
        repo: item.repository_url.replace('https://api.github.com/repos/', ''),
        url: item.html_url,
        status,
        number: item.number,
      }
    })

    const digest = GitHubDigestSchema.parse({
      commits,
      pullRequests,
      summary: '', // filled in by the agent after reviewing the data
      created_at: now,
      updated_at: now,
    })

    console.log(`✅ GitHub: found ${commits.length} commits and ${pullRequests.length} PRs for ${date}`)

    return JSON.stringify(digest)
  },
})
