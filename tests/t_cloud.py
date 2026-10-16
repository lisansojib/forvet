import json, subprocess, time
from playwright.sync_api import sync_playwright
URL='http://localhost:8090/index.html'
errs=[]
def ok(n,c,e=''): print('PASS' if c else 'FAIL', n, e, flush=True)
def sql(q): return subprocess.run(['su','postgres','-c',f'psql -At -d sb -c "{q}"'],capture_output=True,text=True).stdout.strip()
def page(ctx, tag):
    ctx.route('**/@supabase/supabase-js@2.117.2/**', lambda r: r.fulfill(path='/tmp/cloud/site/supabase.js', content_type='application/javascript'))
    p=ctx.new_page()
    p.on('pageerror', lambda e: errs.append(f'{tag} PAGEERROR {e}'))
    p.on('console', lambda m: errs.append(f'{tag} {m.text}') if m.type=='error' and 'fonts.g' not in m.text and 'ERR_NAME_NOT_RESOLVED' not in m.text else None)
    p.goto(URL, wait_until='domcontentloaded'); p.wait_for_function('window.__forvetReady===true', timeout=20000); return p
def login(p, email, pw):
    p.click('#authButton'); p.fill('#authEmail',email); p.fill('#authPassword',pw); p.press('#authPassword','Enter')
    p.wait_for_function(f"CLOUD.user && CLOUD.user.email==='{email}'", timeout=10000); p.wait_for_timeout(800)
def settle(p): p.wait_for_function("outbox.size===0 && !CLOUD.flushing", timeout=15000)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    # ---- anonymous visitor on empty cloud
    anon=b.new_context(); a=page(anon,'ANON')
    ok('anon: view-only badge', 'view only' in a.inner_text('#cloudStatusBadge').lower(), a.inner_text('#cloudStatusBadge'))
    a.wait_for_timeout(400); ok('anon: seed banner', 'empty' in a.inner_text('#globalBanner'))
    ok('anon: inputs disabled', a.is_disabled('#productName') and a.is_disabled('#formulateTop [data-act=add-row]'))
    r=a.evaluate("CLOUD.client.from('forvet_formulations').insert({id:'hack',data:{}}).then(x=>x.error&&x.error.message)")
    ok('anon: direct insert rejected by DB', bool(r), r)
    # ---- admin device 1: seed
    c1=b.new_context(); p1=page(c1,'D1')
    login(p1,'admin@forvet.test','adminpass')
    p1.wait_for_selector('#uiDialog:not([hidden])', timeout=8000)
    ok('admin: seed prompt', 'Cloud database is empty' in p1.inner_text('#uiDialogTitle'))
    p1.click('#uiDialogButtons button:has-text("Upload to cloud")'); settle(p1)
    ok('admin: seeded to DB', sql('select count(*) from forvet_formulations')=='3' and int(sql('select count(*) from forvet_ingredients'))>=29 and sql('select count(*) from forvet_settings')=='1')
    ok('admin: badge synced', 'synced' in p1.inner_text('#cloudStatusBadge').lower(), p1.inner_text('#cloudStatusBadge'))
    p1.keyboard.press('Escape')
    p1.select_option('#presetSelect','liquid_cal_vit'); p1.fill('#productName','VetCal Cloud v2'); p1.press('#productName','Tab'); settle(p1)
    ok('admin edit synced, version 2', sql("select data->>'name'||'|'||version from forvet_formulations where id='liquid_cal_vit'")=='VetCal Cloud v2|2')
    ok('revision kept', sql("select count(*) from forvet_revisions where entity_id='liquid_cal_vit'")=='1')
    # pack pricing independent in cloud
    p1.click('#btnModeCalculate'); p1.select_option('#packSizeSelect','100ml'); p1.fill('#commMrpInput','45'); p1.press('#commMrpInput','Tab'); settle(p1)
    ok('100ml pricing stored separately', sql("select (data->'commercialByPack'->'100ml'->>'mrp')||'|'||(data->'commercialByPack'->'1L'->>'mrp') from forvet_formulations where id='liquid_cal_vit'")=='45|320')
    # ---- anon reload sees cloud data
    a.reload(wait_until='domcontentloaded'); a.wait_for_function('window.__forvetReady===true')
    ok('anon: sees cloud edit', 'VetCal Cloud v2' in a.inner_html('#presetSelect'))
    # ---- viewer account
    cv=b.new_context(); pv=page(cv,'VIEWER'); login(pv,'viewer@forvet.test','viewerpass')
    ok('viewer: still read-only', pv.is_disabled('#productName') and not pv.evaluate('canEdit()'))
    r=pv.evaluate("CLOUD.client.from('forvet_formulations').update({data:{name:'x'}}).eq('id','liquid_cal_vit').select('id').then(x=>JSON.stringify([x.error&&x.error.message, x.data]))")
    ok('viewer: direct update changes nothing', sql("select data->>'name' from forvet_formulations where id='liquid_cal_vit'")=='VetCal Cloud v2', r)
    r=pv.evaluate("CLOUD.client.from('forvet_admins').insert({user_id:'22222222-2222-2222-2222-222222222222'}).then(x=>x.error&&x.error.message)")
    ok('viewer: cannot self-promote', bool(r) and sql('select count(*) from forvet_admins')=='1', r)
    # ---- admin device 2 + conflict
    c2=b.new_context(); p2=page(c2,'D2'); login(p2,'admin@forvet.test','adminpass')
    p2.select_option('#presetSelect','liquid_cal_vit')
    ok('device 2 loads same cloud state', p2.input_value('#productName')=='VetCal Cloud v2')
    p1.click('#btnModeFormulate'); p1.fill('#productName','From device 1'); p1.press('#productName','Tab'); settle(p1)
    p2.fill('#productName','From device 2'); p2.press('#productName','Tab')
    p2.wait_for_function('conflicts.size===1', timeout=10000)
    ok('device 2: conflict detected, no silent overwrite', sql("select data->>'name' from forvet_formulations where id='liquid_cal_vit'")=='From device 1', p2.inner_text('#cloudStatusBadge'))
    p2.click('#cloudStatusBadge'); p2.click('[data-act=conflict][data-choice=cloud]'); p2.wait_for_timeout(500)
    ok('resolve: use cloud', p2.input_value('#productName')=='From device 1' and p2.evaluate('conflicts.size')==0)
    p2.keyboard.press('Escape')
    # keep-mine path
    p1.fill('#productName','D1 again'); p1.press('#productName','Tab'); settle(p1)
    p2.fill('#productName','D2 wins'); p2.press('#productName','Tab'); p2.wait_for_function('conflicts.size===1', timeout=10000)
    p2.click('#cloudStatusBadge'); p2.click('[data-act=conflict][data-choice=mine]'); settle(p2)
    ok('resolve: keep mine overwrites deliberately', sql("select data->>'name' from forvet_formulations where id='liquid_cal_vit'")=='D2 wins')
    p2.keyboard.press('Escape')
    # ---- offline queue
    c1.set_offline(True); p1.evaluate("window.dispatchEvent(new Event('offline'))")
    p1.reload(wait_until='domcontentloaded') if False else None
    p1.evaluate("pullAll().catch(()=>{})"); p1.wait_for_timeout(500)
    p1.select_option('#presetSelect','aqua_growth'); p1.fill('#productName','Edited offline'); p1.press('#productName','Tab'); p1.wait_for_timeout(1800)
    ok('offline: pending shown, local kept', 'pending' in p1.inner_text('#cloudStatusBadge').lower() and p1.evaluate("S.formulations.aqua_growth.name")=='Edited offline', p1.inner_text('#cloudStatusBadge'))
    ok('offline: DB not yet changed', sql("select data->>'name' from forvet_formulations where id='aqua_growth'")!='Edited offline')
    c1.set_offline(False); p1.evaluate("window.dispatchEvent(new Event('online'))"); settle(p1)
    ok('back online: queued change uploaded', sql("select data->>'name' from forvet_formulations where id='aqua_growth'")=='Edited offline')
    # ---- delete + history restore
    p1.select_option('#presetSelect','powder_electrolyte'); p1.click('#formulateTop [data-act=add-row]'); p1.wait_for_timeout(100)
    line=p1.locator('#formulaTableBody tr').first.get_attribute('data-row')
    p1.select_option(f'select[data-line="{line}"][data-field=ing]','zn_chelate'); p1.fill(f'input[data-line="{line}"][data-field=qty]','1'); p1.press(f'input[data-line="{line}"][data-field=qty]','Tab'); settle(p1)
    p1.click('header [data-act=open-myforms]'); p1.locator('#myFormulationsList > div:has-text("ElectroVit") [data-act=history]').click()
    p1.wait_for_selector('#historyBody [data-act=history-restore]', timeout=8000)
    n=p1.locator('#historyBody [data-act=history-restore]').count()
    p1.locator('#historyBody [data-act=history-restore]').last.click(); p1.click('#uiDialogButtons button:has-text("Restore")'); settle(p1)
    rows=int(sql("select jsonb_array_length(data->'rows') from forvet_formulations where id='powder_electrolyte'"))
    ok('history: restore earlier version', n>=1 and rows==10, (n,rows))
    # ---- reload persistence & logout
    p1.reload(wait_until='domcontentloaded'); p1.wait_for_function('window.__forvetReady===true'); p1.wait_for_function('CLOUD.ready', timeout=10000)
    ok('admin session persists across reload', p1.evaluate('CLOUD.isAdmin'))
    b.close()
print('ERRORS:', errs)
