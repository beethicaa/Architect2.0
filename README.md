# Architect 2.0

**Describe an app. Watch a team of agents build it. Or bring your own repo and keep shipping.**

Architect 2.0 is a re-imagining of Lyzr's Architect ([architect.new](https://architect.new)).
v1 serves one audience — the non-technical builder. 2.0 serves two, with a single
product: a **non-technical builder** who wants to describe an app and watch it come
together, and a **developer** who wants to import an existing repo and keep working
on it with agents they can inspect, configure and deploy.

The mechanic that makes that possible is a **lens, not a fork**: every project has a
Simple view and a Developer view over the exact same state — same data, different
questions answered.

> This is a hiring assignment. Accounts and project persistence are **real**
> (Supabase). Agent runs, generated code, previews, GitHub sync and deploys are
> **simulated** on purpose, and every screen that simulates something says so.

---

## The product vision

The problem with v1 is not that it works. It is that it works *for exactly one
person*. The moment the tool succeeds, the user hits the wall every vibe-coding
tool hits:

- They can't tell **what** the agents actually did.
- They can't get the result **out** — into a repo, a CI pipeline, a real deploy.
- They can't scale past a prototype, because nobody technical can join them.

Meanwhile the technical audience — developers who already have a repo and long for
agents that work *inside* it — is served by tools that assume you want to live in a
chat box and never see an architecture, a model choice, or a diff.

Architect 2.0 is built on one bet: **it is the same product for both, and the
difference is a lens, not a fork.**

|              | **Simple** lens                      | **Developer** lens                            |
| ------------ | ------------------------------------ | --------------------------------------------- |
| Who it's for | Non-technical builder                | Engineer / technical founder                  |
| Chat         | "Add a booking page with a calendar" | Same box, plus model picker and context files |
| Progress     | "Building your booking page, 3 of 4" | Which agent, tokens, latency, retries        |
| Architecture | A friendly picture of the team       | The real graph: nodes, edges, models, prompts |
| Code         | Hidden but **peekable**, one click   | File tree + diff + apply-to-repo              |
| Deploy       | One button: "Put it online"          | Environments, logs, env vars, rollback        |
| Failure      | Plain language, one recommended fix  | Trace, agent log, retry/reroute               |

Three rules keep this honest, and they are enforced structurally in the code:

1. **The lens never changes data, only presentation.** Switching to Developer view
   cannot reveal a different app than Simple view described.
2. **Every Simple screen has an escape hatch** to its Developer counterpart. The
   toggle is not a wall; a non-technical user can peek and learn.
3. **Nothing is hidden to be condescending** — code is one click away in Simple,
   jargon is one click away in Developer.

See [`docs/product-vision.md`](./docs/product-vision.md) for the full argument.

---

## What''s real, and what''s a convincing dummy

The brief was explicit: one slice real, the rest realistic mocks. The rule:

> Auth + project persistence are real. Everything downstream of "an agent does
> something to your app" is mocked behind a module boundary that a real backend
> could implement without touching a single screen.

| Feature                                  | Status               | Where it lives                              |
| ---------------------------------------- | -------------------- | ------------------------------------------- |
| Google sign-in (OAuth + PKCE)             | **Real**             | `app/auth/callback/route.ts` + `lib/supabase/*` |
| Email + password sign-up / sign-in        | **Real**             | `lib/actions/auth.ts`                       |
| Session refresh on every request          | **Real**             | `proxy.ts` -> `lib/supabase/proxy.ts`       |
| Profiles (name, avatar)                   | **Real**             | `profiles` table + auto-create trigger      |
| Project list / create                     | **Real**             | `projects` table + RLS, Server Actions      |
| Project membership & roles                | **Real**             | `project_members` + `can_edit_project()` RLS |
| Environment variables                     | **Real persistence** | `project_env_vars` table                    |

### Real

| Area | Status | Where |
| --- | --- | --- |
| Auth (Google + email/password) | **Real** | Supabase, `lib/actions/auth.ts` |
| Projects, profiles, env vars | **Real** | Postgres + RLS, `migrations/0001_core_schema.sql` |
| **The build agent** | **Real** | Anthropic Messages API with tool use, `lib/agent/run.ts` |
| **The agent's tools** | **Real** | `list_files` / `read_file` / `write_file` / `delete_file` / `finish` |
| **The agent's workspace** | **Real** | `project_files`, `migrations/0002_project_files.sql` |
| **The generated app** | **Real** | The model writes real files; you read them and run them |
| **The live preview** | **Real** | esbuild + Tailwind compile the real files into a sandboxed iframe |

### Mocked

| Area | Status | Why |
| --- | --- | --- |
| Agent-team diagram (landing page) | **Mocked** | `lib/mock/agents.ts`. Describes the work; the runtime is one Claude session, not six agents. |
| GitHub connect / push | **Mocked** | `lib/mock/github.ts`. Shaped like the real API, waiting for a token. |
| Deploy to Vercel | **Mocked** | No deployment is made. |
| Time Machine checkpoints | **Mocked** | `lib/mock/versions.ts`. The real rollback data is the `version` column the agent increments. |

**There is no fallback agent.** With no `ANTHROPIC_API_KEY` the builder says so
and refuses to run, because a silent fake is worse than an honest absence. That
is the whole mocked list.

**How the agent works** — the same loop an AI coding assistant runs:

```
you type a request
  -> Claude streams its reasoning as text (you watch it work)
  -> Claude emits tool calls: write_file, read_file, delete_file
  -> those tools write real rows into project_files
  -> the preview recompiles those files and the app updates live
  -> Claude sees the result and can correct itself on the next turn
  -> it calls finish when the app works
```

That last step is what makes it an agent rather than a one-shot generator: it can
read back what it wrote, notice it is wrong, and fix it.

**Where the seam is:**
```
components/*  ->  lib/mock/*        (data + a tiny deterministic state machine)
              ->  app/api/mock/*    (where a real backend would be plugged in)
```

Nothing in `components/` reaches into Supabase for a mocked domain, and nothing in
`lib/mock/` touches Supabase at all. Swapping a mock for a real service is a
single-module change. Full contract: [`docs/real-vs-dummy.md`](./docs/real-vs-dummy.md).

**Why this matters for the review:** the mock timeline is *deterministic* - a fixed
list of eight steps advances on one clock that the chat, the graph, the preview and
the code panel all read. Those four surfaces therefore cannot disagree about how
far along the build is, and a reviewer sees an identical build every time.

---

## Original addition: **Time Machine**

Beyond the brief''s feature list, Architect 2.0 adds a **build timeline with
rollback**. Every build is a checkpoint: preview it, read a plain-language "what
changed" receipt, restore it.

Chosen over a usage dashboard or a template gallery because:

- It attacks the **#1 trust problem** in agentic building. When an agent run makes
  things worse, the only recovery today is to prompt again and hope - which is
  exactly when people stop trusting the tool.
- It is the **same feature for both audiences**, like everything else: Simple =
  "go back to before it looked like this"; Developer = "revert this agent''s commit".
- It makes the app **feel like an app** rather than a chat with a preview.

Justification is also recorded in code at `lib/mock/versions.ts` and
[`docs/product-vision.md`](./docs/product-vision.md).

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # only needed for the real auth + database
npm run env:check                  # tells you exactly what is missing
npm run dev                        # http://localhost:3000
```

The app **boots and every screen works without Supabase credentials** - because
most flows are mocked. In that mode the dashboard shows clearly-labelled demo
projects and a banner explains that auth is unconfigured.

### Where the credentials go

`.env.local` **already exists** at the project root. It is invisible in the VS Code
explorer because the filename starts with a dot, and it is gitignored on purpose.
To open it, press `Ctrl+P` (or `Cmd+P`) and type `.env.local`.

It needs exactly two values:

| Variable | Where to copy it from |
| -------- | --------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard -> Project Settings -> API -> **Project URL** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Dashboard -> Project Settings -> API Keys -> **publishable** |

> Use the *publishable* (or older *anon public*) key - never `service_role`. The
> `service_role` key bypasses row-level security and must never reach the browser.

To make the real slice fully functional:

1. Create a project at [database.new](https://database.new) (takes ~30 seconds)
2. Paste `supabase/migrations/0001_core_schema.sql` into the **SQL Editor** and run it
3. Paste the two values above into `.env.local`
4. Run `npm run env:check` until it says **READY**, then restart `npm run dev`
5. Enable the Google provider - details in [`supabase/README.md`](./supabase/README.md)

`npm run env:check` exists because this was the most confusing part of setting the
project up: it validates the values, catches a pasted `service_role` key, and actually
calls Supabase to confirm the pair works. It applies the same rules as `lib/env.ts`,
so a pass means the app really will boot configured.

### Verified

| Check | Result |
| ----- | ------ |
| `npm run build` | compiled, TS checked, 8 routes, proxy registered |
| `npx tsc --noEmit` | no type errors |
| `npx eslint app components lib hooks` | no errors or warnings |
| `npm run env:check` | validates keys and calls Supabase to confirm |
| Runtime smoke test (production) | all 7 routes return 200 and render real content |

### Verified

| Check                                 | Result                                             |
| ------------------------------------- | -------------------------------------------------- |
| `npm run build`                       | compiled, TS checked, 8 routes, proxy registered  |
| `npx tsc --noEmit`                    | no type errors                                     |
| `npx eslint app components lib hooks` | no errors or warnings                              |
| Runtime smoke test (production)       | all 7 routes return 200 and render real content    |

---

## Project structure

```
app/          routes only (route groups carry the chrome)
components/   ui/ (shadcn) + layout/ marketing/ builder/ agents/ dashboard/ states/
hooks/        shared client hooks (use-build-clock, use-mobile)
lib/          env.ts, utils.ts, supabase/, mock/ (all dummy data), types/
docs/         vision - real-vs-dummy - design-system - structure
supabase/     migrations + setup guide
proxy.ts      session refresh (Next 16 file convention)
```

Conventions, the "every route ships states" rule, and the reasons behind the
deviations from generated code: [`docs/structure.md`](./docs/structure.md).

---

## Design system

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

Next.js 16 (App Router) - TypeScript (strict) - Tailwind CSS v4 - shadcn/ui -
Supabase (auth + Postgres) - next-themes - deploy target: Vercel

## Scripts

| Script          | What it does                        |
| --------------- | ----------------------------------- |
| `npm run dev`   | Dev server (Turbopack)              |
| `npm run build` | Production build                    |
| `npm run start` | Serve the production build          |
| `npm run lint`  | ESLint (next/core-web-vitals + TS)  |
| `npm run env:check` | Validate Supabase env vars before you start |

## Docs

- [`docs/product-vision.md`](./docs/product-vision.md) - the two-audience thesis and the Time Machine rationale
- [`docs/real-vs-dummy.md`](./docs/real-vs-dummy.md) - exactly what works vs. what is scripted
- [`docs/design-system.md`](./docs/design-system.md) - tokens, status vocabulary, component conventions
- [`docs/structure.md`](./docs/structure.md) - folders, conventions, "every route ships states"
- [`supabase/README.md`](./supabase/README.md) - auth + database setup
