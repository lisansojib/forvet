"""Private-mode sign-in tests against tests/mock/mock-supabase.js (no network needed).
Serve a folder containing dist/index.html + tests/mock/* as config.js/mock-supabase.js on :8081, then run."""
import sys
from playwright.sync_api import sync_playwright
URL = 'http://localhost:8081/index.html'
R = []
def ok(name, cond, extra=''):
    R.append(cond); print('PASS' if cond else 'FAIL', name, extra, flush=True)
def gate_view(pg):
    return pg.evaluate("['gateChecking','gateSignIn','gateForgot','gateNewPw','gateNoAccess'].find(id => !document.getElementById(id).hidden && !document.getElementById('signInGate').hidden) || null")
def wait_view(pg, v):
    pg.wait_for_function(f"!document.getElementById('signInGate').hidden && !document.getElementById('{v}').hidden", timeout=5000)
def app_visible(pg):
    return pg.evaluate("getComputedStyle(document.getElementById('appHeader')).display") != 'none'
def sign_in(pg, email, pw):
    pg.fill('#gateEmail', email); pg.fill('#gatePassword', pw); pg.click('#gateSubmit')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 860})
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); wait_view(pg, 'gateSignIn')
    ok('gate shown on first visit', gate_view(pg) == 'gateSignIn')
    ok('app hidden behind gate', not app_visible(pg))
    ok('no table reads while signed out', pg.evaluate("__mock.calls.filter(c => c.table).length") == 0)
    pg.wait_for_timeout(100); ok('email focused', pg.evaluate("document.activeElement.id") == 'gateEmail', pg.evaluate("document.activeElement.id || document.activeElement.tagName"))

    pg.click('#gateSubmit'); ok('empty email message', pg.inner_text('#gateError') == 'Enter your email.')
    sign_in(pg, 'admin@forvet.test', 'wrong'); pg.wait_for_selector('#gateError:not([hidden])')
    pg.wait_for_function("document.getElementById('gateError').textContent.includes('incorrect')")
    ok('wrong password message', pg.inner_text('#gateError') == 'Email or password is incorrect.')
    ok('password marked invalid', pg.get_attribute('#gatePassword', 'aria-invalid') == 'true')
    pg.evaluate("__mock.rateLimit = true"); sign_in(pg, 'admin@forvet.test', 'x')
    pg.wait_for_function("document.getElementById('gateError').textContent.includes('Too many')")
    ok('rate limit message', 'Too many attempts' in pg.inner_text('#gateError')); pg.evaluate("__mock.rateLimit = false")

    pg.click('[data-pw-toggle=gatePassword]'); ok('show password toggle', pg.get_attribute('#gatePassword', 'type') == 'text'); pg.click('[data-pw-toggle=gatePassword]')

    sign_in(pg, 'admin@forvet.test', 'admin-pass-1')
    pg.wait_for_function("document.getElementById('signInGate').hidden", timeout=5000)
    ok('admin sign-in hides gate', app_visible(pg))
    pg.wait_for_selector('#uiDialog:not([hidden])', timeout=5000)
    ok('empty cloud: admin offered upload', 'Cloud database is empty' in pg.inner_text('#uiDialog'))
    pg.click('#uiDialogButtons button:has-text("Upload to cloud")'); pg.wait_for_timeout(1500)
    ok('seed uploaded to cloud', pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('mocksb-db')).forvet_formulations).length") >= 3)
    ok('admin can edit', not pg.is_disabled('header [data-act=create]'))
    ok('account button shows initials', pg.inner_text('#authButton').startswith('A'), pg.inner_text('#authButton'))
    pg.click('#authButton'); pg.wait_for_timeout(100)
    ok('account menu shows email + role', pg.is_visible('#accountEmail') and pg.inner_text('#accountEmail') == 'admin@forvet.test' and 'Administrator' in pg.inner_text('#accountRole'))
    pg.keyboard.press('Escape')

    pg.reload(); pg.wait_for_function('window.__forvetReady===true')
    ok('session survives reload (no gate)', pg.evaluate("document.getElementById('signInGate').hidden") and app_visible(pg))

    pg.click('#authButton'); pg.click('#accountMenu [data-act=sign-out]')
    pg.wait_for_load_state(); wait_view(pg, 'gateSignIn')
    ok('sign out returns to gate', gate_view(pg) == 'gateSignIn' and not app_visible(pg))
    ok('cached cloud data cleared on sign out', pg.evaluate("localStorage.getItem('FORVET_DATA_V6') === null || !JSON.parse(localStorage.getItem('FORVET_DATA_V6')).meta.cloudUrl"))

    sign_in(pg, 'stranger@forvet.test', 'stranger-pass'); wait_view(pg, 'gateNoAccess')
    ok('non-member sees No access', 'stranger@forvet.test' in pg.inner_text('#gateNoAccess') and not app_visible(pg))
    pg.click('#gateNoAccessSignOut'); pg.wait_for_load_state(); wait_view(pg, 'gateSignIn')
    ok('no-access sign out back to sign in', gate_view(pg) == 'gateSignIn')

    sign_in(pg, 'viewer@forvet.test', 'viewer-pass-1')
    pg.wait_for_function("document.getElementById('signInGate').hidden", timeout=5000); pg.wait_for_timeout(300)
    ok('viewer sees app read-only', app_visible(pg) and pg.is_disabled('header [data-act=create]'))
    pg.click('#authButton'); ok('viewer role label', 'Viewer' in pg.inner_text('#accountRole')); pg.keyboard.press('Escape')
    pg.click('#authButton'); pg.click('#accountMenu [data-act=sign-out]'); pg.wait_for_load_state(); wait_view(pg, 'gateSignIn')

    pg.fill('#gateEmail', 'admin@forvet.test'); pg.click('#gateForgotLink'); wait_view(pg, 'gateForgot')
    ok('forgot pre-fills email', pg.input_value('#gateResetEmail') == 'admin@forvet.test')
    pg.click('#gateForgotSubmit'); pg.wait_for_selector('#gateForgotNote:not([hidden])')
    ok('reset link note shown', 'reset link is on its way' in pg.inner_text('#gateForgotNote'))
    ok('reset redirect is this page', pg.evaluate("__mock.reset.opts.redirectTo") == URL)
    pg.click('#gateBackToSignIn'); ok('back to sign in', gate_view(pg) == 'gateSignIn')

    pg.evaluate("__mockRecovery('admin@forvet.test')"); wait_view(pg, 'gateNewPw')
    ok('recovery link opens set-password', gate_view(pg) == 'gateNewPw')
    pg.fill('#gateNewPw1', 'short'); pg.fill('#gateNewPw2', 'short'); pg.click('#gateNewPwSubmit')
    ok('short password rejected', 'at least 8' in pg.inner_text('#gateNewPwError'))
    pg.fill('#gateNewPw1', 'brand-new-pw'); pg.fill('#gateNewPw2', 'brand-new-pX'); pg.click('#gateNewPwSubmit')
    ok('mismatch rejected', "don't match" in pg.inner_text('#gateNewPwError'))
    pg.fill('#gateNewPw2', 'brand-new-pw'); pg.click('#gateNewPwSubmit')
    pg.wait_for_function("document.getElementById('signInGate').hidden", timeout=5000)
    ok('new password saved, signed in', pg.evaluate("__mock.newPw") == 'brand-new-pw' and app_visible(pg))

    m = b.new_context(viewport={'width': 390, 'height': 800}).new_page(); m.goto(URL); wait_view(m, 'gateSignIn')
    ok('mobile: no horizontal scroll', m.evaluate("document.documentElement.scrollWidth <= innerWidth"))
    m.screenshot(path=sys.argv[1] + '/gate_mobile.png') if len(sys.argv) > 1 else None
    if len(sys.argv) > 1:
        pg2 = b.new_context(viewport={'width': 1366, 'height': 860}).new_page(); pg2.goto(URL)
        pg2.wait_for_function("!document.getElementById('signInGate').hidden && !document.getElementById('gateSignIn').hidden")
        pg2.fill('#gateEmail', 'admin@forvet.test'); pg2.fill('#gatePassword', 'nope'); pg2.click('#gateSubmit'); pg2.wait_for_selector('#gateError:not([hidden])')
        pg2.screenshot(path=sys.argv[1] + '/gate_desktop.png')
    ok('no page errors', not errs, errs)
    print(f'{sum(R)}/{len(R)} passed')
