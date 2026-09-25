-- =============================================================================
-- 0002_project_files.sql
--
-- The agent's workspace, in Postgres.
--
-- This is the table that makes the builder real. The model does not return
-- "here is your app" as a string that the UI renders - it calls write_file,
-- which inserts a row here. Everything the file tree, the code view, the
-- diff and the live preview show is read back out of this table.
--
-- Re-runnable, for the same reason 0001 is: the SQL Editor will happily run a
-- file twice.
-- =============================================================================

create table if not exists public.project_files (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  path        text not null,
  content     text not null default '',
  language    text not null default 'text',
  -- 0 for a new file, otherwise the line count before this write, so the UI can
  -- show a real +/- diff without re-reading history.
  prev_lines  int not null default 0,
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, path)
);

create index if not exists project_files_project_idx
  on public.project_files (project_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.project_files enable row level security;

drop policy if exists project_files_select_own on public.project_files;
create policy project_files_select_own on public.project_files
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and (p.owner_id = auth.uid() or public.is_project_member(p.id))
    )
  );

drop policy if exists project_files_insert_own on public.project_files;
create policy project_files_insert_own on public.project_files
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and (p.owner_id = auth.uid() or public.can_edit_project(p.id))
    )
  );

drop policy if exists project_files_update_own on public.project_files;
create policy project_files_update_own on public.project_files
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and (p.owner_id = auth.uid() or public.can_edit_project(p.id))
    )
  );

drop policy if exists project_files_delete_own on public.project_files;
create policy project_files_delete_own on public.project_files
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and (p.owner_id = auth.uid() or public.can_edit_project(p.id))
    )
  );

-- =============================================================================
-- Keep updated_at honest. The agent writes constantly, so relying on the
-- application to set the column would drift the first time a write failed.
--
-- Defined here rather than in 0001 because 0001 has already been run on the
-- live project - adding to it would mean a second manual step for everyone.
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.project_files;
create trigger set_updated_at
  before update on public.project_files
  for each row execute function public.set_updated_at();
