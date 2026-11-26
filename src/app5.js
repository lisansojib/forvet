/* =====================================================================
   SIGN-IN GATE (private mode: config.js → requireSignIn: true)
   Full-page screen shown before any cloud data is read. Views:
   gateChecking · gateSignIn · gateForgot · gateNewPw · gateNoAccess
   ===================================================================== */
const GATE_VIEWS = ['gateChecking', 'gateSignIn', 'gateForgot', 'gateNewPw', 'gateNoAccess'];
const SIGNING_OUT = { active: false, keepLocal: false };

function showGate(view) {
  const g = $('signInGate'); if (!g) return;
  closeMenus();
  g.hidden = false; document.documentElement.classList.add('gate-on');
  GATE_VIEWS.forEach(v => { const el = $(v); if (el) el.hidden = v !== view; });
  qsa('#signInGate .form-error, #signInGate .form-note').forEach(e => { e.hidden = true; e.textContent = ''; });
  if (view === 'gateNoAccess') $('gateNoAccessEmail').textContent = CLOUD.user?.email || 'This account';
  if (view === 'gateForgot' && !$('gateResetEmail').value) $('gateResetEmail').value = $('gateEmail').value.trim();
  setTimeout(() => {
    const first = $(view)?.querySelector('input:not([type=hidden])');
    if (first) (first.value && view === 'gateSignIn' ? $('gatePassword') : first).focus({ preventScroll: true });
  }, 30);
}
function hideGate() {
  const g = $('signInGate'); if (!g) return;
  g.hidden = true; document.documentElement.classList.remove('gate-on');
}
function gateMsg(id, text) { const el = $(id); if (!el) return; el.textContent = text || ''; el.hidden = !text; }
function gateBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(busyLabel)}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}
function authErrorText(err) {
  const m = String(err?.message || err || '');
  if (err?.status === 429 || /rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/invalid (login )?credentials|invalid email or password/i.test(m)) return 'Email or password is incorrect.';
  if (/email not confirmed/i.test(m)) return "This account's email isn't confirmed yet. Ask the owner to confirm it in Supabase.";
  if (!navigator.onLine || /failed to fetch|network|load failed/i.test(m)) return "Can't reach the server. Check your connection and try again.";
  return friendlyError(err);
}
function setInvalid(id, bad) { const el = $(id); if (el) el.setAttribute('aria-invalid', bad ? 'true' : 'false'); }

async function gateSignIn(ev) {
  ev.preventDefault();
  const email = $('gateEmail').value.trim(); const pw = $('gatePassword').value;
  setInvalid('gateEmail', !email); setInvalid('gatePassword', !pw);
  if (!email || !pw) { gateMsg('gateError', !email ? 'Enter your email.' : 'Enter your password.'); (!email ? $('gateEmail') : $('gatePassword')).focus(); return; }
  if (!CLOUD.client) { gateMsg('gateError', "Can't reach the server. Check your connection and reload the page."); return; }
  gateMsg('gateError', ''); const btn = $('gateSubmit'); gateBusy(btn, true, 'Signing in…');
  try {
    const { data, error } = await CLOUD.client.auth.signInWithPassword({ email, password: pw });
    if (error) throw error;
    CLOUD.user = data.user; $('gatePassword').value = '';
    await refreshAdmin();
    if (!CLOUD.isMember) { showGate('gateNoAccess'); return; }
    try { await pullAll({ first: true }); } catch (_) { /* the status pill shows it */ }
    hideGate(); renderAll();
    if (CLOUD.isAdmin) flushOutbox();
    toast(CLOUD.isAdmin ? 'Signed in — editing unlocked.' : 'Signed in — view only.');
  } catch (err) {
    gateMsg('gateError', authErrorText(err)); setInvalid('gatePassword', true); $('gatePassword').select();
  } finally { gateBusy(btn, false); }
}
async function gateForgot(ev) {
  ev.preventDefault();
  const email = $('gateResetEmail').value.trim();
  setInvalid('gateResetEmail', !email);
  if (!email) { gateMsg('gateForgotError', 'Enter your email.'); return; }
  if (!CLOUD.client) { gateMsg('gateForgotError', "Can't reach the server. Check your connection."); return; }
  gateMsg('gateForgotError', ''); gateMsg('gateForgotNote', ''); const btn = $('gateForgotSubmit'); gateBusy(btn, true, 'Sending…');
  try {
    const { error } = await CLOUD.client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error && (error.status === 429 || /rate limit/i.test(error.message))) throw error;
    // Same message whether or not the account exists, so the form can't be used to discover accounts.
    gateMsg('gateForgotNote', `If an account exists for ${email}, a reset link is on its way. Check your inbox and spam folder.`);
  } catch (err) { gateMsg('gateForgotError', authErrorText(err)); }
  finally { gateBusy(btn, false); }
}
async function gateSetPassword(ev) {
  ev.preventDefault();
  const p1 = $('gateNewPw1').value; const p2 = $('gateNewPw2').value;
  setInvalid('gateNewPw1', p1.length < 8); setInvalid('gateNewPw2', p1 !== p2);
  if (p1.length < 8) { gateMsg('gateNewPwError', 'Use at least 8 characters.'); return; }
  if (p1 !== p2) { gateMsg('gateNewPwError', "The two passwords don't match."); return; }
  const btn = $('gateNewPwSubmit'); gateBusy(btn, true, 'Saving…');
  try {
    const { error } = await CLOUD.client.auth.updateUser({ password: p1 });
    if (error) throw error;
    CLOUD.recovery = false; $('gateNewPw1').value = ''; $('gateNewPw2').value = '';
    history.replaceState(null, '', location.pathname + location.search);
    await refreshAdmin();
    if (!CLOUD.isMember) { showGate('gateNoAccess'); return; }
    try { await pullAll({ first: true }); } catch (_) { /* pill shows */ }
    hideGate(); renderAll(); toast('Password updated — you are signed in.');
  } catch (err) { gateMsg('gateNewPwError', authErrorText(err)); }
  finally { gateBusy(btn, false); }
}
/* Private mode sign-out: drop this browser's copy of the cloud data (unless unsent changes
   must be kept), then reload so the sign-in screen starts clean. */
function onSignedOutPrivate() {
  const keep = SIGNING_OUT.active ? SIGNING_OUT.keepLocal : outbox.size > 0;
  CLOUD.user = null; CLOUD.isAdmin = false; CLOUD.isMember = false; UI.adminUserId = null; saveUI();
  if (!keep) window.__forvetNoPersist = true;
  if (!keep) { try { localStorage.removeItem(LS_DATA); localStorage.removeItem(LS_STASH); } catch (_) { /* ignore */ } }
  location.reload();
}
function wireGate() {
  if (!$('signInGate')) return;
  $('gateSignIn').addEventListener('submit', gateSignIn);
  $('gateForgot').addEventListener('submit', gateForgot);
  $('gateNewPw').addEventListener('submit', gateSetPassword);
  $('gateForgotLink').addEventListener('click', () => showGate('gateForgot'));
  $('gateBackToSignIn').addEventListener('click', () => showGate('gateSignIn'));
  $('gateNoAccessSignOut').addEventListener('click', () => { SIGNING_OUT.active = true; SIGNING_OUT.keepLocal = false; CLOUD.client?.auth.signOut().finally(onSignedOutPrivate); });
  qsa('#signInGate [data-pw-toggle]').forEach(b => b.addEventListener('click', () => {
    const inp = $(b.dataset.pwToggle); const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', String(show)); inp.focus();
  }));
  const caps = ev => { if (ev.getModifierState) $('gateCaps').hidden = !ev.getModifierState('CapsLock'); };
  $('gatePassword').addEventListener('keydown', caps); $('gatePassword').addEventListener('keyup', caps);
  qsa('#signInGate input').forEach(i => i.addEventListener('input', () => i.setAttribute('aria-invalid', 'false')));
}
