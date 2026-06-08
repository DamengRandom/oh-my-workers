# @damengrandom/pr-review

AI code-review CLI. Point it at a GitHub pull request and it reviews the changes for **bugs, security, and performance** issues — reading the surrounding code from a local clone so its judgement is grounded in real context, not just the diff.

```bash
omw-review https://github.com/acme/widgets/pull/42
```

---

## What you need before you start

1. **Node.js 18+** — check with `node --version`.
2. **ripgrep** (`rg`) on your PATH — the tool uses it to search code. macOS: `brew install ripgrep`. Check with `rg --version`.
3. **An Anthropic API key** — the review runs on Claude. Get one at <https://console.anthropic.com>.
4. **A GitHub token** (fine-grained, read-only) — so the tool can fetch the PR. See [Get a GitHub token](#get-a-github-token) below.
5. **A local clone** of the repo whose PRs you review — the tool reads files from it for context.

---

## Install

```bash
npm install -g @damengrandom/pr-review
```

This gives you the `omw-review` command everywhere on your machine.

---

## Configure (the important part)

The tool needs **three** settings. Because you installed it **globally** (you run `omw-review` from anywhere), the cleanest place for these is your **shell environment** — not a `.env` file. (A `.env` file is only read from the folder you happen to run the command in, which is fragile for a global tool.)

| Variable | What it is | Where to put it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Your Anthropic key (rarely changes) | Shell profile (`~/.zshrc`) |
| `GITHUB_TOKEN` | Read-only GitHub token (rarely changes) | Shell profile (`~/.zshrc`) |
| `REPO_PATH` | Absolute path to the local clone you're reviewing (changes per repo) | Per command, at run time |

### Step 1 — put the two secrets in your shell profile

Open `~/.zshrc` (the default on macOS; use `~/.bashrc` on bash) and add:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export GITHUB_TOKEN="github_pat_..."
```

Then reload it (or just open a new terminal):

```bash
source ~/.zshrc
```

Now those two are set in every terminal session — you only do this once.

### Step 2 — give `REPO_PATH` when you run a review

`REPO_PATH` points at the local clone of the repo the PR belongs to. The easiest pattern is to `cd` into that clone and use the current directory:

```bash
cd ~/work/the-company-repo          # the clone
git fetch origin                    # make sure you have the PR's branch
git checkout the-pr-branch          # so the context files match the PR
REPO_PATH="$(pwd)" omw-review https://github.com/acme/widgets/pull/42
```

> If you **only ever review one repo**, you can instead add `export REPO_PATH="/abs/path/to/that/repo"` to `~/.zshrc` and skip typing it each time.

---

## Get a GitHub token

Use a **fine-grained, read-only** token — minimal access, so it's safe even if it leaks.

1. GitHub → **Settings → Developer settings → Fine-grained tokens → Generate new token**.
2. **Repository access** → *Only select repositories* → pick the repo you review.
3. **Permissions** (read-only):
   - Contents → **Read**
   - Pull requests → **Read**
4. Generate, copy the token, and paste it into `~/.zshrc` as `GITHUB_TOKEN` (Step 1 above).

---

## Usage

```bash
REPO_PATH="$(pwd)" omw-review <github-pr-url>
```

The tool will:
1. Fetch the PR's changed files and diffs from GitHub.
2. Read related files from `REPO_PATH` (callers, definitions, types) to understand the change in context.
3. Print a ranked list of findings — each with **severity · category · `file:line` · explanation · suggested fix**.

It reviews for **bugs, security, and performance** only — no style nits.

---

## Troubleshooting

| Message | What it means / fix |
| --- | --- |
| `Missing required environment variable(s): ...` | One of the three isn't set. Re-check Step 1, and that you passed `REPO_PATH`. Run `echo $ANTHROPIC_API_KEY` to confirm it's exported. |
| `Invalid GitHub PR URL: ...` | The URL isn't a PR link. It must look like `https://github.com/<owner>/<repo>/pull/<number>`. |
| `... 404` while fetching the PR | Your `GITHUB_TOKEN` can't see that repo. Make sure the token's *repository access* includes it, with Contents + Pull requests read. |
| `Refusing to read "..." — it resolves outside REPO_PATH` | A safety guard — the tool only reads files inside `REPO_PATH`. Usually harmless. |
| `rg: command not found` / search failures | Install ripgrep (`brew install ripgrep`). |

---

## Programmatic use

You can also call it from your own code instead of the CLI:

```ts
import { reviewPullRequest, formatReview } from '@damengrandom/pr-review'

const result = await reviewPullRequest('https://github.com/acme/widgets/pull/42')
console.log(formatReview(result))
```

The same environment variables apply.

---

## Releasing a new version (for maintainers)

> This section is for whoever **publishes** the package — if you're just using the tool, you can ignore it.

Versions follow [semver](https://semver.org): `MAJOR.MINOR.PATCH` — **patch** = bugfix, **minor** = new backward-compatible feature, **major** = breaking change.

**First time only** — log in to npm. The package uses your personal `@damengrandom` scope, which you own automatically, so there's no org/scope setup needed:

```bash
npm whoami        # should print your username; if it errors, run: npm login
```

**Each release — four commands:**

```bash
cd packages/pr-review
npm version patch        # 1. bumps package.json (e.g. 0.1.0 → 0.1.1) AND creates a git commit + tag "v0.1.1"
git push --follow-tags   # 2. pushes the commit and the new tag to GitHub
npm publish              # 3. builds (via prepublishOnly) and publishes to npm
gh release create v0.1.1 --title "v0.1.1" --notes "What changed in this release"   # 4. GitHub Release
```

- **Step 1 is the key one:** `npm version` keeps the npm version and the git tag identical (`v0.1.1`). That tag is what a GitHub Release attaches to — it's the "Latest" entry on the repo's **Releases** page.
- Use `npm version minor` or `npm version major` instead of `patch` depending on the change.
- **Step 4** can also be done in the GitHub UI: **repo → Releases → Draft a new release → pick the tag → write notes**. The number of releases shown there is just your number of version tags over time.

**Monorepo note:** since `pr-review` is the only publishable package here, plain `vX.Y.Z` tags are fine. If you add a second publishable package later, switch to prefixed tags like `pr-review-v0.1.1` to avoid tag collisions.

**Automating it (optional):** add a `.github/workflows/release.yml` that triggers on tag push (`on: push: tags: ['v*']`), runs the build, then `npm publish` (using an `NPM_TOKEN` repo secret) and `gh release create`. Then every release is just `npm version patch && git push --follow-tags` — CI does the publish and the GitHub Release for you.

---

## Notes

- The review is an **assistant, not an oracle** — treat findings as leads to verify, not gospel. It can miss issues and occasionally flag non-issues.
- Cost and time scale with PR size (each review uses Anthropic API tokens).

## License

ISC
