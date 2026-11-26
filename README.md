# Forvet — deployment guide

Forvet is a static web app: `index.html` + `config.js`. No server code. Data lives either in each
browser (**local mode**) or in Supabase (**cloud mode**: shared by every device; sign-in required,
members can view, administrators can edit).

## Files
| File | Purpose |
|---|---|
| `dist/index.html` | The whole app, built from `src/` (styles compiled in; no Tailwind CDN). |
| `config.js` | Supabase URL + anon key. Empty = local mode. Copied to `dist/` by the build. |
| `supabase/forvet_schema.sql` | Tables, Row Level Security, revision history. Safe to re-run. |
| `src/` | Source: `head.html`, `body.html`, `modals.html`, `app1–4.js`, `tw.css` (design components). |
| `tailwind.config.js` | Design tokens: `brand` (primary blue) and `ink` (neutrals). |
| `tests/` | Playwright: `t_local.py` (local mode, :8080), `t_auth.py` (sign-in screen against `tests/mock/mock-supabase.js`, :8081), `t_cloud.py` (needs Postgres + PostgREST). SQL: `rls_test.sql` checks the security rules (run after `mock_supabase.sql` + the schema). |
| `docs/` | Design notes and plans (e.g. `sign-in-plan.md`). |

## Build
```
npm install
python build.py          # → dist/index.html + dist/config.js
cd dist && python -m http.server 8080
python tests/t_local.py  # in another terminal
```

## 1. Try it locally
Run the build, then open `dist/index.html` through any static server (e.g. `npx serve .` or `python -m http.server`).
With an empty `config.js`, the app runs in local mode: anyone using the browser can edit, and
data stays in that browser. Download backups regularly (toolbar ⋯ → Download backup).

## 2. Set up Supabase (cloud mode — shared data, sign-in required)
`config.js` already points at the Forvet project and has `requireSignIn: true`, so the app shows a
sign-in screen before anything loads. Only accounts you add can see data.

1. Supabase → **SQL Editor** → New query → paste all of `supabase/forvet_schema.sql` → **Run**.
   (Safe to re-run; it also upgrades the older public-read version.)
2. **Authentication → Sign In / Providers** → turn **off** "Allow new users to sign up".
3. **Authentication → Users → Add user** → your email + a password, tick **Auto Confirm User**.
4. SQL Editor, replacing the email — makes you an administrator (can edit):
   ```sql
   insert into public.forvet_admins (user_id, note)
   select id, 'owner' from auth.users where email = 'you@example.com'
   on conflict do nothing;
   ```
   Read-only colleague: create their user (step 3), then the same insert into `public.forvet_viewers`.
5. **Authentication → URL Configuration**: *Site URL* = your GitHub Pages address
   (e.g. `https://<user>.github.io/forvet/`) and add the same address under *Redirect URLs*
   (needed for "Forgot password?" links).
6. Open the site, sign in. The cloud is empty, so Forvet offers to upload this browser's data.
   - On the browser/PC that has your real data: accept.
   - On a new site/browser that only has the samples: choose **Cancel**, then ⋯ → **Restore from backup**
     with a JSON backup downloaded from your old copy. Every later change syncs automatically.

Signed-in users who are in neither table see a "No access yet" screen. The database enforces all of
this (row-level security), not just the UI. The publishable key in `config.js` is meant to be public;
never put the secret / service_role key there.

## 3. Host it — GitHub Pages (automatic)
`.github/workflows/pages.yml` builds the app and publishes `dist/` on every push to `main`.
One-time: GitHub repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site is then at `https://<user>.github.io/<repo>/`. (Pages on a private repo needs a paid GitHub plan;
the repo contains code and the public key only — no data.)

Any other static host also works (upload `dist/`). HTTPS is required for sign-in.

## Deploy to Cloudflare Pages (free, works on mobile)
One-time: create a free account at dash.cloudflare.com.

**Option A — from your terminal (repeatable):**
```
npm install
npm run deploy     # builds, then uploads dist/ to the "forvet" Pages project
```
The first run opens a browser to log in to Cloudflare and asks to create the `forvet` project
(choose production branch `main`). The app is then live at **https://forvet.pages.dev**
(or `forvet-xxxx.pages.dev` if the name is taken). Run `npm run deploy` again after each change.

**Option B — no terminal:** Cloudflare dashboard → Workers & Pages → Create → Pages →
*Upload assets* → name it `forvet` → drag the `dist` folder in → Deploy.

Notes
- `static/_headers` stops browsers caching `index.html` / `config.js`, so phones always get the latest version.
- In local mode each phone/browser has its own data, starting from the samples. To see your
  real formulations on the phone, either *Download backup* on the PC and *Restore* it on the phone,
  or set up Supabase (section 2) so every device shares one database.
- To keep it private, put Cloudflare Access (Zero Trust → Access → Applications, free up to 50 users)
  in front of the site with an email one-time PIN.

## Moving from the old Forvet.html
- **Same browser:** opening the new version imports the old saved data automatically. The old copy
  is left untouched.
- **Other device:** in the old version use *Backup JSON*, then *Restore JSON* in the new one.
  Old backup formats are converted.

## Privacy
With `requireSignIn: true` and the v7 SQL, nothing is readable without signing in as a listed member
(`forvet_admins` or `forvet_viewers`). Signing out clears this browser's cached copy of the cloud data
(unless there are unsent changes).

## Backups & recovery
- ⋯ → *Download backup* downloads everything. Restore asks for confirmation and offers a backup first.
  Formulations missing from a backup move to *Recently deleted*. Materials missing from it are
  archived, not destroyed.
- Deleting a formulation is a soft delete (restorable in My Formulations → Recently deleted).
- In cloud mode every save keeps the previous version (`forvet_revisions`); admins can restore it
  from My Formulations → History.
- Supabase Free does not include managed backups, and inactive projects can be paused. Check the
  current plan limits, and keep downloading JSON backups.

## How sync behaves
- Changes save to the browser immediately, then upload ~1 s later. The status pill (top right) shows
  *Synced*, *pending*, *Offline* or *conflict*. The bottom status bar shows the last local save time.
- Offline edits queue and upload when the connection returns.
- If two people edit the same record, the second upload is refused. That person chooses
  *Keep mine* or *Use cloud version* (click the status pill). Nothing is overwritten silently.

## Known limitations
- **Testing coverage:** tested in headless Chromium at desktop and phone sizes, and against PostgreSQL 16 + PostgREST 12 using the
  same SQL/RLS with a stand-in auth server. Not yet tested against a live Supabase project or on a
  physical Android phone. Do one pass on each before relying on it.
- **Photo OCR:** uses Tesseract.js, loaded from a CDN on demand, and needs internet. Results are
  marked "review required". OCR was not exercised in automated tests.
- **XLS warning:** the XLS export is Excel 2003 XML. Excel shows a "format doesn't match extension"
  warning, then opens it normally.
- **Liquid batches:** totals treat kg of solids and L of liquids 1 : 1 (density is not modelled).
- **Packaging rates:** packaging material rates are shared by all products of a form. Pricing (MRP/TP/bonus/
  discount/offer) is per product + pack size.
- **Templates:** SOP phases, pH targets and dosage text are templates. Exports are marked DRAFT
  when data is incomplete.
- **Conflict granularity:** conflicts are detected per record (a whole formulation), not per field.
