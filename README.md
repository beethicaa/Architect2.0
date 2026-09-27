# Architect 2.0

> **Describe an app in a sentence. Watch a team of seven agents build it, live, in front
> of you. Or hand it a real GitHub repository and let the same team work inside it.**
>
> 🔗 **Live:** https://architect-v2-beethica.vercel.app

---

## The pitch

Every AI app builder in 2026 asks the same question, and every one of them answers it
by choosing an audience.

They pick **non-technical** — so the interface hides code, models and diffs behind
friendly language. The moment the tool works, the user hits a wall: they can't tell
what the agents did, they can't get the result out, and nobody technical can join them.

Or they pick **technical** — so the interface is a chat box with a terminal underneath.
Powerful, and completely closed to the person who had the idea but can't read TypeScript.

Both are wrong, because the two audiences are not different products. They're the
same product answering different questions — and the difference is small enough that
**the honest answer is one product, not two.**

### The idea: a lens, not a fork

Architect 2.0 has a **Simple** view and a **Developer** view over *the exact same
state*. Same data. Same builds. Same agents. Different questions answered.

| | **Simple** | **Developer** |
|---|---|---|
| Entry | "Add a booking page with a calendar" | Same box, plus per-agent model picks |
| Progress | "Building your booking page, 3 of 4" | Which agent, which model, which files |
| Architecture | A friendly picture of the team | The real graph: nodes, edges, models |
| Code | Hidden, but **one click away** | File tree, diffs, per-agent attribution |
| History | "Go back to how it looked before the calendar" | "Revert to `3d5aa890` — the checkpoint before the interface agent ran" |
| Failure | One sentence, one recommended fix | The trace, the agent log, the retry |

Three rules keep this from being two products wearing a coat:

1. **The lens never changes data — only presentation.** Developer view cannot reveal a
   different app than Simple view described. Same row, different question.
2. **Every Simple screen has an escape hatch.** The toggle is not a wall. A
   non-technical user can peek, and a developer can drop back to plain language.
3. **Nothing is hidden to be condescending.** Code is one click away in Simple;
   jargon is one click away in Developer.

> **Where this goes.** The two audiences don't stay separate. The non-technical
> builder *becomes* the developer as their app grows — that's the entire arc of
> "vibe coding". A product that has to choose at the door loses them at the moment
> they outgrow it. A lens lets one person graduate **in place**, which is the only
> path where the person who had the idea is still there when it becomes a product.

---


This was scoped as an assignment. It was built as a product. Every flow below runs end
to end against a real service.

| | Status | Where |
| --- | --- | --- |
| Google sign-in (OAuth + PKCE) | **Real** | `app/auth/callback/route.ts`, `lib/supabase/*` |
| Email + password sign-up / sign-in | **Real** | `lib/actions/auth.ts` |
| Session refresh on every request | **Real** | `proxy.ts` -> `lib/supabase/proxy.ts` |
| Row-level security on every table | **Real** | `migrations/0001`-`0004` |
| Projects, profiles, env vars | **Real** | Postgres + RLS |
| Project membership and roles | **Real** | `project_members` + `can_edit_project()` |
| **The agent team (7 specialists)** | **Real** | `lib/pipeline/run.ts` on Groq, 3 models |
| **The agent tools** | **Real** | `list_files` / `read_file` / `write_file` / `delete_file` / `finish` |
| **The agent workspace** | **Real** | `project_files` in Postgres |
| **The generated app** | **Real** | The model writes real files; you read and run them |
| **The live preview** | **Real** | esbuild + Tailwind v4, compiled in-process |
| **GitHub connect / import** | **Real** | `lib/github/*` - OAuth, tree, file fetch |
| **Deploy to Vercel** | **Real** | `lib/deploy/*` - uploads, polls to READY, returns a URL |
| **Time Machine checkpoints** | **Real** | `lib/pipeline/checkpoints.ts` - a real file snapshot, restorable |

**The only simulated surfaces** are the marketing demo on the landing page and the
dashboard fallback when no database is configured. Both are labelled on screen. There
is no fake data anywhere a real user reaches, and **no fallback agent** - with no API
key the builder says so and refuses to run, because a silent fake is worse than an
honest absence.

**How an agent works** - the same loop an AI coding assistant runs:

```
you type a request
  -> the model streams its reasoning as text (you watch it work)
  -> it emits tool calls: write_file, read_file, delete_file
  -> those tools write real rows into project_files
  -> the preview recompiles those files and the app updates live
  -> the model reads back what it wrote, notices it is wrong, and fixes it
  -> it calls finish when the app works
```

That last step is what makes it an agent rather than a one-shot generator.

Full contract: [`docs/real-vs-dummy.md`](./docs/real-vs-dummy.md).

---

### Try it in 90 seconds

1. Sign in at `/sign-in`
2. On the dashboard, type: *"a barbershop booking page: pick a chair, pick a time, see the day appointments"*
3. Press enter, and do not touch anything

Seven agents take it from there. The Planner decomposes the request, the Researcher
surveys the options, the Data Agent designs and wires the schema, the Interface Agent
writes the screens, a Reviewer audits the result, the Shipper deploys it. The preview
updates on every write; the History tab records each one.

Then press **Publish** and open the URL.

---

## Three things I would argue are the interesting part

### 1. Time Machine - because trust, not capability, is the bottleneck

The number one reason people stop trusting an agentic builder is not that it is bad.
It is that **they cannot tell what it just did**, and asking it to undo that is a coin
flip. So every change is a checkpoint holding a real snapshot of the files, with a
receipt in plain language - and, for developers, the agent run and diff that produced it.

The same feature serves both lenses. Simple gets *"go back to how it looked before the
calendar"*. Developer gets *"revert to `3d5aa890`, the commit before the interface agent
ran"*.

### 2. Repo import that is genuinely import

Importing a repository should mean the code is **there** - not that an agent was asked
to continue inside an empty folder and invent something plausible. Importing a sales
dataset once produced a travel planner, which is the clearest possible statement of the
failure mode. So the tree is read, the files are copied, the entry point is discovered
from what the project *declares* (`index.html`, `package.json`) rather than a hardcoded
list of guesses, and the agent first reads the code and says what it does before
changing anything.

### 3. The preview is a real compiler

Not a screenshot and not a mock frame: **esbuild and Tailwind compiled in the server
process**, from the exact bytes the agents wrote, served as a self-contained document.
That decision paid for itself by surfacing bugs a mock never would - a deployed preview
served a blank page for four rounds because Tailwind package resolution fails inside a
serverless function, and the only way to find that was to test the deployed bundle
rather than the source.

## Quick start

```bash
npm install
cp .env.local.example .env.local
npm run env:check                  # validates the values, then CALLS each service
npm run dev                        # http://localhost:3000
```

The app **boots without any credentials**, so you can look around first. In that mode
the dashboard shows clearly-labelled demo projects and a banner explains that auth is
unconfigured. The builder will refuse to run a build without an agent key rather than
pretending.

### Where the credentials go

`.env.local` lives at the project root. It starts with a dot, so your editor's file
explorer hides it, and it is gitignored on purpose. Press `Ctrl+P` (or `Cmd+P`) and
type `.env.local` to open it.

| Variable | Required for | Where to copy it from |
| -------- | ------------ | --------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` | auth + database | Dashboard -> Project Settings -> API -> **Project URL** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | auth + database | Dashboard -> Project Settings -> API Keys -> **publishable** |
| `GROQ_API_KEY` | the agents | [console.groq.com/keys](https://console.groq.com/keys) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | repo import | GitHub -> Settings -> Developer settings -> OAuth Apps |
| `VERCEL_TOKEN` | deploy | Vercel -> Account Settings -> Tokens |

> Use the *publishable* (or older *anon public*) key - never `service_role`. The
> `service_role` key bypasses row-level security and must never reach the browser.
> `env:check` will tell you if you have pasted the wrong one.

To bring the whole thing up:

1. Create a project at [database.new](https://database.new) (about 30 seconds)
2. Run `supabase/migrations/0001_core_schema.sql` ... through `0006` in the **SQL Editor**, in order
3. Paste the values above into `.env.local`
4. Run `npm run env:check` until it says **READY**, then restart `npm run dev`
5. For GitHub import, add `http://localhost:3000/api/github/callback` as an OAuth
   callback URL - details in [`supabase/README.md`](./supabase/README.md) and below

### Where the credentials go (GitHub OAuth, in detail)

GitHub matches the redirect URI **character for character**, so a host mismatch is the
usual cause of `The redirect_uri is not associated with this application`. Set
`NEXT_PUBLIC_SITE_URL` to the address you are actually browsing from, and register
that same address plus `/api/github/callback` on the OAuth app. Register both
`localhost` and your LAN address and you can work from either.

The app validates this pairing at startup rather than letting you find out at the
The app validates this pairing at startup rather than letting you find out at the callback.
---

## What is verified

| Check | Result |
| ----- | ------ |
| `npm run build` | compiled successfully, proxy registered |
| `npx tsc --noEmit` | no type errors |
| `npx eslint` | 0 errors |
| `npm run env:check` | validates the keys, then calls Supabase, Groq and GitHub |
| Live deployment | every route 200 |
| Live preview | a 61-file monorepo compiles to a 60KB stylesheet and renders |
| Repo import | 61/61 files; entry discovered from the project own `index.html` |
| Deploy | a live URL serving the app and its React runtime |

---


## Project structure
app/            routes: (marketing) (auth) (app) + api/*
  (app)/        the signed-in product - dashboard, projects/[id], settings
  api/          preview, pipeline (NDJSON stream), files, checkpoints,
                deploy, github, repair
components/     builder/ agents/ dashboard/ deploy/ checkpoints/ github/
                marketing/ layout/ states/ ui/ (shadcn)
hooks/          use-pipeline (reconnects to a run in progress), use-view-mode
lib/
  agent/        provider (Groq, streaming, tools), preview (the compiler)
  pipeline/     run.ts (the 7-agent loop), workspace, checkpoints
  deploy/       Vercel REST client + what gets deployed
  github/       OAuth, tree reading, import planning
  supabase/     client, server, proxy, types
  mock/         ONLY the marketing demo - no mock reaches a real user
supabase/       6 migrations + setup guide
scripts/        env:check, react runtime pre-bundle
docs/           product-vision, real-vs-dummy, design-system, structure
proxy.ts        session refresh (Next 16 file convention)
```

Conventions, the "every route ships states" rule, and the reasons behind the
deviations from generated code: [`docs/structure.md`](./docs/structure.md).

- **One accent, earned.** "Volt" marks only what is *alive* - a running agent, an
  unshipped change, a live deploy, the current lens. Everything else stays neutral
  so the accent keeps meaning something.
- **Five status states** (queued - working - done - needs you - failed) are shared
  by the agent graph, build stream and deploy surfaces via one `StatusPill`, so the
  language is learned once.
- **A locked type scale and page rhythm.** The consistency pass found four
  arbitrary rem values in use for the same job, so `app/globals.css` now defines
  the only sizes a screen may use, and `PageShell` is the only container. A screen
  chooses a *width*, never a set of paddings.
- **Real empty, loading, error and success states everywhere.** Empty states teach
  the product; error states propose exactly one fix.
- **Motion means work.** Three animations exist (`live-pulse`, `stream-caret`,
  `shimmer`); nothing else moves, so the UI never performs busyness.
  `prefers-reduced-motion` is respected globally.
- **Light and dark from day one** (`next-themes`, class-based, no flash).

Full rules, token table and component conventions:
[`docs/design-system.md`](./docs/design-system.md).

---
## Stack

**Frontend** Next.js 16 (App Router, Turbopack) - React 19 - TypeScript strict -
Tailwind CSS v4 - shadcn/ui - next-themes
**Backend** Supabase (Postgres, Auth, RLS) - Groq (agent inference) - GitHub REST -
Vercel REST
**Compiler** esbuild - `@tailwindcss/node` + `@tailwindcss/oxide` - a live in-process
build of the generated app
**Deploy target** Vercel

## Scripts

| Script | What it does |
| ------ | ------------ |
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | `prebuild` bundles React, then a production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run env:check` | Validates every credential, then **calls** Supabase, Groq and GitHub to confirm they work. Prints READY or the exact fix. |

`env:check` exists because setup was the most confusing part of building this. It
applies the same rules as `lib/env.ts`, so a pass means the app really will boot
configured - it is a preflight, not a lint.

## Docs

- [`docs/product-vision.md`](./docs/product-vision.md) - the two-audience thesis and the Time Machine rationale
- [`docs/real-vs-dummy.md`](./docs/real-vs-dummy.md) - exactly what works vs. what is scripted
- [`docs/design-system.md`](./docs/design-system.md) - tokens, status vocabulary, component conventions
- [`docs/structure.md`](./docs/structure.md) - folders, conventions, "every route ships states"
- [`supabase/README.md`](./supabase/README.md) - auth + database setup

---

## A note on how this was built

A meaningful share of the time went into bugs that could only be found by testing the
**deployed** artefact rather than the source: a stylesheet that failed to compile
because Tailwind package resolution does not work inside a serverless function, a
deployment that 404'd on the one file its own document imported, an import map
containing `<script>` tags so React was never loaded at all.

Each one passed every local check. The lesson that actually stuck: **a build is not a
test, and "it works on my machine" is a statement about your machine.** What fixed it
was unglamorous - a diagnostic that reports the real failure in plain language instead
of degrading silently, and a test that crosses the deployment boundary.
