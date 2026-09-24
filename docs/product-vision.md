# Architect 2.0 — product vision

> Describe an app in plain language. Watch an agent team build it. Or bring your
> own repo and keep shipping with agents that already understand it.

## The problem with v1

Today's Architect serves exactly one person: the non-technical builder who has an
idea, no repo, and no intention of reading code. That's a great wedge, and it's
also a ceiling. The moment the product works, the user hits the wall that every
"vibe-coding" tool hits:

- They can't tell **what** the agents actually did.
- They can't get the result **out** (into a repo, a CI pipeline, a real deploy).
- They can't scale past a prototype, because nobody technical can join them.

Meanwhile the technical audience — developers who already have a repo and long
for agents that can work *inside* it — is served by tools that assume you want to
live in a chat box and never see an architecture, a model choice, or a diff.

Architect 2.0 is built on one bet: **it is the same product for both, and the
difference is a lens, not a fork.**

## The central mechanic: one project, two lenses

Every project has two views of the same underlying state:

|                | **Simple** lens                                                                 | **Developer** lens                                                              |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Who it's for   | Non-technical builder                                                           | Engineer / technical founder                                                     |
| Chat           | "Add a booking page with a calendar"                                            | Same box, plus model picker, context attachments, agent-plan approval           |
| Progress       | "Building your booking page… 3 of 4 steps"                                      | Which agent is running, tokens, latency, retries, tool calls                     |
| Architecture   | A friendly picture of what the app *has* (pages, data, integrations)            | The real orchestration graph: nodes, edges, handoffs, models, prompts            |
| Code           | Hidden but *peekable* — a "show me the code" affordance, never a requirement    | Full file tree, editor, diff view, "apply to repo"                               |
| Deploy         | One button: "Put it online" → live URL                                          | Build logs, environments, env vars, rollback, GitHub-backed deploys              |
| Failure states | Plain language + one recommended fix                                            | Stack traces, agent logs, retry/reroute the agent that failed                    |

Rules that keep this honest:

1. **The lens never changes data, only presentation.** Switching to Developer
   view cannot reveal a different app than Simple view described.
2. **Every Simple screen has an escape hatch to its Developer counterpart.** The
   toggle is not a wall; the non-technical user can peek and learn.
3. **Nothing is hidden to be condescending** — code is one click away in Simple
   view, jargon is one click away in Developer view.

## Why the agent architecture view is the signature feature

"For non-technical users" tools die at trust. The single most valuable thing
Architect 2.0 can show a nervous builder is *why* the app does what it does. A
live graph of the agent team — planner → schema → API → UI → reviewer, with each
node's state, model, and outputs — turns an opaque magic box into something the
user can reason about, point at, and screenshot when asking for help.

For developers that same graph becomes the control surface: swap a model on the
API agent, add a node, change a handoff, inspect the prompt that produced a file.

One visualisation, two readings. That's the whole thesis of 2.0 in one screen.

## Original addition: **Time Machine** (build timeline + rollback)

Every build is a checkpoint. The user gets a timeline of the app's history —
"Add booking page", "Switch auth to Google", "Fix date picker bug" — where any
point can be previewed and restored, and every entry carries a plain-language
"what changed" receipt plus (in Developer view) the agent run and diff that
produced it.

Why this, over a usage/cost dashboard or a template gallery:

- It attacks the **#1 trust problem** in agentic building. When an agent run
  makes things worse, the only recovery today is to prompt again and hope. That
  is why people stop trusting the tool.
- It's the **same feature for both audiences**, exactly like everything else:
  Simple = "go back to before it looked like this"; Developer = "revert this
  agent's commit".
- It makes the app **feel like an app** rather than a chat with a preview: real
  products have history.
- It composes with the rest: deploys can reference a checkpoint, the agent graph
  can be replayed for any checkpoint, GitHub sync becomes an export of the same
  history.

Justification is also recorded in code at `lib/mock/README.md` as the mock data
for the feature is created (see docs/real-vs-dummy.md).

## Design principles

- **Calm, dense-on-demand.** Generous whitespace and one accent; density is
  opt-in via the Developer lens.
- **One accent, earned.** A single "volt" accent colour marks the thing that is
  alive — a running agent, an unsaved change, a live deploy. If everything is
  accented, nothing is.
- **Real states, always.** Every screen ships its empty, loading, error and
  success states. Empty states teach the product; error states propose one fix.
- **Motion means work.** Animation is reserved for genuine progress (streaming
  text, an agent moving between states) so it never lies to the user.
- **Desktop-first workspace, responsive by default.** The builder is a
  large-screen tool; the dashboard, landing page and settings are fully
  responsive.
