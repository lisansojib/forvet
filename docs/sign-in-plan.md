# Sign-in — design & implementation plan

Status: **partly built** (Nov 2026). Done: private mode (§6) full-page sign-in with forgot/reset password, no-access screen, account menu with sign out, member-only database reads. Not yet: the §3 restyle of the optional sign-in *modal* used when `requireSignIn` is off, resuming a pending action after sign-in.

## 1. Context

Forvet's access model (from `supabase/forvet_schema.sql`): anyone can **view**; only users in
`forvet_admins` can **edit**. The database enforces this through RLS, so the UI's job is clarity, not security.

Because of that, sign-in should be a **modal on top of the app**, not a gate screen. A full-screen gate only
makes sense if public read is turned off (README → *Privacy*). That case is covered as an option in §6.

## 2. Entry points

| Where | Behaviour |
|---|---|
| Header **Sign in** button (cloud mode only) | Opens the modal. |
| Any edit action while viewing (New, Duplicate, Delete, Restore, editing a field…) | Opens the modal with a reason line, e.g. *"Sign in to create formulations."* After a successful admin sign-in, the action runs. |
| Mobile **More** sheet → *Account / sign in* | Same modal (shown as a bottom sheet). |
| Signed in → avatar | Opens an **account menu** (not the modal): email, role, sync status, *Sign out*. |

**Decision needed:** in view mode, should edit buttons stay visible and lead to sign-in, or be hidden?
Recommendation: keep them visible but enabled, and route the click to sign-in. That way viewers can see
editing exists. Today they are greyed out, and a tooltip is the only explanation. `requireEdit()` already
exists and is the natural place to hook this in.

## 3. Modal layout (desktop 400px, mobile bottom sheet)

```
┌────────────────────────────────────┐
│ [Rx]                           ✕   │
│ Sign in to Forvet                  │
│ Viewing is open to everyone.       │
│ Sign in to edit formulations.      │
│ ┌ reason banner (if triggered) ──┐ │
│ │ Sign in to create formulations │ │
│ └────────────────────────────────┘ │
│ Email                              │
│ [ name@company.com            ]    │
│ Password            Forgot?        │
│ [ ••••••••               👁 ]      │
│ ⚠ Caps Lock is on                  │
│ ⓘ inline error (aria-live)         │
│ [        Sign in        ] (primary)│
│ Continue as viewer   (text button) │
│ ────────────────────────────────── │
│ Local-mode / cloud host note (xs)  │
└────────────────────────────────────┘
```

- Brand colours are the new tokens (`brand-600` primary, `ink-*` neutrals). There is no dark header bar
  inside the modal any more.
- The primary button is full width. While submitting it shows a spinner and *Signing in…*, and the
  inputs are disabled.
- Errors appear inline under the fields, not in the grey status box.
- Password has a show/hide toggle and a Caps Lock warning.
- *Create account* appears only when `allowSignup: true` (unchanged).

## 4. States

| State | What the user sees |
|---|---|
| Signed out | Form as above. Focus on email (or password if the email is remembered). |
| Submitting | Spinner, inputs disabled, *Esc* still closes. |
| Wrong credentials | *"Email or password is incorrect."* The message is generic, so it does not reveal which emails exist. |
| Offline / network | *"Can't reach the server. You're offline — viewing the cached copy."* |
| Rate-limited (429) | *"Too many attempts. Try again in a minute."* |
| Signed in, **not admin** | The modal changes to a result panel: *"Signed in as x@y — view only. Ask the owner to grant edit access."* Optional *Request access* button (`mailto:` built from `adminContact` in config). |
| Signed in, admin | Toast *"Signed in — editing unlocked"*. The modal closes, and any pending action resumes. |
| Local mode | No Sign in button. If opened from the More sheet: *"This copy runs in local mode — anyone on this browser can edit. Configure Supabase to share and protect editing."* |

## 5. Forgot password (Supabase)

1. *Forgot?* → email-only step → `auth.resetPasswordForEmail(email, { redirectTo: <site URL> })`.
   The app always shows *"If that account exists, a reset link is on its way."*
2. When the link returns with `type=recovery` in the URL, the app opens the modal in **Set new password**
   mode (new + confirm, min 8 characters) and calls `auth.updateUser({ password })`.
3. Supabase setup: *Authentication → URL Configuration*, set Site URL and add the deployed URL to
   Redirect URLs. The default Supabase SMTP is heavily rate-limited, so configure custom SMTP before
   relying on this.

Optional later: **magic-link / email OTP** (`signInWithOtp`) for staff who don't want passwords. This
needs custom SMTP too.

## 6. Option: private mode (gate screen)

Add `requireSignIn: true` to `config.js`, and change the `public read` RLS policies to `to authenticated`.

- The app shows a full-page sign-in (same form, centred card on an `ink-50` background, brand mark,
  footer *Formulated by AZ Shohan*) before any data loads.
- Do not cache cloud data in localStorage for signed-out users in this mode.

## 7. Implementation outline

| File | Change |
|---|---|
| `src/modals.html` | Rebuild `#authModal` per §3. Add `#authResetPanel` and `#authResultPanel`. |
| `src/app4.js` | `renderAuthModal(reason?)`, `submitAuth` (spinner, error mapping), `forgotPassword`, `handleRecoveryRedirect`, `pendingAction` resume. |
| `src/app2.js` | `applyPermissions`: stop disabling header actions. `requireEdit()` opens sign-in with a reason. |
| `src/app1.js` / `body.html` | Avatar → account dropdown (reuses the new `.menu` component). Move *Sign out* there. |
| `config.js` | New optional keys: `requireSignIn`, `adminContact`. |
| `README.md` | Document the reset-password URL setup and private mode. |
| `tests/t_cloud.py` | Wrong password, viewer account, admin + resume pending action, sign out from the avatar menu, reset email request. |

Estimate: about half a day for §3–4 plus the account menu, about half a day for password reset, and
about half a day for private mode.

## 8. Open questions

1. Visible-but-prompting edit buttons in view mode, or hidden? (§2)
2. Do you want password reset now, or should the owner reset passwords from the Supabase dashboard for now?
3. Should the link stay public view, or should we plan private mode (§6) from the start?
4. Who is `adminContact`, if anyone (email for *Request access*)?
