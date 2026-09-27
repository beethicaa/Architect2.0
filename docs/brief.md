0. Ground Rules (read first, obey throughout)
Do not change the existing layout, visual design, or component structure. The UI shell (nav, colors, typography, spacing, existing pages) is final. You are adding features and wiring functionality inside the existing design language, not redesigning it. If a new feature needs a new screen, match the existing UI kit exactly (same components, same spacing scale, same button/input styles) — copy patterns from existing screens rather than inventing new ones.
This is a dual-audience product. Every feature must work for two distinct users:
Non-technical ("Simple") users — never see code, diffs, commits, or model names unless they explicitly opt in.
Technical ("Developer") users — see the orchestration graph, per-agent model selection, file diffs, commit hashes, environment variables, and repo state. Implement this as a persistent mode toggle (Simple / Developer) stored per-user, not a one-time onboarding choice. The toggle changes how much is shown, not what functionality exists — both modes are backed by the same underlying data/actions.
Everything must be fully functional, not a static mockup. If a backend/API/DB doesn't exist yet for a piece, build the minimal real version (real endpoints, real persistence, real state) rather than hardcoding fake UI state.
Treat this as a production app: loading states, empty states, error states, optimistic UI where relevant, and accessibility (keyboard nav, aria labels, focus states) on every new screen or component.
Work in the phases below, in order. After each phase, the app should be in a working, demoable state — don't leave things half-wired between phases.
1. Product Concept (context for every decision you make)

Architect 2.0 is a vibe-coding platform. A user can:

Describe an app in plain language and watch a team of specialist agents build it live.
Import an existing GitHub repo and have agents work inside it instead of starting fresh.
Build agents in any framework.
Connect GitHub and push branches/commits.
Deploy the app and get a shareable link.
Roll back to any previous checkpoint at any time.

The core trust mechanic of the product: the user is never talking to one black-box chatbot. They're talking to a visible team of specialist agents, each with one job, each inspectable. This graph is the emotional and functional center of the product — build it as a first-class, reusable component, not a one-off animation.

The seven-agent pipeline (fixed order, always):

Planner — reads the request, produces a plan/spec.
Researcher — looks at prior art / similar solutions before generating anything.
Data Agent (schema) — decides what the app needs to remember (data model).
Data Agent (wiring) — connects UI to real, persisted data.
Interface Agent — builds the clickable screens.
Reviewer — tests / tries to break what was built, flags issues.
Shipper — deploys and returns a live link.

Every one of these must produce an inspectable artifact (plan text, research notes, schema, data bindings, UI diff, review findings, deploy URL) that the user can click into — this is what Section 5 (Agent Section) and Section 6 (UI Getting Built) render.

2. Authentication

Build real auth, not a placeholder.

Sign up / log in via email+password and at least one OAuth provider (Google). Use whatever auth solution best fits the existing stack (e.g., NextAuth/Clerk/Supabase Auth/Firebase Auth — pick based on what's already installed; if nothing is installed, choose the lightest-weight option that fits the stack).
On first login, do not force a heavy onboarding wizard. Ask exactly one question that matters for the product: "Do you write code?" → sets the Simple/Developer default mode (user can change it anytime from settings/nav). This is a soft default, not a locked account type — allow switching later.
Persist session securely (httpOnly cookies / secure token storage — whatever matches the existing backend).
Account menu: profile, mode toggle (Simple/Developer), connected accounts (GitHub — see Section 7), logout, delete account.
Handle and surface real error states: wrong password, existing email, OAuth cancellation, network failure — with plain-language copy in Simple mode and technical error detail available (collapsed, expandable) in Developer mode.
3. Homepage

The homepage's job: get the user into a build within one action, while cleanly branching Simple vs Developer paths.

Primary entry point: a single prompt input ("Describe what you want to build...") — this is the Simple-mode default and should be visually dominant.
Secondary entry point, equally discoverable but not competing for primary visual weight: "Import a GitHub repo" — this is the Developer-mode default path. Selecting it walks into the GitHub connect flow (Section 7) then into repo mapping (Section 5's Researcher/Planner acting on an existing codebase instead of a blank one).
Below the fold: Recent projects / checkpoints list — every past build the user has created, with last-edited time, a thumbnail/preview, and status (Building / Live / Needs review / Draft). Clicking one resumes into the Chat Window with full history and the checkpoint timeline (Section 8-adjacent — "Beyond the Brief").
If the user has zero projects: a real empty state with 2–3 example prompts they can click to prefill the input (not fake demo data — clicking one should actually kick off a build).
Mode toggle visible here too, and it should reorder/reframe homepage content: Simple mode leads with the prompt box and plain-language project cards; Developer mode leads with "Connect a repo" and shows commit hash / branch / model-per-agent info on project cards instead of plain-language summaries.
4. Chat Window

This is the main working surface once a build starts.

Standard chat thread (user message / system responses) but each agent's turn is a distinct, labeled message block (avatar/icon + agent name + short status line), not one undifferentiated stream — e.g., "Planner is reading your request...", "Researcher found 3 similar patterns...", "Interface Agent is building the signup screen...".
Each agent message is clickable and opens the relevant panel in the Agent Section (Section 5) — deep-link between chat and the graph.
Plain-language status is mandatory in Simple mode for every single action, even technical ones happening under the hood (e.g., "Setting up your database" instead of "Provisioning Postgres instance"). Maintain a copy dictionary mapping technical actions → plain-language strings; Developer mode can toggle to see the technical string instead via a small inline switch on each message, not a global setting only.
User can interrupt/redirect mid-build ("make it blue instead") — this should be a first-class action, not just a new chat message: show it modifying the current checkpoint rather than looking like an unrelated new request.
Approval gates: when an agent needs a real decision (ambiguous requirement, destructive action, a choice with real tradeoffs), it must pause and present the choice as structured UI (buttons/options), not just ask a question in prose the user has to type back. Non-technical users should never have to "learn anything technical" to say no — a clear Approve / Reject / Modify affordance on any gated decision.
Streaming responses, retry-on-failure, and a way to stop/cancel an in-progress build.
5. Agent Section (the graph)

Build this as its own inspectable, persistent view (not just chat bubbles) — reachable from the Chat Window, from a project's history, and from Developer mode's main nav.

Render the 7-agent pipeline as an interactive node graph: Planner → Researcher → Data Agent (schema) → Data Agent (wiring) → Interface Agent → Reviewer → Shipper, with handoff arrows, and live status per node (queued / running / done / failed).
Click any node → side panel or modal showing exactly what that agent produced:
Planner: the plan/spec it wrote.
Researcher: what patterns/prior art it looked at and why.
Data Agent (schema): the data model it decided on (rendered as a simple table/ER view for Simple mode, real schema/DDL for Developer mode).
Data Agent (wiring): which screens are bound to which data, sample real records.
Interface Agent: the screens it built (link into Section 6's live preview).
Reviewer: issues found, severity, whether auto-fixed or flagged for the user.
Shipper: deploy status and link.
Developer mode adds, per node: a model selector (dropdown of available models — this must actually change which model backs that agent's calls, not be cosmetic) and a "view raw run" option (prompt/response, tokens, latency).
Simple mode shows the same graph but with plain-language labels and no model/config controls — just outcomes.
This graph should be re-viewable historically per checkpoint (see Section 8), not just for the live/current run.
6. UI Getting Built (live preview during generation)
As the Interface Agent works, screens should appear/update in a live preview pane progressively — not a single "done" reveal at the end. If the underlying build system can stream partial UI, wire that in; at minimum, update the preview screen-by-screen as each is completed, with a visible "building this screen now" indicator.
Preview pane must be genuinely interactive (clickable, not a static screenshot) once a screen is marked done, so the user can click around mid-build.
Provide a lightweight in-preview feedback path: hover/select an element → quick action ("change this") that round-trips into the Chat Window as a scoped edit request, not a full re-prompt.
Responsive preview toggle (desktop/tablet/mobile viewport sizes) inside the pane.
Loading and partial-failure states: if one screen fails to build, the rest of the preview should still be usable and the failure should be clearly flagged (Reviewer agent surfaces this), not silently broken.
7. GitHub Integration

Two flows: connect for import (Developer entry point) and connect to push (any build, once it exists).

OAuth connect to GitHub from settings or from the homepage import flow; store the token securely server-side, never client-exposed.
Import flow: list the user's repos (with search/filter), pick one and a branch → Researcher/Planner agents read and map the codebase (real static analysis: file tree, key entry points, detected framework/stack) before any generation happens → summarized for the user (plain-language "Here's what your app does today" for Simple mode; full dependency/structure breakdown for Developer mode).
Push flow: once agents have made changes, Developer mode gets a real diff view (file list + unified diff, syntax highlighted) and can push to a new branch or open a PR directly from the product. Simple mode gets a plain-language change summary with a single "Save these changes to GitHub" action that performs the same push under the hood.
Handle real edge cases: repo too large, private repo permission issues, merge conflicts on push, disconnected/expired token (prompt reconnect, don't silently fail).
Show connection status persistently (connected as @username, repo + branch currently active) somewhere always visible during a build that's tied to a repo.
8. Deploying the App
One-click deploy action from the Chat Window, the Agent Section (Shipper node), and the project's overview page.
Real deployment — integrate with an actual hosting provider/API available in the stack (e.g., Vercel/Netlify/Render — pick based on what fits; if nothing is configured, implement against whichever the project already has credentials/config for, and clearly note in code comments what's needed to go live).
On success: live URL, copy-link action, QR code for quick mobile sharing, and a visible deploy history (timestamp, which checkpoint was deployed, status).
On failure: real error surfaced, Reviewer-style plain-language explanation of what broke, retry action.
Environment variables management (Developer mode: full key/value editor with secrets masked; Simple mode: hidden unless a variable is genuinely required to proceed, in which case ask for it in plain language — e.g., "This needs an email address to send from" rather than "Set SMTP_FROM").
Rollback: redeploy any previous checkpoint's build with one click (ties into Section 9).
9. Checkpoints & Rollback ("Beyond the Brief")

This is a cross-cutting system, not a single screen — implement it as a service every other feature writes to.

Every meaningful change (a completed agent pipeline run, a manual edit, a push, a deploy) creates a checkpoint: an immutable snapshot with enough data to restore to it exactly.
Checkpoint list/timeline UI (accessible from the project view): reverse-chronological, each entry has:
Simple mode: a plain-language one-line description of what changed (e.g., "Sign in with Google added — entries now only show for the person who wrote them"), plus a stat line (screens changed / tables added / etc.), and a Restore button.
Developer mode: the same entry additionally shows commit hash, which agents ran, model used per agent, and files changed — with a Revert to this commit action that's a real git operation when the project is GitHub-connected.
Restoring a checkpoint must actually revert app state/data/UI to that point — not just visually roll back the chat log.
Generate the plain-language checkpoint description automatically (have the Reviewer or a dedicated summarizer step produce it from the diff/plan at the end of each pipeline run) — don't leave this as a manual field.
10. Cross-cutting features to add (things a real platform like this needs beyond the list above)

Implement these as part of the same effort — they're what makes it feel production-grade rather than a demo:

Project settings page per project: name, visibility (private/shared link), delete project, transfer/duplicate.
Usage/limits indicator if the underlying models/deploys are metered (simple usage bar, not raw token counts, in Simple mode; full usage breakdown in Developer mode).
Notifications: build completed, deploy succeeded/failed, review flagged an issue — in-app toast + persistent notification center.
Search across a user's projects and, within a project, across checkpoints.
Framework choice for agent-built apps (per the "build agents in any framework" requirement): expose a framework/stack picker before generation starts (sensible default pre-selected for Simple mode, fully explicit selection required/visible for Developer mode).
Collaboration basics: shareable read-only preview link for any project (for the "quote a client a working prototype" use case), separate from the deploy link.
Global error boundary and offline/reconnect handling — agent runs are long-lived; a dropped connection shouldn't lose build progress.
11. Implementation Notes
Reuse existing components, API patterns, and folder structure. Grep the codebase for existing conventions before adding new files.
Where a real integration (GitHub OAuth, a model provider, a deploy provider) needs credentials that aren't present, implement the full code path and clearly mark the config/env vars needed with comments and a note in your final summary — do not fake the response.
Add loading/error/empty states to every new screen — no feature is "done" without all three.
After each phase (Sections 2 → 10 in order), give a short status summary of what's working end-to-end and what's stubbed pending credentials/config, before moving</user_input>
