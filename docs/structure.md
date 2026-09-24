# Project structure

```
architectv2/
├─ app/                        # Next.js App Router (routes only — thin)
│  ├─ layout.tsx               # fonts, theme provider, metadata
│  ├─ globals.css              # Tailwind v4 + design tokens (@theme inline)
│  ├─ page.tsx                 # landing / marketing
│  ├─ (auth)/                  # sign-in, sign-up, auth error states
│  ├─ auth/callback/route.ts   # Supabase OAuth code exchange (REAL)
│  ├─ (app)/                   # authenticated product
│  │  ├─ layout.tsx            # app chrome: nav, project switcher, lens toggle
│  │  ├─ dashboard/            # project list + new project paths
│  │  └─ projects/[id]/        # chat · preview · agents · github · deploy · settings
│  └─ api/mock/                # scripted streaming endpoints for dummy flows
├─ components/
│  ├─ ui/                      # shadcn/ui primitives (CLI-generated; edits need a comment)
│  ├─ layout/                  # app chrome: nav, sidebars, mode toggle
│  ├─ marketing/               # landing sections
│  ├─ builder/                 # chat interface, preview panel, build stream
│  ├─ agents/                  # orchestration graph + node inspector
│  ├─ github/                  # connect, repo picker, commit history
│  ├─ deploy/                  # deploy review, logs, live status
│  └─ settings/                # model picker, env vars, team
├─ lib/
│  ├─ env.ts                   # safe env access (app boots without credentials)
│  ├─ utils.ts                 # cn() and small shared helpers
│  ├─ supabase/                # browser, server, session-refresh clients + types
│  ├─ mock/                    # ALL mocked data & state machines
│  └─ types/                   # shared domain types for mock + real code
├─ hooks/                      # shared client hooks (use-mobile, …)
├─ docs/                       # vision, real-vs-dummy, design-system, structure
├─ supabase/                   # SQL migrations + setup guide
├─ proxy.ts                    # Next 16 proxy (formerly middleware)
└─ .env.local.example
```

## Conventions

- **Server-first.** Data that comes from Postgres is read in Server Components;
  mutations are Server Actions. Client Components are reserved for interaction
  (streaming chat, drag, canvas).
- **Route groups carry the chrome.** `(app)` owns the authenticated shell,
  `(auth)` owns the centred auth layout; pages never re-implement layout.
- **Every route ships states.** `loading.tsx`, `error.tsx` and an explicit empty
  state component are part of "done" for a screen.
- **Two lenses, one data source.** Components read a `viewMode`
  (`"simple" | "developer"`) from context and vary presentation only — never the
  underlying query or the mock payload.
- **Naming.** Route folders `kebab-case`, components `PascalCase`, hooks
  `use-kebab-case.ts`, mock modules noun-based (`agents.ts`, `deployments.ts`).
- **Imports.** Always via the `@/` alias — no deep relative paths.
- **Secrets.** Only `NEXT_PUBLIC_*` values reach the browser; anything else is
  read inside Server Components, Server Actions or route handlers.
- **Generated code is still our code.** shadcn writes `components/ui/*` and
  `hooks/`; we edit them when a generated default is wrong for us. Example:
  `hooks/use-mobile.ts` was rewritten from the stock implementation (which calls
  `setState` inside an effect and trips React 19's `set-state-in-effect` rule)
  to a `useSyncExternalStore` subscription. Whenever we deviate, the reason is
  recorded in a comment in that file.
- **`components/ui/` is never hand-styled from a screen.** If a primitive needs
  a new look, it gets a variant, not a pile of overrides at the call site.
