# Starsys — Financial Reporting Platform

A web platform for collecting, reviewing and exporting monthly financial reports (tithe and
other offerings) per church and district, with role-based access, a full audit trail and
Excel export.

- **Frontend:** a Vite-built web app (`index.html` + `src/`), styled with Tailwind CSS (PostCSS),
  icons from the `lucide` package, `exceljs` for exports and `supabase-js` v2. Fonts are bundled,
  so nothing is loaded from a CDN.
- **Desktop:** the same app packaged with Electron as a standalone Windows `.exe`.
- **Backend:** [Supabase](https://supabase.com) — Postgres, Auth, Row Level Security and Realtime.
  Everything lives in [`supabase/`](supabase/).

## Features

- Email/password sign-up with email confirmation and **admin approval** before first sign-in
- Three roles: `audit_user` (enters data for assigned districts), `admin` (manages users and
  districts/churches), `super_admin` (shown in the app as **Sys Admin**: everything, plus support access)
- Districts and churches, monthly entries with configurable offering types
- Activity log and audit trail of every administrative action
- Time-boxed **support access** grants, revocable by the super admin
- Excel export of reports; realtime updates; light/dark mode; adjustable text size (100–120%)

## Repository layout

```
index.html                         App markup (entry point for Vite)
src/main.js                        Application logic (Supabase, rendering, exports)
src/ui.js                          Sidebar, theme toggle, text-size slider, logo
src/icons.js                       The Lucide icons bundled with the app
src/styles.css                     Custom CSS + Tailwind layers
tailwind.config.cjs, postcss.config.cjs, vite.config.js
electron/main.cjs                  Electron window (desktop app)
electron-builder.yml               Windows packaging config
.github/workflows/build-exe.yml    CI: builds the .exe on every push
supabase/
  config.toml                      Supabase CLI config for local dev
  migrations/                      Schema, functions, RLS, seed, grants (run in order)
  types/database.types.ts          Generated TypeScript types for the schema
.env.example                       Which values are public vs. secret
```

## Database overview

| Table | Purpose |
|---|---|
| `profiles` | One row per user (linked to `auth.users`): name, phone, `role`, `status`, `last_login`, `avatar_url` |
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

## Development

Requires Node.js 20.19+ (22 recommended).

```bash
npm install
npm run dev          # web app with hot reload
npm run build        # production build into dist/
npm run electron     # build, then open in the desktop shell
npm run dist:win     # build the Windows .exe into release/ (run on Windows)
```

Adding an icon: import it in `src/icons.js`, add it to the `icons` object, then use its
kebab-case name in `<i data-lucide="...">`.

## Windows desktop app (.exe)

Every push to GitHub triggers **Actions → Build Windows EXE**, which produces
`Starsys-v<version>.exe`, with `<version>` read from `package.json`. Download it from the
run's **Artifacts** section.

To publish a labelled release:

1. Bump `version` in `package.json` (e.g. `1.0.1`) and commit.
2. Tag and push: `git tag v1.0.1 && git push origin v1.0.1`.
3. The workflow checks the tag matches `package.json`, then attaches the `.exe` to a GitHub Release.

Notes:
- The `.exe` is a **portable** build (one file, no installer) and is **unsigned**, so Windows
  SmartScreen may warn on first run ("More info → Run anyway"). Buying a code-signing
  certificate removes the warning. To get a Setup wizard instead, change `target` to `nsis`
  in `electron-builder.yml`.
- The app still needs internet to reach Supabase; only the UI, fonts and icons are bundled.
- Password-reset e-mails open in the user's browser. Host the web build somewhere and set
  `VITE_PUBLIC_APP_URL` (in a `.env` file at build time) to that address, and add it to
  Supabase **Auth → URL Configuration → Redirect URLs**.
- To use your own app icon, add `build/icon.ico` (256×256+) and uncomment the `icon` line in
  `electron-builder.yml`.

## Hosting the web app and making email links work

Password-reset and email-verification links must come back to a real web address. The web app is
published to **GitHub Pages** by `.github/workflows/deploy-pages.yml` (on every push to `main`):

1. In GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions** (one time).
2. In Supabase: **Authentication → URL Configuration**
   - **Site URL:** `https://jamesking-23.github.io/starsys/`
   - **Redirect URLs:** add `https://jamesking-23.github.io/starsys/` (and `http://localhost:5173/` if you
     develop locally).
3. Reset and verification emails now open the hosted app, which shows the "choose a new password"
   screen (reset) or "Email Verified" (sign-up). Expired or already-used links show a clear message.

Users of the desktop `.exe` follow the same links in their browser; once the password is changed
they sign in to the desktop app as normal. If you host elsewhere, change `VITE_PUBLIC_APP_URL` in
both workflow files and the two URLs above.

## Setting it up on a new Supabase project

1. Create a project at supabase.com.
2. Apply the schema, either with the CLI:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   or by pasting each file in `supabase/migrations/` into the SQL editor, **in filename order**.
3. In `src/main.js`, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the `CONFIG` block
   (Project Settings → API). The anon key is designed to be public; RLS protects the data.
4. In Supabase Dashboard → Authentication:
   - set **Site URL** and **Redirect URLs** to wherever you host the web build
   - configure a production **SMTP** provider (the built-in mailer is rate limited)
   - enable **leaked password protection** (Auth → Providers → Email → Password security)
5. Run `npm run build` and host the `dist/` folder on any static host (GitHub Pages, Netlify,
   Vercel, Cloudflare Pages), or distribute the desktop `.exe`.
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
