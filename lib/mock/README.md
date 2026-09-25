# lib/mock — the dummy seam

Every mocked flow in Architect 2.0 lives here, and nothing in `components/`
reaches around it. The files in this folder are **pure data + tiny deterministic
state machines**: no network, no Supabase, no randomness the UI has to guess at.

```
components/*  →  lib/mock/*            (data + state)
              →  app/api/mock/*        (streams that data to the client)
```

## Why a seam at all

The brief is explicit: auth and project persistence are real, everything
downstream of "an agent does something" is theatre. Putting the theatre behind
one folder means the components never learn whether a value came from Postgres
or from a hardcoded array — so swapping in a real agent service later is a
single-module change and no screen has to be rewritten.

## Where the mock line actually sits

The important correction, and the one worth reading twice.

The brief said "AI code generation should be a convincing dummy flow". The first
implementation took that to mean *static output*: a heading, three hardcoded
rows, and a `<span>` painted to look like a button. A reviewer could look at the
generated app but never touch it — which is the one thing a vibe-coding platform
cannot be.

So the line was moved. **The intelligence is mocked. Everything it produces is
real.**

| Layer | Real? | Where |
| --- | --- | --- |
| Auth, projects, DB | **Real** | Supabase |
| The generated app's behaviour | **Real** | `app-runtime.ts` |
| The chat's effect on that app | **Real** | `intents.ts` |
| The agent reasoning that chose it | Mocked | keyword intent table |
| Generated source files | Mocked | `generated-files.ts` |
| GitHub, deploys, models | Mocked | `github.ts`, `build-run.ts` |

Concretely, in the preview you can add a record through a validating form, tick
it off, search it, delete it, open it, and change settings — and those changes
persist for the session. Typing "add a mood score" into the chat adds a real
mood picker, a real column in the generated migration, and a real average in the
stats panel.

What is faked is the part that would need a model: deciding *that* a mood score
is what you meant, and writing the `.tsx` for it. `npm run env:check` asserts
both halves — that the suggestions parse, and that the resulting app state is
actually correct.


The first version hardcoded one clinic-booking app into the preview, the
generated code, the build log and the version history. Every prompt therefore
produced the same booking screen, which contradicted the product's entire pitch.

`app-templates.ts` now classifies the prompt (keyword scoring, deterministic) and
supplies the screens, data model, file list and copy for that kind of app. The
other modules take a `prompt` argument and derive from it:

| Module           | Function                      | Follows the prompt? |
| ---------------- | ----------------------------- | ------------------- |
| `app-templates.ts` | `templateFor(prompt)`       | source of truth     |
| `build-run.ts`   | `planFor(prompt)`            | step details + files |
| `generated-files.ts` | `allGeneratedFiles(prompt)` | paths + content    |
| `versions.ts`    | `versionsFor(prompt)`        | receipts + files    |
| `github.ts`      | `commitsFor(prompt)`         | commit messages     |

`GITHUB_REPOS` stays fixed on purpose: those are the real repositories a
developer might import and have nothing to do with a prompt.

`npm run env:check` asserts the five agree, so a hardcoded leftover fails the
check rather than shipping.


## Modules

| Module               | Backs                                                          | Mocked? |
| -------------------- | -------------------------------------------------------------- | ------- |
| `app-templates.ts`   | classifies the prompt into an app kind, supplies screens, data model, files, copy | derived |
| `app-runtime.ts`     | **the generated app itself** — state, reducer, search, stats, streak | **no** |
| `intents.ts`         | parses a follow-up sentence into a change, with a plan and a receipt | reasoning only |
| `agents.ts`          | the orchestration graph: nodes, edges, handoffs, models         | yes |
| `build-run.ts`       | the timeline that advances a build (streams, stages, logs)      | yes |
| `generated-files.ts` | the source files the agents would have written                  | yes |
| `github.ts`          | connect handshake, repo list, commit history                    | yes |
| `versions.ts`        | **Time Machine** checkpoints + "what changed" receipts          | yes |
| `deployments.ts`     | environments, build logs, live URLs, redeploys (planned)        | yes |
| `usage.ts`           | tokens/latency/cost signals for the developer lens (planned)    | yes |

`app-runtime.ts` and `intents.ts` are the two that are *not* fake. They are
listed here because they live in the same folder and are the seam where a real
agent would be substituted: replace `interpret()` with a model call, and the
`AppState` reducer keeps working unchanged.

## The original addition: Time Machine (`versions.ts`)

Beyond the feature list, Architect 2.0 adds a build timeline with rollback.
Chosen because the #1 failure mode of agentic builders is *"I don't trust what it
just did, and I can't undo it"*: prompting again is the only recovery, which is
exactly when users stop trusting the tool.

It is also the clearest expression of the 2.0 thesis — one feature, two lenses:

- **Simple lens:** "Go back to before it looked like this" — a preview thumbnail
  of the app at that moment, one button to restore.
- **Developer lens:** the agent run that produced the checkpoint, the files it
  touched, and a revert that maps onto a commit.

This comment is the justification recorded in code, as promised in
[docs/product-vision.md](../../docs/product-vision.md).
