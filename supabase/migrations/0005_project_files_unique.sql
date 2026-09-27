/*
-- 0005: enforce one row per (project_id, path)
--
-- Why this exists, and why it is not in 0002.
--
-- 0002 declares `unique (project_id, path)` inline in the `create table`. That
-- clause is only applied when the table is *first* created — `create table if
-- not exists` skips the whole statement on an existing table, so a database that
-- already had `project_files` never received the constraint. It is there in the
-- file, which is exactly why this went unnoticed for so long.
--
-- Without it, `lib/pipeline/workspace.ts` is not the upsert it claims to be. It
-- selects the existing row with `.maybeSingle()` and updates it, but with no
-- constraint to back it up, repeated writes of the same path simply inserted
-- another row. Observed in a real project: 108 rows for 68 distinct paths.
--
-- The damage is not cosmetic. Every workspace read filters on
-- (project_id, path) and expects exactly one file, so duplicates mean:
--   - the preview resolved an arbitrary copy of each file,
--   - `version` counted up from whichever row the select happened to return,
--   - and `maybeSingle()` throws "JSON object requested, multiple rows returned"
--     instead of returning null, which took down the whole preview.
--
-- This is idempotent: it removes the duplicates first, keeping the row with the
-- highest version (the most recently written), and only adds the constraint if
-- it is genuinely absent. Safe to run against a clean or a dirty database.
*/

-- Keep the most recently written copy of each file. `version` is the tiebreak
-- because the writer increments it on every rewrite, so the highest version is
-- the file the user last saw.
delete from public.project_files pf
where pf.id <> (
  select keep.id
  from public.project_files keep
  where keep.project_id = pf.project_id
    and keep.path = pf.path
  order by keep.version desc, keep.updated_at desc, keep.id
  limit 1
);

-- Add the constraint only when it is not already there. `create table if not
-- exists` semantics do not apply to `alter table`, so this has to be explicit.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_files'::regclass
      and contype = 'u'
      and conname = 'project_files_project_id_path_key'
  ) then
    alter table public.project_files
      add constraint project_files_project_id_path_key
      unique (project_id, path);
  end if;
end $$;
