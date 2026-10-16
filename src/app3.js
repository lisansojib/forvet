/* =====================================================================
   UI INFRASTRUCTURE
   ===================================================================== */
const modalStack = [];
function openModal(id) {
  const m = $(id); if (!m) return;
  if (!m.hidden && modalStack.includes(id)) return;
  m._opener = document.activeElement;
  m.hidden = false; modalStack.push(id);
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const first = m.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'); first?.focus({ preventScroll: true }); }, 30);
}
function closeModal(id) {
  const m = $(id); if (!m || m.hidden) return;
  m.hidden = true;
  const i = modalStack.lastIndexOf(id); if (i >= 0) modalStack.splice(i, 1);
  if (!modalStack.length) document.body.style.overflow = '';
  if (m._dialogResolve) { const r = m._dialogResolve; m._dialogResolve = null; r(null); }
  if (m._opener && document.contains(m._opener)) m._opener.focus({ preventScroll: true });
}
/** Generic dialog. buttons: [{label, value, style}] → resolves with value (null if dismissed). */
function uiDialog(title, bodyHtml, buttons) {
  return new Promise(resolve => {
    const m = $('uiDialog');
    if (m._dialogResolve) { const prev = m._dialogResolve; m._dialogResolve = null; prev(null); }
    $('uiDialogTitle').textContent = title;
    $('uiDialogBody').innerHTML = bodyHtml;
    const styles = { primary: 'bg-emerald-600 hover:bg-emerald-500 text-white', danger: 'bg-rose-600 hover:bg-rose-500 text-white', plain: 'bg-white border border-slate-300 text-slate-800 hover:bg-slate-100', dark: 'bg-slate-900 text-white' };
    $('uiDialogButtons').innerHTML = buttons.map((b, i) => `<button type="button" data-dlg="${i}" class="px-4 py-2 rounded-lg text-xs font-bold ${styles[b.style || 'plain']}">${esc(b.label)}</button>`).join('');
    m._dialogResolve = resolve;
    qsa('[data-dlg]', m).forEach(btn => btn.addEventListener('click', () => {
      const b = buttons[Number(btn.dataset.dlg)];
      let value = b.value;
      if (b.readInput) value = { button: b.value, text: $('uiDialogInput')?.value ?? '' };
      const r = m._dialogResolve; m._dialogResolve = null; closeModal('uiDialog'); r(value);
    }));
    openModal('uiDialog');
    const input = $('uiDialogInput');
    if (input) setTimeout(() => { input.focus(); input.select?.(); }, 40);
  });
}
function uiAlert(title, text) { return uiDialog(title, `<p>${esc(text)}</p>`, [{ label: 'OK', value: true, style: 'dark' }]); }
async function uiConfirm(title, text, okLabel = 'Continue', danger = false) { return (await uiDialog(title, `<p>${esc(text)}</p>`, [{ label: 'Cancel', value: false }, { label: okLabel, value: true, style: danger ? 'danger' : 'primary' }])) === true; }
async function uiPrompt(title, text, def = '', okLabel = 'OK') {
  const r = await uiDialog(title, `<p>${esc(text)}</p><input id="uiDialogInput" type="text" class="w-full mt-2 px-3 py-2 border border-slate-300 rounded-lg" value="${esc(def)}" />`, [{ label: 'Cancel', value: false }, { label: okLabel, value: true, style: 'primary', readInput: true }]);
  return r && r.button ? r.text.trim() : null;
}
let toastTimer = null;
function toast(msg, action) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? ` <button type="button" id="toastAction" class="ml-3 underline font-extrabold text-emerald-300">${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  if (action) $('toastAction').onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : 3500);
}
const banners = new Map();
function showBanner(key, level, text, actions = []) { banners.set(key, { level, text, actions }); drawBanners(); }
function hideBanner(key) { if (banners.delete(key)) drawBanners(); }
function drawBanners() {
  const host = $('globalBanner'); if (!host) return;
  const style = { error: 'bg-rose-50 border-rose-300 text-rose-900', info: 'bg-sky-50 border-sky-300 text-sky-900', warn: 'bg-amber-50 border-amber-300 text-amber-950' };
  host.innerHTML = [...banners.entries()].map(([k, b]) => `<div class="border rounded-lg px-3 py-2 text-xs flex flex-wrap items-center gap-2 mb-2 ${style[b.level] || style.info}"><span class="flex-1 min-w-[200px]">${esc(b.text)}</span>${b.actions.map(a => `<button type="button" data-act="${esc(a.act)}" class="font-bold underline">${esc(a.label)}</button>`).join('')}</div>`).join('');
  host.hidden = banners.size === 0;
}
function elKey(el) {
  if (!el || el === document.body) return null;
  if (el.dataset?.line) return `L|${el.dataset.line}|${el.dataset.field}`;
  if (el.dataset?.packField) return `P|${el.dataset.packField}`;
  if (el.id) return `#${el.id}`;
  return null;
}
function findByKey(key) {
  if (!key) return null;
  if (key.startsWith('#')) return $(key.slice(1));
  const [t, a, b] = key.split('|');
  if (t === 'L') return document.querySelector(`[data-line="${CSS.escape(a)}"][data-field="${CSS.escape(b)}"]`);
  if (t === 'P') return document.querySelector(`[data-pack-field="${CSS.escape(a)}"]`);
  return null;
}
/** Re-render after the browser has moved focus, then put focus back on the same logical control. */
function rerenderKeepFocus() {
  setTimeout(() => {
    const key = elKey(document.activeElement);
    renderAll();
    const el = findByKey(key);
    if (el && el !== document.activeElement && !el.disabled) el.focus({ preventScroll: true });
  }, 0);
}
function initCollapsibles() {
  qsa('section[data-collapsible]').forEach(sec => {
    const head = sec.querySelector('.sec-head'); const body = sec.querySelector('.sec-body');
    if (!head || !body || head.querySelector('.sec-toggle')) return;
    const name = sec.dataset.collapsible;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sec-toggle no-print ml-auto';
    const title = (head.querySelector('h2')?.textContent || 'section').trim();
    const apply = collapsed => { body.hidden = collapsed; sec.classList.toggle('is-collapsed', collapsed); btn.setAttribute('aria-expanded', String(!collapsed)); btn.textContent = collapsed ? '▸ Expand' : '▾ Collapse'; btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${title}`); };
    btn.addEventListener('click', () => { const c = !body.hidden; UI.collapsed[name] = c; saveUI(); apply(c); });
    head.appendChild(btn);
    apply(!!UI.collapsed[name]);
  });
}
function initEnterNavigation() {
  const selector = 'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]), select, textarea';
  const visible = el => !el.disabled && el.tabIndex !== -1 && el.getClientRects().length > 0 && !el.closest('[hidden]');
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return;
    const cur = ev.target;
    if (!(cur instanceof HTMLInputElement)) return;                 // never intercept Enter in selects, textareas, buttons
    if (!cur.matches(selector)) return;
    const form = cur.closest('form');
    if (form && form.hasAttribute('data-enter-submit')) return;     // sign-in: Enter submits
    const scope = form || cur.closest('.modal-panel') || document;
    const controls = qsa(selector, scope).filter(visible);
    const idx = controls.indexOf(cur);
    const next = controls.slice(idx + 1)[0];
    if (!next) { if (form) return; ev.preventDefault(); cur.blur(); return; }   // last field in a form → normal submit
    ev.preventDefault();
    const nextKey = elKey(next);
    cur.blur();                                                      // commits the value (change event)
    setTimeout(() => setTimeout(() => {
      const target = (nextKey && findByKey(nextKey)) || (document.contains(next) ? next : null);
      if (target && !target.disabled) { target.focus(); if (target instanceof HTMLInputElement && /^(text|number|search|email|tel|url)$/.test(target.type)) target.select?.(); }
    }, 0), 0);
  });
  document.addEventListener('focusout', ev => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement && el.type === 'text') && !(el instanceof HTMLTextAreaElement)) return;
    if (el.closest('#authForm')) return;
    const v = normalizeVitaminTerms(el.value);
    if (v !== el.value) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}
function initBackToTop() {
  const btn = $('backToTopBtn');
  const upd = () => { btn.hidden = window.scrollY < 260; };
  window.addEventListener('scroll', upd, { passive: true }); upd();
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* =====================================================================
   FORMULATION ACTIONS
   ===================================================================== */
function requireEdit(what) {
  if (canEdit()) return true;
  uiAlert('View only', isCloudMode() ? `Only an administrator can ${what}. Sign in with an administrator account.` : `You cannot ${what} right now.`);
  return false;
}
function switchFormulation(id) {
  if (!S.formulations[id] || S.formulations[id].deletedAt) return;
  UI.currentId = id; saveUI(); renderAll();
}
function setMode(mode) {
  UI.mode = mode === 'calculate' ? 'calculate' : 'formulate'; saveUI();
  if (!$('materialsView').hidden) closeMaterials(true);
  renderAll();
  if (UI.mode === 'calculate') $('packagingSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function newFormulationDoc({ name, form, batchSize, status, intention }) {
  return sanitizeFormulation({ id: uid('f'), name, form, batchSize, status, intention, species: ['Cattle', 'Poultry'], rows: [{ ingId: DEFAULT_CARRIER[form], role: CARRIER_ROLE, autoMakeup: true }], commercialByPack: {} }, null, S.ingredients);
}
function createFromForm(ev) {
  ev.preventDefault();
  if (!requireEdit('create formulations')) return;
  const name = normalizeVitaminTerms($('createProdName').value.trim()) || 'New formulation';
  const batch = toNum($('createBatchSize').value);
  if (!batch || batch <= 0) { uiAlert('Batch size', 'Enter a batch size greater than zero.'); return; }
  const f = newFormulationDoc({ name, form: document.querySelector('input[name=createFormRadio]:checked').value, batchSize: batch, status: $('createInitialStatus').value, intention: document.querySelector('input[name=createIntentionRadio]:checked').value });
  S.formulations[f.id] = f; markDirty('formulation', f.id);
  closeModal('createModal'); UI.mode = 'formulate'; switchFormulation(f.id);
  toast(`Created “${f.name}”. Add ingredient rows to start.`);
}
async function duplicateCurrent() {
  const f = current(); if (!f || !requireEdit('duplicate formulations')) return;
  const name = await uiPrompt('Duplicate formulation', 'Name for the copy:', `${f.name} (Copy)`, 'Duplicate');
  if (!name) return;
  const copy = clone(f); copy.id = uid('f'); copy.name = normalizeVitaminTerms(name); copy.status = 'In Progress'; copy.createdAt = nowIso(); copy.deletedAt = null;
  copy.rows.forEach(r => { r.lineId = uid('l'); });
  S.formulations[copy.id] = copy; markDirty('formulation', copy.id);
  UI.packKey[copy.id] = UI.packKey[f.id]; switchFormulation(copy.id); toast('Duplicated. Pricing per pack was copied too.');
}
async function deleteFormulation(id) {
  const f = S.formulations[id]; if (!f || !requireEdit('delete formulations')) return;
  if (activeFormulations().length <= 1) { uiAlert('Cannot delete', 'At least one formulation must remain.'); return; }
  const ok = await uiConfirm('Delete formulation?', `“${f.name}” (${f.form}, ${fmtNum(f.batchSize, 3)} ${mainUnit(f.form)}) moves to Recently deleted in My Formulations. You can restore it from there.`, 'Delete', true);
  if (!ok) return;
  f.deletedAt = nowIso(); markDirty('formulation', id);
  ensureCurrentValid(); renderAll();
  toast(`Deleted “${f.name}”.`, { label: 'Undo', run: () => restoreFormulation(id) });
}
function restoreFormulation(id) {
  const f = S.formulations[id]; if (!f || !requireEdit('restore formulations')) return;
  f.deletedAt = null; markDirty('formulation', id); renderAll(); toast(`Restored “${f.name}”.`);
}
function saveStatus(status) {
  const f = current(); if (!f || !requireEdit('change the status')) return;
  if (status === 'Complete') {
    const c = calcFormulation(f); const blockers = c.warnings.filter(w => w.level === 'error');
    if (blockers.length) { uiAlert('Not ready to mark Complete', blockers.map(b => b.text).join(' ')); return; }
  }
  f.status = status; markDirty('formulation', f.id); renderAll(); toast(`Saved as “${status}”.`);
}
function addRow(ingId = null, qty = null) {
  const f = current(); if (!f || !requireEdit('edit formulations')) return;
  const ing = getIng(ingId);
  const row = { lineId: uid('l'), ingId: ing ? ing.id : null, role: ing ? primaryRole(ing) : null, qty: qty === null ? null : round(qty, 6), autoMakeup: false };
  f.rows.unshift(row); markDirty('formulation', f.id); renderAll();
  if (!ingId) document.querySelector(`[data-line="${row.lineId}"][data-field="ing"]`)?.focus();
}
function findRow(f, lineId) { return f.rows.find(r => r.lineId === lineId); }
function removeRow(lineId) {
  const f = current(); if (!f || !requireEdit('edit formulations')) return;
  const idx = f.rows.findIndex(r => r.lineId === lineId); if (idx < 0 || f.rows[idx].autoMakeup) return;
  const [removed] = f.rows.splice(idx, 1);
  markDirty('formulation', f.id); renderAll();
  const label = getIng(removed.ingId) ? ingLabel(getIng(removed.ingId)) : 'empty row';
  toast(`Removed ${label}.`, { label: 'Undo', run: () => { if (!S.formulations[f.id]) return; S.formulations[f.id].rows.splice(Math.min(idx, S.formulations[f.id].rows.length), 0, removed); markDirty('formulation', f.id); renderAll(); } });
}
function onRowChange(el) {
  const f = current(); if (!f) return;
  if (!canEdit()) { renderAll(); return; }
  const row = findRow(f, el.dataset.line); if (!row) return;
  const field = el.dataset.field;
  if (field === 'ing') {
    const prevIng = getIng(row.ingId);
    const customRole = row.role && prevIng && row.role !== primaryRole(prevIng);
    row.ingId = el.value || null;
    const ing = getIng(row.ingId);
    if (row.autoMakeup) row.role = CARRIER_ROLE;
    else if (!ing) row.role = null;
    else if (!customRole) row.role = primaryRole(ing);
  } else if (field === 'role') {
    if (row.autoMakeup) return;
    row.role = normalizeCategory(el.value) || null;
  } else if (field === 'qty') {
    const raw = String(el.value).trim();
    if (raw === '') row.qty = null;
    else {
      const v = toNum(raw);
      if (v === null || v < 0) { toast('Quantity must be zero or a positive number.'); rerenderKeepFocus(); return; }
      row.qty = round(v, 6);
    }
  }
  markDirty('formulation', f.id);
  rerenderKeepFocus();
}
function onMetaChange(el) {
  const f = current(); if (!f) return;
  if (!canEdit()) { renderAll(); return; }
  if (el.id === 'productName') {
    const v = normalizeVitaminTerms(el.value).trim();
    f.name = v || 'Untitled formulation'; if (!v) el.value = f.name;
    markDirty('formulation', f.id); renderProductSelects(); $('packSettingsScope').textContent = `${f.name} · ${S.settings.packaging[f.form][currentPackKey(f)]?.label || ''}`;
    return;
  }
  if (el.id === 'productForm') {
    const old = f.form; const nf = el.value === 'Powder' ? 'Powder' : 'Liquid';
    if (old === nf) return;
    f.form = nf;
    const qs = f.rows.find(r => r.autoMakeup);
    if (qs && (qs.ingId === DEFAULT_CARRIER[old] || !qs.ingId)) qs.ingId = getIng(DEFAULT_CARRIER[nf]) ? DEFAULT_CARRIER[nf] : qs.ingId;
    delete UI.packKey[f.id]; saveUI();
    markDirty('formulation', f.id); renderAll(); toast(`Switched to ${nf}. Check the Q.S. carrier and pack sizes.`);
    return;
  }
  if (el.id === 'batchSize') {
    const nb = toNum(el.value);
    if (!nb || nb <= 0) { toast('Batch size must be greater than zero.'); el.value = f.batchSize; return; }
    if (nb === f.batchSize) return;
    const ratio = nb / f.batchSize;
    f.rows.forEach(r => { if (!r.autoMakeup && r.qty !== null) r.qty = round(r.qty * ratio, 6); });
    f.batchSize = nb; markDirty('formulation', f.id); renderAll();
    toast(`Batch set to ${fmtNum(nb, 3)} ${mainUnit(f.form)}; quantities scaled ×${fmtNum(ratio, 4)}.`);
    return;
  }
  if (el.id === 'formulationIntention') { f.intention = el.value === 'Performance' ? 'Performance' : 'Cost Effective'; markDirty('formulation', f.id); renderAll(); return; }
  if (el.classList.contains('species-checkbox')) { f.species = qsa('.species-checkbox:checked').map(c => c.value); markDirty('formulation', f.id); renderAll(); }
}
function onNotesInput(el) {
  const f = current(); if (!f || !canEdit()) return;
  f.notes = f.notes || { dosage: '', process: '' };
  if (el.id === 'dosageNotes') f.notes.dosage = el.value; else f.notes.process = el.value;
  markDirty('formulation', f.id);
}
function readCommercialInputs() {
  return sanitizeCommercial({ mrp: $('commMrpInput').value, tp: $('commTpInput').value, bonusMode: $('commBonusSelect').value, customFree: $('customBonusFree').value, customPaid: $('customBonusPaid').value, cashDiscPct: $('commCashDiscPct').value, addOfferBdt: $('commAdditionalOfferBdt').value, promoNote: $('commPromoNote').value });
}
function onCommercialInput() {
  const f = current(); if (!f || !canEdit()) return;
  const key = currentPackKey(f);
  f.commercialByPack = f.commercialByPack || {};
  f.commercialByPack[key] = readCommercialInputs();
  $('customBonusInputsWrap').hidden = $('commBonusSelect').value !== 'custom';
  markDirty('formulation', f.id);
  renderCommercialOutputs(calcFormulation(f));
}
async function applyPricingToAllPacks() {
  const f = current(); if (!f || !requireEdit('change pricing')) return;
  const key = currentPackKey(f); const sizes = S.settings.packaging[f.form];
  const base = getCommercial(f, key);
  if (!base.isSet) { uiAlert('Set this pack first', 'Enter pricing for the current pack before copying it.'); return; }
  const ok = await uiConfirm('Copy pricing to every pack size?', `MRP, TP and additional offer for ${sizes[key].label} will be scaled by pack size and written to all other ${f.form.toLowerCase()} packs of “${f.name}”, replacing their current values. Bonus, cash discount and note are copied as-is.`, 'Copy to all packs', true);
  if (!ok) return;
  for (const k of packKeysFor(f.form)) {
    if (k === key) continue;
    const ratio = sizes[k].sizeInUnit / sizes[key].sizeInUnit;
    f.commercialByPack[k] = sanitizeCommercial({ ...base, mrp: round(base.mrp * ratio, 2), tp: round(base.tp * ratio, 2), addOfferBdt: round(base.addOfferBdt * ratio, 2) });
  }
  markDirty('formulation', f.id); renderAll(); toast('Pricing copied to all pack sizes.');
}
function onPackFieldChange(el) {
  const f = current(); if (!f || !canEdit()) { renderAll(); return; }
  const v = toNum(el.value);
  if (v === null || v < 0) { toast('Packaging cost must be zero or more.'); rerenderKeepFocus(); return; }
  S.settings.packaging[f.form][currentPackKey(f)][el.dataset.packField] = round(v, 4);
  markDirty('settings', 'main'); rerenderKeepFocus();
}
function setPackKey(key) {
  const f = current(); if (!f || !S.settings.packaging[f.form][key]) return;
  UI.packKey[f.id] = key; saveUI(); renderAll();
}

/* ---------------- optimizer ---------------- */
function openOptimizer() {
  const f = current(); if (!f || !requireEdit('use the optimizer')) return;
  const calc = calcFormulation(f); const items = [];
  for (const l of calc.lines) {
    if (!l.complete || l.isQs || l.role === CARRIER_ROLE || !(l.qty > 0)) continue;
    const alt = findAlternative(l.ing, f.intention); if (!alt) continue;
    items.push({ l, alt, plan: swapPlan(l, alt) });
  }
  $('swapModalTitle').textContent = `${f.intention} swap suggestions`;
  $('swapModalBody').innerHTML = items.length ? items.map(({ l, alt, plan }) => `<div class="p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div class="min-w-0"><div class="font-bold text-slate-900">${esc(ingLabel(l.ing))} <span class="text-slate-500 font-normal">(৳${fmtNum(l.rate, 2)}, abs ${fmtNum(l.ing.absorption, 1)}%)</span></div><div class="text-emerald-800 font-bold">→ ${esc(ingLabel(alt))} <span class="text-slate-500 font-normal">(৳${fmtNum(alt.rate, 2)}, abs ${fmtNum(alt.absorption, 1)}%)</span></div><div class="text-[11px] text-slate-600 mt-0.5">${plan.keepsElement ? `Quantity ${fmtNum(l.qty, 4)} → ${fmtNum(plan.newQty, 4)} ${mainUnit(f.form)} to keep ${esc(plan.element)} the same.` : `Quantity kept at ${fmtNum(l.qty, 4)} — no shared element to rebalance, check the label claim.`} Batch cost change: <strong class="${plan.saving >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${plan.saving >= 0 ? '−' : '+'}${fmtBDT(Math.abs(plan.saving))}</strong></div></div><button type="button" data-act="swap-row" data-line="${esc(l.row.lineId)}" data-alt="${esc(alt.id)}" class="admin-only bg-emerald-600 text-white font-bold px-3 py-1.5 rounded text-xs shrink-0">Swap</button></div>`).join('')
    : '<div class="py-4 text-center font-bold text-emerald-700">✓ No swaps suggested from the current master list.</div>';
  $('applyAllSwapsBtn').hidden = !items.length;
  openModal('swapModal'); applyPermissions();
}
function swapRow(lineId, altId, silent) {
  const f = current(); if (!f || !requireEdit('modify formulations')) return;
  const calc = calcFormulation(f); const l = calc.lines.find(x => x.row.lineId === lineId); const alt = getIng(altId);
  if (!l || !alt) return;
  const plan = swapPlan(l, alt);
  l.row.ingId = alt.id; l.row.qty = round(plan.newQty, 6);
  markDirty('formulation', f.id);
  if (!silent) { renderAll(); if (!$('swapModal').hidden) openOptimizer(); toast(`Swapped to ${ingLabel(alt)}.`); }
}
function applyAllSwaps() {
  const f = current(); if (!f || !requireEdit('modify formulations')) return;
  const calc = calcFormulation(f); let n = 0;
  for (const l of calc.lines) { if (!l.complete || l.isQs || l.role === CARRIER_ROLE || !(l.qty > 0)) continue; const alt = findAlternative(l.ing, f.intention); if (alt) { swapRow(l.row.lineId, alt.id, true); n++; } }
  closeModal('swapModal'); renderAll(); toast(`${n} swap(s) applied.`);
}

/* ---------------- materials ---------------- */
let materialsReturnY = 0;
function openMaterials() {
  materialsReturnY = window.scrollY;
  $('materialsReturnName').textContent = `“${current()?.name || ''}”`;
  $('workspace').hidden = true; $('materialsView').hidden = false;
  closeModal('moreSheet');
  renderMaterials(); window.scrollTo({ top: 0 });
  $('mobileMaterialsBtn')?.classList.add('bg-emerald-500', 'text-slate-950');
}
function closeMaterials(silent) {
  $('materialsView').hidden = true; $('workspace').hidden = false;
  $('mobileMaterialsBtn')?.classList.remove('bg-emerald-500', 'text-slate-950');
  renderAll();
  if (!silent) requestAnimationFrame(() => window.scrollTo({ top: materialsReturnY }));
}
function matchMaterial(rawName, opts = {}) {
  const name = normalizeVitaminTerms(String(rawName || '').trim());
  const nk = nameKey(name); const ak = aliasKey(name);
  const list = sortedIngredients(!!opts.includeArchived);
  if (!nk) return { status: 'none', candidates: [] };
  const exact = list.filter(i => nameKey(i.name) === nk || nameKey(ingLabel(i)) === nk);
  if (exact.length === 1) return { status: 'exact', best: exact[0], candidates: exact };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };
  const alias = list.filter(i => i.aliases.some(a => nameKey(a) === nk || (ak && aliasKey(a) === ak)) || (ak && aliasKey(i.name) === ak) || nameKey(i.name).split('(')[0].trim() === nk || nameKey(i.name).split(/\s*\/\s*/).includes(nk));
  if (alias.length === 1) return { status: 'alias', best: alias[0], candidates: alias };
  if (alias.length > 1) return { status: 'ambiguous', candidates: alias };
  if (!ak) return { status: 'none', candidates: [] };
  const scored = list.map(i => {
    const ik = aliasKey(i.name);
    let s = similarity(ak, ik);
    for (const a of i.aliases) s = Math.max(s, similarity(ak, aliasKey(a)));
    if (ak.length >= 5 && (ik.startsWith(ak + ' ') || ik.includes(' ' + ak + ' '))) s = Math.max(s, 0.84);
    return { ing: i, score: s };
  }).filter(x => x.score >= 0.78).sort((a, b) => b.score - a.score).slice(0, 5);
  if (!scored.length) return { status: 'none', candidates: [] };
  return { status: 'fuzzy', candidates: scored.map(x => x.ing), scores: scored.map(x => x.score) };
}
function buildElementalMap(choice, name, potency) {
  const p = Number(potency) || 0;
  const map = { Ca: 'Elemental Calcium (Ca)', P: 'Elemental Phosphorus (P)', Zn: 'Elemental Zinc (Zn)', Cu: 'Elemental Copper (Cu)', Se: 'Elemental Selenium (Se)', Mg: 'Elemental Magnesium (Mg)', VitA: 'Vitamin A (Retinol)', VitD3: 'Vitamin D3 (Cholecalciferol)', VitE: 'Vitamin E (Alpha-Tocopherol)', VitC: 'Vitamin C (L-Ascorbic Acid)' };
  if (choice === 'None') return {};
  if (map[choice]) return p ? { [map[choice]]: p } : {};
  const ref = referenceSpecs(name);
  if (ref) return { ...ref.elementalMap };
  return p ? { [name]: p } : {};
}
function makeMaterial({ name, formVersion = '', categories, rate, potency, iu = 0, elementChoice = 'Auto', unconfirmed = false }) {
  const ref = referenceSpecs(name);
  const isActive = categories.includes(ACTIVE_ROLE);
  const pot = potency === null || potency === undefined ? (ref && isActive ? ref.potency : 0) : potency;
  const em = isActive ? buildElementalMap(elementChoice, name, pot) : {};
  return sanitizeIngredient({
    id: uid('ing'), name, formVersion, categories, rate: rate ?? 0, potencyPct: pot, absorption: ref?.absorption ?? 85, vitaminIUPerGram: iu,
    elementGroup: ref?.elementGroup || (isActive ? 'General Nutritional Active' : categories[0]), activeElement: isActive ? (ref?.activeElement || `${name}${pot ? ` (${pot}%)` : ''}`) : 'Excipient',
    elementalMap: em, indication: ref?.indication || '', unconfirmed: unconfirmed || (potency == null && isActive && !!ref)
  });
}
async function quickAdd(ev) {
  ev.preventDefault();
  if (!requireEdit('add materials')) return;
  const name = normalizeVitaminTerms($('quickIngName').value.trim()); if (!name) return;
  let formVersion = normalizeVitaminTerms($('quickIngForm').value.trim());
  const cats = qsa('#quickIngCategories input:checked').map(i => i.value);
  const categories = cats.length ? cats : [ACTIVE_ROLE];
  const rate = toNum($('quickIngRate').value);
  if (rate === null || rate < 0) { uiAlert('Rate required', 'Enter the purchase rate per kg or L (৳). Use 0 only if the material is free.'); return; }
  const sameName = sortedIngredients(true).filter(i => nameKey(i.name) === nameKey(name));
  if (sameName.length) {
    const choice = await uiDialog('Ingredient Already Exists', `<p>Ingredient Already Exists. Do You Want to Add a Different Form/Version?</p><p class="text-xs text-slate-500">Existing: ${sameName.map(i => esc(ingLabel(i)) + (i.archived ? ' (archived)' : '')).join('; ')}</p>`, [{ label: 'Cancel', value: 'cancel' }, { label: 'Open existing', value: 'open' }, { label: 'Add different form/version', value: 'add', style: 'primary' }]);
    if (choice === 'open') { openEditIngredient(sameName[0].id); return; }
    if (choice !== 'add') return;
    while (!formVersion || sameName.some(i => nameKey(i.formVersion) === nameKey(formVersion))) {
      const fv = await uiPrompt('Form / version', `Enter a form or version that is different from the existing record(s) — e.g. Feed Grade, Pharma Grade, 99%, Liquid.`, formVersion, 'Use this');
      if (fv === null) return;
      formVersion = normalizeVitaminTerms(fv);
    }
  } else {
    const m = matchMaterial(name, { includeArchived: true });
    if (m.status === 'alias' || m.status === 'exact') {
      const choice = await uiDialog('Possible duplicate', `<p>“${esc(name)}” looks like the existing material <strong>${esc(ingLabel(m.best))}</strong> (known alias or alternative spelling).</p>`, [{ label: 'Cancel', value: 'cancel' }, { label: 'Open existing', value: 'open', style: 'primary' }, { label: 'Add as a new material anyway', value: 'add' }]);
      if (choice === 'open') { openEditIngredient(m.best.id); return; }
      if (choice !== 'add') return;
    }
  }
  const ing = makeMaterial({ name, formVersion, categories, rate, potency: toNum($('quickIngPotency').value), iu: toNum($('quickIngVitaminIU').value) || 0, elementChoice: $('quickIngElementKey').value });
  S.ingredients[ing.id] = ing; markDirty('ingredient', ing.id);
  $('quickAddForm').reset(); renderAll(); toast(`Added ${ingLabel(ing)}.`);
}
function openEditIngredient(id) {
  const i = getIng(id); if (!i) return;
  $('editIngId').value = i.id; $('editIngName').value = i.name; $('editIngForm').value = i.formVersion; $('editIngAliases').value = i.aliases.join(', ');
  categoryChips('editIngCategories', i.categories, 'editCat');
  $('editIngGroup').value = i.elementGroup; $('editIngActive').value = i.activeElement; $('editIngRate').value = i.rate; $('editIngPotency').value = i.potencyPct;
  $('editIngAbsorption').value = i.absorption; $('editIngVitaminIU').value = i.vitaminIUPerGram || '';
  $('editIngElemental').value = Object.entries(i.elementalMap).map(([k, v]) => `${k}, ${v}`).join('\n');
  $('editIngSpecies').value = i.speciesRule; $('editIngIndication').value = i.indication; $('editIngSupplier').value = i.supplierNote; $('editIngConfirmed').checked = !i.unconfirmed;
  $('editIngTitle').textContent = `✏️ Edit material${i.archived ? ' (archived)' : ''}`;
  openModal('editIngredientModal'); applyPermissions();
}
async function saveIngredientEdit(ev) {
  ev.preventDefault();
  if (!requireEdit('edit materials')) return;
  const i = getIng($('editIngId').value); if (!i) return;
  const name = normalizeVitaminTerms($('editIngName').value.trim()); const fv = normalizeVitaminTerms($('editIngForm').value.trim());
  if (!name) return;
  const dup = Object.values(S.ingredients).find(o => o.id !== i.id && nameKey(o.name) === nameKey(name) && nameKey(o.formVersion) === nameKey(fv));
  if (dup) { uiAlert('Duplicate', `“${ingLabel(dup)}” already exists with this exact name and form/version. Change the form/version or edit that record instead.`); return; }
  const em = {}; const bad = [];
  for (const line of $('editIngElemental').value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^(.*?)[,\t:]\s*([-+]?\d+(?:\.\d+)?)\s*%?\s*$/);
    if (!m) { bad.push(line.trim()); continue; }
    em[normalizeVitaminTerms(m[1].trim())] = Number(m[2]);
  }
  if (bad.length) { uiAlert('Check elemental content', `These lines need “Name, %” format: ${bad.join(' | ')}`); return; }
  const rate = toNum($('editIngRate').value);
  if (rate === null || rate < 0) { uiAlert('Rate', 'Rate must be zero or more.'); return; }
  const cats = qsa('#editIngCategories input:checked').map(x => x.value);
  if (rate !== i.rate && usageCount(i.id).length) {
    const ok = await uiConfirm('Change master rate?', `${ingLabel(i)} is used in ${usageCount(i.id).length} formulation(s). Changing the rate from ${fmtBDT(i.rate)} to ${fmtBDT(rate)} updates their costs.`, 'Update rate');
    if (!ok) return;
  }
  Object.assign(i, { name, formVersion: fv, aliases: [...new Set($('editIngAliases').value.split(',').map(s => s.trim()).filter(Boolean))], categories: cats.length ? cats : [ACTIVE_ROLE],
    elementGroup: $('editIngGroup').value.trim(), activeElement: normalizeVitaminTerms($('editIngActive').value.trim()), rate, potencyPct: toNum($('editIngPotency').value) ?? 0,
    absorption: toNum($('editIngAbsorption').value) ?? 85, vitaminIUPerGram: Math.max(0, toNum($('editIngVitaminIU').value) || 0), elementalMap: em,
    speciesRule: $('editIngSpecies').value, indication: normalizeVitaminTerms($('editIngIndication').value.trim()), supplierNote: $('editIngSupplier').value.trim(), unconfirmed: !$('editIngConfirmed').checked });
  markDirty('ingredient', i.id); closeModal('editIngredientModal'); renderAll(); toast(`Saved ${ingLabel(i)}.`);
}
async function archiveIngredient(id, archive) {
  const i = getIng(id); if (!i || !requireEdit('archive materials')) return;
  if (archive) {
    const used = usageCount(id);
    const msg = used.length ? `${ingLabel(i)} is used in ${used.length} formulation(s): ${used.slice(0, 6).map(f => f.name).join(', ')}${used.length > 6 ? '…' : ''}. Archiving keeps it in those formulations (costs unchanged) but hides it from new selections.` : `${ingLabel(i)} will be hidden from material lists. You can restore it with “Show archived”.`;
    if (!(await uiConfirm('Archive material?', msg, 'Archive', true))) return;
  }
  i.archived = !!archive; markDirty('ingredient', id); renderAll(); toast(archive ? 'Archived.' : 'Restored.');
}
async function addCategory(targetId) {
  if (!requireEdit('add categories')) return;
  const name = normalizeCategory(await uiPrompt('Add New Category', 'Category name:', '', 'Add category') || '');
  if (!name) return;
  if (!S.settings.categories.some(c => nameKey(c) === nameKey(name))) { S.settings.categories.push(name); markDirty('settings', 'main'); }
  const host = $(targetId); const checked = qsa('input:checked', host).map(x => x.value); checked.push(S.settings.categories.find(c => nameKey(c) === nameKey(name)));
  categoryChips(targetId, checked, targetId === 'editIngCategories' ? 'editCat' : 'quickCat'); applyPermissions();
}
