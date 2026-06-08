# @damengrandom/pr-review

Reviews a GitHub pull request for **bugs, security, and performance** issues — reading the surrounding code from a local clone, so its judgement is grounded in real context, not just the diff.

```bash
omw-review https://github.com/acme/widgets/pull/42
```

## Requirements

- **Node.js 18+** and **[ripgrep](https://github.com/BurntSushi/ripgrep)** (`rg`) on your PATH (`brew install ripgrep`).
- An **Anthropic API key** (<https://console.anthropic.com>).
- A **GitHub token** — fine-grained, read-only, with **Contents: Read** + **Pull requests: Read** on the repo you review.
- A **local clone** of that repo.

## Install

```bash
npm install -g @damengrandom/pr-review
```

You now have the `omw-review` command everywhere.

## Configure

Three settings. Since `omw-review` is a global command, put the two secrets in your shell profile and pass `REPO_PATH` per run:

```bash
# ~/.zshrc  — add once, then run: source ~/.zshrc
export ANTHROPIC_API_KEY="sk-ant-..."
export GITHUB_TOKEN="github_pat_..."
```

> Don't use a `.env` file with a global install — it's only read from the folder you run in, whereas shell exports are always found.

**Getting the GitHub token:** GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Restrict it to the repo you review, with **Contents: Read** and **Pull requests: Read**.

## Usage

`cd` into the repo clone so `REPO_PATH` is simply the current directory:

```bash
cd ~/work/the-repo
git checkout <pr-branch>      # so the context files match the PR
REPO_PATH="$(pwd)" omw-review https://github.com/<owner>/<repo>/pull/<number>
```

You get a ranked list of findings — each with **severity · category · `file:line` · explanation · suggested fix**. Bugs, security, and performance only — no style nits.

> Only ever review one repo? Put `export REPO_PATH="/abs/path"` in `~/.zshrc` and drop it from the command.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `Missing required environment variable(s): ...` | A var isn't set. `echo $ANTHROPIC_API_KEY` to check; confirm you passed `REPO_PATH`. |
| `Invalid GitHub PR URL: ...` | Must look like `https://github.com/<owner>/<repo>/pull/<number>`. |
| `... 404` fetching the PR | Your `GITHUB_TOKEN` can't see that repo — add it to the token's repository access. |
| `Refusing to read "..." outside REPO_PATH` | Safety guard; the tool only reads inside `REPO_PATH`. Harmless. |
| `rg: command not found` | `brew install ripgrep`. |

<!-- ## How to release
```bash
cd packages/pr-review
npm version patch/minor/major # bump version + create git tag vX.Y.Z (git tree must be clean)
npm publish # build + publish to npm (needs npm login / 2FA)
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."   # GitHub Release (or use the Releases UI)
```
-->

## Notes

- An **assistant, not an oracle** — verify findings; it can miss issues or flag non-issues.
- Cost and time scale with PR size.

ISC license.
