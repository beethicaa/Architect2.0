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

## Planned modules (created as each screen is built)

| Module            | Backs                                                       |
| ----------------- | ----------------------------------------------------------- |
| `agents.ts`       | the orchestration graph: nodes, edges, handoffs, models      |
| `build-run.ts`    | the timeline that advances a build (streams, stages, logs)   |
| `generated-files.ts` | mock file trees per template, used by code + preview views |
| `github.ts`       | connect handshake, repo list, commit history                 |
| `deployments.ts`  | environments, build logs, live URLs, redeploys               |
| `versions.ts`     | **Time Machine** checkpoints + "what changed" receipts       |
| `usage.ts`        | tokens/latency/cost signals for the developer lens           |

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
