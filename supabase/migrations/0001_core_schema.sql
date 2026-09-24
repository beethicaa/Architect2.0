-- ============================================================================
-- Architect 2.0 — core schema
--
-- This is the ONE slice of the product that is REAL and works end-to-end:
-- Supabase auth (Google + email/password) and Postgres persistence for
-- profiles, projects, project membership and environment variables.
--
-- Everything else (agent orchestration, generated code, GitHub sync, app
-- deployments) is a mocked flow — see docs/real-vs-dummy.md.
--
-- Apply it either with the Supabase CLI:
--     supabase link --project-ref <ref> && supabase db push
-- or by pasting this file into the Supabase Dashboard → SQL Editor.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles — 1:1 with auth.users, created automatically on sign-up
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- projects — the dashboard list
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  name           text not null check (char_length(btrim(name)) > 0),
  description    text,
  -- The original natural-language brief ("a booking app for my clinic").
  prompt         text,
  origin         text not null default 'prompt' check (origin in ('prompt', 'import')),
  repo_full_name text,                                  -- GitHub "owner/repo"
  framework      text,
  status         text not null default 'draft'
                 check (status in ('draft', 'building', 'ready', 'deployed', 'archived')),
  accent         text not null default 'volt',          -- per-project identity colour
  last_opened_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists projects_owner_updated_idx
  on public.projects (owner_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- project_members — collaboration (roles are enforced by RLS below)
-- ---------------------------------------------------------------------------
create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- project_env_vars — the "Settings → Environment variables" screen
-- Note: in a production build values would be encrypted at rest (Vault);
-- for this assignment they are readable by project members only.
-- ---------------------------------------------------------------------------
create table if not exists public.project_env_vars (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  key        text not null check (char_length(btrim(key)) > 0),
  value      text not null default '',
  target     text not null default 'all'
             check (target in ('development', 'preview', 'production', 'all')),
  is_secret  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, key, target)
);

-- ---------------------------------------------------------------------------
-- Shared helpers
--
-- `security definer` matters here: policies on project_members need to ask
-- "is the current user a member?" without recursing into their own RLS.
-- ---------------------------------------------------------------------------
create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.project_members m
    where m.project_id = p_project_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_project(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.owner_id = auth.uid()
  ) or exists (
    select 1
    from public.project_members m
    where m.project_id = p_project_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'editor')
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: profile on sign-up, owner membership, updated_at bookkeeping
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Every project has its creator as an 'owner' member, so the Team screen and
-- the membership policies agree from the very first row.
create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (project_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists env_vars_touch_updated_at on public.project_env_vars;
create trigger env_vars_touch_updated_at
  before update on public.project_env_vars
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — nothing is readable across accounts
-- ---------------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.projects         enable row level security;
alter table public.project_members  enable row level security;
alter table public.project_env_vars enable row level security;

-- profiles ------------------------------------------------------------------
create policy "profiles_select_self"
  on public.profiles for select
  using (id = auth.uid());

-- Collaborators may see each other's name/avatar (used by Settings → Team).
create policy "profiles_select_teammates"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.project_members me
      join public.project_members them on them.project_id = me.project_id
      where me.user_id = auth.uid()
        and them.user_id = profiles.id
    )
  );

create policy "profiles_insert_self"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- projects ------------------------------------------------------------------
create policy "projects_select_own_or_member"
  on public.projects for select
  using (owner_id = auth.uid() or public.is_project_member(id));

create policy "projects_insert_own"
  on public.projects for insert
  with check (owner_id = auth.uid());

create policy "projects_update_editor"
  on public.projects for update
  using (public.can_edit_project(id))
  with check (public.can_edit_project(id));

create policy "projects_delete_owner"
  on public.projects for delete
  using (owner_id = auth.uid());

-- project_members -----------------------------------------------------------
create policy "members_select_member"
  on public.project_members for select
  using (user_id = auth.uid() or public.is_project_member(project_id));

create policy "members_insert_editor"
  on public.project_members for insert
  with check (public.can_edit_project(project_id));

create policy "members_update_editor"
  on public.project_members for update
  using (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

create policy "members_delete_editor"
  on public.project_members for delete
  using (public.can_edit_project(project_id));

-- project_env_vars ----------------------------------------------------------
create policy "env_vars_select_member"
  on public.project_env_vars for select
  using (public.is_project_member(project_id));

create policy "env_vars_insert_editor"
  on public.project_env_vars for insert
  with check (public.can_edit_project(project_id));

create policy "env_vars_update_editor"
  on public.project_env_vars for update
  using (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

create policy "env_vars_delete_editor"
  on public.project_env_vars for delete
  using (public.can_edit_project(project_id));


