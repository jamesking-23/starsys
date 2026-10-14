# Starsys — Financial Reporting Platform

A web platform for collecting, reviewing and exporting monthly financial reports (tithe and
other offerings) per church and district, with role-based access, a full audit trail and
Excel export.

- **Frontend:** a single static file, [`index.html`](index.html) (Tailwind via CDN, Lucide icons,
  ExcelJS, `supabase-js` v2 loaded from a CDN). No build step.
- **Backend:** [Supabase](https://supabase.com) — Postgres, Auth, Row Level Security and Realtime.
  Everything lives in [`supabase/`](supabase/).

## Features

- Email/password sign-up with email confirmation and **admin approval** before first sign-in
- Three roles: `audit_user` (enters data for assigned districts), `admin` (manages users and
  districts/churches), `super_admin` (everything, plus support access)
- Districts and churches, monthly entries with configurable offering types
- Activity log and audit trail of every administrative action
- Time-boxed **support access** grants, revocable by the super admin
- Excel export of reports; realtime updates; light/dark mode; adjustable text size (100–120%)

## Repository layout

```
index.html                         The whole frontend
supabase/
  config.toml                      Supabase CLI config for local dev
  migrations/                      Schema, functions, RLS, seed, grants (run in order)
  types/database.types.ts          Generated TypeScript types for the schema
.env.example                       Which values are public vs. secret
```

## Database overview

| Table | Purpose |
|---|---|
| `profiles` | One row per user (linked to `auth.users`): name, phone, `role`, `status`, `last_login` |
| `districts`, `churches` | Organisation structure |
| `user_district_access` | Which districts an `audit_user` may work in |
| `admin_scope` | Which districts an `admin` covers (or `system_wide`) |
| `entries` | Monthly financial entries (`amounts` and `late_fields` stored as JSON) |
| `offering_types` | Configurable offering categories (key, label, sort order) |
| `audit` | One row per submitted report (who, where, period, total) |
| `audit_log` | Append-only log of administrative actions |
| `support_access` | Time-limited support access grants |
| `system_config` | Single row; makes the **first** user to sign up the `super_admin` |

**Security model.** RLS is enabled on every table. Reads are scoped by
`user_has_district_access()`. Most writes go through `SECURITY DEFINER` RPC functions
(`approve_user`, `set_user_status`, `promote_to_admin`, `add_district`, `rename_church`, …) that
check the caller's role, pin `search_path`, and write to `audit_log`. A trigger on `profiles`
stops users changing their own `role`, `status` or `last_login`.

## Setting it up on a new Supabase project

1. Create a project at supabase.com.
2. Apply the schema, either with the CLI:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   or by pasting each file in `supabase/migrations/` into the SQL editor, **in filename order**.
3. In `index.html`, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the `CONFIG` block
   (Project Settings → API). The anon key is designed to be public; RLS protects the data.
4. In Supabase Dashboard → Authentication:
   - set **Site URL** and **Redirect URLs** to wherever you host `index.html`
   - configure a production **SMTP** provider (the built-in mailer is rate limited)
   - enable **leaked password protection** (Auth → Providers → Email → Password security)
5. Host `index.html` on any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages).
6. **Sign up first.** The first account created becomes the `super_admin` automatically
   (`system_config.initialized` flips to `true`). Everyone after that is `audit_user` /
   `pending_approval` until approved.

## Notes for a new owner

- **No data is in this repo.** Only structure and the eight default offering types. Live
  users, districts, churches and entries stay in the existing Supabase project.
- **The migrations were reconstructed** from the live database catalog (tables, functions,
  policies, grants, publication) because Supabase does not keep the original SQL text. They were
  applied in order to an empty PostgreSQL instance and smoke-tested: first sign-up becomes
  super admin, later sign-ups are pending, a user cannot self-promote, anonymous callers cannot
  invoke the RPCs. The original `reset_to_fresh_state` data-reset migration is intentionally
  not included.
- **Supabase linter warnings are expected.** "Signed-in users can execute SECURITY DEFINER
  function" is reported for the admin RPCs because the app calls them from the browser; each
  one enforces its own role check. Leaked-password protection is a dashboard setting (step 4).
- **No edge functions** are used.
- **Never commit** the `service_role` key, database password or access tokens.
