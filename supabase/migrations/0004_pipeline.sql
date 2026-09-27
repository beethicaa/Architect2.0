-- =============================================================================
-- 0004_pipeline.sql
--
-- The rest of the product, in tables.
--
-- Sections 3-10 of the brief all read or write one of these, so they land
-- together and the app stays demoable between phases:
--
--   project_settings    per-project config: framework, per-agent model overrides
--   project_messages    the chat thread, persisted (Section 4)
--   agent_runs          one row per pipeline run, with all seven agents'
--                       artifacts as JSONB (Sections 5, 9)
--   checkpoints         immutable file snapshots. Restore rewrites project_files
--                       from the snapshot, so a rollback is a real revert and
--                       not a cosmetic scroll-back of the chat (Section 9)
--   deployments         deploy history, each tied to the checkpoint it shipped
--                       (Section 8)
--   github_connections  one OAuth token per user, server-side only (Section 7)
--   notifications       in-app notification centre (Section 10)
--
-- Re-runnable: every statement is IF NOT EXISTS / OR REPLACE / DROP IF EXISTS,
-- because the SQL Editor will happily run this file twice.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- projects gains the columns the later sections need
-- -----------------------------------------------------------------------------
alter table public.projects
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'shared'));

-- The stack the Interface Agent builds in. Nullable because pre-picker projects
-- simply have no choice recorded yet; the builder falls back to its own default.
alter table public.projects
  add column if not exists framework text;

-- GitHub binding for an imported repo. Set by the import flow, not by hand.
alter table public.projects
  add column if not exists repo_full_name text;
alter table public.projects
  add column if not exists repo_branch text;

-- Opaque token for the read-only share link. Null means "not shared".
alter table public.projects
  add column if not exists share_token text;

create unique index if not exists projects_share_token_idx
  on public.projects (share_token)
  where share_token is not null;

-- -----------------------------------------------------------------------------
-- project_settings — one row per project, created with the project
-- -----------------------------------------------------------------------------
create table if not exists public.project_settings (
  project_id      uuid primary key references public.projects (id) on delete cascade,
  -- Per-agent model overrides (Section 5). An absent key means "use the pool
  -- default". This is real: the pipeline reads this before every agent call, so
  -- changing a model in the inspector changes which model actually runs.
  agent_models    jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- project_messages — the persisted chat thread
-- -----------------------------------------------------------------------------
create table if not exists public.project_messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  -- 'you' | 'agent' | 'system' | 'gate'
  role        text not null check (role in ('you', 'agent', 'system', 'gate')),
  -- Which of the seven agents authored it, or null for the user/system.
  agent_key   text,
  body        text not null default '',
  -- The technical phrasing of the same event. Simple mode renders `body`; the
  -- per-message inline switch reveals this. One row, two audiences, no drift.
  technical   text,
  -- Structured payload: tool calls, options for an approval gate, run ids.
  meta        jsonb not null default '{}'::jsonb,
  -- A gate's decision: 'pending' | 'approved' | 'rejected' | 'modified'.
  gate_status text check (gate_status in ('pending', 'approved', 'rejected', 'modified')),
  -- Set on a message that redirects an in-flight run rather than starting a new one.
  is_redirect boolean not null default false,
  run_id      uuid,
  created_at  timestamptz not null default now()
);

create index if not exists project_messages_project_idx
  on public.project_messages (project_id, created_at);

-- -----------------------------------------------------------------------------
-- agent_runs — one row per seven-agent pipeline execution
--
-- The seven artifacts live in one JSONB column rather than seven tables. They
-- are always read and written together, they are never queried across projects,
-- and a per-agent table would mean seven near-identical RLS blocks.
--
-- Keyed by the pipeline's agent keys:
--   planner | researcher | data_schema | data_wiring | interface | reviewer | shipper
--
-- Value shape:
--   { state, model, plain, technical, artifact, startedAt, finishedAt, seconds,
--     tokens, files }
-- -----------------------------------------------------------------------------
create table if not exists public.agent_runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  -- The user's request, verbatim.
  prompt      text not null,
  state       text not null default 'queued'
                check (state in ('queued', 'running', 'done', 'needs-you', 'failed')),
  agents      jsonb not null default '{}'::jsonb,
  -- An approval gate pauses the run here until the user answers (Section 4).
  gate        jsonb,
  -- The plain-language checkpoint description, written by the Reviewer at the end
  -- of the run. Generated, never typed by hand (Section 9).
  receipt     text,
  -- Agent keys in the order they ran, for the timeline.
  sequence    text[] not null default '{}',
  error       text,
  -- Token spend, aggregated across the seven calls.
  tokens      int not null default 0,
  -- Rolling per-minute budget accounting. Kept on the row so a refresh mid-run
  -- does not forget what has already been spent this minute.
  spent_at    jsonb not null default '{}'::jsonb,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_runs_project_idx
  on public.agent_runs (project_id, started_at desc);

-- -----------------------------------------------------------------------------
-- checkpoints — immutable snapshots (Section 9)
--
-- `snapshot` holds every file's path and content at that moment. That is what
-- makes a restore exact: the restore path deletes project_files and rewrites it
-- from the snapshot, so it reverts code, data bindings and UI together.
-- -----------------------------------------------------------------------------
create table if not exists public.checkpoints (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  run_id       uuid references public.agent_runs (id) on delete set null,
  -- Simple mode reads this; the Reviewer writes it.
  label        text not null,
  -- Developer mode reads these.
  commit_sha   text,
  -- Per-agent model record for Developer mode.
  model_summary jsonb not null default '{}'::jsonb,
  -- [{ path, content, language }] — every file as it was at this moment. This
  -- is what makes a restore an actual revert rather than a scroll-back of the
  -- chat transcript.
  snapshot     jsonb not null default '[]'::jsonb,
  -- { filesChanged, linesAdded, linesRemoved, screens }.
  stats        jsonb not null default '{}'::jsonb,
  -- Which agent produced it: pipeline | manual | push | deploy.
  source       text not null default 'pipeline',
  is_head      boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists checkpoints_project_idx
  on public.checkpoints (project_id, created_at desc);

-- Only one head per project. Enforced in the database, not by convention.
create unique index if not exists checkpoints_one_head_idx
  on public.checkpoints (project_id)
  where is_head;

-- -----------------------------------------------------------------------------
-- deployments (Section 8)
-- -----------------------------------------------------------------------------
create table if not exists public.deployments (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  checkpoint_id uuid references public.checkpoints (id) on delete set null,
  environment  text not null default 'production'
                 check (environment in ('preview', 'production')),
  state        text not null default 'queued'
                 check (state in ('queued', 'working', 'done', 'needs-you', 'failed')),
  -- The provider's own deployment id, so a retry can poll instead of redeploying.
  external_id  text,
  url          text,
  -- Real provider log lines, surfaced in the UI rather than invented.
  logs         text[] not null default '{}',
  error        text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index if not exists deployments_project_idx
  on public.deployments (project_id, created_at desc);

-- -----------------------------------------------------------------------------
-- github_connections (Section 7)
--
-- The token is stored here and never leaves the server: the client only ever
-- sees `login` and `scopes`.
--
-- There is deliberately NO select policy. RLS protects rows, not columns, so a
-- select policy that admitted the row would admit the token with it. Every read
-- therefore goes through the service-role client in lib/github/store.ts, which
-- returns only the safe fields.
-- -----------------------------------------------------------------------------
create table if not exists public.github_connections (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  login        text not null,
  avatar_url   text,
  access_token text not null,
  scopes       text[] not null default '{}',
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- notifications (Section 10)
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- 'build' | 'deploy' | 'review' | 'gate'
  kind        text not null,
  title       text not null,
  body        text,
  -- Where clicking it goes.
  href        text,
  project_id  uuid references public.projects (id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

-- =============================================================================
-- RLS
--
-- Every policy leans on the membership helpers from 0001 (`is_project_member`
-- for read, `can_edit_project` for write), so access is decided in exactly one
-- place and a new table cannot accidentally invent a second rule.
-- =============================================================================

alter table public.project_settings enable row level security;
alter table public.project_messages enable row level security;
alter table public.agent_runs enable row level security;
alter table public.checkpoints enable row level security;
alter table public.deployments enable row level security;
alter table public.notifications enable row level security;

-- project_settings ------------------------------------------------------------
drop policy if exists project_settings_select_own on public.project_settings;
create policy project_settings_select_own on public.project_settings
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and public.is_project_member(p.id))
  );

drop policy if exists project_settings_insert_own on public.project_settings;
create policy project_settings_insert_own on public.project_settings
  for insert with check (
    exists (select 1 from public.projects p
            where p.id = project_id and public.can_edit_project(p.id))
  );

drop policy if exists project_settings_update_own on public.project_settings;
create policy project_settings_update_own on public.project_settings
  for update using (
    exists (select 1 from public.projects p
            where p.id = project_id and public.can_edit_project(p.id))
  );

-- project_messages ------------------------------------------------------------
drop policy if exists project_messages_select_own on public.project_messages;
create policy project_messages_select_own on public.project_messages
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and public.is_project_member(p.id))
  );

drop policy if exists project_messages_insert_own on public.project_messages;
create policy project_messages_insert_own on public.project_messages
  for insert with check (
    exists (select 1 from public.projects p
            where p.id = project_id and public.can_edit_project(p.id))
  );

drop policy if exists project_messages_update_own on public.project_messages;
create policy project_messages_update_own on public.project_messages
  for update using (
    exists (select 1 from public.projects p
            where p.id = project_id and public.can_edit_project(p.id))
  );

-- agent_runs ------------------------------------------------------------------
drop policy if exists agent_runs_select_own on public.agent_runs;
create policy agent_runs_select_own on public.agent_runs
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and public.is_project_member(p.id))
  );

drop policy if exists agent_runs_insert_own on public.agent_runs;
create policy agent_runs_insert_own on public.agent_runs
  for insert with check (
    exists (select 1 from public.projects p
            where p.id = project_id and public.can_edit_project(p.id))
  );

-- A run is written continuously while seven agents stream, so the driving client
-- needs update rights. Read-only members can watch but not drive.
drop policy if exists agent_runs_update_own on public.agent_runs;
create policy agent_runs_update_own on public.agent_runs
  for update using (
    exists (select 1 from public.projects p
            where p.id = project_id and public.can_edit_project(p.id))
  );

-- checkpoints -----------------------------------------------------------------
drop policy if exists checkpoints_select_own on public.checkpoints;
create policy checkpoints_select_own on public.checkpoints
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and public.is_project_member(p.id))
  );

drop policy if exists checkpoints_insert_own on public.checkpoints;
create policy checkpoints_insert_own on public.checkpoints
  for insert with check (
    exists (select 1 from public.projects p
            where p.id = project_id and public.can_edit_project(p.id))
  );

-- deployments -----------------------------------------------------------------
drop policy if exists deployments_select_own on public.deployments;
create policy deployments_select_own on public.deployments
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and public.is_project_member(p.id))
  );

drop policy if exists deployments_insert_own on public.deployments;
create policy deployments_insert_own on public.deployments
  for insert with check (
    exists (select 1 from public.projects p
            where p.id = project_id and public.can_edit_project(p.id))
  );

drop policy if exists deployments_update_own on public.deployments;
create policy deployments_update_own on public.deployments
  for update using (
    exists (select 1 from public.projects p
            where p.id = project_id and public.can_edit_project(p.id))
  );

-- notifications ---------------------------------------------------------------
-- Keyed on user_id rather than project membership: a notification is about the
-- person, and survives the project it referred to being deleted.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notifications_insert_own on public.notifications;
create policy notifications_insert_own on public.notifications
  for insert with check (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete using (user_id = auth.uid());

-- =============================================================================
-- Triggers
-- =============================================================================

drop trigger if exists set_updated_at on public.project_settings;
create trigger set_updated_at
  before update on public.project_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.github_connections;
create trigger set_updated_at
  before update on public.github_connections
  for each row execute function public.set_updated_at();

-- New projects get their settings row, so the pipeline never has to handle a
-- missing-config case on a project that was created a second ago.
create or replace function public.create_project_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_settings (project_id) values (new.id)
  on conflict (project_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_project_created_settings on public.projects;
create trigger on_project_created_settings
  after insert on public.projects
  for each row execute function public.create_project_settings();

-- Backfill for projects that existed before this migration ran.
insert into public.project_settings (project_id)
select p.id from public.projects p
on conflict (project_id) do nothing;
