# Design system

Every rule here exists to answer one question fast: *this is the two-audience
product — who is looking at this screen, and what does the other person need
instead?* Tokens live in `app/globals.css`; nothing in a screen uses a raw hex
value.

## The five rules

1. **One accent, earned.** Volt marks what is *alive*: a running agent, an
   unshipped change, a live deploy, the current selection. Everything else is
   neutral. If two things on a screen are volt, one of them is wrong.
2. **Hierarchy comes from space, not borders.** Prefer whitespace and type size
   to dividers and boxes. Add a border only to create a container that means
   something (a card, a panel, a table).
3. **Motion means work.** If nothing is being computed, nothing moves.
4. **Real states always.** Empty, loading, error and success are designed, not
   defaulted. Empty states teach; error states propose exactly one fix.
5. **The lens changes presentation, never data.** Simple and Developer views
   render the same numbers, worded for different readers.

## Colour

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `background` | `oklch(0.985 0.002 106)` | `oklch(0.16 0.005 264)` | page canvas |
| `card` / `popover` | `oklch(1 0 0)` | `oklch(0.195 / 0.21 ...)` | raised surfaces |
| `foreground` | `oklch(0.185 0.006 264)` | near-white | primary text |
| `muted-foreground` | `oklch(0.52 0.01 264)` | `oklch(0.7 0.01 264)` | secondary text, meta |
| `primary` | ink | near-white | the one primary action per view |
| `border` / `input` | `oklch(0.908 0.004 264)` | `white / 12%` | structural edges |
| `volt` | `oklch(0.87 0.19 122)` | `oklch(0.89 0.2 122)` | alive/active fill |
| `volt-foreground` | dark green-ink | dark green-ink | text *on* volt |
| `volt-ink` | `oklch(0.48 0.13 124)` | `oklch(0.9 0.17 122)` | volt text/icons on canvas |
| `volt-muted` | `oklch(0.95 0.06 122)` | `oklch(0.3 0.06 124)` | volt wash, hover, glow |
| `success` / `warning` / `info` / `destructive` | — | — | the five status states |

**Contrast rule:** volt is a *fill*, never small text on a light canvas. Use
`text-volt-ink` for that, `bg-volt text-volt-foreground` for solid fills, and
`bg-volt-muted` for washes.

## Status vocabulary (used by agents, builds, deploys)

| State | Token | Meaning |
| --- | --- | --- |
| queued | `info` | accepted, not started |
| working | `volt` + `animate-live-pulse` | an agent/deploy is running |
| done | `success` | finished successfully |
| needs you | `warning` | waiting on a human decision |
| failed | `destructive` | stopped, with a fix offered |

Same five states everywhere means a user learns the language once.

## Type

Geist (sans) + Geist Mono (code, ids, keys, diffs) via `next/font`.

| Role | Class | Note |
| --- | --- | --- |
| Display | `text-3xl sm:text-4xl font-medium tracking-tight text-balance` | marketing only, one per screen |
| Section title | `text-lg font-medium` | card/section headers |
| Body | default `text-sm` / `text-base leading-relaxed` | copy is ≤ 72ch (`max-w-prose`) |
| Meta | `text-xs text-muted-foreground` | timestamps, ids, counts |

Mono is a *signal*: if it's monospaced it is literal (a path, a commit, a token
count). Never use mono for prose.

## Space, radius, elevation

- 4px base scale; card padding is the shadcn `--card-spacing` (16px / 12px small).
- Section rhythm: 24px inside a group, 40px between groups, 64px+ between
  marketing sections. Whitespace is the primary layout tool.
- Radius: `--radius: 0.625rem` with the derived `sm → 4xl` scale. Pills
  (`rounded-4xl`) are reserved for status badges and toggles.
- Elevation is one ring (`ring-1 ring-foreground/10` on cards), not stacked
  shadows. Only floating layers (popover, dialog, command) get a shadow.

## Motion

| Token | Used for |
| --- | --- |
| `animate-live-pulse` | a small dot that means "running right now" |
| `animate-stream-caret` | text streaming in from an agent |
| `animate-shimmer` | a skeleton becoming real |

150–200ms for UI transitions, 2–2.4s for looping "alive" indicators.
`prefers-reduced-motion` is respected globally in `globals.css`.

## Component conventions

- **Button hierarchy:** one `default` (primary) per view; `outline` for
  secondary; `ghost` for toolbars and icon actions. `destructive` never sits
  next to the primary action.
- **Badge:** status and counts only. If it needs a verb, it's a Button.
- **Card:** a single idea. Nested cards are a smell — use a labelled section.
- **Sheet:** any panel on a viewport narrower than `lg` (the builder is
  desktop-first, the dashboard is not).
- **Command:** every "choose one of many" moment (project switcher, repo picker,
  model picker) so keyboard users are first-class.
- **Resizable:** the builder split (chat ↔ preview ↔ agents).
- **Sonner (Toaster):** confirms fire-and-forget actions ("Deployed",
  "Invite sent"). Blocking flows use inline states instead.

## The two lenses in the UI

The lens is a single control in the app chrome that swaps presentation:

| | Simple | Developer |
| --- | --- | --- |
| Language | what happened, in plain words | what ran, with numbers |
| Density | one message per idea | tool calls, tokens, latency, retries inline |
| Code | hidden behind "show me the code" | file tree + diff open by default |
| Errors | one recommended fix | trace, agent log, retry/reroute |

Concretely: components take a `viewMode` and vary *copy, density and default
expansion* — never the query, never the payload.

## Accessibility

- Focus is always visible (`focus-visible:ring-3` with `ring` token).
- Interactive targets ≥ 32px; the compact shadcn sizes are for dense toolbars,
  not primary actions.
- Status is never colour-only: every dot ships with a label.
- Dark and light are both first-class — check new screens in both.
