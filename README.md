# Architect 2.0

**Describe an app. Watch a team of agents build it. Or bring your own repo and keep shipping.**

Architect 2.0 is a re-imagining of Lyzr's Architect ([architect.new](https://architect.new)).
v1 serves one audience — the non-technical builder. 2.0 serves two, with a single
product: a **non-technical builder** who wants to describe an app and watch it
come together, and a **developer** who wants to import an existing repo and keep
working on it with agents they can actually inspect, configure and deploy.

The mechanic that makes that possible is a **lens, not a fork**: every project
has a Simple view and a Developer view over the exact same state — same data,
different questions answered.

---

## Status: scaffold complete — screens coming next

This commit is the foundation only. No product screens have been built yet.

Done and verified:

- Next.js 16 (App Router) + TypeScript + Tailwind CSS v4, strict mode, `@/*` alias
- shadcn/ui initialised (Radix primitives, `cn` package, token-driven theming)
  with 26 components installed and the Architect 2.0 token system in
  `app/globals.css`
- Supabase wired for SSR: browser client, server client, cookie-based session
  refresh via `proxy.ts` (Next 16's replacement for `middleware.ts`)
- Postgres schema + row-level security for the real slice
  (`supabase/migrations/0001_core_schema.sql`)
- Env handling that lets the app boot with **zero credentials**, because most
  flows are mocked — verified: the proxy logs a warning and passes the request
  through instead of failing
- Product docs: vision, real-vs-dummy contract, design system, structure
  conventions

Verified commands (all green):

```bash
npm run build     # ✓ compiled, TypeScript checked, 4 static pages generated
npx tsc --noEmit  # ✓ no type errors
npm run lint      # ✓ no errors (see note in docs/structure.md re: generated hooks)
npm run dev       # ✓ GET / 200 with no Supabase credentials configured
```

Not built yet (deliberately — one screen at a time): landing page, auth screens,
dashboard, chat/build interface, preview panel, agent graph, GitHub flow, deploy
flow, settings, Time Machine.

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # add your Supabase URL + publishable key
npm run dev                        # http://localhost:3000
```

The app boots **without** Supabase credentials — only the auth/projects slice
needs them. To make that slice fully functional:

1. Create a project at [database.new](https://database.new)
2. Paste `supabase/migrations/0001_core_schema.sql` into the SQL editor
3. Fill in `.env.local` and restart the dev server
4. Enable the Google provider (details in [`supabase/README.md`](./supabase/README.md))

---

## What is real, and what is a convincing dummy

| Real, end-to-end                                          | Mocked, but built to feel real                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| Google sign-in + email/password (Supabase Auth, PKCE)      | AI code generation, streaming agent replies                       |
| Session refresh + protected routes                         | Agent orchestration graph and its live state transitions          |
| Projects: create, list, rename, delete (Postgres + RLS)    | Live preview of the generated app                                 |
| Profiles, project membership/roles, env vars               | GitHub connect, repo import, commits, push                        |
| Team member list (real rows, real RLS)                     | Deploy to Vercel: build logs, live URL, redeploy                  |
|                                                            | Version history / rollback (Time Machine)                          |

The full contract — including the mock seam and honest limitations — lives in
[`docs/real-vs-dummy.md`](./docs/real-vs-dummy.md). Mocked screens carry a small
"Simulated" affordance so nothing is ever misleading.

---

## The two lenses

|                    | **Simple**                                     | **Developer**                                        |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------- |
| Chat               | Plain language, friendly progress              | Model picker, context, agent-plan approval            |
| Build progress     | "3 of 4 steps done"                            | Which agent, tokens, latency, retries, tool calls     |
| Architecture       | What your app *has* (pages, data, integrations) | Nodes, edges, handoffs, prompts, models              |
| Code               | Hidden but peekable                            | File tree, editor, diffs, apply-to-repo               |
| Deploy             | One button → live URL                          | Environment, logs, rollback, GitHub-backed deploys    |

The lens changes presentation only — never the underlying data. See
[`docs/product-vision.md`](./docs/product-vision.md).

## Original addition beyond the brief: **Time Machine**

Every build is a checkpoint: preview it, read a plain-language "what changed"
receipt, restore it. Chosen over a usage dashboard or template gallery because
it attacks the single biggest reason people abandon agentic builders — not
trusting what the agent just did — and it is the same feature read two ways
(undo for non-technical users, revert for developers). Reasoning in
[`docs/product-vision.md`](./docs/product-vision.md#original-addition-time-machine-build-timeline--rollback).


---

## Project structure

```
app/          routes only (route groups carry the chrome)
components/   ui/ (shadcn) + layout/ marketing/ builder/ agents/ github/ deploy/ settings/
hooks/        shared client hooks (use-mobile, more as screens need them)
lib/          env.ts, utils.ts, supabase/, mock/ (all dummy data), types/
docs/         vision · real-vs-dummy · design-system · structure
supabase/     migrations + setup guide
proxy.ts      session refresh (Next 16 file convention)
```

Full tree, conventions and the "every route ships states" rule:
[`docs/structure.md`](./docs/structure.md).

## Design system

- **One accent, earned.** "Volt" marks only what is *alive* — a running agent, an
  unshipped change, a live deploy. Everything else stays neutral so the accent
  keeps meaning something.
- **Five status states** (queued · working · done · needs you · failed) are shared
  by the agent graph, build stream and deploy screens, so the language is learned
  once.
- **Foundation first:** `app/globals.css` holds every token — colour, type,
  radius, motion. Screens consume tokens, never raw hex values.
- **Light and dark from day one** (`next-themes`, class-based, no flash).
- **Motion means work.** Three animations exist (`live-pulse`, `stream-caret`,
  `shimmer`); nothing else moves, so the UI never performs busyness.

Full rules, token table and component conventions:
[`docs/design-system.md`](./docs/design-system.md).

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui ·
Supabase (auth + Postgres) · next-themes · deploy target: Vercel

## Scripts

| Script          | What it does                        |
| --------------- | ----------------------------------- |
| `npm run dev`   | Dev server (Turbopack)              |
| `npm run build` | Production build                    |
| `npm run start` | Serve the production build          |
| `npm run lint`  | ESLint (next/core-web-vitals + TS)  |

## Docs

- [`docs/product-vision.md`](./docs/product-vision.md) — the two-audience thesis and the Time Machine rationale
- [`docs/real-vs-dummy.md`](./docs/real-vs-dummy.md) — exactly what works vs. what is scripted
- [`docs/design-system.md`](./docs/design-system.md) — tokens, status vocabulary, component conventions
- [`docs/structure.md`](./docs/structure.md) — folders and conventions
- [`supabase/README.md`](./supabase/README.md) — auth + database setup
