/*
-- 0006: drop the one-head-per-project index
--
-- `checkpoints_one_head_idx` is a partial unique index on `(project_id) where
-- is_head`, created in 0004 to guarantee a single head.
--
-- It is the reason no version was ever recorded. `createCheckpoint` demotes the
-- old head and then inserts the new one, and the demote is an `.update()` —
-- which returns no error when it matches zero rows. Under RLS that update can
-- silently affect nothing, leaving the old head in place, and the insert then
-- fails with `23505 duplicate key value violates unique constraint
-- "checkpoints_one_head_idx"`. Every write in every build was rejected this way
-- and the Undo tab reported "this is the only version" about projects that had
-- changed many times.
--
-- The index protects an invariant the application already handles. `getHead`
-- reads the newest row rather than trusting `is_head`, precisely because that
-- column is maintained by two independent statements and can drift. A partial
-- unique index turns a display flag into a hard constraint that a policy
-- failure can violate silently, which is the worst of both worlds.
--
-- Safe to run more than once.
*/

drop index if exists public.checkpoints_one_head_idx;
