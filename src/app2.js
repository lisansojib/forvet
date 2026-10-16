/* =====================================================================
   CALCULATION ENGINE (pure functions of state)
   ===================================================================== */
function vitaminKind(text) {
  const t = normalizeVitaminTerms(String(text || '')).toLowerCase();
  if (/\bvitamin\s*d3\b|cholecalciferol/.test(t)) return 'D3';
  if (/\bvitamin\s*a\b|retinol|retinyl/.test(t)) return 'A';
  return null;
}
function ingVitaminKind(ing) { return ing ? vitaminKind(`${ing.name} ${ing.activeElement} ${Object.keys(ing.elementalMap || {}).join(' ')}`) : null; }
/** Theoretical IU from pure vitamin mass (mg). Vitamin A: 1 IU = 0.3 µg retinol. Vitamin D3: 1 µg = 40 IU. */
function iuFromPureMg(kind, mg) { return kind === 'A' ? mg * (1000 / 0.3) : kind === 'D3' ? mg * 40000 : null; }
function fmtMass(mg) { const v = Number(mg) || 0; if (Math.abs(v) >= 1000) return `${fmtNum(v / 1000, 3)} g`; if (Math.abs(v) < 1 && v !== 0) return `${fmtNum(v * 1000, 2)} mcg`; return `${fmtNum(v, 3)} mg`; }
function fmtIU(iu) { return `${fmtNum(iu, 0)} IU`; }

function calcFormulation(f) {
  const batch = Number(f.batchSize) || 0;
  const unit = mainUnit(f.form);
  const warnings = [];
  const lines = f.rows.map(row => {
    const ing = getIng(row.ingId);
    const qty = row.autoMakeup ? null : toNum(row.qty);
    const role = row.ingId ? (row.role || primaryRole(ing)) : null;
    return { row, ing, role, qty, isQs: !!row.autoMakeup, complete: !!(row.ingId && ing && (row.autoMakeup || (qty !== null && qty >= 0))) };
  });
  let sumOther = 0;
  for (const l of lines) if (l.complete && !l.isQs) sumOther += l.qty;
  const over = round(Math.max(0, sumOther - batch), 6);
  const qsQty = round(Math.max(0, batch - sumOther), 6);
  for (const l of lines) if (l.isQs) l.qty = l.ing ? qsQty : null;
  let raw = 0, actives = 0, excip = 0, totalQty = 0;
  for (const l of lines) {
    l.rate = l.ing ? Number(l.ing.rate) || 0 : 0;
    l.cost = l.complete ? (l.qty || 0) * l.rate : 0;
    if (!l.complete) continue;
    totalQty += l.qty || 0; raw += l.cost;
    if (l.role === ACTIVE_ROLE) actives += l.cost; else excip += l.cost;
  }
  // Deterministic display order: incomplete rows (insertion order) → others by qty desc → carrier-role rows → Q.S. last.
  const rank = l => (!l.complete && !l.isQs) ? 0 : l.isQs ? 3 : l.role === CARRIER_ROLE ? 2 : 1;
  const order = lines.map((l, i) => ({ l, i }));
  order.sort((a, b) => rank(a.l) - rank(b.l) || (rank(a.l) === 0 ? a.i - b.i : ((b.l.qty || 0) - (a.l.qty || 0)) || ingLabel(a.l.ing).localeCompare(ingLabel(b.l.ing))));
  const sorted = order.map(o => o.l);

  // Warnings
  const seen = new Map();
  for (const l of lines) {
    if (l.row.ingId && !l.ing) warnings.push({ level: 'error', text: `A row refers to a material that no longer exists (id “${l.row.ingId}”). Select a material or remove the row.` });
    if (l.ing?.archived) warnings.push({ level: 'warn', text: `${ingLabel(l.ing)} is archived in Materials. It still costs correctly; consider replacing it.` });
    if (l.complete && l.rate <= 0) warnings.push({ level: 'warn', text: `${ingLabel(l.ing)} has no rate (৳0). Its cost is counted as zero — set a rate in Materials.` });
    if (l.complete && l.ing?.unconfirmed) warnings.push({ level: 'info', text: `${ingLabel(l.ing)}: rate/potency marked * (unconfirmed estimate).` });
    if (l.ing && l.row.ingId) { seen.set(l.row.ingId, (seen.get(l.row.ingId) || 0) + 1); }
  }
  for (const [id, n] of seen) if (n > 1) warnings.push({ level: 'info', text: `${ingLabel(getIng(id))} appears on ${n} rows.` });
  const incomplete = lines.filter(l => !l.complete && !l.isQs).length;
  if (incomplete) warnings.push({ level: 'info', text: `${incomplete} row(s) still need a material and quantity — they are excluded from totals.` });
  const qsLine = lines.find(l => l.isQs);
  if (qsLine && !qsLine.ing) warnings.push({ level: 'error', text: 'Select a Q.S. carrier material (water, dextrose, calcium carbonate…) — the batch balance is not costed until you do.' });
  if (over > 0) warnings.push({ level: 'error', text: `Ingredients exceed the batch size by ${fmtNum(over, 4)} ${unit}. The Q.S. carrier is at 0 and the batch is over-filled — reduce quantities or increase the batch size.` });
  if (batch <= 0) warnings.push({ level: 'error', text: 'Batch size must be greater than zero.' });
  if (f.form === 'Liquid') warnings.push({ level: 'note', text: 'Liquid balance treats kg of solids and L of liquids 1 : 1. Correct the final volume with water in process (density not modelled).' });

  const overheadRate = Number(S.settings.overheadPerUnit) || 0;
  const overhead = overheadRate * batch;
  const bulk = raw + overhead;
  return { f, batch, unit, lines, sorted, qsQty, over, totalQty, raw, actives, excip, overheadRate, overhead, bulk, bulkPerUnit: batch > 0 ? bulk / batch : 0, warnings };
}

function packCost(form, key) {
  const p = S.settings.packaging[form]?.[key]; if (!p) return 0;
  return PACK_FIELDS[form].reduce((s, [fld]) => s + (Number(p[fld]) || 0), 0);
}
function packKeysFor(form) { return Object.keys(S.settings.packaging[form] || {}); }
function currentPackKey(f) {
  const keys = packKeysFor(f.form);
  let k = UI.packKey[f.id];
  if (!keys.includes(k)) k = keys.includes(f.form === 'Liquid' ? '1L' : '1kg') ? (f.form === 'Liquid' ? '1L' : '1kg') : keys[0];
  return k;
}
/** Commercial settings for one product + pack. Unset packs get a clearly flagged size-scaled suggestion. */
function getCommercial(f, key) {
  const stored = f.commercialByPack?.[key];
  if (stored) return { ...sanitizeCommercial(stored), isSet: true, source: null };
  const sizes = S.settings.packaging[f.form] || {};
  const size = Number(sizes[key]?.sizeInUnit) || 1;
  const refKey = Object.keys(f.commercialByPack || {}).filter(k => sizes[k]).sort((a, b) => Math.abs(Math.log((sizes[a].sizeInUnit || 1) / size)) - Math.abs(Math.log((sizes[b].sizeInUnit || 1) / size)))[0];
  if (refKey) {
    const ref = sanitizeCommercial(f.commercialByPack[refKey]); const ratio = size / (sizes[refKey].sizeInUnit || 1);
    return { ...ref, mrp: round(ref.mrp * ratio, 2), tp: round(ref.tp * ratio, 2), addOfferBdt: round(ref.addOfferBdt * ratio, 2), promoNote: '', isSet: false, source: refKey };
  }
  return { mrp: 0, tp: 0, bonusMode: 'none', customFree: 0, customPaid: 1, cashDiscPct: 0, addOfferBdt: 0, promoNote: '', isSet: false, source: null };
}
function bonusOf(c) { if (c.bonusMode === 'custom') return { free: Math.max(0, c.customFree || 0), paid: Math.max(1, c.customPaid || 1) }; const [free, paid] = BONUS_PRESETS[c.bonusMode] || [0, 1]; return { free, paid }; }
function bonusLabel(c) { const b = bonusOf(c); return b.free ? `${b.free} free with ${b.paid} paid` : 'No bonus'; }

function calcCommercial(calc, key) {
  const f = calc.f; const pk = S.settings.packaging[f.form]?.[key];
  if (!pk) return null;
  const size = Number(pk.sizeInUnit) || 0;
  const yieldN = size > 0 ? Math.floor(calc.batch / size + 1e-9) : 0;
  const leftover = round(Math.max(0, calc.batch - yieldN * size), 6);
  const pc = packCost(f.form, key);
  const bulkPerPack = calc.bulkPerUnit * size;
  const cogs = bulkPerPack + pc;
  const c = getCommercial(f, key);
  const b = bonusOf(c);
  const bonusFraction = b.free / (b.free + b.paid);
  const bonusDil = c.tp * bonusFraction;
  const cash = c.tp * (c.cashDiscPct / 100);
  const offer = c.addOfferBdt;
  const nrp = c.tp - bonusDil - cash - offer;
  const gp = nrp - cogs;
  const e = S.settings.expenses;
  const expBase = Math.max(0, gp);
  const mkt = expBase * e.marketing / 100, office = expBase * e.office / 100, misc = expBase * e.misc / 100;
  const exp = mkt + office + misc;
  const np = gp - exp;
  const warnings = [];
  if (!c.isSet) warnings.push(c.source ? `Pricing for this pack is not set yet — showing values scaled from the ${S.settings.packaging[f.form][c.source]?.label || c.source} pack. Edit any field to save values for this pack only.` : 'Pricing for this pack is not set yet. Enter MRP and TP to calculate profit.');
  if (c.tp > c.mrp && c.mrp > 0) warnings.push('TP is higher than MRP.');
  if (yieldN === 0) warnings.push('The batch is smaller than one pack.');
  if (gp < 0) warnings.push('Gross profit is negative: this pack sells below cost. Expenses are set to 0 and the full loss is shown.');
  return { key, label: pk.label, size, yieldN, leftover, packCost: pc, bulkPerPack, cogs, c, bonusFraction, bonusDil, cash, offer, nrp, gp, mkt, office, misc, exp, np,
    gpPct: nrp > 0 ? gp / nrp * 100 : null, npPct: nrp > 0 ? np / nrp * 100 : null, batchPackCost: yieldN * pc, warnings };
}

function calcComposition(calc, factor) {
  const f = calc.f; const rowsA = []; const agg = new Map(); const warnings = [];
  for (const l of calc.lines) {
    if (!l.complete || l.role !== ACTIVE_ROLE || !(l.qty > 0)) continue;
    const ing = l.ing;
    const rawMg = (l.qty * 1000 / calc.batch) * factor; // kg per batch → mg per basis (ml or g)
    const potency = Number(ing.potencyPct) || 0;
    const activeMg = rawMg * potency / 100;
    const vk = ingVitaminKind(ing);
    let claim;
    if (vk && ing.vitaminIUPerGram > 0) claim = { text: fmtIU(rawMg / 1000 * ing.vitaminIUPerGram), est: false };
    else if (vk) { claim = { text: fmtIU(iuFromPureMg(vk, activeMg)), est: true }; warnings.push(`${ingLabel(ing)}: Vitamin ${vk} IU is a theoretical estimate from ${potency}% pure vitamin. Enter the supplier-declared IU/g in Materials for a verified value.`); }
    else claim = { text: fmtMass(activeMg), est: false };
    if (!potency && !Object.keys(ing.elementalMap || {}).length) warnings.push(`${ingLabel(ing)} has no potency or elemental content — its claim shows as 0.`);
    rowsA.push({ ing, rawMg, activeMg, claim });
    const em = Object.keys(ing.elementalMap || {}).length ? ing.elementalMap : (ing.activeElement && potency ? { [ing.activeElement]: potency } : {});
    for (const [elem, pct] of Object.entries(em)) {
      const ek = vitaminKind(elem);
      const entry = agg.get(elem) || { name: elem, mg: 0, iu: 0, isIU: !!ek, est: false, sources: [] };
      if (ek) {
        if (ing.vitaminIUPerGram > 0) entry.iu += rawMg / 1000 * ing.vitaminIUPerGram;
        else { entry.iu += iuFromPureMg(ek, rawMg * pct / 100); entry.est = true; }
      } else entry.mg += rawMg * pct / 100;
      entry.sources.push(`${ing.name.split('(')[0].trim()} (${fmtNum(pct, 2)}%)`);
      agg.set(elem, entry);
    }
  }
  return { rowsA, rowsB: [...agg.values()], warnings: [...new Set(warnings)] };
}

function compositionBasis(f) {
  const su = smallUnit(f.form), mu = mainUnit(f.form);
  if (UI.compBasis === 'custom') { const v = Math.max(0.01, toNum(UI.compCustom) || 1); return { factor: v, label: `${fmtNum(v, 2)} ${su}` }; }
  const n = Number(UI.compBasis) || 1;
  return n === 1000 ? { factor: 1000, label: `1 ${mu} (1000 ${su})` } : { factor: n, label: `${n} ${su}` };
}

function findAlternative(ing, intention) {
  if (!ing) return null;
  const hasMap = Object.keys(ing.elementalMap || {}).length > 0;
  const group = sortedIngredients().filter(i => i.id !== ing.id && i.elementGroup && i.elementGroup === ing.elementGroup && (!hasMap || mainElementPct(i, ing)));
  if (intention === 'Cost Effective') return group.filter(i => i.rate > 0 && costPerElement(i, ing) < costPerElement(ing, ing)).sort((a, b) => costPerElement(a, ing) - costPerElement(b, ing))[0] || null;
  return group.filter(i => (i.absorption || 0) > (ing.absorption || 0)).sort((a, b) => (b.absorption || 0) - (a.absorption || 0))[0] || null;
}
function mainElementPct(ing, ref) {
  const keys = Object.keys(ref?.elementalMap || {});
  for (const k of keys) if (ing.elementalMap?.[k] > 0) return { key: k, pct: ing.elementalMap[k] };
  return null;
}
/** Cost per unit of the shared element (so a cheap but weak salt is not "cheaper"). */
function costPerElement(i, ref) { const m = mainElementPct(i, ref); return m ? i.rate / (m.pct / 100) : i.rate; }
function swapPlan(line, alt) {
  const a = mainElementPct(line.ing, line.ing), b = mainElementPct(alt, line.ing);
  const newQty = a && b && a.key === b.key ? round(line.qty * a.pct / b.pct, 5) : line.qty;
  return { newQty, keepsElement: !!(a && b && a.key === b.key), element: a?.key, saving: line.qty * line.rate - newQty * alt.rate };
}

/* =====================================================================
   RENDERING
   ===================================================================== */
let lastCalc = null;
function renderAll() {
  ensureCurrentValid();
  const f = current();
  document.body.classList.toggle('ro-lock', !canEdit());
  renderModeButtons();
  renderProductSelects();
  if (!f) { updateStatusBadges(); applyPermissions(); return; }
  const calc = calcFormulation(f);
  lastCalc = calc;
  renderProductParams(f);
  renderFormulaTable(calc);
  renderCosting(calc);
  renderComposition(calc);
  renderDosage(calc);
  renderSOP(calc);
  renderPuzzlesAndCompat(calc);
  renderPackaging(calc, true);
  if (!$('materialsView').hidden) renderMaterials();
  if (!$('myFormulationsModal').hidden) renderMyFormulations();
  updateStatusBadges();
  applyPermissions();
}
function ensureCurrentValid() {
  if (UI.currentId && S.formulations[UI.currentId] && !S.formulations[UI.currentId].deletedAt) return;
  const first = activeFormulations()[0];
  UI.currentId = first ? first.id : null;
  saveUI();
}
function applyPermissions() {
  const ro = !canEdit();
  qsa('.edit-ctl, .admin-only').forEach(el => { el.disabled = ro; if (ro) el.setAttribute('title', 'View only — sign in as an administrator to edit'); else if (el.getAttribute('title') === 'View only — sign in as an administrator to edit') el.removeAttribute('title'); });
}
function renderModeButtons() {
  qsa('.mode-btn').forEach(b => {
    const on = b.dataset.mode === UI.mode;
    b.classList.toggle('bg-emerald-500', on); b.classList.toggle('text-slate-950', on); b.classList.toggle('shadow', on);
    b.classList.toggle('text-slate-300', !on);
    b.setAttribute('aria-pressed', String(on));
  });
  const calcMode = UI.mode === 'calculate';
  $('formulateTop').hidden = calcMode; $('formulateLower').hidden = calcMode;
}
function productOptionsHtml(selectedId) {
  const list = activeFormulations();
  const groups = [['Complete', '✅ Complete'], ['In Progress', '⏳ In Progress']];
  return groups.map(([st, label]) => {
    const items = list.filter(f => f.status === st);
    if (!items.length) return '';
    return `<optgroup label="${esc(label)} (${items.length})">` + items.map(f => `<option value="${esc(f.id)}"${f.id === selectedId ? ' selected' : ''}>${esc(f.name)} (${esc(f.form)} · ${fmtNum(f.batchSize, 2)} ${mainUnit(f.form)})</option>`).join('') + '</optgroup>';
  }).join('');
}
function renderProductSelects() {
  const html = productOptionsHtml(UI.currentId);
  qsa('.product-select').forEach(sel => { sel.innerHTML = html || '<option value="">No formulations</option>'; sel.value = UI.currentId || ''; });
}
function renderProductParams(f) {
  const setVal = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  setVal('productName', f.name);
  setVal('productForm', f.form);
  setVal('batchSize', f.batchSize);
  setVal('formulationIntention', f.intention);
  qsa('.species-checkbox').forEach(cb => { cb.checked = f.species.includes(cb.value); });
  setVal('dosageNotes', f.notes?.dosage || '');
  setVal('processNotes', f.notes?.process || '');
  const mu = mainUnit(f.form), su = smallUnit(f.form);
  $('batchUnitLabel').textContent = mu;
  qsa('.unit-main').forEach(el => { el.textContent = mu; });
  $('masterFormUnitPill').textContent = `Batch: ${fmtNum(f.batchSize, 3)} ${mu}`;
  const badge = $('formulaStatusBadge');
  badge.className = 'text-xs font-extrabold px-2.5 py-0.5 rounded-full border ' + (f.status === 'Complete' ? 'bg-emerald-100 text-emerald-900 border-emerald-300' : 'bg-amber-100 text-amber-950 border-amber-300');
  badge.textContent = f.status === 'Complete' ? '✅ Status: Complete' : '⏳ Status: In Progress';
  $('optimizerBtnLabel').textContent = f.intention === 'Cost Effective' ? 'Cost Optimizer' : 'Performance Optimizer';
  const sel = $('compBasisSelect');
  sel.options[0].textContent = `Per 1 ${su}`; sel.options[1].textContent = `Per 5 ${su}`; sel.options[2].textContent = `Per 100 ${su}`; sel.options[3].textContent = `Per 1 ${mu} (1000 ${su})`;
  sel.value = UI.compBasis; $('compCustomInputWrap').hidden = UI.compBasis !== 'custom';
  if (document.activeElement !== $('compCustomValue')) $('compCustomValue').value = UI.compCustom;
  $('compCustomUnitLabel').textContent = su;
  $('printDate').textContent = new Date().toLocaleString();
}
function warningsHtml(list) {
  const style = { error: 'bg-rose-50 border-rose-200 text-rose-900', warn: 'bg-amber-50 border-amber-200 text-amber-950', info: 'bg-slate-50 border-slate-200 text-slate-700', note: 'bg-white border-slate-200 text-slate-500' };
  const icon = { error: '⛔', warn: '⚠️', info: 'ℹ️', note: '•' };
  return list.map(w => `<div class="border rounded-lg px-2.5 py-1.5 ${style[w.level] || style.info}">${icon[w.level] || ''} ${esc(w.text)}</div>`).join('');
}
function ingredientOptions(selectedId) {
  const list = sortedIngredients();
  const sel = getIng(selectedId);
  if (sel && sel.archived) list.unshift(sel);
  return list.map(i => `<option value="${esc(i.id)}"${i.id === selectedId ? ' selected' : ''}>${esc(ingLabel(i))}${i.unconfirmed ? ' *' : ''}${i.archived ? ' (archived)' : ''} — ৳${fmtNum(i.rate, 2)}</option>`).join('');
}
function roleOptions(role) {
  const cats = [...S.settings.categories];
  if (role && !cats.includes(role)) cats.push(role);
  return cats.map(c => `<option value="${esc(c)}"${c === role ? ' selected' : ''}>${esc(c)}</option>`).join('');
}
function autoUnit(qty, form) {
  if (!(qty > 0)) return null;
  if (qty < 0.1) return { text: `${fmtNum(qty * 1000, 3)} ${form === 'Liquid' ? 'g/ml' : 'g'}`, conv: true };
  return { text: `${fmtNum(qty, 3)} ${mainUnit(form)}`, conv: false };
}
function renderFormulaTable(calc) {
  const f = calc.f; const tb = $('formulaTableBody');
  const intention = f.intention; const ro = !canEdit();
  const rowsHtml = calc.sorted.map(l => {
    const r = l.row; const ing = l.ing;
    const alt = (!ro && l.complete && !l.isQs && l.role !== CARRIER_ROLE) ? findAlternative(ing, intention) : null;
    const draft = !r.ingId;
    const au = l.complete ? autoUnit(l.qty, f.form) : null;
    const trCls = draft ? 'bg-amber-50/70' : l.isQs ? 'bg-blue-50/60' : l.role === CARRIER_ROLE ? 'bg-blue-50/30' : 'hover:bg-slate-50/80';
    const nameLine = draft ? `<div class="font-bold text-amber-900 mb-1">${l.isQs ? 'Q.S. carrier — select a material' : 'New ingredient row'}</div>`
      : `<div class="font-bold text-slate-900 leading-snug mb-1">${ing ? esc(ingLabel(ing)) : `<span class="text-rose-700">Missing material (${esc(r.ingId)})</span>`}${ing?.unconfirmed ? '<span class="text-amber-700" title="Unconfirmed rate/potency"> *</span>' : ''}${l.isQs ? ' <span class="ml-1 text-[10px] bg-blue-100 text-blue-900 px-1.5 py-0.5 rounded font-mono whitespace-nowrap">Q.S. AUTO</span>' : ''}${ing?.archived ? ' <span class="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">archived</span>' : ''}</div>`;
    const qtyCell = l.isQs
      ? `<div class="px-2 py-1 rounded bg-blue-100/80 border border-blue-300 mono text-xs font-extrabold text-blue-950" title="Calculated: batch size minus all other ingredients">${l.ing ? fmtNum(l.qty, 4) : '—'}</div>`
      : `<input type="number" step="0.01" min="0" inputmode="decimal" aria-label="Quantity in ${mainUnit(f.form)}" data-line="${esc(r.lineId)}" data-field="qty" value="${l.qty === null ? '' : esc(l.qty)}" placeholder="Qty" class="edit-ctl w-full max-w-[7rem] text-right px-1.5 py-1 rounded border ${draft || l.qty === null ? 'border-amber-400' : 'border-slate-300'} mono text-xs font-semibold" />`;
    return `<tr class="${trCls}" data-row="${esc(r.lineId)}">
      <td class="py-2 px-2 align-top">${nameLine}
        <select aria-label="Material" data-line="${esc(r.lineId)}" data-field="ing" class="edit-ctl w-full bg-white text-slate-700 rounded px-1.5 py-1 text-[11px] border border-slate-300"><option value="">Select Ingredient</option>${ingredientOptions(r.ingId)}</select>
        ${r.ingId ? `<div class="mt-1 flex items-center gap-1"><label class="text-[10px] text-slate-500" for="role_${esc(r.lineId)}">Role here:</label><select id="role_${esc(r.lineId)}" data-line="${esc(r.lineId)}" data-field="role" class="edit-ctl min-w-0 max-w-full bg-slate-50 text-slate-600 rounded px-1 py-0.5 text-[10px] border border-slate-200"${l.isQs ? ' disabled title="The Q.S. carrier is always Carrier / Base"' : ''}>${roleOptions(l.role)}</select></div>` : ''}
      </td>
      <td class="py-2 px-1.5 text-center align-top">${ing ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${(ing.absorption || 0) >= 90 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">${fmtNum(ing.absorption, 1)}%</span>` : '<span class="text-slate-400">—</span>'}</td>
      <td class="py-2 px-1.5 text-right align-top">${qtyCell}</td>
      <td class="py-2 px-1.5 text-right mono align-top">${au ? (au.conv ? `<span class="inline-block bg-emerald-100 text-emerald-900 border border-emerald-300 px-1.5 py-0.5 rounded font-bold text-[11px]">${esc(au.text)}</span>` : `<span class="font-semibold text-slate-800">${esc(au.text)}</span>`) : '<span class="text-slate-400">—</span>'}</td>
      <td class="py-2 px-1.5 text-right mono text-slate-700 align-top">${ing ? `${fmtBDT(ing.rate)}${ing.rate <= 0 ? ' <span title="No rate">⚠️</span>' : ''}` : '—'}</td>
      <td class="py-2 px-1.5 text-right mono font-semibold text-slate-900 align-top">${l.complete ? fmtBDT(l.cost) : '—'}</td>
      <td class="py-2 px-1.5 text-center align-top no-print"><div class="flex items-center justify-center gap-1">
        ${alt ? `<button type="button" data-act="swap-row" data-line="${esc(r.lineId)}" data-alt="${esc(alt.id)}" class="admin-only bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded text-[10px] font-bold" title="Suggested swap: ${esc(ingLabel(alt))}">${intention === 'Cost Effective' ? '💰' : '🚀'}</button>` : ''}
        ${l.isQs ? '' : `<button type="button" data-act="remove-row" data-line="${esc(r.lineId)}" class="admin-only text-slate-400 hover:text-rose-600 font-bold px-1.5 py-0.5" aria-label="Remove row">✕</button>`}
      </div></td></tr>`;
  }).join('');
  tb.innerHTML = rowsHtml || '<tr><td colspan="7" class="py-4 text-center text-slate-500">No rows yet — use + Add Row.</td></tr>';
  $('totalBatchInputRaw').textContent = `${fmtNum(calc.totalQty, 4)} ${calc.unit}`;
  $('totalBatchFillStatus').innerHTML = calc.over > 0 ? `<span class="text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold">Over by ${fmtNum(calc.over, 4)}</span>` : `<span class="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold">✓ Q.S. ${fmtNum(calc.batch, 3)} ${calc.unit}</span>`;
  $('totalRawMatCostCell').textContent = fmtBDT(calc.raw);
  $('formulaWarnings').innerHTML = warningsHtml(calc.warnings);
}
function renderCosting(calc) {
  $('costActives').textContent = fmtBDT(calc.actives);
  $('costExcipients').textContent = fmtBDT(calc.excip);
  $('costRawBatch').textContent = fmtBDT(calc.raw);
  $('overheadRateLabel').textContent = `${fmtBDT(calc.overheadRate)} / ${calc.unit}`;
  $('overheadBatchMultiplier').textContent = `${fmtNum(calc.batch, 3)} ${calc.unit} × ${fmtBDT(calc.overheadRate)}`;
  $('costOverheadBatch').textContent = fmtBDT(calc.overhead);
  $('costGrandBatch').textContent = fmtBDT(calc.bulk);
  $('costPerUnitKgL').textContent = `${fmtBDT(calc.bulkPerUnit)} / ${calc.unit}`;
  const body = $('individualIngredientCostBody');
  const rows = calc.sorted.filter(l => l.complete);
  body.innerHTML = rows.length ? rows.map(l => `<tr><td class="py-1.5 px-2"><div class="font-semibold text-slate-800">${esc(ingLabel(l.ing))}</div><div class="text-[9px] text-slate-500">${esc(l.role || '')}${l.isQs ? ' · Q.S. carrier' : ''}</div></td><td class="py-1.5 px-2 text-right mono">${fmtNum(l.qty, 4)}</td><td class="py-1.5 px-2 text-right mono ${l.rate <= 0 ? 'text-rose-700 font-bold' : ''}">${fmtBDT(l.rate)}${l.ing.unconfirmed ? '*' : ''}</td><td class="py-1.5 px-2 text-right mono font-bold">${fmtBDT(l.cost)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="py-3 px-2 text-center text-slate-500">No ingredient quantities entered.</td></tr>';
  $('ingredientBreakdownTotal').textContent = fmtBDT(calc.raw);
  $('costWarnings').innerHTML = warningsHtml(calc.warnings.filter(w => /rate|missing|Q\.S\. carrier material/i.test(w.text)));
  const f = calc.f; let n = 0;
  if (canEdit()) for (const l of calc.lines) if (l.complete && !l.isQs && l.role !== CARRIER_ROLE && findAlternative(l.ing, f.intention)) n++;
  $('swapBadgeCount').textContent = n;
  $('costSavingsCallout').innerHTML = n ? `<div class="flex items-center justify-between gap-2"><span><strong>${n}</strong> ${esc(f.intention)} swap suggestion(s).</span><button type="button" data-act="optimizer" class="admin-only underline font-bold">Review</button></div>` : `<span class="font-semibold text-emerald-800">✓ No ${esc(f.intention.toLowerCase())} swaps suggested from the current master list.</span>`;
}
function renderComposition(calc) {
  const basis = compositionBasis(calc.f);
  const comp = calcComposition(calc, basis.factor);
  $('compositionHeaderUnit').textContent = `actives per ${basis.label}`;
  $('compositionUnitBadgeA').textContent = `Each ${basis.label} contains`;
  $('compositionUnitBadgeB').textContent = `Total per ${basis.label}`;
  $('compositionTableBody').innerHTML = comp.rowsA.length ? comp.rowsA.map(r => `<tr><td class="py-2 px-2.5 font-semibold text-slate-900">${esc(ingLabel(r.ing))}</td><td class="py-2 px-2.5 text-slate-600">${esc(r.ing.activeElement || '—')}</td><td class="py-2 px-2.5 text-right mono">${fmtMass(r.rawMg)}</td><td class="py-2 px-2.5 text-right mono font-bold ${r.claim.est ? 'text-amber-700' : 'text-emerald-700'}">${esc(r.claim.text)}${r.claim.est ? ' <span class="text-[9px] font-bold bg-amber-100 px-1 rounded" title="Theoretical estimate — supplier IU/g missing">est.</span>' : ''}</td></tr>`).join('')
    : '<tr><td colspan="4" class="py-3 px-2.5 text-center text-slate-500">No rows with the role “Active Ingredients” and a quantity.</td></tr>';
  $('elementalSumTableBody').innerHTML = comp.rowsB.length ? comp.rowsB.map(e => `<tr><td class="py-2 px-2.5 font-bold text-emerald-950">${esc(e.name)}</td><td class="py-2 px-2.5 text-[11px] text-slate-600">${esc(e.sources.join(' + '))}</td><td class="py-2 px-2.5 text-right mono font-extrabold ${e.est ? 'text-amber-700' : 'text-emerald-800'}">${e.isIU ? fmtIU(e.iu) : fmtMass(e.mg)}${e.est ? ' <span class="text-[9px] bg-amber-100 px-1 rounded">est.</span>' : ''}</td></tr>`).join('')
    : '<tr><td colspan="3" class="py-3 px-2.5 text-center text-slate-500">—</td></tr>';
  $('labelWarnings').innerHTML = warningsHtml(comp.warnings.map(t => ({ level: 'warn', text: t })));
}
const DOSAGE_TEMPLATES = {
  Cattle: { icon: '🐄', Liquid: '50–100 ml / animal daily orally or in drinking water for 5–7 days.', Powder: '30–50 g / head daily mixed with feed.' },
  Poultry: { icon: '🐓', Liquid: '1–2 ml per litre of drinking water for 5–7 days.', Powder: '1 g per 1–2 litres of drinking water, or 100–250 g / 100 kg feed.' },
  'Fish and Shrimps': { icon: '🐟🦐', Liquid: '3–5 ml per kg of pelleted feed, top-dressed.', Powder: '3–5 g per kg of feed, or 1–2 kg per acre of pond water.' }
};
function renderDosage(calc) {
  const f = calc.f;
  const items = []; const seen = new Set();
  for (const l of calc.lines) if (l.complete && l.role === ACTIVE_ROLE && l.qty > 0 && l.ing.indication && !seen.has(l.ing.id)) { seen.add(l.ing.id); items.push(`<li><strong>${esc(l.ing.activeElement || ingLabel(l.ing))}:</strong> ${esc(l.ing.indication)}</li>`); }
  $('indicationsList').innerHTML = items.join('') || '<li class="list-none -ml-4 text-slate-500">No indication text on the active materials yet.</li>';
  $('dosageCardsContainer').innerHTML = f.species.map(sp => DOSAGE_TEMPLATES[sp] ? `<div class="p-2 rounded bg-slate-50 border border-slate-200"><strong>${DOSAGE_TEMPLATES[sp].icon} ${esc(sp)}:</strong> ${esc(DOSAGE_TEMPLATES[sp][f.form])} <span class="text-[10px] text-slate-500">(template — verify)</span></div>` : '').join('') || '<div class="text-slate-500">Select target species.</div>';
}
function sopPhases(calc) {
  const f = calc.f; const mu = calc.unit;
  const list = roles => calc.sorted.filter(l => l.complete && l.qty > 0 && roles.includes(l.role)).map(l => ({ name: ingLabel(l.ing), qty: l.qty, display: autoUnit(l.qty, f.form)?.text || '' }));
  const known = [ACTIVE_ROLE, CARRIER_ROLE, 'Preservative', 'Sweetener', 'Flavor', 'Color'];
  const other = calc.sorted.filter(l => l.complete && l.qty > 0 && !known.includes(l.role)).map(l => ({ name: `${ingLabel(l.ing)} (${l.role})`, qty: l.qty, display: autoUnit(l.qty, f.form)?.text || '' }));
  if (f.form === 'Liquid') return [
    { phase: 'Phase 1: Water charging', ph: 'Target pH 6.5 – 7.0', desc: 'Charge about 60% of the purified / DM water into a clean SS316L vessel; warm to about 40 °C.', mats: list([CARRIER_ROLE]), check: 'Vessel line-clearance and cleaning record verified; water conductivity within limit.' },
    { phase: 'Phase 2: Dissolve actives', ph: 'Target pH 4.6 – 5.8', desc: 'Add actives one at a time under agitation (about 350 RPM); wait for full dissolution before the next.', mats: list([ACTIVE_ROLE]).concat(other), check: 'Visual clarity after each addition; record pH.' },
    { phase: 'Phase 3: Preservative, sweetener, flavour & colour', ph: 'Target pH 5.0 – 5.8', desc: 'Pre-dissolve gram-level excipients in a small portion of water, then add to the main vessel.', mats: list(['Preservative', 'Sweetener', 'Flavor', 'Color']), check: 'Colour and odour match standard.' },
    { phase: 'Phase 4: Make up volume, filter & release checks', ph: 'Release pH 5.2 – 6.2 (±0.2)', desc: `Make up to ${fmtNum(calc.batch, 3)} ${mu} with remaining water, mix 15 minutes, filter.`, mats: [{ name: 'Total batch', qty: calc.batch, display: `${fmtNum(calc.batch, 3)} ${mu}` }], check: 'Final volume, pH, appearance, specific gravity; QC sample retained.' }
  ];
  return [
    { phase: 'Phase 1: Sieving & carrier bed', ph: '10% solution pH 6.0 – 7.0', desc: 'Sieve all materials through a 40-mesh sifter; load part of the carrier into the blender.', mats: list([CARRIER_ROLE]), check: 'Blender line-clearance; sieve integrity before and after.' },
    { phase: 'Phase 2: Geometric dilution of micro-ingredients (< 0.1 kg)', ph: 'Blend CV target < 5%', desc: 'Pre-blend gram-level actives, preservatives and flavours with carrier by geometric dilution.', mats: list(['Preservative', 'Sweetener', 'Flavor', 'Color']).concat(list([ACTIVE_ROLE]).filter(m => m.qty < 0.1)), check: 'Pre-blend weight reconciliation.' },
    { phase: 'Phase 3: Main ribbon blending & Q.S. carrier', ph: 'Moisture (LOD) < 4.5%', desc: 'Add all actives and the remaining Q.S. carrier; blend about 25 minutes at about 28 RPM.', mats: list([ACTIVE_ROLE]).filter(m => m.qty >= 0.1).concat(other), check: 'Blend uniformity sample (top / middle / bottom); LOD.' }
  ];
}
function sopReadiness(calc) {
  const issues = [];
  if (calc.over > 0) issues.push('ingredients exceed the batch size');
  if (calc.lines.some(l => !l.complete && !l.isQs)) issues.push('incomplete rows');
  if (calc.lines.some(l => l.row.ingId && !l.ing)) issues.push('missing materials');
  if (!calc.lines.some(l => l.complete && l.role === ACTIVE_ROLE && l.qty > 0)) issues.push('no active ingredients');
  if (calc.lines.some(l => l.complete && l.rate <= 0)) issues.push('materials without a rate');
  if (calc.lines.some(l => l.complete && l.ing.unconfirmed)) issues.push('unconfirmed material specifications');
  if (calc.f.status !== 'Complete') issues.push('formulation status is In Progress');
  return issues;
}
function renderSOP(calc) {
  const f = calc.f;
  $('sopBatchLabel').textContent = `${fmtNum(calc.batch, 3)} ${calc.unit}`;
  $('sopProcessTypeBadge').textContent = f.form === 'Liquid' ? 'Liquid oral process' : 'Powder blending process';
  const issues = sopReadiness(calc);
  $('sopReadiness').innerHTML = issues.length ? `<div class="border border-amber-300 bg-amber-50 text-amber-950 rounded-lg px-3 py-2"><strong>Draft — not validated:</strong> ${esc(issues.join(', '))}. The SOP export will be marked DRAFT.</div>` : '<div class="border border-emerald-200 bg-emerald-50 text-emerald-900 rounded-lg px-3 py-2">Formulation data is complete. The SOP is still a template — review process parameters before use.</div>';
  $('sopStepsContainer').innerHTML = sopPhases(calc).map(p => `<div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1"><div class="flex flex-wrap justify-between items-center gap-2"><h3 class="font-bold text-slate-900 text-xs">${esc(p.phase)}</h3><span class="text-[10px] font-mono font-bold bg-blue-100 text-blue-900 px-2 py-0.5 rounded">${esc(p.ph)}</span></div><p class="text-xs text-slate-600">${esc(p.desc)}</p><div class="text-[11px] bg-white p-1.5 rounded border border-slate-200">${p.mats.length ? p.mats.map(m => `${esc(m.name)}: <strong>${esc(m.display)}</strong>`).join('; ') : 'None'}</div><p class="text-[10px] text-slate-500">Check: ${esc(p.check)}</p></div>`).join('');
}
function renderPuzzlesAndCompat(calc) {
  const f = calc.f; const act = calc.lines.filter(l => l.complete && l.qty > 0);
  const has = pred => act.some(pred);
  const elem = (l, k) => Object.keys(l.ing.elementalMap || {}).some(e => e.includes(k));
  const puzzles = [];
  const add = (cond, title, desc, ingId, frac) => { if (cond && getIng(ingId) && !getIng(ingId).archived) puzzles.push({ title, desc, ingId, qty: round(f.batchSize * frac, 4) }); };
  add(has(l => elem(l, 'Calcium') || elem(l, 'Phosphorus')) && !has(l => ingVitaminKind(l.ing) === 'D3'), 'Vitamin D3', 'Ca/P without Vitamin D3.', 'vit_d3_500', 0.00045);
  add(!has(l => l.role === 'Preservative'), 'Preservative', 'No preservative for shelf-life.', f.form === 'Liquid' ? 'methyl_paraben' : 'sod_benzoate', 0.0008);
  add(has(l => elem(l, 'Vitamin E')) && !has(l => elem(l, 'Selenium')), 'Selenium', 'Selenium works with Vitamin E.', 'sod_selenite', 0.00035);
  const pb = $('missingPuzzlesBanner');
  if (!puzzles.length) { pb.className = 'p-3.5 rounded-lg border bg-emerald-50/70 border-emerald-200 text-xs'; pb.innerHTML = '<div class="font-bold text-emerald-900">🧩 No missing synergies or preservative detected</div><p class="text-emerald-700 mt-0.5">The Q.S. carrier makes up the batch balance automatically.</p>'; }
  else { pb.className = 'p-3.5 rounded-lg border bg-indigo-50/80 border-indigo-300 text-xs space-y-1.5'; pb.innerHTML = `<div class="font-bold text-indigo-950">🧩 Suggestions (${puzzles.length})</div>` + puzzles.map(p => `<div class="flex items-center justify-between gap-2 bg-white p-1.5 rounded border border-indigo-200"><div><strong>Missing ${esc(p.title)}:</strong> <span class="text-slate-600">${esc(p.desc)}</span></div><button type="button" data-act="add-suggested" data-ing="${esc(p.ingId)}" data-qty="${p.qty}" class="admin-only bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2 py-1 rounded text-[10px] shrink-0">+ Add</button></div>`).join(''); }
  const issues = [];
  for (const l of act) {
    if (l.ing.speciesRule === 'NO_POULTRY_AQUA') { if (f.species.includes('Poultry')) issues.push(['error', `[Poultry] ${ingLabel(l.ing)} is contraindicated.`]); if (f.species.includes('Fish and Shrimps')) issues.push(['error', `[Fish/Shrimp] ${ingLabel(l.ing)} is contraindicated.`]); }
    if (l.ing.speciesRule === 'CAUTION_AQUA' && f.species.includes('Fish and Shrimps')) issues.push(['warn', `[Fish/Shrimp] ${ingLabel(l.ing)}: use with caution — check dose against species tolerance.`]);
  }
  const cb = $('compatibilityBanner');
  if (issues.length) { const err = issues.some(i => i[0] === 'error'); cb.className = `p-3.5 rounded-lg border text-xs ${err ? 'bg-rose-50 border-rose-300 text-rose-950' : 'bg-amber-50 border-amber-300 text-amber-950'}`; cb.innerHTML = `<div class="font-bold">${err ? '⛔ Species incompatibility' : '⚠️ Species caution'}</div><ul class="list-disc pl-4 mt-1">${issues.map(i => `<li>${esc(i[1])}</li>`).join('')}</ul>`; }
  else { cb.className = 'p-3.5 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-950 text-xs'; cb.innerHTML = `<div class="font-bold text-emerald-900">✅ No species rule conflicts (${esc(f.species.join(', ') || 'no species selected')})</div><p class="text-emerald-700 mt-0.5">Only the species rules recorded on each material are checked.</p>`; }
}
function renderPackaging(calc, writeInputs) {
  const f = calc.f; const key = currentPackKey(f); const pk = S.settings.packaging[f.form][key];
  const ps = $('packSizeSelect');
  ps.innerHTML = packKeysFor(f.form).map(k => `<option value="${esc(k)}"${k === key ? ' selected' : ''}>${esc(S.settings.packaging[f.form][k].label)}</option>`).join('');
  $('packComponentHeaderUnit').textContent = pk.label;
  $('packFormTitle').textContent = f.form.toLowerCase();
  $('packSettingsScope').textContent = `${f.name} · ${pk.label}`;
  if (writeInputs) {
    $('packagingInputsGrid').innerHTML = PACK_FIELDS[f.form].map(([fld, label]) => `<div class="bg-slate-50 p-2.5 rounded-lg border border-slate-200"><label for="pk_${fld}" class="block text-[11px] font-semibold text-slate-600 mb-1">${esc(label)} (৳)</label><input id="pk_${fld}" type="number" step="0.01" min="0" inputmode="decimal" data-pack-field="${fld}" value="${esc(Number(pk[fld]) || 0)}" class="edit-ctl w-full px-2 py-1 text-right bg-white border border-slate-300 rounded mono text-xs font-bold" /></div>`).join('');
    const c = getCommercial(f, key);
    // Only spare the focused field if we are still on the same product + pack; otherwise stale values would leak into another pack.
    const scopeKey = `${f.id}|${key}`; const sameScope = renderPackaging.lastScope === scopeKey; renderPackaging.lastScope = scopeKey;
    const setIf = (id, v) => { const el = $(id); if (!sameScope || document.activeElement !== el) el.value = v; };
    setIf('commMrpInput', c.mrp); setIf('commTpInput', c.tp); setIf('commBonusSelect', c.bonusMode);
    setIf('customBonusFree', c.customFree); setIf('customBonusPaid', c.customPaid); setIf('commCashDiscPct', c.cashDiscPct);
    setIf('commAdditionalOfferBdt', c.addOfferBdt); setIf('commPromoNote', c.promoNote || '');
    $('customBonusInputsWrap').hidden = c.bonusMode !== 'custom';
  }
  renderCommercialOutputs(calc);
}
function renderCommercialOutputs(calc) {
  const f = calc.f; const key = currentPackKey(f); const m = calcCommercial(calc, key);
  if (!m) return;
  const e = S.settings.expenses; const y = m.yieldN; const mu = calc.unit;
  $('packSettingsNote').innerHTML = m.warnings.length ? m.warnings.map(w => `<div class="text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1">⚠️ ${esc(w)}</div>`).join('') : `<div class="text-emerald-800">✓ Pricing saved for this pack${m.c.promoNote ? ` · Note: ${esc(m.c.promoNote)}` : ''}.</div>`;
  $('calcActiveProductSummaryPill').textContent = `COGS ${fmtBDT(m.cogs)} / ${m.label}`;
  $('commRetailSpreadLabel').textContent = fmtBDT(m.c.mrp - m.c.tp);
  $('commBonusDeductionLabel').textContent = `-${fmtBDT(m.bonusDil)}`;
  $('commCashDiscBdtLabel').textContent = `-${fmtBDT(m.cash)}`;
  const row = (label, per, cls = '', bcls = '') => `<tr class="${cls}"><td class="py-1.5 px-3">${label}</td><td class="py-1.5 px-3 text-right mono ${bcls}">${fmtBDT(per)}</td><td class="py-1.5 px-3 text-right mono ${bcls}">${fmtBDT(per * y)}</td></tr>`;
  $('waterfallStatementBody').innerHTML = [
    row('Maximum Retail Price (MRP)', m.c.mrp, 'text-slate-600'),
    row('<strong>Distributor Trade Price (TP)</strong>', m.c.tp, 'bg-emerald-50/40', 'font-bold'),
    row(`Less: bonus dilution (${esc(bonusLabel(m.c))} → ${fmtNum(m.bonusFraction * 100, 2)}% of TP)`, -m.bonusDil, 'text-rose-700'),
    row(`Less: cash discount (${fmtNum(m.c.cashDiscPct, 2)}% of TP)`, -m.cash, 'text-rose-700'),
    row('Less: additional offer', -m.offer, 'text-rose-700'),
    row('<strong>Net realized price (NRP)</strong>', m.nrp, 'bg-slate-100', 'font-bold text-indigo-900'),
    row(`Less: finished COGS (bulk ${fmtBDT(m.bulkPerPack)} + packaging ${fmtBDT(m.packCost)})`, -m.cogs, 'text-slate-700'),
    row('<strong>GROSS PROFIT (GP = NRP − COGS)</strong>', m.gp, 'bg-indigo-950 text-white', 'font-extrabold text-indigo-300'),
    row(`Less: marketing (${fmtNum(e.marketing, 2)}% of GP)`, -m.mkt, 'text-amber-900'),
    row(`Less: office (${fmtNum(e.office, 2)}% of GP)`, -m.office, 'text-amber-900'),
    row(`Less: miscellaneous (${fmtNum(e.misc, 2)}% of GP)`, -m.misc, 'text-amber-900'),
    row('<strong>NET PROFIT (NP = GP − expenses)</strong>', m.np, 'bg-emerald-900 text-white', 'font-extrabold text-emerald-300')
  ].join('');
  $('finalFinishedCogsPerPack').textContent = fmtBDT(m.cogs);
  $('bulkCostPerPack').textContent = fmtBDT(m.bulkPerPack);
  $('packCostPerUnit').textContent = fmtBDT(m.packCost);
  $('netRealizedPricePerPack').textContent = fmtBDT(m.nrp);
  $('packYieldCount').textContent = `${fmtNum(y, 0)} full packs${m.leftover > 0 ? ` · ${fmtNum(m.leftover, 4)} ${mu} left over` : ''}`;
  $('gpPerPackBdt').textContent = `${fmtBDT(m.gp)} / pack`;
  $('gpBatchTotalBdt').textContent = `Batch GP: ${fmtBDT(m.gp * y)}`;
  $('gpMarginPctLabel').textContent = m.gpPct === null ? 'No margin: NRP ≤ 0' : `GP margin ${fmtNum(m.gpPct, 1)}% of NRP`;
  $('expMktLabel').textContent = `Marketing (${fmtNum(e.marketing, 2)}% GP)`; $('expOfficeLabel').textContent = `Office (${fmtNum(e.office, 2)}% GP)`; $('expMiscLabel').textContent = `Misc. (${fmtNum(e.misc, 2)}% GP)`;
  $('expMarketingPerPack').textContent = fmtBDT(m.mkt); $('expOfficePerPack').textContent = fmtBDT(m.office); $('expMiscPerPack').textContent = fmtBDT(m.misc);
  $('npPerPackBdt').textContent = `${fmtBDT(m.np)} / pack`;
  $('npBatchTotalBdt').textContent = `Batch NP: ${fmtBDT(m.np * y)}`;
  $('npMarginSummaryLabel').textContent = m.npPct === null ? 'No margin: NRP ≤ 0' : `Net margin ${fmtNum(m.npPct, 1)}% of NRP`;
  $('npBox').className = `${m.np < 0 ? 'bg-gradient-to-r from-rose-800 to-rose-900' : 'bg-gradient-to-r from-emerald-800 to-teal-900'} text-white p-4 rounded-xl shadow flex items-center justify-between gap-2`;
  $('commercialFormulaNote').textContent = `How this is calculated: bonus dilution = TP × free ÷ (free + paid); cash discount = TP × %; NRP = TP − bonus − cash − offer; COGS = (raw materials + overhead) ÷ batch × pack size + packaging; GP = NRP − COGS; expenses are % of GP and only apply when GP is positive; NP = GP − expenses. Batch totals use ${fmtNum(y, 0)} full packs (rounded down).`;
  $('costPackLabel').textContent = `${fmtNum(y, 0)} × ${m.label}`;
  $('costPackagingBatchSummary').textContent = fmtBDT(m.batchPackCost);
  $('costAllInWithPackBatch').textContent = fmtBDT(calc.bulk + m.batchPackCost);
  $('multiPackComparisonBody').innerHTML = packKeysFor(f.form).map(k => {
    const r = calcCommercial(calc, k); const on = k === key;
    return `<tr data-pack-row="${esc(k)}" tabindex="0" class="${on ? 'bg-emerald-50/90 font-semibold' : 'hover:bg-slate-50'} cursor-pointer">
      <td class="py-2 px-3 font-bold text-slate-900">${esc(r.label)}${r.c.isSet ? '' : ' <span class="text-[9px] bg-amber-100 text-amber-900 px-1 rounded" title="Pricing not set for this pack">not set</span>'}</td>
      <td class="py-2 px-3 text-right mono">${fmtNum(r.yieldN, 0)}</td><td class="py-2 px-3 text-right mono text-slate-500">${r.leftover > 0 ? `${fmtNum(r.leftover, 4)} ${mu}` : '—'}</td>
      <td class="py-2 px-3 text-right mono text-slate-600">${fmtBDT(r.bulkPerPack)}</td><td class="py-2 px-3 text-right mono text-slate-600">${fmtBDT(r.packCost)}</td>
      <td class="py-2 px-3 text-right mono font-bold">${fmtBDT(r.cogs)}</td><td class="py-2 px-3 text-right mono">${fmtBDT(r.c.tp)}</td>
      <td class="py-2 px-3 text-right mono font-bold ${r.gp < 0 ? 'text-rose-700' : 'text-indigo-800'}">${fmtBDT(r.gp)}</td><td class="py-2 px-3 text-right mono text-amber-800">-${fmtBDT(r.exp)}</td>
      <td class="py-2 px-3 text-right mono font-extrabold ${r.np >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${fmtBDT(r.np)}</td><td class="py-2 px-3 text-right mono font-extrabold">${fmtBDT(r.np * r.yieldN)}</td></tr>`;
  }).join('');
}

/* ---------------- materials view ---------------- */
function usageCount(ingId) { return Object.values(S.formulations).filter(f => !f.deletedAt && f.rows.some(r => r.ingId === ingId)); }
function categoryChips(containerId, selected, name) {
  const host = $(containerId); const sel = new Set(selected || []);
  host.innerHTML = S.settings.categories.map(c => `<label class="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-slate-300 bg-white text-[11px] cursor-pointer has-[:checked]:bg-emerald-50 has-[:checked]:border-emerald-500"><input type="checkbox" name="${esc(name)}" value="${esc(c)}" class="edit-ctl accent-emerald-600"${sel.has(c) ? ' checked' : ''} /> ${esc(c)}</label>`).join('')
    + `<button type="button" data-act="add-category" data-target="${esc(containerId)}" class="admin-only px-2 py-1 rounded-full border border-dashed border-slate-400 text-[11px] font-bold text-slate-700">＋ Add New Category</button>`;
}
function renderMaterials() {
  const q = nameKey($('materialsSearch').value || '');
  const showArch = $('materialsShowArchived').checked;
  const list = sortedIngredients(true).filter(i => (showArch || !i.archived) && (!q || nameKey(`${ingLabel(i)} ${i.aliases.join(' ')} ${i.categories.join(' ')} ${i.elementGroup}`).includes(q)));
  $('materialsCount').textContent = `${list.length} shown · ${Object.values(S.ingredients).filter(i => !i.archived).length} active`;
  const ro = !canEdit();
  $('ingredientMasterTableBody').innerHTML = list.map(i => {
    const used = usageCount(i.id).length;
    return `<tr class="${i.archived ? 'bg-slate-50 text-slate-500' : i.unconfirmed ? 'bg-amber-50/60' : 'hover:bg-slate-50'}">
      <td class="py-2 px-2.5"><div class="font-semibold text-slate-900">${esc(i.name)}${i.unconfirmed ? '<span class="text-amber-700" title="Unconfirmed rate/potency"> *</span>' : ''}${i.archived ? ' <span class="text-[10px] bg-slate-200 px-1.5 rounded">archived</span>' : ''}</div>${i.formVersion ? `<div class="text-[10px] text-slate-500">${esc(i.formVersion)}</div>` : ''}${i.aliases.length ? `<div class="text-[10px] text-slate-400">aka ${esc(i.aliases.join(', '))}</div>` : ''}</td>
      <td class="py-2 px-2.5"><div class="flex flex-wrap gap-1">${i.categories.map(c => `<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]">${esc(c)}</span>`).join('')}</div></td>
      <td class="py-2 px-2.5 text-slate-600">${esc(i.elementGroup || '—')}</td>
      <td class="py-2 px-2.5 text-center mono">${fmtNum(i.absorption, 1)}%</td>
      <td class="py-2 px-2.5 text-right mono font-bold">${fmtNum(i.potencyPct, 3)}%</td>
      <td class="py-2 px-2.5 text-right mono">${i.vitaminIUPerGram ? fmtNum(i.vitaminIUPerGram, 0) : '—'}</td>
      <td class="py-2 px-2.5 text-right mono font-bold ${i.rate <= 0 ? 'text-rose-700' : 'text-emerald-800'}">${fmtBDT(i.rate)}</td>
      <td class="py-2 px-2.5 text-center">${used || '—'}</td>
      <td class="py-2 px-2.5 text-center whitespace-nowrap">${ro ? '<span class="text-slate-400 text-[10px]">view only</span>' : `<button type="button" data-act="edit-ing" data-id="${esc(i.id)}" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold px-2 py-0.5 rounded text-[11px]">✏️ Edit</button> ${i.archived ? `<button type="button" data-act="unarchive-ing" data-id="${esc(i.id)}" class="bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold px-2 py-0.5 rounded text-[11px]">Restore</button>` : `<button type="button" data-act="archive-ing" data-id="${esc(i.id)}" class="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold px-2 py-0.5 rounded text-[11px]">Archive</button>`}`}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="py-4 text-center text-slate-500">No materials match.</td></tr>';
  const keep = qsa('#quickIngCategories input:checked').map(i => i.value);
  categoryChips('quickIngCategories', keep.length ? keep : [ACTIVE_ROLE], 'quickCat');
  applyPermissions();
}

/* ---------------- My Formulations ---------------- */
function renderMyFormulations() {
  const q = nameKey($('myFormulationsSearch').value || '');
  const tab = UI.myfTab === 'deleted' ? 'deleted' : 'active';
  qsa('.myf-tab').forEach(b => { const on = b.dataset.myfTab === tab; b.classList.toggle('bg-slate-900', on); b.classList.toggle('text-white', on); b.setAttribute('aria-selected', String(on)); });
  const all = Object.values(S.formulations).filter(f => (tab === 'deleted') === !!f.deletedAt).filter(f => !q || nameKey(`${f.name} ${f.status} ${f.form}`).includes(q))
    .sort((a, b) => tab === 'deleted' ? String(b.deletedAt).localeCompare(String(a.deletedAt)) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const ed = canEdit();
  $('myFormulationsList').innerHTML = all.length ? all.map(f => {
    const st = f.status === 'Complete' ? ['Complete', 'bg-emerald-100 text-emerald-800'] : ['In Progress', 'bg-amber-100 text-amber-900'];
    const rows = f.rows.filter(r => r.ingId && !r.autoMakeup).length;
    const actions = tab === 'deleted'
      ? (ed ? `<button type="button" data-act="restore-form" data-id="${esc(f.id)}" class="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">Restore</button>` : '')
      : `<button type="button" data-act="open-form" data-id="${esc(f.id)}" class="${ed ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'} text-white px-3 py-1.5 rounded-lg text-xs font-bold">${ed ? 'Edit' : 'View'}</button>${ed ? `<button type="button" data-act="delete-form" data-id="${esc(f.id)}" class="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3 py-1.5 rounded-lg text-xs font-bold">Delete</button>` : ''}`;
    const hist = ed && isCloudMode() && CLOUD.ready ? `<button type="button" data-act="history" data-id="${esc(f.id)}" class="bg-slate-100 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold">History</button>` : '';
    return `<div class="border ${f.id === UI.currentId ? 'border-emerald-400 bg-emerald-50/30' : 'border-slate-200'} rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div class="min-w-0"><div class="font-bold text-slate-900 break-words">${esc(f.name)}${f.id === UI.currentId ? ' <span class="text-[10px] text-emerald-700">(open)</span>' : ''}</div><div class="mt-1 flex flex-wrap items-center gap-2 text-[11px]"><span class="${st[1]} px-2 py-0.5 rounded-full font-bold">${st[0]}</span><span class="text-slate-500">${esc(f.form)} · ${fmtNum(f.batchSize, 3)} ${mainUnit(f.form)} · ${rows} ingredient rows</span><span class="text-slate-400">${tab === 'deleted' ? 'Deleted ' + fmtDate(f.deletedAt) : 'Updated ' + fmtDate(f.updatedAt)}</span></div></div><div class="flex flex-wrap items-center gap-2 shrink-0">${actions}${hist}</div></div>`;
  }).join('') : `<div class="p-5 text-center text-sm text-slate-500 border rounded-xl">${tab === 'deleted' ? 'Nothing in Recently deleted.' : 'No matching formulations.'}</div>`;
}
