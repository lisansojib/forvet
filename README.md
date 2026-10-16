# Forvet — deployment guide

Forvet is a static web app: `index.html` + `config.js`. No server code. Data lives either in each
browser (**local mode**) or in Supabase (**cloud mode**: anyone with the link can view, only
administrators can edit).

## Files
| File | Purpose |
|---|---|
| `index.html` | The whole app (styles compiled in; no Tailwind CDN). |
| `config.js` | Supabase URL + anon key. Empty = local mode. |
| `supabase/forvet_schema.sql` | Tables, Row Level Security, revision history. Safe to re-run. |

## 1. Try it locally
Open `index.html` through any static server (e.g. `npx serve .` or `python -m http.server`).
With an empty `config.js`, the app runs in local mode: anyone using the browser can edit, and
data stays in that browser. Download backups (⬇️ Backup JSON) regularly.

## 2. Set up Supabase (cloud mode)
1. Create a project at supabase.com.
2. SQL Editor → paste `supabase/forvet_schema.sql` → Run.
3. Authentication → Users → **Add user** (email + password, tick *Auto Confirm*).
4. SQL Editor, replacing the email:
   ```sql
   insert into public.forvet_admins (user_id, note)
   select id, 'owner' from auth.users where email = 'you@example.com'
   on conflict do nothing;
   ```
5. Project Settings → API: copy the **Project URL** and the **anon / publishable** key into `config.js`.
   Never use the `service_role` / secret key in the browser.
6. Authentication → URL Configuration: set *Site URL* to your deployed address.
7. Open the app, click **🔐 Admin Login**, sign in. Because the cloud is empty, Forvet offers to
   upload this browser's data — accept once. Every later change syncs automatically.

Adding another editor: create the user (step 3) and insert them into `forvet_admins` (step 4).
Anyone else (signed in or not) can only view. This is enforced by the database, not the UI.

## 3. Host it
Any static host works: Cloudflare Pages, Netlify, GitHub Pages, or IIS / Kestrel static files.
Upload `index.html` and `config.js` to the same folder. HTTPS is required for sign-in.

## Moving from the old Forvet.html
- **Same browser:** opening the new version imports the old saved data automatically. The old copy
  is left untouched.
- **Other device:** in the old version use *Backup JSON*, then *Restore JSON* in the new one.
  Old backup formats are converted.

## Privacy (decide before sharing the link)
Cloud mode makes **all** formulations, supplier rates, costs and margins readable by anyone who
has the link and the anon key (which is inside `config.js`). If that is not acceptable, change the
`public read` policies in the SQL to `to authenticated` and give viewers accounts.

## Backups & recovery
- ⬇️ Backup JSON downloads everything. Restore asks for confirmation and offers a backup first.
  Formulations missing from a backup move to *Recently deleted*. Materials missing from it are
  archived, not destroyed.
- Deleting a formulation is a soft delete (restorable in My Formulations → Recently deleted).
- In cloud mode every save keeps the previous version (`forvet_revisions`); admins can restore it
  from My Formulations → History.
- Supabase Free does not include managed backups, and inactive projects can be paused. Check the
  current plan limits, and keep downloading JSON backups.

## How sync behaves
- Changes save to the browser immediately, then upload ~1 s later. The header badge shows
  *synced*, *pending*, *offline* or *conflict*.
- Offline edits queue and upload when the connection returns.
- If two people edit the same record, the second upload is refused. That person chooses
  *Keep mine* or *Use cloud version* (click the badge). Nothing is overwritten silently.

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
