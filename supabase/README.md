# Supabase setup (the real slice)

Everything in `migrations/` backs the only part of Architect 2.0 that is
functional end-to-end: **auth + project persistence**.

## 1. Create the project

1. Create a project at [database.new](https://database.new).
2. Copy `.env.local.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (older dashboards call this the anon key —
     `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works)
3. Restart `npm run dev`.

## 2. Apply the schema

Either paste `migrations/0001_core_schema.sql` into the dashboard's **SQL Editor**,
or use the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## 3. Enable sign-in providers

**Authentication → Providers**

- **Google**: enable, then add your Client ID/Secret from Google Cloud Console.
  Authorised redirect URI:
  `https://<project-ref>.supabase.co/auth/v1/callback`
- **Email**: enabled by default. For demos without an inbox, turn
  *Authentication → Sign In / Providers → Email → Confirm email* **off** so
  email/password sign-up signs the user in immediately.

**Authentication → URL Configuration**

- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/auth/callback` plus
  `https://<your-vercel-domain>/auth/callback` for previews.

## 4. What the migration gives you

| Table               | Used by                                             |
| ------------------- | --------------------------------------------------- |
| `profiles`          | avatar/name in the nav, team member list            |
| `projects`          | dashboard list, "new project" flow, project header  |
| `project_members`   | Settings → Team (roles enforced by RLS)             |
| `project_env_vars`  | Settings → Environment variables                    |

A trigger on `auth.users` creates the matching `profiles` row on sign-up, so the
first render after OAuth always has a profile to show.
