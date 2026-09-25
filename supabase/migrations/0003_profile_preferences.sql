-- =============================================================================
-- 0003_profile_preferences.sql
--
-- Phase 2 — auth: per-user lens preference + one-question onboarding.
--
-- Ground rule from the brief: the Simple/Developer toggle is a persistent
-- per-user preference, not an onboarding lock-in. Both lenses render the same
-- underlying data; only presentation changes (see lib/view-mode.tsx).
--
-- So profiles gains two columns:
--   view_mode            'simple' | 'developer' — the persisted lens
--   onboarding_completed boolean — whether "Do you write code?" was answered
--   display_name         optional friendly name (profile screen edits this)
--
-- Re-runnable: every statement is IF NOT EXISTS / OR REPLACE / DROP IF EXISTS.
-- =============================================================================

alter table public.profiles
  add column if not exists view_mode text not null default 'simple'
    check (view_mode in ('simple', 'developer'));

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

alter table public.profiles
  add column if not exists display_name text;

-- Keep updated_at honest on profile edits (reuses set_updated_at from 0002).
drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Backfill display_name from the sign-up metadata where present.
update public.profiles
set display_name = coalesce(display_name, full_name)
where display_name is null and full_name is not null;
