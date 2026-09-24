# Real vs. dummy

Architect 2.0 deliberately implements **one slice for real** and mocks the rest
convincingly. This document is the contract: what actually works, what is
theatre, and where the seam is when you want to make a mock real.

## The rule

> Auth + project persistence are real. Everything downstream of "an agent does
> something to your app" is mocked behind a module boundary that a real backend
> could implement without touching a single screen.

## Status table

> The scaffold commit ships the **Supabase slice only**. Paths below describe
> where each capability lives — or will live as screens are built one at a time.
> Anything not yet created is marked *(planned)*.

| Feature                              | Status                | Where it lives / how it works |
| ------------------------------------ | --------------------- | ----------------------------- |
| Google sign-in (OAuth + PKCE)        | **Real**              | Supabase Auth via `app/auth/callback/route.ts` *(planned)* + `lib/supabase/*` |
| Email + password sign-up / sign-in   | **Real**              | Supabase Auth Server Actions *(planned)* |
| Session refresh on every request     | **Real**              | `proxy.ts` → `lib/supabase/proxy.ts` |
| Profiles (name, avatar)              | **Real**              | `profiles` table + auto-create trigger |
| Project list / create / rename / delete | **Real**           | `projects` table + RLS, Server Actions |
| Project membership & roles           | **Real**              | `project_members` + `can_edit_project()` RLS |
| Environment variables                | **Real persistence**  | `project_env_vars` table (values are not encrypted at rest — see note) |
| Chat with the build agent            | **Mocked**            | Scripted responses streamed from `/api/mock/agent/*` route handlers |
| AI code generation                   | **Mocked**            | Hardcoded file trees in `lib/mock/` |
| Agent orchestration graph            | **Mocked**            | `lib/mock/agents.ts` — nodes/edges advance on a deterministic timeline |
| Live preview of the generated app    | **Mocked**            | Fake device frame rendering mock pages; no iframe of a real build |
| "UI getting built" construction state| **Mocked**            | Staged skeleton states driven by the same mock agent timeline |
| GitHub connect / import repo         | **Mocked**            | OAuth-style connect screen + repo picker over `lib/mock/github.ts` |
| Commit history, push changes         | **Mocked**            | Static commit list, fake push progress |
| Build logs                           | **Mocked**            | Streamed canned log lines from `/api/mock/deploy/logs` |
| Deploy to Vercel + live URL          | **Mocked**            | Fake 40s build, deterministic URL derived from project slug |
| Version history / rollback (Time Machine) | **Mocked**       | `lib/mock/versions.ts`; snapshots are mock file trees |
| Usage / cost metering                | **Mocked**            | Derived numbers in `lib/mock/usage.ts` |

## Notes on honesty in the UI

Mocked surfaces are labelled. Screens that simulate a backend show a small
"Simulated" / "Demo data" affordance (and a tooltip explaining that the flow is
scripted) so a reviewer — or a real user — is never misled about what the
product can do today. The exact wording is decided per screen; the rule is:
*mocked, never misleading*.

## Where the mock seam is

```
components/*  →  lib/mock/*  (pure data + a tiny state machine)
              →  app/api/mock/*  (streaming simulation over Server-Sent Events)
```

Nothing in `components/` reaches into Supabase for a mocked domain, and nothing
in `lib/mock/` touches Supabase at all. That means replacing a mock with a real
service is a single-module change: implement the same function signatures in
`lib/agents/`, `lib/github/`, `lib/deploy/` and point the components at it.

## Deliberate limitations

- `project_env_vars.value` is stored in plaintext and protected only by RLS. A
  production build would encrypt values (Supabase Vault) and never send secrets
  to the client.
- Mocked flows do not persist server-side. Refreshing the page resets a running
  agent run; the *project* row and its env vars survive, because those are real.
- The preview is a faithful-looking mock, not a compiled app. It exists to prove
  the flow and the information design, not the compiler.
