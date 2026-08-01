# How to Evaluate the Agents in oh-my-workers

A tutorial, not a spec. The goal is that by the end you can write evals for this
repo yourself, and — more importantly — decide *which* evals are worth writing.

I have deliberately **not** given you a finished eval file to paste in. Every code
block here is a fragment meant to illustrate one idea. You will type the rest.
That is the point: an eval you did not write is an eval you will not trust, and an
eval you do not trust is an eval you will delete the first time it goes red.

Where I am stating an opinion rather than a fact, I say so. Where I am unsure, I
say that too.

---

## Table of contents

- [Part 0 — What I read before writing this](#part-0--what-i-read-before-writing-this)
- [Part 1 — Concepts](#part-1--concepts)
- [Part 2 — Your first eval, step by step](#part-2--your-first-eval-step-by-step)
- [Part 3 — A harder one: LLM-as-judge](#part-3--a-harder-one-llm-as-judge)
- [Part 4 — Building the golden dataset by hand](#part-4--building-the-golden-dataset-by-hand)
- [Part 5 — Scoring, baselines, and drift](#part-5--scoring-baselines-and-drift)
- [Part 6 — CI wiring, and the free-tier reality](#part-6--ci-wiring-and-the-free-tier-reality)
- [Part 7 — Phased rollout](#part-7--phased-rollout)
- [Part 8 — What is not worth bothering with](#part-8--what-is-not-worth-bothering-with)
- [Part 9 — The tool landscape](#part-9--the-tool-landscape)

---

## Part 0 — What I read before writing this

I installed the repo (`pnpm install`), ran the suite (`pnpm test` — 76 tests, all
green), and read `src/agent/` and `src/tools/` end to end before searching the web
for anything. That order matters and I would ask you to keep it: eval advice on
the internet is written for RAG chatbots and customer-support agents, and most of
it does not apply to a cron job that writes eight Telegram bullet points. If you
read the tooling first you will end up installing a framework and then hunting for
a problem it solves.

What I found in the code that shapes everything below:

| Thing | Where | Why it matters for evals |
| --- | --- | --- |
| `githubAgent` | `src/agent/github.agent.ts` | One tool call, `runLimit: 1`, prompt says "return the result as-is". Almost nothing to evaluate. |
| `diaryAgent` | `src/agent/diary.agent.ts` | Free-form prose for a human manager. Nothing machine-checkable. Judge territory, and low value. |
| `curateTrending` | `src/agent/news-curator.agent.ts` | **This is the one worth evaluating.** Structured output, hard constraints, runs unattended daily. |
| `runCuratorGraph` | `src/agent/curator.graph.ts` | Retry wrapper, `MAX_ATTEMPTS = 2`. Already unit-tested with a fake curator. |
| `TRENDING_CURATOR_PROMPT` | `src/agent/prompt.ts` | Contains three constraints stated in prose and enforced nowhere. |

---

## Part 1 — Concepts

### 1.1 What an eval actually is

An eval is a test whose subject is a model's *output quality*, run against a fixed
set of inputs, producing a *score* rather than a pass/fail.

That definition has three load-bearing words, so let me take them one at a time,
because each one is a difference from the tests you already have.

**"Output quality."** Your existing tests check the code around the model.
Look at `src/agent/curator-graph.test.ts` — every single one of those eleven tests
passes a `fakeCurate` function to `runCuratorGraph`. There is no model in the loop.
That test file asks "if the model returns garbage, does my retry logic behave?"
which is a completely legitimate and valuable question, and it is **not an eval**.
An eval asks "does the model return garbage, and how often?"

Keep both. They fail for different reasons and they are fixed in different places.
A scaffold test going red means you broke your TypeScript. An eval going red means
you broke your prompt, or the provider changed the model under you.

**"A fixed set of inputs."** This is the golden dataset — §1.3. Without it you
cannot compare today to last week, and comparison is the entire value.

**"A score rather than pass/fail."** A unit test is binary because the code is
deterministic. Model output is not. If you write `assert.equal(summary, "...")`
against an LLM you have written a test that fails for reasons you do not care
about. So evals count: *8 of 8 repos had valid tags* is the output, and *you*
decide the threshold.

### 1.2 The three layers, and why the middle one is where your money is

Think of it as three layers, cheapest first:

1. **Scaffold tests** — no model. Your current 76 tests. Free, instant,
   deterministic. Run on every commit.
2. **Deterministic evals** — model in the loop, but the *scoring* is plain code:
   string length, set membership, exact match. Costs one API call per example.
   No judgement, no ambiguity, no second model.
3. **Judged evals** — model in the loop *and* a second model scoring the output.
   Costs two API calls per example, and the scores are themselves noisy.

My strong opinion, and it is an opinion: for this repo, layer 2 is where nearly
all the value is, and you should be reluctant to move to layer 3. Most eval
tutorials leap straight to LLM-as-judge because it demos well. But a judge that
you have not calibrated is a random number generator with a plausible-sounding
`comment` field attached, and on a free-tier model it is a *slow* random number
generator.

### 1.3 What a golden dataset is

A golden dataset is a frozen set of inputs, and — where you can define it — the
expected output for each. "Golden" means you curated it by hand and you will not
regenerate it casually. It is a fixture with an opinion.

Two things people get wrong:

- **It must be frozen.** If you scrape GitHub trending fresh on every eval run,
  a score drop tells you nothing — did the model get worse, or did today's repos
  just have vaguer descriptions? You cannot tell. Freeze the input, and the only
  moving parts are the prompt and the model.
- **The expected output does not have to be a full expected output.** For your
  curator you will almost never know the *right* summary. You do know that the
  tags must come from a list of thirteen. That is enough. A golden dataset can
  carry constraints instead of answers, and for generative tasks it usually should.

### 1.4 What scoring means

A scorer is a function from (input, output) to a number, conventionally in `[0, 1]`.
`1` is good. That is essentially the whole convention.

You will write two kinds:

```ts
// Binary: the property either holds or it does not.
const score = tags.every((t) => ALLOWED_TAGS.has(t)) ? 1 : 0

// Proportional: what fraction of the thing was right?
const score = tags.filter((t) => ALLOWED_TAGS.has(t)).length / tags.length
```

Prefer proportional when you want to see improvement between runs, and binary when
the property is genuinely all-or-nothing. One invalid tag out of five renders a
hashtag that nobody can search — but so do five. I would use binary here. That is
a judgement call and you may disagree.

Then you aggregate across the dataset — usually a mean — and that single number
is what you track over time.

### 1.5 Deterministic vs LLM-as-judge

Ask one question: **can I express this property as code?** If yes, do that, always.

| Property | Expressible as code? |
| --- | --- |
| Summary is ≤ 140 characters | Yes — `.length` |
| Tags are from the allowed 13 | Yes — set membership |
| There are 3–5 tags | Yes — `.length` |
| `repo_name` matches the input exactly | Yes — string equality |
| Every input repo got an entry | Yes — count |
| Summary explains *what problem it solves* rather than restating the description | **No.** This needs a judge. |

Notice how far down the list you get before you need a judge. That is not an
accident of this codebase — it is typical, and most teams underestimate it. When
you find yourself reaching for a judge, spend five more minutes trying to find the
code version first.

### 1.6 Why a baseline matters

A score with nothing to compare it to is a decoration.

"The curator scored 0.87" means nothing. "The curator scored 0.87, and it was 0.98
for the last six weeks" means you have a regression and you should look at what
changed. The baseline is the whole product. Everything in Part 5 is about making
that comparison honest.

The corollary: **the first time you run an eval, it does not tell you anything.**
Its job is to become the baseline. Do not tune your prompt off a single run.

### 1.7 What is already machine-checkable in this repo, for free

This is the concrete payoff of reading the code first. `TRENDING_CURATOR_PROMPT`
in `src/agent/prompt.ts` states four constraints, and I traced each one through
the code to see what actually enforces it:

**1. `repo_name` must be echoed exactly.**
Partially enforced, and the failure mode is nasty. `mergeSummaries` in
`src/agent/news-curator.agent.ts` builds a `Map` keyed on the input names and does:

```ts
const s = byName.get(r.name)
if (!s) return []      // <- repo silently vanishes from the digest
```

So a mismatched name does not error — the repo is *dropped*. If the model
mangles three names out of eight, you send a five-repo digest and nothing anywhere
tells you. There is a partial safety net: `curateNode` in `curator.graph.ts` errors
if the model matched *zero* repos (that is `T-33`, commit `851ae49`). But 7-of-8 is
silent. **Nothing measures the match rate.** That is eval #1.

**2. Summaries must stay under `TRENDING_SUMMARY_MAX` (140).**
Not enforced at all — it is *hidden*. `repoEntry` in `src/tools/news-telegram.tool.ts`
calls `truncate(repo.summary, TRENDING_SUMMARY_MAX)`, which cuts the string and
appends an ellipsis. So an over-long summary does not fail; it gets clipped
mid-sentence and delivered to your phone looking broken. **Nothing measures the
over-length rate.** Eval #2.

**3. Tags must come from exactly these 13:** `ai, framework, library, devtools,
bundler, testing, cli, database, ui, api, runtime, security, typescript`.
I grepped for these. They appear in exactly one place in the entire repo — the
prompt string. `SummarySchema` in `news-curator.agent.ts` types them as
`z.array(z.string())`, so any string passes. The Telegram tool slices to
`TRENDING_TAGS_MAX` and renders whatever it got as `#hashtag`. A model that emits
`#web-framework` one day and `#framework` the next breaks the searchability that
the prompt explicitly says is the reason for the list. Eval #3, and honestly the
highest-value one.

**4. Tag count must be 3–5.** Same story. `TRENDING_TAGS_MAX = 5` only slices at
send time; there is no floor at all. Eval #4.

Four real, valuable evals, all layer-2, all scoreable in plain TypeScript. Start here.

---

## Part 2 — Your first eval, step by step

We are going to build eval #3 (tag validity), because it is the one with the
largest gap between "the prompt says so" and "anything checks."

The trick I want you to internalise before we start: **we will build the scorer
before we build the thing that calls the model.** Scorers are pure functions. You
can develop and test them for free, in milliseconds, with no API key. The model
call is a thin wrapper you add at the end. Most people do this backwards, burn
forty API calls debugging a scoring bug, and hit the free-tier daily cap.

### Step 1 — Decide where eval files live, and why not in `src/`

Make a top-level `evals/` directory. Not `src/evals/`.

I want to explain this properly, because the reason is specific to your repo and
you would not guess it. Your `code-quality.yml` workflow runs Fallow with
`FALLOW_COVERAGE: coverage/coverage-final.json`, and that file comes from
`pnpm test:coverage`, which is:

```
c8 --reporter=json --src src --all node --import tsx --test "src/**/*.test.ts"
```

The `--all` flag means *every file under `src`* enters the coverage denominator,
including ones no test touches. Fallow then computes CRAP = complexity² × (1 −
coverage)³ + complexity. Drop uncovered eval files into `src/` and you inflate the
denominator, push CRAP up on new code, and your own `gate: new-only` starts failing
PRs for reasons that have nothing to do with the PR. Keeping evals outside `src`
sidesteps the whole thing.

```bash
mkdir -p evals/fixtures
```

One follow-up: `pnpm tsc` uses `"include": ["src/**/*"]`, so it will not typecheck
`evals/`. Add `"evals"` to the `include` array in `tsconfig.json`. You want these
typechecked — an eval with a type error is an eval that silently stops running.

### Step 2 — Capture a real fixture

Do not hand-write fake repos. Real GitHub descriptions are messy in ways you will
not invent: emoji, marketing copy, empty strings, 300-character run-ons. Your
model will be wrong on the messy ones, which is exactly what you want to measure.

The scrape tool is already a standalone tool with no DB dependency, so you can
call it directly:

```bash
node --import tsx -e "
import { trendingScrapeTool } from './src/tools/trending-scrape.tool.ts'
console.log(await trendingScrapeTool.invoke({ languages: ['typescript', 'javascript'] }))
" > evals/fixtures/trending-2026-08-01.json
```

I ran this while writing; it returned 14 TypeScript repos in about two seconds, no
API key needed — scraping is free, only curation costs you.

Date-stamp the filename. In three months you will want to know whether a score
change came from a new prompt or a fixture you quietly refreshed.

Now open the file and read it. Actually read it. You are about to freeze this as
your definition of "typical input" and you should know what is in there. When I
looked at today's, the first entry was:

```json
{ "name": "usekaneo/kaneo",
  "description": "🎯 All you need. Nothing you don't. Open source project management that works for you, not against you.",
  "language": "TypeScript", "stars": 5509, "todayStars": 778 }
```

That description tells you almost nothing about what the project *does*. If your
model produces a bland summary for it, that is the model correctly reflecting a
bland input — not a bug. Knowing that before you see the score stops you from
"fixing" the prompt in response to noise.

### Step 3 — Write down the constraint as data

Create `evals/constraints.ts`. First thing in it: the tag list, as a real
data structure.

```ts
export const ALLOWED_TAGS = new Set([
  'ai', 'framework', 'library', 'devtools', 'bundler', 'testing',
  'cli', 'database', 'ui', 'api', 'runtime', 'security', 'typescript',
])
```

Why a `Set` and not an array: you will do membership checks in a loop, and `Set.has`
says what you mean. Why not `readonly string[] as const`: you would then need
`.includes()` with a widening cast, which is noise.

Now the uncomfortable question, which I want you to sit with rather than have me
answer: **this list now exists in two places** — here and in the prompt string. If
you edit one you must edit the other, and if you forget, your eval passes while
production is wrong. That is the classic way evals rot.

There are three ways out, and I genuinely do not think one is obviously right:

- **(a)** Leave it duplicated, accept the risk. Cheapest. Fine for a solo repo where
  you are the only one who touches `prompt.ts`.
- **(b)** Export `ALLOWED_TAGS` from `src/constants/index.ts` and interpolate it into
  the prompt template. Single source of truth. Costs you a slightly less readable
  prompt string, and it means the prompt file now has an import.
- **(c)** Keep them separate *on purpose*, and add a scaffold test in `src/` asserting
  that every tag in `ALLOWED_TAGS` appears in `TRENDING_CURATOR_PROMPT`. The
  duplication stays, but drift becomes a test failure.

My preference is (b), because "the prompt is data" is a habit that pays off later
when you start versioning prompts (§5.4). But (c) is a completely defensible
five-line answer and you would not be wrong to take it today and revisit.

### Step 4 — Write the scorer as a pure function

Still no model. Same file, or `evals/scorers.ts` if you prefer — I would split once
you have more than three.

Think about the signature before you write it. What does this function need? The
model's output for one repo. What does it return? A number in `[0,1]`, and — this
is the part people skip — *a reason*. Six weeks from now a bare `0.75` in a log
will be useless to you. So:

```ts
export type Score = { score: number; comment?: string }

export function scoreTags(tags: string[]): Score {
  const invalid = tags.filter((t) => !ALLOWED_TAGS.has(t))
  if (invalid.length) return { score: 0, comment: `invalid tags: ${invalid.join(', ')}` }
  if (tags.length < 3 || tags.length > 5) return { score: 0, comment: `${tags.length} tags, want 3-5` }
  return { score: 1 }
}
```

Four decisions in there, each deliberate:

- **It takes `string[]`, not a `CuratedRepo`.** The narrowest input that does the
  job. Narrow inputs are trivial to test and impossible to misuse.
- **It returns an object, not a number.** The `comment` is what makes a failing
  eval actionable instead of merely alarming.
- **It is binary.** Per §1.4, one bad hashtag already breaks searchability. If you
  would rather see gradual improvement, return
  `1 - invalid.length / tags.length` instead — just be consistent, because you
  cannot compare a proportional score against a binary baseline.
- **It folds in the count check (eval #4).** Both are "are the tags well-formed?",
  and one scorer with a good comment beats two scorers you have to read together.
  Reasonable people split these. If you split them, split them now, not later.

### Step 5 — Test the scorer

Yes, really. Your eval logic is code, and it can be wrong. A scorer with an
off-by-one that silently returns `1` is worse than no eval, because it tells you
everything is fine.

This one goes in `src/`? No — it goes next to the scorer, `evals/scorers.test.ts`,
and here you hit a small wrinkle worth knowing: your `pnpm test` script globs
`"src/**/*.test.ts"`, so a test under `evals/` will not run. Widen the glob to
cover both directories, or add a second script. I would widen it — this test is
pure, fast, and deterministic, and it belongs in the same gate as the other 76.

```ts
test('rejects a tag outside the allowed list', () => {
  const { score, comment } = scoreTags(['ai', 'framework', 'web3'])
  assert.equal(score, 0)
  assert.match(comment ?? '', /web3/)   // the comment must name the offender
})
```

Write three or four: the happy path, an invalid tag, too few tags, too many. Note
the second assertion — I am testing that the *comment* is useful, not just that
the score is `0`. That is the assertion that keeps the comment honest when you
refactor.

Run `pnpm test`. This costs nothing and takes two seconds. Iterate here until the
scorer is right, *then* spend API calls.

### Step 6 — Now write the runner

This is the part that calls the model. Create `evals/curator.eval.ts`.

Note the extension: `.eval.ts`, not `.test.ts`. That is what keeps it out of the
`src/**/*.test.ts` glob and out of your per-PR gate. Live-model evals are slow and
occasionally flaky; they must not block a typo fix. §6 covers how they run instead.

What does the runner need to do? Four things, in order:

1. Load the fixture.
2. Call the real curator on it.
3. Score each returned repo.
4. Report the aggregate.

For step 2, call `curateTrending` **directly**, not `runCuratorGraph`:

```ts
const repos = JSON.parse(readFileSync(FIXTURE, 'utf8')) as TrendingRepo[]
const raw = await curateTrending(repos.slice(0, TRENDING_TOP_N))
const { repos: curated } = JSON.parse(raw) as { repos: CuratedRepo[] }
```

The reason is important and it is the kind of thing that quietly ruins an eval.
`runCuratorGraph` retries up to `MAX_ATTEMPTS = 2` and feeds the parse error back
into the prompt as `feedback`. If you evaluate through the graph, a model that
fails half the time and gets rescued by the retry scores identically to a model
that is right first time. You would be measuring your error handling, not your
model. **Evaluate the node; let the graph be tested by the scaffold tests that
already exist.**

(There is a separate eval worth writing later: *how often does the retry fire?*
That is a real signal about prompt quality. Different eval, different question.)

Also note `.slice(0, TRENDING_TOP_N)`. Production sends 8. If you evaluate on 14
you are evaluating a prompt under a load it never sees — long inputs degrade
instruction-following, so you would score worse than reality. **Match production
shape exactly.** This is the single most common way a first eval ends up lying.

For step 3, iterate and collect. For step 4:

```ts
const mean = results.reduce((sum, r) => sum + r.score, 0) / results.length
console.log(`tag_validity: ${mean.toFixed(2)} (${results.filter((r) => r.score === 1).length}/${results.length})`)
for (const r of results.filter((r) => r.score < 1)) console.log(`  ✗ ${r.name}: ${r.comment}`)
```

Print the failures individually. The mean tells you *whether* to care; the per-repo
lines tell you *what to do*. An eval that prints only a number sends you digging
through LangSmith to find out what happened.

### Step 7 — Add a script and run it

In `package.json`:

```json
"eval": "node --import tsx evals/curator.eval.ts"
```

Plain `node`, no `--test`. You could use `node:test` here for the runner
ergonomics, and later you may want to. Right now a script that prints numbers is
easier to read and cannot accidentally end up in CI's test glob.

Make sure `LLM_API_KEY` is set — `createLlm` in `src/agent/llm.ts` throws
immediately without it, which is good, fail-fast behaviour. Then:

```bash
pnpm eval
```

### Step 8 — Read the output

Expect something like:

```
tag_validity: 0.75 (6/8)
  ✗ vercel/next.js: invalid tags: react, web
  ✗ oven-sh/bun: 2 tags, want 3-5
```

Here is how to read that, and the reading is more important than the number.

**`0.75` on the first run is not a failure.** It is your baseline. You now know
something you did not know an hour ago: roughly one repo in four gets tags that
break hashtag searchability. That has presumably been true for every digest you
have ever sent.

**Look at the failures for a pattern.** `react, web` is interesting — those are
*sensible* tags that just are not on the list. The model is not being stupid; it
is doing a reasonable thing your prompt did not sufficiently constrain. That
points at a prompt fix (repeat the list closer to the output instruction, or add
"if no tag fits, use `library`"), not a model fix.

**`2 tags, want 3-5` is a different failure.** The model complied with the list but
not the count. Also a prompt issue, but a different one.

**If you get `1.00` on the first run**, do not celebrate yet. Check the fixture is
actually loading, check `curated.length === 8`, and check the scorer by feeding it
a deliberately bad input. A green eval you have not seen go red is not yet evidence
of anything. (I will admit this is a hard-won habit rather than something I can
prove to you.)

### Step 9 — Run it three times

Same fixture, same prompt, three runs. Write down the three numbers.

`curateTrending` calls `createLlm(0.5)` — temperature 0.5, not 0. So the model
*will* give you different answers to the identical input. If your three runs are
`0.75, 0.75, 0.88`, then a single run's number carries roughly ±0.1 of noise, and
a change from 0.75 to 0.80 next month means nothing at all.

You cannot set a meaningful threshold until you know your noise floor. This step is
not optional and it costs you three runs' worth of quota. Do it once now, and
repeat it whenever you change the model or the temperature.

---

## Part 3 — A harder one: LLM-as-judge

Only now. And with a specific, narrow question.

### 3.1 Pick something a judge is actually needed for

Your prompt says:

> Do not just restate the repo's own description; say what problem it solves for a
> TS/JS engineer

That is genuinely not codeable. You could check n-gram overlap with the
description as a crude proxy, and honestly that is worth trying first — it is free
and catches the blatant cases. But a model that paraphrases the description with
different words defeats overlap while still failing the actual instruction.

So: judge question is *"does this summary say what problem the repo solves, beyond
restating its description?"* One question. Not "is this summary good."

### 3.2 Write the judge prompt

Five rules, and I will explain each because the rules are where judges go wrong.

**Rule 1: binary, not a 1–5 scale.** Everyone reaches for 1–5. Do not. Models
cluster on 3 and 4, the difference between 3 and 4 is not stable across runs, and
you cannot say what a 3 means. Ask a yes/no question and you get a number you can
actually average into a rate.

**Rule 2: give it the input, not just the output.** The judge cannot tell whether
a summary restates the description unless it has the description. Obvious once
said; frequently forgotten.

**Rule 3: define the failure, not the success.** "Is this a good summary?" invites
vibes. "Does this only rephrase the description without naming a problem?" is
answerable.

**Rule 4: anchor with one example of each.** Two short examples cut disagreement
between runs more than any amount of adjectival tuning.

**Rule 5: force structured output.** You already have the machinery —
`.withStructuredOutput()`, exactly as `curateTrending` uses it.

Sketch:

```ts
const JUDGE_PROMPT = `You check whether a one-line repo summary adds information
beyond the repo's own description.

Answer "yes" only if the summary names a problem the repo solves, or a reason a
TypeScript engineer would care. Answer "no" if it only rephrases the description.

Example — description: "A fast bundler." Summary: "A quick bundling tool." -> no
Example — description: "A fast bundler." Summary: "Cuts cold-start build times on
large monorepos where webpack stalls." -> yes`
```

Then a `z.object({ verdict: z.enum(['yes', 'no']), reason: z.string() })` schema,
and `createLlm(0)` — temperature **0** for the judge. You want the judge as stable
as you can get it, even though the thing it is judging is at 0.5.

### 3.3 The ways judge prompts go wrong

In rough order of how often I would expect them to bite you here:

1. **Verbosity bias.** Judges reliably prefer longer answers, even when length adds
   nothing. This is the best-documented judge bias there is, and it is actively
   dangerous for you: your summaries are capped at 140 characters, so the judge is
   biased *against* exactly the concision you require. Mitigation: say in the judge
   prompt that length is not evidence of quality; and cross-check that your judge
   score is not simply tracking `summary.length`. That cross-check is three lines
   of code and I would write it before trusting the judge at all.
2. **Self-preference.** Judges score their own outputs higher. You are running
   `nemotron-3-ultra` as the writer; if you use the same model as judge, expect
   inflation. Your `LLM_FALLBACK_MODELS` already lists `nemotron-3-super-120b` —
   using it as the judge gives you a different model for free. Not a *different
   family*, which would be better, but better than identical.
3. **Position bias** — models favour whichever option came first in a pairwise
   comparison. Only applies if you do A/B comparisons. Since I am steering you to
   single-output yes/no, you dodge it. Mentioning it so you recognise it if you
   later compare two prompt versions head-to-head; the fix is to run both orderings
   and average.
4. **Leniency drift.** A judge with a vague rubric drifts toward "yes" as inputs get
   more varied. Anchoring examples (rule 4) are the cheapest defence.
5. **Judging several things at once.** "Is it concise, useful, and correctly tagged?"
   produces a verdict you cannot act on. One judge, one question.

### 3.4 Calibrate the judge before you believe it

This is the step that separates a judge from a random number generator, and it is
the step everyone skips. It costs you one evening.

1. Take 20 curated summaries from a real run.
2. **You** label each one yes/no by hand, before looking at the judge. Do this in a
   plain file. It is boring. Do it anyway.
3. Run the judge on the same 20.
4. Compare:
   - **True positive rate** — of the ones you said "yes", how many did the judge
     say "yes"?
   - **True negative rate** — of the ones you said "no", how many did the judge say
     "no"?

If both are above ~0.9, the judge is a usable proxy for your taste. If the TNR is
low — the common case — your judge is a yes-machine and its average will look
great regardless of quality. Tighten the rubric, add a harder negative example,
re-run.

If you cannot get it above ~0.8 after two attempts, **drop the judge.** Your
deterministic evals are still working, and a miscalibrated judge is worse than
nothing because it manufactures confidence. I would rather you ship Part 2 and skip
Part 3 entirely than ship an uncalibrated judge.

Re-check calibration whenever you change the judge model. Your `modelKwargs.models`
fallback chain means the judge model can change *without you doing anything* if
OpenRouter rate-limits the primary. Worth knowing.

---

## Part 4 — Building the golden dataset by hand

Part 2 used one day's scrape. That is enough to start and not enough to trust. Here
is how to grow it.

### Step 1 — Collect several days of raw scrapes

Run the Step 2 capture command on several different days — a week apart is better
than a week straight, since trending is dominated by whatever went viral that day.
You want variety, not volume. Five scrapes over a month beats fourteen consecutive
days.

You can also pull from your Neon database, since `saveTrendingRepos` has been
storing every curated repo with `created_at`. That gives you *historical* inputs
plus what the model actually said about them — genuinely useful, and free.

### Step 2 — Select for failure modes, not for count

This is the core skill. Do not take the first 50 rows. Go through the pool and pick
repos that represent *distinct ways the task is hard*:

- a repo with an excellent, specific description (easy case — your control)
- a repo with a pure-marketing description (the `usekaneo/kaneo` case above)
- a repo with an **empty** description — `parseTrendingHtml` defaults to `''`, so
  this happens, and it is the case most likely to make the model hallucinate
- a repo whose description is in Chinese or has heavy emoji
- a 300-character run-on description
- a repo that fits *no* tag in your 13 cleanly (a game engine, a font tool)
- one surging on 4,000 stars/day and one on 30 — the prompt has a "if the repo is
  surging today" clause that only the first exercises

Guidance from the field is 20–50 hand-reviewed items to start, growing to 100–1000
for a full regression set — and consistently, that coverage of distinct failure
modes matters more than raw count. 100 diverse items beat 1000 near-duplicates.
For your workload I would target **25**, and I would rather have 15 well-chosen
than 40 scraped indiscriminately.

### Step 3 — Store it as one file with provenance

```jsonc
{
  "version": 1,
  "captured": ["2026-08-01", "2026-08-08"],
  "cases": [
    { "id": "empty-description",
      "note": "parseTrendingHtml defaults to '' — model must not invent a purpose",
      "repo": { "name": "foo/bar", "description": "", "language": "TypeScript",
                "stars": 900, "todayStars": 120, "url": "https://github.com/foo/bar" } }
  ]
}
```

The `id` and `note` fields are not decoration. When `empty-description` fails in
four months, the note tells you what you were worried about. Without it you will
stare at the row and guess.

### Step 4 — Version it, and never edit in place

Commit it. When you add cases, bump `version` and append. If you *change* an
existing case, you have made every prior score incomparable — so do not, or if you
must, treat it as a new baseline and say so in the commit message.

### Step 5 — Add expected outputs only where they genuinely exist

For most cases you cannot write the right summary. But some cases have a real
expected value: the empty-description case should probably produce tags including
`library` and a summary that does not claim functionality. Where you can state it,
add an `expect` field and let the scorer use it. Where you cannot, leave it out —
do not invent a "reference summary," because you will end up scoring similarity to
your own writing style rather than quality.

---

## Part 5 — Scoring, baselines, and drift

### 5.1 What the numbers mean

For **binary deterministic evals** on this workload, my rough reading — and this is
calibrated to a free-tier model doing constrained generation, not a universal law:

| Score | Reading |
| --- | --- |
| ≥ 0.95 | Working. The constraint is effectively enforced. |
| 0.85–0.95 | Acceptable but leaking. Look at the failures; there is usually one pattern. |
| 0.70–0.85 | The prompt is not carrying the constraint. Fix the prompt, or enforce in code. |
| < 0.70 | The model cannot do this reliably. Move it out of the prompt into code. |

That last row deserves emphasis, because it is the most useful thing evals do for
you. If tag validity sits at 0.6 after two prompt attempts, the answer is not a
third prompt attempt — it is to change `SummarySchema` from `z.array(z.string())`
to `z.array(z.enum([...ALLOWED_TAGS]))` and let structured output enforce it at the
API level. **An eval that stays red is telling you to stop prompting and start
coding.** Frankly, for the tag list specifically, I suspect you will land there,
and it would be a completely legitimate outcome for this whole exercise: the eval's
job was to prove the constraint needed enforcing.

For **judge evals**, be more relaxed. A judged "explains the problem" rate of 0.7
may be fine. Judge scores are noisy and only meaningful relative to your baseline.

### 5.2 Recording a baseline

Simplest thing that works: append one line per run to `evals/history.jsonl`.

```jsonl
{"date":"2026-08-01","eval":"tag_validity","score":0.75,"n":8,"model":"nvidia/nemotron-3-ultra-550b-a55b:free","fixture":"trending-2026-08-01","promptHash":"a1b2c3"}
```

Record `model`, `fixture`, and a hash of the prompt on every row. Without those you
cannot answer "did the score drop because I changed the prompt, or because
OpenRouter fell back to the 120b model?" — and given your `modelKwargs.models`
fallback chain, that question *will* come up.

JSONL over a database: it diffs in git, it is greppable, and you will not maintain a
schema for it. Commit it.

### 5.3 Detecting drift

Three things move under you, and they look identical in the score:

1. **You changed the prompt** — intentional, and you know when.
2. **The provider changed the model** — `:free` model endpoints get re-pointed and
   re-quantised without announcement. This is the main reason to run evals on a
   schedule rather than only when you touch code.
3. **The input distribution changed** — trending in November looks different from
   trending in August. Your *frozen* fixture protects you here, which is precisely
   why it must stay frozen.

Practical rule: run the eval suite weekly on a fixed fixture. When a score drops
more than your measured noise band (Step 9 — probably ~±0.1 at temperature 0.5),
check `promptHash` first; if unchanged, suspect the model.

### 5.4 One thing I am unsure about

Whether it is worth pinning to a non-`:free` model for evals specifically, so that
eval noise does not include provider-side model swapping. It would cost real money
(cents, but non-zero) and would mean you are evaluating a model you do not run in
production — which is arguably the wrong thing to measure. I lean toward *no*,
keep evaluating what you actually ship, and accept noisier numbers. But I do not
think that is clear-cut, and if your weekly numbers turn out to be unreadably
noisy, revisit it.

---

## Part 6 — CI wiring, and the free-tier reality

### 6.1 The constraint that decides the design

OpenRouter's free tier is **20 requests per minute and 50 requests per day**, with
the daily cap rising to 1,000 if you have ever bought $10 of credits. The 20/min
ceiling stays regardless. Failed requests count against the daily quota.

Sit with the 50/day number, because it dictates everything:

- A 25-case golden dataset in **one batched call** (all 25 repos in one prompt) = **1 request**.
- The same dataset **one repo per call** = **25 requests** — half your day, gone.
- Add a judge, one call per repo = **50 requests**. Your entire day, one eval run.

So: **batch, the way production batches.** `curateTrending` already sends all repos
in a single prompt. Your eval should too. That is not a trick to save quota — it is
the correct design, because it matches production shape (§Step 6).

If you want per-repo judging, that is 25 more calls and you must budget for it. My
opinion: run the deterministic evals often and the judge monthly.

### 6.2 Do not put live evals in the per-PR gate

Your `code-quality.yml` runs format, typecheck, test, and Fallow on every PR. That
gate should stay fast and deterministic. Live-model evals in it would mean:

- ~30–60s added to every PR
- a PR blocked because OpenRouter was rate-limiting at that moment
- quota burned by every push, including README typos

The widely-recommended split, and I agree with it: **deterministic checks on every
commit; LLM evals on merge to main or on a schedule.** A flaky gate is worse than
no gate, because it teaches you to ignore red.

### 6.3 What to actually wire

Two things:

**(a) Scorer unit tests into the existing gate.** These are pure and fast. Widen the
`test` script glob so `evals/*.test.ts` runs alongside `src/**/*.test.ts`. Free,
instant, and it stops your eval code from rotting.

**(b) A new scheduled workflow.** Model it on `morning-news.yml` — it already has
the shape you need. Changes:

- `on: schedule` weekly (say `0 22 * * 0`) plus `workflow_dispatch`
- env: `LLM_API_KEY`, plus `LANGSMITH_*` if you want the traces
- run `pnpm eval`
- **no** `DATABASE_URL` or `TELEGRAM_*` — the eval must not write to your DB or
  message your phone. Keep it side-effect free.

Set `continue-on-error: true` initially, or simply do not gate on it. For the first
month you are collecting a baseline, not enforcing one. Turning on a gate before
you know your noise floor produces a red build you learn to ignore, which is the
worst possible outcome.

### 6.4 Later: gate on a delta, not an absolute

Once you have six-plus weeks of `history.jsonl`, the better gate is relative:
*fail if the score drops more than X below the trailing median*, not *fail if
score < 0.85*. Absolute thresholds either sit so low they never fire, or so high
they fire on noise. This is a Phase 3 concern; do not build it now.

### 6.5 Committing eval results from CI

Tempting, and I would not. A workflow that commits to master on a schedule creates
noise and a push-permission surface for a file only you read. Print the numbers to
the workflow log, and append to `history.jsonl` when you run locally. Revisit if
weekly runs become genuinely load-bearing.

---

## Part 7 — Phased rollout

**Phase 1 — this week (~2 hours, ~10 API calls).**
Set up `evals/`, capture one fixture, write `scoreTags` plus its unit tests, write
the runner, run it three times, record the numbers. Stop there. You now know your
tag-validity rate and your noise floor — which is more than you know today, and
already enough to justify a prompt change.

**Phase 2 — next two weeks (~4 hours).**
Add the other three deterministic scorers: summary length, `repo_name` match rate,
per-repo coverage (did all 8 come back?). Same fixture, same runner, one batched
call scores all four. Build the 25-case golden dataset from Part 4. Start
`history.jsonl`. Add the scheduled workflow, ungated.

At the end of Phase 2 you have the thing that actually matters: **a weekly number
that would notice if the trending digest quietly got worse.** If you stop here you
have got 80% of the value, and stopping here is a perfectly good outcome.

**Phase 3 — next month or two, if Phase 2 proves useful.**
The judge from Part 3, *including the 20-item calibration* — the judge without
calibration is not Phase 3, it is a mistake. A retry-rate eval (how often does
`runCuratorGraph` need attempt 2?). Delta-based CI gating.

**Later / maybe never.**
Evaluating `diaryAgent` output. Prompt A/B comparison infrastructure. A hosted eval
platform. Each of these is defensible; none is justified until something in Phase 2
or 3 makes you want it.

---

## Part 8 — What is not worth bothering with

Being explicit about what to *skip* is worth as much as the rest of this document,
because the failure mode for a solo maintainer is not "bad evals," it is "an
elaborate eval setup that goes stale in five weeks."

**Evaluating `githubAgent`.** It has one tool, `runLimit: 1`, and a prompt that says
"return the result as-is." The tool's output is already schema-validated. There is
no meaningful generation to score. `src/tools/github.tool.ts` deserves ordinary
unit tests; it does not deserve evals.

**Evaluating `diaryAgent`'s prose quality.** It writes a report for one reader: you.
You read it every day. You are a better judge than any model, you get the feedback
instantly, and the cost of a mediocre report is a mildly worse diary entry. Building
a judge for this is automating a review you are already doing for free. *Do* keep
the existing scaffold tests around `toKpiRecord` and the save path — the failure
that actually hurts is a report not being saved, and that is codeable.

**Installing an eval framework right now.** promptfoo, Braintrust, DeepEval — all
reasonable tools (§9), all more machinery than a `.eval.ts` file that prints four
numbers. You will not understand your own scores until you have written a scorer by
hand. Adopt a framework when you have a concrete need it fills, and you will know,
because you will find yourself writing its features badly.

**Semantic similarity / embedding scores.** "Is this summary similar to a reference
summary?" sounds rigorous and measures almost nothing here. You have no reference
summaries, and manufacturing them means scoring the model against your prose style.
Skip.

**Generic off-the-shelf metrics** — "helpfulness," "coherence," "toxicity." They are
not grounded in anything your users (you) care about, they move for reasons you
cannot act on, and they give a false sense of coverage. Custom, narrow,
task-specific checks beat generic metrics for a specific application. All four of
your Part 1.7 evals are narrow and specific. Keep them that way.

**Testing the LLM provider.** `failLoudlyOnProviderError` and its nine tests in
`src/agent/llm.test.ts` already cover provider misbehaviour, and they do it without
network calls. Do not re-do that as an eval.

**100% eval coverage of every path.** Four good deterministic evals on the one agent
that runs unattended and sends output to your phone is a *complete* eval strategy
for this repo. Resist the pull toward completeness.

---

## Part 9 — The tool landscape

I looked at these so you can make an informed decision to not use them yet. Dates
are as of **1 August 2026** and this space moves fast.

**LangSmith** — <https://docs.langchain.com/langsmith/evaluation>
Already wired into your repo: `LANGSMITH_TRACING` / `LANGSMITH_API_KEY` /
`LANGSMITH_PROJECT` are in `.env.example` and set in three workflows, and
`notifyError` links to it. It has a real TypeScript `evaluate()` in
`langsmith/evaluation` — evaluators take `{ inputs, outputs, referenceOutputs }`
and return `{ key, score, comment }`, which is deliberately close to the shape I
had you write in Step 4, so migrating later is mechanical. Datasets live on their
platform (`client.createDataset` / `createExamples`).

One thing to know: `langsmith` **is** already in your `node_modules` at 0.7.5, but
only transitively — `@langchain/core` depends on it. If you start importing from it
directly, add it to `package.json` yourself; relying on a transitive dep is how you
get a surprise break on an unrelated upgrade.

Free tier is 5,000 traces/month with 14-day retention, one seat. Fine for you.
**Verdict: mature, already in your stack, the obvious upgrade path.** But the
datasets live in their cloud rather than in git, and for a solo repo I think
version-controlled JSON is better. Adopt when you want the comparison UI.

**promptfoo** — <https://www.promptfoo.dev/docs/getting-started/>
Declarative YAML: `prompts`, `providers`, `tests` with `assert` blocks. Assertion
types include deterministic ones (`contains`, `javascript`, `cost`, `latency`) and
model-graded ones (`llm-rubric`). Runs as `npx promptfoo eval`, no install. Supports
60+ providers including OpenAI-compatible ones, so OpenRouter works. Its real
strength is comparing several prompts or models side by side, and red-teaming
(500+ attack vectors — not relevant to you). Notably, OpenAI now points its own
deprecated-Evals users at promptfoo as the migration path, which is a meaningful
signal about maturity.
**Verdict: mature, and the one I would look at first if you outgrow hand-written
scorers** — specifically when you want to A/B two versions of
`TRENDING_CURATOR_PROMPT`. YAML fits that better than TypeScript.

**Braintrust** — <https://www.braintrust.dev/docs/evaluation>
JS-native. `Eval()` takes data + task + scorers; the companion `autoevals` package
ships exact-match, embedding-similarity and LLM-judge scorers. Free tier: 1 GB
processed data, 10k scores/month, unlimited users.
**Verdict: mature and genuinely good, but it is a hosted platform for teams.** The
collaboration and monitoring features are its value proposition and you are one
person. Overkill today.

**DeepEval** — <https://github.com/confident-ai/deepeval>
60+ metrics, strong CI story, the broadest open-source metric library. But it was
Python-only until a TypeScript port landed around **July 2026** — that is weeks
old at time of writing, non-experimental features only.
**Verdict: mature in Python, brand new in TypeScript.** I would not put a
weeks-old port under a solo maintainer's CI. Revisit in six months.

**Ragas** — <https://docs.ragas.io>
Research-backed retrieval and generation metrics; the canonical specialist for RAG.
Python.
**Verdict: not a fit.** You have no retrieval step. Faithfulness and context-recall
have nothing to attach to. Skip entirely.

**OpenAI Evals** — <https://developers.openai.com/api/docs/guides/evals>
**Being shut down.** Deprecation announced 3 June 2026; read-only from 31 October
2026; full shutdown 30 November 2026, along with Agent Builder and the `/v1/prompts`
API.
**Verdict: do not start here.** Included because it still tops search results and
you would otherwise waste an afternoon on it.

### Sources

- [LangSmith Evaluation docs](https://docs.langchain.com/langsmith/evaluation) · [code evaluators](https://docs.langchain.com/langsmith/code-evaluator) · [langsmith-sdk (JS `evaluate` source)](https://github.com/langchain-ai/langsmith-sdk/blob/main/js/src/evaluation/_runner.ts) · [LangSmith pricing 2026](https://inference.net/content/langsmith-pricing/)
- [promptfoo getting started](https://www.promptfoo.dev/docs/getting-started/) · [regression evals in CI/CD with promptfoo (Jul 2026)](https://medium.com/@alexrodriguesj/testing-llm-prompts-like-code-regression-evals-in-ci-cd-with-promptfoo-5242b4dcb9be)
- [Braintrust evaluation quickstart](https://www.braintrust.dev/docs/evaluation) · [braintrust-sdk-javascript](https://github.com/braintrustdata/braintrust-sdk) · [autoevals on npm](https://www.npmjs.com/package/autoevals)
- [DeepEval](https://github.com/confident-ai/deepeval) · [TypeScript in DeepEval's monorepo](https://deepeval.com/blog/typescript-in-deepeval-monorepo) · [DeepEval vs Ragas](https://deepeval.com/blog/deepeval-vs-ragas)
- [OpenAI evals guide](https://developers.openai.com/api/docs/guides/evals) · [OpenAI API deprecations](https://developers.openai.com/api/docs/deprecations) · [Evals/Agent Builder shutdown, Nov 2026](https://therouter.ai/news/openai-evals-agent-builder-prompts-deprecation-november-2026/)
- [OpenRouter rate limits](https://openrouter.zendesk.com/hc/en-us/articles/39501163636379-OpenRouter-Rate-Limits-What-You-Need-to-Know) · [OpenRouter free tier limits 2026](https://flo2.com/blog/openrouter-free-tier-limits)
- [Hamel Husain — LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/) · [A pragmatic guide to LLM evals for devs](https://newsletter.pragmaticengineer.com/p/evals) · [Langfuse — golden dataset evaluation](https://langfuse.com/resources/engineering/golden-dataset-evaluation)
- [Self-Preference Bias in LLM-as-a-Judge (arXiv 2410.21819)](https://arxiv.org/pdf/2410.21819) · [Judging the Judges: bias mitigation in LLM-as-a-Judge pipelines (arXiv 2604.23178)](https://arxiv.org/pdf/2604.23178) · [A survey on LLM-as-a-judge](https://www.sciencedirect.com/science/article/pii/S2666675825004564) · [LLM-judge calibration](https://deepchecks.com/llm-judge-calibration-automated-issues/)
- [Testing AI agents: validating non-deterministic behavior](https://www.sitepoint.com/testing-ai-agents-deterministic-evaluation-in-a-non-deterministic-world/) · [Your evals are flaky too](https://dev.to/saurav_bhattacharya/your-evals-are-flaky-too-stop-trusting-a-pass-rate-you-cant-reproduce-6pk) · [CI/CD LLM eval with GitHub Actions (2026)](https://futureagi.com/blog/ci-cd-llm-eval-github-actions-2026/)

---

## Where I am least confident

Stating these plainly so you can weigh them rather than take them on faith:

- **The score bands in §5.1** are my calibration for constrained generation on a
  free-tier model, not an established standard. Treat them as a starting point and
  replace them with your own once you have four weeks of history.
- **Batching all 25 golden cases into one call** matches production and saves quota,
  but it means one bad case can drag the others (the model sees them together).
  Splitting into 3 batches of 8 would match production shape more exactly at 3× the
  requests. I lean toward matching production shape; I have not measured the
  difference and you might find it matters.
- **Whether the judge in Part 3 is worth building at all.** I have written it as
  Phase 3 and hedged it heavily. There is a real chance that after Phase 2 you find
  the deterministic evals catch everything you care about, and the honest answer is
  to never build the judge. I would consider that a success, not a shortfall.
- **Where the tag list should live** (§Step 3, options a/b/c). I prefer (b), but not
  strongly.
- **Whether to pin a paid model for evals** (§5.4). Genuinely unresolved.
