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

**Authentication -> Providers**

### Email (do this first)

Enabled by default. For demos without an inbox, turn **Authentication -> Sign
In / Providers -> Email -> Confirm email** off, so email/password sign-up
signs the user in immediately. Leave it on in production.

### Google

Google sign-in is two separate halves, and this is where people get stuck:

1. **Google Cloud Console** creates the OAuth *client* and gives you a Client
   ID and Client Secret.
2. **Supabase** holds those credentials and performs the token exchange. Supabase
   does not create Google credentials for you.

#### Step A - create the OAuth client in Google Cloud

1. Open https://console.cloud.google.com/apis/credentials . Pick (or create) a
   project. Any project works; it need not be the same one as anything else.
2. **Create credentials -> OAuth client ID.**
3. **Application type: Web application.**
4. **Name:** `Architect 2.0 local`.
5. Under **Authorized redirect URIs**, add exactly this. It must match
   character for character, including the trailing slash:

   ```
   https://<PROJECT-REF>.supabase.co/auth/v1/callback
   ```

   `<PROJECT-REF>` is the 20 characters in your project URL. Google rejects
   wildcards, `localhost`, and any trailing path.

6. Click **Create**. You now have a **Client ID** and a **Client Secret**.

#### Step B - paste them into Supabase

In Supabase: **Authentication -> Providers -> Google**, then:

| Field | Value |
| ----- | ----- |
| Enable Google provider | on |
| Client ID | the `...apps.googleusercontent.com` value |
| Client Secret | the secret Google just showed you |
| Redirect URL | Supabase fills this in; verify it matches Step A |

Click **Save**.

#### Step C - allow-list your own app callback

Supabase only redirects to URLs it knows about. Under **Authentication -> URL
Configuration**:

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** add every host you actually browse from:

  ```
  http://localhost:3000/auth/callback
  http://192.168.1.4:3000/auth/callback
  https://<your-vercel-domain>/auth/callback
  ```

  The second entry only matters because this build is often opened on a phone
  at the LAN address: Google sends the browser back to *your app*, not to
  Supabase, so both hosts must be listed.

#### The redirect flow, once, so it is not mysterious

```
browser  ->  Supabase  ->  accounts.google.com  ->  (you consent)
          <-                                        |
browser  <-  Supabase  <-------------------------
   (supabase.co/auth/v1/callback exchanges the code for a
    session, sets cookies, then redirects to YOUR /auth/callback)
```

`app/auth/callback/route.ts` is the last step: it swaps the `code` for a
session and sets the auth cookies. That is why the exchange happens on the
server - the browser never holds the Supabase credentials.

### If Google sign-in fails

| Symptom | Cause |
| ------- | ----- |
| `redirect_uri_mismatch` from Google | The URI in Google Cloud is not identical to the one in Supabase. |
| Redirects to Supabase and then stops | Your app callback is missing from Supabase **Redirect URLs**. |
| Lands on `/auth/error?code=access_denied` | Consent was cancelled on the Google screen. |
| `provider is not enabled` | The Google toggle in Supabase is still off. |
| Works on localhost but not on the phone LAN IP | Add `http://192.168.x.x:3000/auth/callback` to **Redirect URLs**. |

## 4. What the migration gives you

| Table               | Used by                                             |
| ------------------- | --------------------------------------------------- |
| `profiles`          | avatar/name in the nav, team member list            |
| `projects`          | dashboard list, "new project" flow, project header  |
| `project_members`   | Settings → Team (roles enforced by RLS)             |
| `project_env_vars`  | Settings → Environment variables                    |

A trigger on `auth.users` creates the matching `profiles` row on sign-up, so the
first render after OAuth always has a profile to show.

## If the SQL Editor reports an error

Re-running `migrations/0001_core_schema.sql` is safe. Every statement in it is
idempotent, so a second run, a resumed run, or a run against a half-built schema
will not error:

| Statement                | Guard                                 |
| ------------------------ | ------------------------------------- |
| `create table`           | `if not exists`                       |
| `create function`        | `or replace`                          |
| `create trigger`         | preceded by `drop trigger if exists`   |
| `create policy`          | preceded by `drop policy if exists`   |
| `alter table ... enable rls` | naturally idempotent              |

An earlier version of this migration used a bare `create policy`, so a re-run
failed with `ERROR 42710: policy "profiles_select_self" already exists`. That is
fixed; if you hit an equivalent error, the statement below will tell you exactly
what is actually present.

### Verify the schema

Run this after applying the migration. It should return **4 tables, 16 policies,
4 triggers, 0 errors**:

```sql
select 'tables'   as what, count(*) from pg_tables where schemaname = 'public'
union all select 'policies', count(*) from pg_policies where schemaname = 'public'
union all select 'triggers', count(*) from pg_trigger where not tgisinternal
order by 1;
```

If `tables` is 4 but `policies` is 0, the run stopped at the RLS block — re-run
the whole file. If `policies` is 16 and `triggers` is 4, you are done.

## Troubleshooting

| Symptom                                              | Cause                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `Error: Invalid login credentials` on a known password | Email confirmation is on; the user never confirmed. Turn it off under Authentication -> Sign In / Providers -> Email. |
| Sign-up succeeds but the app bounces back to `/sign-in` | The session cookie was not written. Check that the Supabase **publishable** key (not `service_role`) is in `.env.local`, then restart the dev server. |
| Project saves fail with a missing-table error         | The migration was not applied. Run it, then re-check with the query above. |
| `Failed to run sql query`                             | A partial run. The migration is re-runnable; just run it again. |

