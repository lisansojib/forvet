/* =====================================================================
   OCR (Tesseract, loaded on demand — real extraction only)
   ===================================================================== */
async function ocrImage(file, statusEl) {
  if (statusEl) statusEl.textContent = 'Loading text recognition…';
  try { if (!window.Tesseract) await loadScript(TESSERACT_JS_URL); }
  catch (_) { throw new Error('Text recognition could not be loaded (it needs an internet connection). Type or paste the text instead.'); }
  const res = await window.Tesseract.recognize(file, 'eng', { logger: m => { if (statusEl && m.status === 'recognizing text' && Number.isFinite(m.progress)) statusEl.textContent = `Reading image… ${Math.round(m.progress * 100)}%`; } });
  return res?.data?.text || '';
}
async function readTextFile(file) { return (await file.text()).replace(/^\uFEFF/, ''); }
function splitCols(line) { return line.includes('\t') ? line.split('\t') : line.split(/[,;|]/); }

/* =====================================================================
   IMPORT FORMULATION (preview → explicit decisions → new formulation)
   ===================================================================== */
const UNIT_TO_MAIN = { kg: ['mass', 1], g: ['mass', 0.001], gm: ['mass', 0.001], gram: ['mass', 0.001], grams: ['mass', 0.001], mg: ['mass', 1e-6], l: ['vol', 1], ltr: ['vol', 1], litre: ['vol', 1], liter: ['vol', 1], ml: ['vol', 0.001] };
let importDraft = null;
function isWaterLike(name) { return /\b(water|dm water|purified water|q\.?\s?s\.?)\b/i.test(name); }
function parseImportLines(text, form) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const cols = splitCols(line).map(s => s.trim());
    const name = normalizeVitaminTerms(cols[0] || '');
    if (!name || /^(ingredient|raw material|material|name|product)s?\b/i.test(name) && cols.slice(1).every(c => !/\d/.test(c))) continue;
    const item = { raw: line, name, qtyMain: null, unit: '', rate: null, error: '' };
    const qty = toNum((cols[1] || '').replace(/[^\d.\-]/g, ''));
    let unit = (cols[2] || '').toLowerCase().replace(/[^a-z]/g, '');
    let rateCol = cols[3];
    if (unit && !UNIT_TO_MAIN[unit]) { rateCol = cols[2]; unit = ''; }
    item.unit = unit || mainUnit(form);
    item.rate = toNum((rateCol || '').replace(/[^\d.]/g, ''));
    if (qty === null || qty < 0) item.error = 'No valid quantity';
    else {
      const u = UNIT_TO_MAIN[item.unit.toLowerCase()] || UNIT_TO_MAIN[mainUnit(form).toLowerCase()];
      if (form === 'Powder' && u[0] === 'vol') item.error = `Volume unit “${item.unit}” in a powder formulation — convert to kg/g first`;
      else item.qtyMain = round(qty * u[1], 6);
    }
    item.match = matchMaterial(name);
    item.decision = item.match.status === 'exact' || item.match.status === 'alias' ? item.match.best.id : '';
    if (isWaterLike(name) || (item.decision && Object.values(DEFAULT_CARRIER).includes(item.decision))) { item.decision = 'skip'; item.note = 'Water / Q.S. carrier is calculated automatically'; }
    out.push(item);
  }
  return out;
}
function decisionOptions(item) {
  const c = item.match.candidates || [];
  const opts = ['<option value="">— choose —</option>'];
  if (c.length) opts.push(`<optgroup label="Suggested">${c.map((i, k) => `<option value="${esc(i.id)}"${item.decision === i.id ? ' selected' : ''}>${esc(ingLabel(i))}${item.match.scores ? ` (${Math.round(item.match.scores[k] * 100)}%)` : ''}</option>`).join('')}</optgroup>`);
  opts.push(`<option value="create"${item.decision === 'create' ? ' selected' : ''}>➕ Create as new material</option><option value="skip"${item.decision === 'skip' ? ' selected' : ''}>⛔ Skip this line</option>`);
  opts.push(`<optgroup label="All materials">${sortedIngredients().filter(i => !c.includes(i)).map(i => `<option value="${esc(i.id)}"${item.decision === i.id ? ' selected' : ''}>${esc(ingLabel(i))}</option>`).join('')}</optgroup>`);
  return opts.join('');
}
const STATUS_LABEL = { exact: ['Exact match', 'text-emerald-700'], alias: ['Alias match', 'text-emerald-700'], fuzzy: ['Possible match — confirm', 'text-amber-700'], ambiguous: ['Several matches — choose', 'text-amber-700'], none: ['No match — choose', 'text-rose-700'] };
function renderImportReview() {
  const d = importDraft; const unit = mainUnit(d.form);
  $('importReviewBody').innerHTML = d.items.map((it, k) => `<tr class="${it.error ? 'bg-rose-50' : !it.decision ? 'bg-amber-50/60' : ''}">
    <td class="py-2 px-2"><div class="font-semibold">${esc(it.name)}</div><div class="text-[10px] text-slate-500 mono">${esc(it.raw)}</div>${it.rate !== null ? `<div class="text-[10px] text-slate-500">Imported rate ৳${fmtNum(it.rate, 2)} — used only for new materials; master rates are never overwritten</div>` : ''}</td>
    <td class="py-2 px-2 text-right mono">${it.error ? `<span class="text-rose-700">${esc(it.error)}</span>` : `${fmtNum(it.qtyMain, 6)} ${unit}${it.unit.toLowerCase() !== unit.toLowerCase() ? `<div class="text-[10px] text-slate-500">from ${esc(it.unit)}</div>` : ''}`}</td>
    <td class="py-2 px-2"><span class="font-bold ${STATUS_LABEL[it.match.status][1]}">${STATUS_LABEL[it.match.status][0]}</span>${it.note ? `<div class="text-[10px] text-slate-500">${esc(it.note)}</div>` : ''}</td>
    <td class="py-2 px-2"><select data-import-idx="${k}" class="w-full max-w-[22rem] px-2 py-1 border border-slate-300 rounded bg-white text-xs"${it.error ? ' disabled' : ''}>${decisionOptions(it)}</select></td></tr>`).join('');
  const undecided = d.items.filter(i => !i.error && !i.decision).length, errors = d.items.filter(i => i.error).length;
  $('importReviewSummary').innerHTML = `<div class="flex flex-wrap items-center gap-2"><span>${d.items.length} line(s): <strong>${d.items.filter(i => i.decision && !['create', 'skip'].includes(i.decision)).length}</strong> mapped, <strong>${d.items.filter(i => i.decision === 'create').length}</strong> new, <strong>${d.items.filter(i => i.decision === 'skip').length}</strong> skipped${undecided ? `, <strong class="text-amber-700">${undecided} need a decision</strong>` : ''}${errors ? `, <strong class="text-rose-700">${errors} with errors (excluded)</strong>` : ''}.</span>${undecided ? '<button type="button" id="importCreateAll" class="text-[11px] font-bold underline">Create all undecided as new materials</button>' : ''}</div>`;
  $('importCommitBtn').disabled = !canEdit() || undecided > 0 || !d.items.some(i => !i.error && i.decision && i.decision !== 'skip');
  const ca = $('importCreateAll'); if (ca) ca.onclick = () => { d.items.forEach(i => { if (!i.error && !i.decision) i.decision = 'create'; }); renderImportReview(); };
}
function importReview() {
  const form = $('importForm').value; const batch = toNum($('importBatch').value);
  if (!batch || batch <= 0) { uiAlert('Batch size', 'Enter the batch size of the imported formulation.'); return; }
  const items = parseImportLines($('importFormulaTextarea').value, form);
  if (!items.length) { uiAlert('Nothing to import', 'Add at least one line: Name, Quantity, Unit, Rate.'); return; }
  importDraft = { form, batch, name: normalizeVitaminTerms($('importName').value.trim()) || 'Imported formulation', items };
  $('importStepInput').hidden = true; $('importStepReview').hidden = false; renderImportReview();
}
function importCommit() {
  if (!requireEdit('import formulations')) return;
  const d = importDraft; if (!d) return;
  if (d.items.some(i => !i.error && !i.decision)) { renderImportReview(); return; }
  const newMats = new Map(); const rows = new Map();
  for (const it of d.items) {
    if (it.error || it.decision === 'skip') continue;
    let id = it.decision;
    if (id === 'create') {
      const k = nameKey(it.name);
      if (!newMats.has(k)) newMats.set(k, makeMaterial({ name: it.name, categories: [ACTIVE_ROLE], rate: it.rate ?? 0, potency: null, unconfirmed: true }));
      id = newMats.get(k).id;
    }
    if (!S.ingredients[id] && ![...newMats.values()].some(m => m.id === id)) continue;
    rows.set(id, round((rows.get(id) || 0) + it.qtyMain, 6));
  }
  if (!rows.size) { uiAlert('Nothing imported', 'Every line was skipped or had an error.'); return; }
  for (const m of newMats.values()) { S.ingredients[m.id] = m; markDirty('ingredient', m.id); }
  const f = newFormulationDoc({ name: d.name, form: d.form, batchSize: d.batch, status: 'In Progress', intention: 'Cost Effective' });
  for (const [id, qty] of rows) { const ing = S.ingredients[id]; f.rows.unshift({ lineId: uid('l'), ingId: id, role: primaryRole(ing), qty, autoMakeup: false }); }
  S.formulations[f.id] = f; markDirty('formulation', f.id);
  importDraft = null; closeModal('importFormulaModal'); UI.mode = 'formulate'; switchFormulation(f.id);
  toast(`Imported “${f.name}” as a new formulation${newMats.size ? ` with ${newMats.size} new material(s) marked * for review` : ''}.`);
}
function normalizeOcrFormulaText(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?[A-Za-z)][^\d]*?)\s*[:\-–,|]?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gm|mg|ml|l|ltr)?\b\s*(?:[^\d]*(\d+(?:[.,]\d+)?))?/i);
    if (!m) return l;
    return [m[1].replace(/[|:,–-]+$/, '').trim(), m[2].replace(',', '.'), m[3] || '', m[4] ? m[4].replace(',', '.') : ''].filter((v, i) => i < 3 || v).join(', ');
  }).join('\n');
}

/* =====================================================================
   BULK MATERIAL IMPORT
   ===================================================================== */
let bulkDraft = null;
function bulkReview() {
  const items = []; const seen = new Set();
  for (const raw of $('bulkImportTextarea').value.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const cols = splitCols(line).map(s => s.trim());
    const name = normalizeVitaminTerms(cols[0] || ''); if (!name || seen.has(nameKey(name))) continue;
    if (/^(name|material|ingredient)s?$/i.test(name)) continue;
    seen.add(nameKey(name));
    const rate = toNum((cols[1] || '').replace(/[^\d.]/g, '')); const potency = toNum((cols[2] || '').replace(/[^\d.]/g, ''));
    const match = matchMaterial(name, { includeArchived: true });
    const decision = match.status === 'exact' || match.status === 'alias' ? 'keep:' + match.best.id : match.status === 'none' ? 'create' : '';
    items.push({ raw: line, name, rate, potency, match, decision });
  }
  if (!items.length) { uiAlert('Nothing to import', 'Add one material per line: Name, Rate, Potency.'); return; }
  bulkDraft = items; $('bulkStepInput').hidden = true; $('bulkStepReview').hidden = false; renderBulkReview();
}
function renderBulkReview() {
  $('bulkReviewBody').innerHTML = bulkDraft.map((it, k) => {
    const c = it.match.candidates || [];
    const opts = ['<option value="">— choose —</option>', ...c.map((i, n) => `<option value="keep:${esc(i.id)}"${it.decision === 'keep:' + i.id ? ' selected' : ''}>Same as ${esc(ingLabel(i))}${it.match.scores ? ` (${Math.round(it.match.scores[n] * 100)}%)` : ''} — keep master</option>`), `<option value="create"${it.decision === 'create' ? ' selected' : ''}>➕ Create new material</option>`, `<option value="skip"${it.decision === 'skip' ? ' selected' : ''}>⛔ Skip</option>`].join('');
    return `<tr class="${!it.decision ? 'bg-amber-50/60' : ''}"><td class="py-2 px-2 font-semibold">${esc(it.name)}</td><td class="py-2 px-2 text-right mono">${it.rate === null ? '<span class="text-rose-700">missing</span>' : fmtNum(it.rate, 2)}</td><td class="py-2 px-2 text-right mono">${it.potency === null ? '—' : fmtNum(it.potency, 2) + '%'}</td><td class="py-2 px-2"><span class="font-bold ${STATUS_LABEL[it.match.status][1]}">${STATUS_LABEL[it.match.status][0]}</span></td><td class="py-2 px-2"><select data-bulk-idx="${k}" class="w-full max-w-[22rem] px-2 py-1 border border-slate-300 rounded bg-white text-xs">${opts}</select></td></tr>`;
  }).join('');
  const und = bulkDraft.filter(i => !i.decision).length; const creates = bulkDraft.filter(i => i.decision === 'create');
  $('bulkReviewSummary').innerHTML = `<p>${creates.length} new material(s) will be added${creates.some(i => i.rate === null) ? ' — those without a rate get ৳0 and a * flag' : ''}. Existing materials keep their master name, rate and specification.${und ? ` <strong class="text-amber-700">${und} line(s) need a decision.</strong>` : ''}</p>`;
  $('bulkCommitBtn').disabled = !canEdit() || und > 0 || !creates.length;
}
function bulkCommit() {
  if (!requireEdit('import materials')) return;
  let n = 0;
  for (const it of bulkDraft) {
    if (it.decision !== 'create') continue;
    const m = makeMaterial({ name: it.name, categories: [ACTIVE_ROLE], rate: it.rate ?? 0, potency: it.potency, unconfirmed: it.rate === null || it.potency === null });
    S.ingredients[m.id] = m; markDirty('ingredient', m.id); n++;
  }
  bulkDraft = null; closeModal('bulkImportModal'); renderAll(); toast(`${n} material(s) added. Review any marked * in Materials.`);
}

/* =====================================================================
   CANONICAL ACTIVES (shared by Analyze and Compare)
   ===================================================================== */
const CANON_RULES = [
  [/cholecalciferol|\bvitamin\s*d3?\b/, 'Vitamin D3'], [/retinol|retinyl|\bvitamin\s*a\b/, 'Vitamin A'], [/tocopher|\bvitamin\s*e\b/, 'Vitamin E'], [/ascorb|\bvitamin\s*c\b/, 'Vitamin C'],
  [/cyanocobal|cobalamin|\bvitamin\s*b12\b/, 'Vitamin B12'], [/thiamin|\bvitamin\s*b1\b/, 'Vitamin B1'], [/riboflav|\bvitamin\s*b2\b/, 'Vitamin B2'], [/niacin|nicotinam|\bvitamin\s*b3\b/, 'Vitamin B3'],
  [/pantothen|\bvitamin\s*b5\b/, 'Vitamin B5'], [/pyridox|\bvitamin\s*b6\b/, 'Vitamin B6'], [/biotin|\bvitamin\s*b7\b/, 'Vitamin B7'], [/folic|folate|\bvitamin\s*b9\b/, 'Vitamin B9'], [/menadion|\bvitamin\s*k3?\b/, 'Vitamin K'],
  [/phosph|^\s*p\s*$/, 'Phosphorus (P)'], [/calcium|^\s*ca\s*$/, 'Calcium (Ca)'], [/zinc|^\s*zn\s*$/, 'Zinc (Zn)'], [/copper|^\s*cu\s*$/, 'Copper (Cu)'], [/selen|^\s*se\s*$/, 'Selenium (Se)'],
  [/magnes|^\s*mg\s*$/, 'Magnesium (Mg)'], [/potass|^\s*k\s*$/, 'Potassium (K)'], [/sodium|^\s*na\s*$/, 'Sodium (Na)'], [/cobalt|^\s*co\s*$/, 'Cobalt (Co)'], [/iron|ferr|^\s*fe\s*$/, 'Iron (Fe)'],
  [/mangan|^\s*mn\s*$/, 'Manganese (Mn)'], [/iodine|iodide|iodate/, 'Iodine (I)'], [/lysine/, 'Lysine'], [/methionine/, 'Methionine'], [/choline/, 'Choline'], [/nitrogen|\bnpn\b|urea/, 'Nitrogen (NPN)']
];
function canonicalActive(name) {
  const t = normalizeVitaminTerms(String(name || '')).toLowerCase().replace(/\belemental\b/g, '').trim();
  for (const [re, key] of CANON_RULES) if (re.test(t)) return key;
  return String(name || '').replace(/\s+/g, ' ').trim();
}
/** Our formulation per 1 ml (liquid) or 1 g (powder), keyed by canonical active. */
function ourProfile(f) {
  const calc = calcFormulation(f); const comp = calcComposition(calc, 1); const prof = new Map();
  for (const e of comp.rowsB) {
    const k = canonicalActive(e.name); const p = prof.get(k) || { mg: 0, iu: 0, isIU: e.isIU, est: false };
    p.mg += e.mg || 0; p.iu += e.iu || 0; p.est = p.est || e.est; prof.set(k, p);
  }
  return { calc, prof };
}
function parseClaimLine(line) {
  const cols = splitCols(line).map(s => s.trim());
  let name = cols[0]; let amount = null; let unit = '';
  if (cols.length >= 2) { amount = toNum((cols[1] || '').replace(',', '.').replace(/[^\d.]/g, '')); unit = (cols[2] || (cols[1].match(/[a-zµ%]+/i) || [''])[0]).toLowerCase(); }
  else { const m = line.match(/^(.*?)[\s:–-]+(\d+(?:[.,]\d+)?)\s*(iu|i\.u\.|mcg|µg|ug|mg|g|%)/i); if (m) { name = m[1]; amount = toNum(m[2].replace(',', '.')); unit = m[3].toLowerCase(); } }
  unit = unit.replace(/\./g, '');
  if (!name || amount === null) return null;
  if (unit === 'iu') return { name, value: amount, kind: 'IU' };
  const f = { mg: 1, mcg: 0.001, 'µg': 0.001, ug: 0.001, g: 1000, '%': 10 }[unit];
  if (f === undefined) return { name, value: amount, kind: 'mg', assumed: true };
  return { name, value: amount * f, kind: 'mg', percent: unit === '%' };
}
function parseLabelText(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const out = { name: '', price: null, packSize: null, packUnit: '', basis: null, basisUnit: '', claims: [] };
  out.name = lines.find(l => l.length >= 3 && l.length <= 60 && /[a-z]/i.test(l) && !/composition|each|contains|manufactur|address|batch|expiry|exp\.|mfg|dosage|ingredient|indication|direction|storage|\d+\s*(mg|mcg|iu)/i.test(l)) || '';
  const priceLine = lines.find(l => /(mrp|price|৳|bdt|tk\.?)/i.test(l) && /\d/.test(l));
  if (priceLine) { const m = priceLine.match(/(?:mrp|price|৳|bdt|tk\.?)\s*[:\-]?\s*(?:৳|tk\.?|bdt)?\s*(\d+(?:[.,]\d+)?)/i); if (m) out.price = Number(m[1].replace(',', '.')); }
  const basis = text.match(/each\s+(\d+(?:\.\d+)?)?\s*(ml|g|gm|kg|l)\b/i);
  if (basis) { out.basis = Number(basis[1] || 1); out.basisUnit = basis[2].toLowerCase() === 'gm' ? 'g' : basis[2].toLowerCase(); }
  const pack = lines.map(l => l.match(/(?:net|pack|content|volume|weight|size)[^\d]{0,15}(\d+(?:\.\d+)?)\s*(ml|l|ltr|litre|liter|g|gm|kg)\b/i)).find(Boolean);
  if (pack) { out.packSize = Number(pack[1]); const u = pack[2].toLowerCase(); out.packUnit = /^l|ltr|litre|liter/.test(u) ? 'L' : u === 'gm' ? 'g' : u; }
  for (const l of lines) {
    const m = l.match(/^(.*?)[\s:.\-–]+(\d+(?:[.,]\d+)?)\s*(iu|i\.u\.|mcg|µg|ug|mg|g)\b/i);
    if (!m) continue;
    const key = canonicalActive(m[1]);
    if (!CANON_RULES.some(([, k]) => k === key)) continue;
    out.claims.push(`${m[1].replace(/[:.\-–]+$/, '').trim()}, ${m[2].replace(',', '.')}, ${m[3].replace(/\./g, '')}`);
  }
  return out;
}

/* ---------------- Analyze → draft formulation ---------------- */
function pickMaterialFor(canon, form, intention) {
  const cands = sortedIngredients().filter(i => i.categories.includes(ACTIVE_ROLE)).map(i => {
    const e = Object.entries(i.elementalMap || {}).find(([k]) => canonicalActive(k) === canon);
    return e ? { ing: i, pct: e[1] } : null;
  }).filter(x => x && x.pct > 0);
  if (!cands.length) return null;
  if (intention === 'Performance') cands.sort((a, b) => (b.ing.absorption || 0) - (a.ing.absorption || 0));
  else cands.sort((a, b) => (a.ing.rate / a.pct) - (b.ing.rate / b.pct));
  return cands[0];
}
function analyzePlan() {
  const form = $('analyzeRefForm').value; const batch = 100; const plan = []; const skipped = [];
  for (const raw of $('analyzeLiteratureTextarea').value.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const c = parseClaimLine(line); if (!c) { skipped.push(`${line} (could not read amount)`); continue; }
    const canon = canonicalActive(c.name); const pick = pickMaterialFor(canon, form, 'Performance');
    if (!pick) { skipped.push(`${c.name} (no material in Materials contains ${canon})`); continue; }
    let kg; let note = '';
    if (c.kind === 'IU') {
      const vk = vitaminKind(canon);
      if (pick.ing.vitaminIUPerGram > 0) kg = c.value * batch / pick.ing.vitaminIUPerGram;
      else if (vk) { const mg = c.value / iuFromPureMg(vk, 1); kg = mg * batch / (10 * pick.pct); note = 'estimated from pure vitamin — set supplier IU/g'; }
      else { skipped.push(`${c.name} (IU claim for a non-A/D3 active)`); continue; }
    } else kg = c.value * batch / (10 * pick.pct);
    if (c.assumed) note = (note ? note + '; ' : '') + 'unit not stated — assumed mg';
    plan.push({ claim: line, canon, ing: pick.ing, kg: round(kg, 5), note });
  }
  return { form, batch, plan, skipped };
}
function renderAnalyzePreview() {
  const p = analyzePlan(); const unit = mainUnit(p.form); const total = p.plan.reduce((s, x) => s + x.kg, 0);
  $('analyzePreview').innerHTML = (p.plan.length ? `<table class="w-full text-xs border border-slate-200 rounded"><thead class="bg-slate-100"><tr><th class="text-left px-2 py-1">Claim</th><th class="text-left px-2 py-1">Material</th><th class="text-right px-2 py-1">Qty / ${p.batch} ${unit}</th></tr></thead><tbody>${p.plan.map(x => `<tr class="border-t"><td class="px-2 py-1">${esc(x.claim)}</td><td class="px-2 py-1">${esc(ingLabel(x.ing))}${x.note ? `<div class="text-[10px] text-amber-700">${esc(x.note)}</div>` : ''}</td><td class="px-2 py-1 text-right mono">${fmtNum(x.kg, 5)}</td></tr>`).join('')}</tbody></table>` : '<p class="text-slate-500">No claims matched a material yet.</p>')
    + (p.skipped.length ? `<p class="mt-2 text-amber-800">Not used: ${esc(p.skipped.join('; '))}</p>` : '')
    + (total > p.batch ? `<p class="mt-2 text-rose-700 font-bold">Materials total ${fmtNum(total, 3)} ${unit} — more than the batch. Check the claims and units.</p>` : '');
  return p;
}
function analyzeGenerate() {
  if (!requireEdit('create formulations')) return;
  const p = renderAnalyzePreview(); if (!p.plan.length) return;
  const name = normalizeVitaminTerms($('analyzeRefName').value.trim()) || 'Label-matched draft';
  const f = newFormulationDoc({ name: `${name} (draft from label)`, form: p.form, batchSize: p.batch, status: 'In Progress', intention: 'Performance' });
  const byIng = new Map(); for (const x of p.plan) byIng.set(x.ing.id, round((byIng.get(x.ing.id) || 0) + x.kg, 6));
  for (const [id, kg] of byIng) f.rows.unshift({ lineId: uid('l'), ingId: id, role: ACTIVE_ROLE, qty: kg, autoMakeup: false });
  f.notes.dosage = `Drafted from label claims for “${name}”. Review all quantities.`;
  S.formulations[f.id] = f; markDirty('formulation', f.id);
  closeModal('analyzeModal'); UI.mode = 'formulate'; switchFormulation(f.id); toast('Draft created. Add excipients and review quantities.');
}

/* ---------------- Compare ---------------- */
const BASIS_TO_SMALL = { ml: 1, g: 1, L: 1000, kg: 1000 };
function renderComparison() {
  const ourId = $('compOurProductSelect').value; const f = S.formulations[ourId];
  if (!f) { $('compTableBody').innerHTML = ''; return; }
  const packSel = $('compOurPack');
  const keys = packKeysFor(f.form);
  if (packSel.dataset.for !== f.id) { packSel.innerHTML = keys.map(k => `<option value="${esc(k)}">${esc(S.settings.packaging[f.form][k].label)}</option>`).join(''); packSel.value = currentPackKey(f); packSel.dataset.for = f.id; }
  const basisN = Math.max(0.0001, toNum($('compExtBasis').value) || 1) * (BASIS_TO_SMALL[$('compExtBasisUnit').value] || 1);
  const ext = new Map(); const unread = [];
  for (const raw of $('compExtCompTextarea').value.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const c = parseClaimLine(line); if (!c) { unread.push(line); continue; }
    const key = canonicalActive(c.name); const e = ext.get(key) || { mg: 0, iu: 0, kinds: new Set(), notes: [] };
    if (c.kind === 'IU') e.iu += c.value / basisN; else e.mg += c.value / basisN;
    e.kinds.add(c.kind); if (c.assumed) e.notes.push('unit assumed mg'); if (c.percent) e.notes.push('% read as % w/v (10 mg per ml/g per 1%)');
    ext.set(key, e);
  }
  const { prof } = ourProfile(f);
  const su = smallUnit(f.form);
  const keysAll = [...new Set([...ext.keys(), ...prof.keys()])];
  let extMore = 0, ourMore = 0;
  $('compColHeaderExt').textContent = $('compExtName').value.trim() || 'Competitor (declared)';
  $('compColHeaderOur').textContent = `${f.name} (calculated)`;
  $('compTableBody').innerHTML = keysAll.map(k => {
    const e = ext.get(k); const o = prof.get(k);
    const eIU = e && e.kinds.has('IU'); const oIU = o && o.isIU;
    const eVal = e ? (eIU ? e.iu : e.mg) : null; const oVal = o ? (oIU ? o.iu : o.mg) : null;
    const fmt = (v, iu) => v === null ? '<span class="text-slate-400">not declared</span>' : iu ? fmtIU(v) : fmtMass(v);
    let diff = '—', note = '';
    if (e && o && eIU === !!oIU) { const d = oVal - eVal; diff = eVal > 0 ? `${d >= 0 ? '+' : ''}${fmtNum(d / eVal * 100, 1)}%` : '—'; if (Math.abs(d) > 1e-9) { if (d > 0) ourMore++; else extMore++; } note = Math.abs(d) <= Math.max(eVal, oVal) * 0.02 ? 'About equal' : d > 0 ? 'Ours is higher' : 'Competitor is higher'; }
    else if (e && o) note = 'Different units (mg vs IU) — not compared';
    else note = e ? 'Only in competitor label' : 'Only in our formulation';
    if (o?.est) note += ' · our IU is an estimate';
    if (e?.notes.length) note += ' · ' + [...new Set(e.notes)].join(', ');
    return `<tr><td class="py-2 px-3 font-semibold text-slate-900">${esc(k)}</td><td class="py-2 px-3 text-right mono">${fmt(eVal, eIU)}</td><td class="py-2 px-3 text-right mono">${fmt(oVal, oIU)}</td><td class="py-2 px-3 text-right mono">${diff}</td><td class="py-2 px-3 text-[11px] text-slate-600">${esc(note)}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="py-3 text-center text-slate-500">Enter the competitor composition to compare.</td></tr>';
  // Price per kg / L
  const extPrice = toNum($('compExtPrice').value); const extPack = toNum($('compExtPackSize').value); const extPackUnit = $('compExtPackUnit').value;
  const extPerUnit = extPrice && extPack ? extPrice / (extPack * ({ L: 1, kg: 1, ml: 0.001, g: 0.001 }[extPackUnit])) : null;
  const pk = packSel.value; const pkObj = S.settings.packaging[f.form][pk]; const com = getCommercial(f, pk);
  const ourPerUnit = com.isSet && com.mrp > 0 ? com.mrp / pkObj.sizeInUnit : null;
  const mu = mainUnit(f.form);
  $('compSummaryBox').innerHTML = `<div class="font-bold text-slate-900">Summary</div>
    <p class="text-slate-600">Compared per 1 ${su}. ${keysAll.length} active(s): competitor higher in <strong>${extMore}</strong>, ours higher in <strong>${ourMore}</strong>.</p>
    <p class="text-slate-600">Retail price per ${mu}: competitor ${extPerUnit !== null ? `<strong>${fmtBDT(extPerUnit)}</strong>` : '<em>enter price and pack size</em>'} · ours ${ourPerUnit !== null ? `<strong>${fmtBDT(ourPerUnit)}</strong> (MRP of ${esc(pkObj.label)})` : `<em>MRP not set for ${esc(pkObj.label)}</em>`}.</p>
    ${unread.length ? `<p class="text-amber-800">Could not read: ${esc(unread.join(' | '))}</p>` : ''}
    <p class="text-[10px] text-slate-500">Competitor values are label-declared (or extracted text you reviewed). Ours are calculated from the formulation and master data. Bioavailability is not compared.</p>`;
}
function suggestComparison() {
  const keys = new Set(); for (const raw of $('compExtCompTextarea').value.split(/\r?\n/)) { const c = parseClaimLine(raw.trim()); if (c) keys.add(canonicalActive(c.name)); }
  if (!keys.size) { $('compSuggestedMatch').textContent = ''; return; }
  let best = null, bestScore = 0;
  for (const f of activeFormulations()) { const { prof } = ourProfile(f); let s = 0; for (const k of keys) if (prof.has(k)) s++; if (s > bestScore) { best = f; bestScore = s; } }
  $('compSuggestedMatch').innerHTML = best ? `Closest saved formulation: <strong>${esc(best.name)}</strong> (${bestScore} of ${keys.size} actives shared) ${best.id !== $('compOurProductSelect').value ? `<button type="button" id="compUseSuggested" class="underline font-bold ml-1">Use it</button>` : ''}` : 'No saved formulation shares these actives.';
  const b = $('compUseSuggested'); if (b) b.onclick = () => { $('compOurProductSelect').value = best.id; renderComparison(); suggestComparison(); };
}
function openCompare() {
  $('compOurProductSelect').innerHTML = productOptionsHtml(UI.currentId);
  $('compOurProductSelect').value = UI.currentId; $('compOurPack').dataset.for = '';
  openModal('compareModal'); renderComparison(); suggestComparison();
}
async function onCompetitorFile(input) {
  const file = input.files?.[0]; if (!file) return;
  const st = $('competitorOcrStatus');
  try {
    const text = /\.(txt|csv)$/i.test(file.name) || file.type.startsWith('text/') ? await readTextFile(file) : await ocrImage(file, st);
    const p = parseLabelText(text);
    if (p.name && !$('compExtName').value) $('compExtName').value = p.name;
    if (p.price !== null) $('compExtPrice').value = p.price;
    if (p.packSize) { $('compExtPackSize').value = p.packSize; if (['L', 'ml', 'kg', 'g'].includes(p.packUnit)) $('compExtPackUnit').value = p.packUnit; }
    if (p.basis) { $('compExtBasis').value = p.basis; if (['ml', 'g', 'L', 'kg'].includes(p.basisUnit)) $('compExtBasisUnit').value = p.basisUnit === 'l' ? 'L' : p.basisUnit; }
    $('compExtCompTextarea').value = p.claims.length ? p.claims.join('\n') : text.trim();
    st.innerHTML = `<strong class="text-amber-800">Extracted — review required.</strong> ${p.claims.length} composition line(s) recognised${p.claims.length ? '' : ' (raw text pasted below)'}; check every amount, unit and the “declared per” basis.`;
    renderComparison(); suggestComparison();
  } catch (err) { st.textContent = err.message || 'Could not read that file. Type the composition instead.'; }
  input.value = '';
}

/* =====================================================================
   EXPORTS
   ===================================================================== */
function downloadBlob(content, filename, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function fileSafe(s) { return String(s || 'Forvet').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').slice(0, 60); }
function stamp() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }
function backupPayload() { return { app: 'Forvet', schema: APP_SCHEMA, exportedAt: nowIso(), source: isCloudMode() ? 'cloud' : 'local', ingredients: Object.values(S.ingredients), formulations: Object.values(S.formulations), settings: S.settings }; }
function downloadBackup() {
  downloadBlob(JSON.stringify(backupPayload(), null, 2), `Forvet_Backup_${stamp()}.json`, 'application/json');
  META.lastBackupAt = nowIso(); persistLocalNow(); updateStatusBadges(); toast('Backup downloaded.');
}
async function restoreFromFile(file) {
  if (!requireEdit('restore a backup')) return;
  let st;
  try { st = importAnyState(JSON.parse(await readTextFile(file))); }
  catch (err) { uiAlert('Backup not restored', `This file could not be used: ${err.message}`); return; }
  const nf = Object.values(st.formulations).filter(f => !f.deletedAt).length; const ni = Object.keys(st.ingredients).length;
  if (!nf) { uiAlert('Backup not restored', 'The backup has no active formulations.'); return; }
  const choice = await uiDialog('Restore this backup?', `<p>The backup contains <strong>${nf}</strong> formulation(s) and <strong>${ni}</strong> material(s).</p><p>Restoring replaces the current data${isCloudMode() ? ' for everyone using the cloud' : ''}. Current formulations that are not in the backup move to Recently deleted; materials not in the backup are archived. Both can be restored.</p>`, [{ label: 'Cancel', value: null }, { label: 'Download current backup first', value: 'backup' }, { label: 'Restore', value: 'restore', style: 'danger' }]);
  if (!choice) return;
  if (choice === 'backup') { downloadBackup(); if (!(await uiConfirm('Continue restoring?', 'Your current data was downloaded. Restore the selected backup now?', 'Restore', true))) return; }
  applyReplacementState(st);
  toast('Backup restored.');
}
function applyReplacementState(st) {
  const now = nowIso();
  for (const [id, f] of Object.entries(S.formulations)) if (!st.formulations[id] && !f.deletedAt) { f.deletedAt = now; markDirty('formulation', id, { force: true }); }
  for (const [id, i] of Object.entries(S.ingredients)) if (!st.ingredients[id] && !i.archived) { i.archived = true; markDirty('ingredient', id, { force: true }); }
  for (const [id, i] of Object.entries(st.ingredients)) { S.ingredients[id] = i; markDirty('ingredient', id, { force: true }); }
  for (const [id, f] of Object.entries(st.formulations)) { S.formulations[id] = f; markDirty('formulation', id, { force: true }); }
  S.settings = st.settings; markDirty('settings', 'main', { force: true });
  conflicts.clear();
  UI.currentId = activeFormulations()[0]?.id || null; UI.packKey = {}; saveUI();
  persistLocalNow();
  renderAll();
}
async function resetDefaults() {
  if (!requireEdit('reset data')) return;
  const choice = await uiDialog('Reset to factory defaults?', '<p>All formulations, materials and settings are replaced by the built-in starting data. Current formulations move to Recently deleted.</p>', [{ label: 'Cancel', value: null }, { label: 'Download backup first', value: 'backup' }, { label: 'Reset', value: 'reset', style: 'danger' }]);
  if (!choice) return;
  if (choice === 'backup') { downloadBackup(); if (!(await uiConfirm('Continue reset?', 'Backup downloaded. Reset to defaults now?', 'Reset', true))) return; }
  applyReplacementState(makeDefaultState()); closeModal('settingsModal'); toast('Reset to defaults.');
}
function xmlEsc(v) { return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function sheetXml(name, rows) {
  const cell = c => {
    if (c === null || c === undefined || c === '') return '<Cell/>';
    if (typeof c === 'object') { const style = c.bold ? ' ss:StyleID="b"' : ''; const f = c.f ? ` ss:Formula="${xmlEsc(c.f)}"` : ''; const isNum = typeof c.v === 'number' && Number.isFinite(c.v); return `<Cell${style}${f}><Data ss:Type="${isNum ? 'Number' : 'String'}">${xmlEsc(isNum ? round(c.v, 6) : c.v)}</Data></Cell>`; }
    if (typeof c === 'number' && Number.isFinite(c)) return `<Cell><Data ss:Type="Number">${round(c, 6)}</Data></Cell>`;
    return `<Cell><Data ss:Type="String">${xmlEsc(c)}</Data></Cell>`;
  };
  return `<Worksheet ss:Name="${xmlEsc(name.slice(0, 31))}"><Table>${rows.map(r => `<Row>${(r || []).map(cell).join('')}</Row>`).join('')}</Table></Worksheet>`;
}
function exportData() {
  const f = current(); const calc = calcFormulation(f); const unit = calc.unit; const key = currentPackKey(f); const m = calcCommercial(calc, key);
  const basis = compositionBasis(f); const comp = calcComposition(calc, basis.factor);
  const head = [[{ v: `Forvet — ${f.name}`, bold: true }], ['Status', f.status, 'Form', f.form, 'Batch', `${fmtNum(f.batchSize, 3)} ${unit}`], ['Exported', new Date().toLocaleString(), 'Formulated by', 'AZ Shohan'], []];
  const lines = calc.sorted.filter(l => l.complete);
  const master = [...head, ['SL', 'Role', 'Ingredient', `Qty (${unit})`, 'Display unit'].map(v => ({ v, bold: true })), ...lines.map((l, i) => [i + 1, l.role, ingLabel(l.ing), l.qty, autoUnit(l.qty, f.form)?.text || '']), [], ['', '', { v: 'Total', bold: true }, calc.totalQty]];
  const costRows = lines.map(l => [ingLabel(l.ing), l.role, l.qty, unit, l.rate, { v: l.cost, f: '=RC[-3]*RC[-1]' }]);
  const n = costRows.length;
  const costing = [...head, ['Ingredient', 'Role', 'Qty', 'Unit', 'Rate (BDT / unit)', 'Cost (BDT)'].map(v => ({ v, bold: true })), ...costRows,
    ['Total raw materials', '', '', '', '', { v: calc.raw, f: n ? `=SUM(R[-${n}]C:R[-1]C)` : '', bold: true }],
    ['Manufacturing overhead', '', calc.batch, unit, calc.overheadRate, { v: calc.overhead, f: '=RC[-3]*RC[-1]' }],
    [{ v: 'Bulk cost per batch', bold: true }, '', '', '', '', { v: calc.bulk, bold: true }], ['Bulk cost per ' + unit, '', '', '', '', calc.bulkPerUnit], [],
    [{ v: `Commercial waterfall — ${m.label}`, bold: true }, 'Per pack (BDT)', `Batch (${m.yieldN} full packs)`],
    ['MRP', m.c.mrp, m.c.mrp * m.yieldN], ['Trade price (TP)', m.c.tp, m.c.tp * m.yieldN], [`Bonus dilution (${bonusLabel(m.c)})`, -m.bonusDil, -m.bonusDil * m.yieldN],
    [`Cash discount (${m.c.cashDiscPct}% of TP)`, -m.cash, -m.cash * m.yieldN], ['Additional offer', -m.offer, -m.offer * m.yieldN], ['Net realized price', m.nrp, m.nrp * m.yieldN],
    ['Finished COGS (bulk + packaging)', -m.cogs, -m.cogs * m.yieldN], [{ v: 'Gross profit', bold: true }, m.gp, m.gp * m.yieldN],
    [`Marketing (${S.settings.expenses.marketing}% of GP)`, -m.mkt, -m.mkt * m.yieldN], [`Office (${S.settings.expenses.office}% of GP)`, -m.office, -m.office * m.yieldN], [`Misc (${S.settings.expenses.misc}% of GP)`, -m.misc, -m.misc * m.yieldN],
    [{ v: 'Net profit', bold: true }, m.np, m.np * m.yieldN], ['Pricing status', m.c.isSet ? 'Set for this pack' : 'NOT SET — suggested values'], [],
    ['All pack sizes', 'Full packs', 'Leftover', 'COGS/pack', 'TP', 'GP/pack', 'NP/pack', 'Batch NP', 'Pricing'].map(v => ({ v, bold: true })),
    ...packKeysFor(f.form).map(k => { const r = calcCommercial(calc, k); return [r.label, r.yieldN, r.leftover, r.cogs, r.c.tp, r.gp, r.np, r.np * r.yieldN, r.c.isSet ? 'set' : 'not set']; })];
  const label = [...head, [{ v: `Output A — per ${basis.label}`, bold: true }], ['Active material', 'Active moiety', 'Raw input', 'Active claim', 'Estimate?'].map(v => ({ v, bold: true })),
    ...comp.rowsA.map(r => [ingLabel(r.ing), r.ing.activeElement, fmtMass(r.rawMg), r.claim.text, r.claim.est ? 'estimate' : '']), [],
    [{ v: `Output B — totals per ${basis.label}`, bold: true }], ['Element / group', 'Sources', 'Total', 'Estimate?'].map(v => ({ v, bold: true })),
    ...comp.rowsB.map(e => [e.name, e.sources.join(' + '), e.isIU ? fmtIU(e.iu) : fmtMass(e.mg), e.est ? 'estimate' : '']), [], ...comp.warnings.map(w => ['Note', w])];
  const ind = [...head, [{ v: 'Indications', bold: true }], ...calc.lines.filter(l => l.complete && l.role === ACTIVE_ROLE && l.ing.indication).map(l => [l.ing.activeElement || ingLabel(l.ing), l.ing.indication]), [],
    [{ v: 'Suggested dosage (template — verify)', bold: true }], ...f.species.map(sp => [sp, DOSAGE_TEMPLATES[sp]?.[f.form] || '']), [], [{ v: 'Reviewed notes', bold: true }], [f.notes?.dosage || '']];
  const issues = sopReadiness(calc);
  const sop = [...head, [issues.length ? `DRAFT — not validated: ${issues.join(', ')}` : 'Formulation data complete — template process, review before use'], [],
    ...sopPhases(calc).flatMap(p => [[{ v: p.phase, bold: true }, p.ph], ['Instruction', p.desc], ...p.mats.map(x => ['Material', x.name, x.display]), ['Check', p.check], []]), [{ v: 'Process notes', bold: true }], [f.notes?.process || '']];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="b"><Font ss:Bold="1"/></Style></Styles>${sheetXml('Master Formulation', master)}${sheetXml('Costing', costing)}${sheetXml('Label Composition', label)}${sheetXml('Indications and Dosage', ind)}${sheetXml('Manufacturing SOP', sop)}</Workbook>`;
  return { xml, sheets: { master, costing, label, ind, sop } };
}
function exportXls() { const f = current(); downloadBlob(exportData().xml, `${fileSafe(f.name)}_Forvet.xls`, 'application/vnd.ms-excel'); toast('XLS downloaded (5 sheets).'); }
function exportCsv() {
  const f = current(); const { sheets } = exportData();
  const flat = v => (v && typeof v === 'object') ? v.v : v;
  const rows = []; for (const [name, sh] of Object.entries({ 'MASTER FORMULATION': sheets.master, COSTING: sheets.costing, 'LABEL COMPOSITION': sheets.label, 'INDICATIONS & DOSAGE': sheets.ind, 'MANUFACTURING SOP': sheets.sop })) { rows.push([`=== ${name} ===`]); for (const r of sh) rows.push((r || []).map(flat)); rows.push([]); }
  const csv = '\uFEFF' + rows.map(r => r.map(c => { const s = c === null || c === undefined ? '' : (typeof c === 'number' ? String(round(c, 6)) : String(c)); return /[",\n\r]|^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) && typeof c !== 'number' ? "'" : '') + s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
  downloadBlob(csv, `${fileSafe(f.name)}_Forvet.csv`, 'text/csv;charset=utf-8');
  toast('CSV downloaded. Import it into Google Sheets (File → Import); it does not update a live sheet.');
}
function exportPdf() {
  const wasMode = UI.mode; const collapsed = qsa('.sec-body[hidden]');
  $('formulateTop').hidden = false; $('formulateLower').hidden = false;
  collapsed.forEach(b => { b.hidden = false; });
  const restore = () => { collapsed.forEach(b => { b.hidden = true; }); UI.mode = wasMode; renderModeButtons(); window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  setTimeout(() => window.print(), 50);
}
function sopDocumentHtml() {
  const f = current(); const calc = calcFormulation(f); const unit = calc.unit; const issues = sopReadiness(calc); const phases = sopPhases(calc);
  const rows = calc.sorted.filter(l => l.complete).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(ingLabel(l.ing))}</td><td>${esc(l.role)}</td><td class="num">${fmtNum(l.qty, 4)} ${unit}</td><td class="num">${esc(autoUnit(l.qty, f.form)?.text || '')}</td><td class="num">${fmtBDT(l.cost)}</td><td></td><td></td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(f.name)} — Manufacturing SOP</title><style>
  body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#0f172a;margin:24px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:20px 0 8px;border-bottom:2px solid #047857;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #cbd5e1;padding:5px;text-align:left;vertical-align:top}th{background:#ecfdf5}.num{text-align:right;white-space:nowrap}
  .meta td{border:none;padding:2px 8px 2px 0}.draft{border:2px solid #b91c1c;color:#7f1d1d;background:#fef2f2;padding:8px;margin:10px 0;font-weight:bold}.ok{border:1px solid #047857;background:#ecfdf5;padding:8px;margin:10px 0}
  .step{border:1px solid #cbd5e1;border-radius:6px;padding:8px;margin:8px 0;break-inside:avoid}.ph{float:right;font-weight:bold;color:#1e3a8a}.small{font-size:10px;color:#475569}
  .wm{position:fixed;top:42%;left:5%;transform:rotate(-30deg);font-size:40px;font-weight:bold;color:rgba(6,78,59,.07);z-index:-1;white-space:nowrap}.sig td{height:42px}
  .bar{margin-bottom:12px}@media print{.bar{display:none}body{margin:12mm}}</style></head><body>
  <div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="wm">FORVET · ${issues.length ? 'DRAFT' : 'FORMULATED BY AZ SHOHAN'}</div>
  <h1>Manufacturing SOP — ${esc(f.name)}</h1><div class="small">Forvet · Formulated by AZ Shohan</div>
  <table class="meta"><tr><td><b>Product form:</b> ${esc(f.form)}</td><td><b>Batch size:</b> ${fmtNum(calc.batch, 3)} ${unit}</td><td><b>Status:</b> ${esc(f.status)}</td></tr>
  <tr><td><b>Record ID:</b> ${esc(f.id)}</td><td><b>Last revised:</b> ${esc(fmtDate(f.updatedAt))}</td><td><b>Generated:</b> ${esc(new Date().toLocaleString())}</td></tr>
  <tr><td colspan="3"><b>Target species:</b> ${esc(f.species.join(', ') || '—')}</td></tr></table>
  ${issues.length ? `<div class="draft">DRAFT — NOT VALIDATED. Open items: ${esc(issues.join('; '))}.</div>` : '<div class="ok">Formulation data complete. Process steps below are a template and must be verified and approved before use.</div>'}
  <h2>1. Bill of materials (dispensing)</h2><table><thead><tr><th>#</th><th>Material</th><th>Role</th><th class="num">Quantity</th><th class="num">Display</th><th class="num">Est. cost</th><th>Dispensed by</th><th>Checked by</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr><th colspan="3">Total</th><th class="num">${fmtNum(calc.totalQty, 4)} ${unit}</th><th></th><th class="num">${fmtBDT(calc.raw)}</th><th colspan="2"></th></tr></tfoot></table>
  ${calc.f.form === 'Liquid' ? '<p class="small">Liquid balance treats kg of solids and L of liquids 1 : 1; adjust the final volume with water.</p>' : ''}
  <h2>2. Process, mixing order &amp; target pH</h2>${phases.map(p => `<div class="step"><span class="ph">${esc(p.ph)}</span><b>${esc(p.phase)}</b><p>${esc(p.desc)}</p><p><b>Materials:</b> ${p.mats.length ? p.mats.map(x => `${esc(x.name)} — ${esc(x.display)}`).join('; ') : 'None'}</p><p><b>In-process check:</b> ${esc(p.check)} &nbsp; Result: ________ &nbsp; Time: ______ &nbsp; Initials: ____</p></div>`).join('')}
  <h2>3. Process notes</h2><p>${esc(f.notes?.process || 'None recorded.').replace(/\n/g, '<br>')}</p>
  <h2>4. Safety</h2><ul><li>Wear gloves, safety glasses, lab coat and a dust mask when handling powders.</li><li>Check material labels, batch numbers and expiry against the bill of materials before dispensing.</li><li>Clean and record line-clearance before and after the batch.</li></ul>
  <h2>5. Approval</h2><table class="sig"><tr><th>Prepared by</th><th>Checked by (QC)</th><th>Approved by (QA)</th></tr><tr><td></td><td></td><td></td></tr></table>
  <p class="small">Generated by Forvet. This document is a development aid and is not a validated SOP unless approved above.</p>
  </body></html>`;
}
function exportSop() {
  const html = sopDocumentHtml(); const f = current();
  const w = window.open('', '_blank');
  if (!w) { downloadBlob(html, `${fileSafe(f.name)}_SOP.html`, 'text/html'); toast('Pop-up blocked — the SOP was downloaded as an HTML file. Open it and print to PDF.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (_) { /* user can use the button */ } }, 400);
}

/* =====================================================================
   AUTH, SYNC, HISTORY, SETTINGS
   ===================================================================== */
function renderAuthModal() {
  const st = $('authStatus');
  const signedIn = !!CLOUD.user;
  $('authSignedOutFields').hidden = signedIn; $('authSubmitBtn').hidden = signedIn || !CLOUD.client; $('authSignOutBtn').hidden = !signedIn;
  $('authSignupBtn').hidden = signedIn || !CFG.allowSignup || !CLOUD.client;
  qsa('#authSignedOutFields input').forEach(i => { i.required = !signedIn; });
  if (!isCloudMode()) st.textContent = 'Cloud is not configured for this copy (config.js). Data is saved only in this browser and anyone using it can edit.';
  else if (!CLOUD.client) st.textContent = CLOUD.error || 'Connecting to the cloud…';
  else if (signedIn) st.textContent = CLOUD.isAdmin ? `Signed in as administrator: ${CLOUD.user.email}.` : `Signed in as ${CLOUD.user.email}. This account can view but not edit — the owner must add it to forvet_admins.`;
  else st.textContent = 'Sign in with an administrator account to edit. Viewing does not need an account.';
}
async function submitAuth(ev) {
  ev.preventDefault();
  if (!CLOUD.client) { renderAuthModal(); return; }
  const st = $('authStatus'); st.textContent = 'Signing in…'; $('authSubmitBtn').disabled = true;
  try {
    const { data, error } = await CLOUD.client.auth.signInWithPassword({ email: $('authEmail').value.trim(), password: $('authPassword').value });
    if (error) throw error;
    CLOUD.user = data.user; await refreshAdmin(); $('authPassword').value = '';
    try { await pullAll(); } catch (_) { /* badge shows */ }
    renderAll(); renderAuthModal(); if (CLOUD.isAdmin) { flushOutbox(); toast('Signed in — editing unlocked.'); setTimeout(() => closeModal('authModal'), 700); }
  } catch (err) { st.textContent = /invalid/i.test(err.message) ? 'Email or password is incorrect.' : friendlyError(err); }
  finally { $('authSubmitBtn').disabled = false; }
}
async function signUp() {
  const email = $('authEmail').value.trim(); const pw = $('authPassword').value;
  if (!email || pw.length < 8) { $('authStatus').textContent = 'Enter an email and a password of at least 8 characters.'; return; }
  const { data, error } = await CLOUD.client.auth.signUp({ email, password: pw });
  $('authStatus').textContent = error ? friendlyError(error) : data.session ? 'Account created. It can view only until the owner grants admin access.' : 'Account created — confirm your email, then sign in. New accounts are view-only.';
}
async function signOut() {
  if (outbox.size && !(await uiConfirm('Unsent changes', `${outbox.size} change(s) have not reached the cloud yet. They stay in this browser and upload when an administrator signs in here again. Sign out anyway?`, 'Sign out'))) return;
  await CLOUD.client?.auth.signOut();
  CLOUD.user = null; CLOUD.isAdmin = false; UI.adminUserId = null; saveUI(); renderAll(); renderAuthModal(); toast('Signed out.');
}
function stashData() { try { return JSON.parse(localStorage.getItem(LS_STASH) || 'null'); } catch (_) { return null; } }
function renderSyncModal() {
  const body = $('syncModalBody'); const stash = stashData();
  const parts = [];
  if (!isCloudMode()) parts.push('<div class="bg-amber-50 border border-amber-200 rounded-lg p-3"><strong>Local mode.</strong> Everything is saved in this browser only (not shared, not synced). Download backups regularly. To share and protect editing, configure Supabase in <code>config.js</code> — see README.</div>');
  else {
    parts.push(`<div class="border rounded-lg p-3 space-y-1"><div><strong>Cloud:</strong> ${esc(CFG.supabaseUrl)}</div><div><strong>Access:</strong> ${CLOUD.isAdmin ? 'Administrator (can edit)' : CLOUD.user ? `Signed in as ${esc(CLOUD.user.email)} — view only` : 'Public view (not signed in)'}</div><div><strong>Connection:</strong> ${CLOUD.online ? 'online' : 'offline'}${CLOUD.error ? ` — <span class="text-rose-700">${esc(CLOUD.error)}</span>` : ''}</div><div><strong>Last sync:</strong> ${fmtDate(META.lastSyncAt)}</div><div><strong>Waiting to upload:</strong> ${outbox.size}</div></div>`);
    if (outbox.size) parts.push(`<div class="border rounded-lg p-3"><strong>Pending changes</strong><ul class="list-disc pl-5 mt-1">${[...outbox.values()].slice(0, 30).map(o => `<li>${esc(o.kind)}: ${esc(o.kind === 'formulation' ? S.formulations[o.id]?.name : o.kind === 'ingredient' ? ingLabel(S.ingredients[o.id]) : 'Settings')}</li>`).join('')}</ul></div>`);
    if (conflicts.size) parts.push(`<div class="border-2 border-rose-300 rounded-lg p-3 space-y-2"><strong class="text-rose-800">Conflicts — changed on another device</strong>${[...conflicts.entries()].map(([k, c]) => { const local = docFor(c.kind, c.id); const nm = c.kind === 'formulation' ? (local?.name || c.cloud.data?.name) : c.kind === 'ingredient' ? (local?.name || c.cloud.data?.name) : 'Settings'; return `<div class="bg-rose-50 rounded p-2"><div class="font-bold">${esc(c.kind)}: ${esc(nm)}</div><div class="text-[11px] text-slate-600">Cloud version saved ${fmtDate(c.cloud.updated_at)}. Your version edited ${fmtDate(local?.updatedAt)}.</div><div class="flex flex-wrap gap-2 mt-1"><button type="button" data-act="conflict" data-key="${esc(k)}" data-choice="mine" class="admin-only px-2 py-1 rounded bg-slate-900 text-white font-bold">Keep mine (overwrite cloud)</button><button type="button" data-act="conflict" data-key="${esc(k)}" data-choice="cloud" class="px-2 py-1 rounded bg-white border border-slate-300 font-bold">Use cloud version</button></div></div>`; }).join('')}</div>`);
    parts.push('<div class="flex flex-wrap gap-2"><button type="button" data-act="sync-now" class="admin-only px-3 py-2 rounded-lg bg-emerald-600 text-white font-bold">Upload now</button><button type="button" data-act="reload-cloud" class="px-3 py-2 rounded-lg bg-slate-100 border border-slate-300 font-bold">Reload from cloud</button></div>');
  }
  if (stash && (stash.formulations?.length || stash.ingredients?.length)) parts.push(`<div class="border border-sky-300 bg-sky-50 rounded-lg p-3 space-y-2"><strong>Set-aside local data</strong><p>${stash.formulations.length} formulation(s) and ${stash.ingredients.length} material(s) that existed only in this browser were set aside when the cloud was connected (${fmtDate(stash.savedAt)}).</p><div class="flex flex-wrap gap-2"><button type="button" data-act="stash-download" class="px-2 py-1 rounded bg-white border font-bold">Download</button><button type="button" data-act="stash-upload" class="admin-only px-2 py-1 rounded bg-emerald-600 text-white font-bold">Add to cloud</button><button type="button" data-act="stash-discard" class="admin-only px-2 py-1 rounded bg-white border border-rose-300 text-rose-700 font-bold">Discard</button></div></div>`);
  parts.push(`<p class="text-slate-500">Last backup download: ${fmtDate(META.lastBackupAt)}.</p>`);
  body.innerHTML = parts.join(''); applyPermissions();
}
async function stashAction(kind) {
  const stash = stashData(); if (!stash) return;
  if (kind === 'download') { downloadBlob(JSON.stringify({ app: 'Forvet', schema: APP_SCHEMA, exportedAt: nowIso(), ingredients: stash.ingredients, formulations: stash.formulations, settings: S.settings }, null, 2), `Forvet_LocalData_${stamp()}.json`, 'application/json'); return; }
  if (!requireEdit('change cloud data')) return;
  if (kind === 'discard') { if (!(await uiConfirm('Discard set-aside data?', 'This removes it from this browser permanently. Download it first if unsure.', 'Discard', true))) return; localStorage.removeItem(LS_STASH); renderSyncModal(); return; }
  for (const raw of stash.ingredients) { const i = sanitizeIngredient(raw); if (S.ingredients[i.id]) i.id = uid('ing'); S.ingredients[i.id] = i; markDirty('ingredient', i.id); }
  for (const raw of stash.formulations) { const f = sanitizeFormulation(raw, null, S.ingredients); if (S.formulations[f.id]) f.id = uid('f'); S.formulations[f.id] = f; markDirty('formulation', f.id); }
  localStorage.removeItem(LS_STASH); renderAll(); renderSyncModal(); toast('Local data added and uploading.');
}
async function openHistory(id) {
  const f = S.formulations[id]; if (!f || !CLOUD.client) return;
  $('historySubtitle').textContent = f.name; $('historyBody').innerHTML = 'Loading…'; openModal('historyModal');
  try {
    const { data, error } = await CLOUD.client.from('forvet_revisions').select('id,version,data,deleted,changed_at').eq('entity', 'forvet_formulations').eq('entity_id', id).order('changed_at', { ascending: false }).limit(40);
    if (error) throw error;
    window.__forvetHistory = data || [];
    $('historyBody').innerHTML = data?.length ? data.map((r, k) => `<div class="border rounded-lg p-2 flex flex-wrap items-center justify-between gap-2"><div><div class="font-bold">${esc(r.data?.name || '—')} <span class="text-slate-500 font-normal">v${r.version}${r.deleted ? ' · deleted' : ''}</span></div><div class="text-[11px] text-slate-500">Replaced ${fmtDate(r.changed_at)} · ${(r.data?.rows || []).filter(x => x.ingId && !x.autoMakeup).length} rows · batch ${esc(r.data?.batchSize)}</div></div><button type="button" data-act="history-restore" data-idx="${k}" data-id="${esc(id)}" class="admin-only px-3 py-1.5 rounded bg-slate-900 text-white font-bold">Restore this version</button></div>`).join('') : '<p class="text-slate-500">No earlier versions yet — a version is kept every time the formulation is saved to the cloud.</p>';
    applyPermissions();
  } catch (err) { $('historyBody').textContent = friendlyError(err); }
}
async function restoreRevision(id, idx) {
  const r = window.__forvetHistory?.[idx]; if (!r || !requireEdit('restore versions')) return;
  if (!(await uiConfirm('Restore this version?', `The current “${S.formulations[id]?.name}” is replaced by the version from ${fmtDate(r.changed_at)}. The current version is kept in history.`, 'Restore'))) return;
  const f = sanitizeFormulation({ ...r.data, id, deletedAt: null }, id, S.ingredients); f.deletedAt = null;
  S.formulations[id] = f; markDirty('formulation', id); closeModal('historyModal'); switchFormulation(id); toast('Version restored.');
}
function openSettings() {
  const s = S.settings;
  $('setOverhead').value = s.overheadPerUnit; $('setExpMkt').value = s.expenses.marketing; $('setExpOffice').value = s.expenses.office; $('setExpMisc').value = s.expenses.misc;
  $('settingsDataInfo').textContent = `${Object.keys(S.formulations).length} formulations, ${Object.keys(S.ingredients).length} materials. ${isCloudMode() ? 'Stored in the cloud; this browser keeps a cached copy.' : 'Stored in this browser only.'} Last backup download: ${fmtDate(META.lastBackupAt)}.`;
  closeModal('moreSheet'); openModal('settingsModal'); applyPermissions();
}
function saveSettings(ev) {
  ev.preventDefault(); if (!requireEdit('change cost assumptions')) return;
  const vals = ['setOverhead', 'setExpMkt', 'setExpOffice', 'setExpMisc'].map(id => toNum($(id).value));
  if (vals.some(v => v === null || v < 0) || vals.slice(1).some(v => v > 100)) { uiAlert('Check values', 'Overhead must be 0 or more; expense percentages between 0 and 100.'); return; }
  S.settings.overheadPerUnit = vals[0]; S.settings.expenses = { marketing: vals[1], office: vals[2], misc: vals[3] };
  markDirty('settings', 'main'); closeModal('settingsModal'); renderAll(); toast('Cost assumptions saved for all formulations.');
}

/* =====================================================================
   EVENT WIRING & STARTUP
   ===================================================================== */
async function handleAction(btn) {
  const a = btn.dataset.act; const d = btn.dataset;
  switch (a) {
    case 'open-materials': openMaterials(); break;
    case 'close-materials': closeMaterials(); break;
    case 'open-myforms': closeModal('moreSheet'); openModal('myFormulationsModal'); renderMyFormulations(); break;
    case 'open-auth': renderAuthModal(); openModal('authModal'); break;
    case 'open-sync': renderSyncModal(); openModal('syncModal'); break;
    case 'open-more': openModal('moreSheet'); applyPermissions(); break;
    case 'create': if (requireEdit('create formulations')) { closeModal('moreSheet'); $('createProdName').value = ''; openModal('createModal'); } break;
    case 'duplicate': closeModal('moreSheet'); duplicateCurrent(); break;
    case 'delete-current': closeModal('moreSheet'); if (UI.currentId) deleteFormulation(UI.currentId); break;
    case 'optimizer': closeModal('moreSheet'); openOptimizer(); break;
    case 'backup': closeModal('moreSheet'); downloadBackup(); break;
    case 'restore': if (requireEdit('restore a backup')) { closeModal('moreSheet'); $('restoreJsonInput').click(); } break;
    case 'settings': openSettings(); break;
    case 'reset-defaults': resetDefaults(); break;
    case 'export': { closeModal('moreSheet'); const fmt = d.format || 'xls'; if (fmt === 'csv') exportCsv(); else if (fmt === 'pdf') exportPdf(); else exportXls(); break; }
    case 'export-sop': exportSop(); break;
    case 'save-status': saveStatus(d.status); break;
    case 'add-row': addRow(); break;
    case 'remove-row': removeRow(d.line); break;
    case 'swap-row': swapRow(d.line, d.alt); break;
    case 'add-suggested': addRow(d.ing, toNum(d.qty)); break;
    case 'apply-pack-all': applyPricingToAllPacks(); break;
    case 'open-import': if (requireEdit('import formulations')) { $('importStepInput').hidden = false; $('importStepReview').hidden = true; $('importForm').value = current()?.form || 'Liquid'; openModal('importFormulaModal'); } break;
    case 'open-analyze': if (requireEdit('create formulations')) { $('analyzePreview').innerHTML = ''; openModal('analyzeModal'); } break;
    case 'open-compare': openCompare(); break;
    case 'open-bulk': if (requireEdit('import materials')) { $('bulkStepInput').hidden = false; $('bulkStepReview').hidden = true; $('bulkPhotoBox').hidden = d.mode === 'sheet'; $('bulkSheetBox').hidden = d.mode === 'photo'; openModal('bulkImportModal'); } break;
    case 'edit-ing': openEditIngredient(d.id); break;
    case 'archive-ing': archiveIngredient(d.id, true); break;
    case 'unarchive-ing': archiveIngredient(d.id, false); break;
    case 'add-category': addCategory(d.target); break;
    case 'open-form': closeModal('myFormulationsModal'); UI.mode = 'formulate'; if (!$('materialsView').hidden) closeMaterials(true); switchFormulation(d.id); window.scrollTo({ top: 0 }); break;
    case 'delete-form': await deleteFormulation(d.id); renderMyFormulations(); break;
    case 'restore-form': restoreFormulation(d.id); renderMyFormulations(); break;
    case 'history': openHistory(d.id); break;
    case 'history-restore': restoreRevision(d.id, Number(d.idx)); break;
    case 'conflict': resolveConflict(d.key, d.choice); break;
    case 'sync-now': await flushOutbox(); renderSyncModal(); break;
    case 'reload-cloud': try { await pullAll(); renderAll(); toast('Reloaded from cloud.'); } catch (err) { toast(friendlyError(err)); } renderSyncModal(); break;
    case 'stash-download': stashAction('download'); break;
    case 'stash-upload': stashAction('upload'); break;
    case 'stash-discard': stashAction('discard'); break;
    default: break;
  }
}
/* Header dropdown menus ([data-menu] > [data-menu-toggle] + .menu-pop) */
function closeMenus(except) {
  qsa('[data-menu]').forEach(m => { if (m === except) return; const pop = m.querySelector('.menu-pop'); if (pop && !pop.hidden) { pop.hidden = true; m.querySelector('[data-menu-toggle]')?.setAttribute('aria-expanded', 'false'); } });
}
function toggleMenu(toggle) {
  const m = toggle.closest('[data-menu]'); const pop = m.querySelector('.menu-pop');
  closeMenus(m);
  const open = pop.hidden; pop.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
  if (open) { applyPermissions(); pop.querySelector('[role=menuitem]:not([disabled])')?.focus({ preventScroll: true }); }
}
function onMenuKey(ev) {
  const pop = ev.target.closest?.('.menu-pop'); if (!pop) return false;
  const items = [...pop.querySelectorAll('[role=menuitem]:not([disabled])')]; const i = items.indexOf(document.activeElement);
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const n = items.length; items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus(); return true; }
  if (ev.key === 'Escape') { const t = pop.closest('[data-menu]').querySelector('[data-menu-toggle]'); closeMenus(); t?.focus(); return true; }
  return false;
}
function wireEvents() {
  document.addEventListener('click', ev => {
    const menuToggle = ev.target.closest('[data-menu-toggle]');
    if (menuToggle) { ev.preventDefault(); toggleMenu(menuToggle); return; }
    closeMenus();
    const actEl = ev.target.closest('[data-act]');
    if (actEl && !actEl.disabled) { ev.preventDefault(); handleAction(actEl); return; }
    const closeEl = ev.target.closest('[data-close]');
    if (closeEl) { const m = closeEl.closest('.modal-backdrop'); if (m) closeModal(m.id); return; }
    const modeEl = ev.target.closest('[data-mode]:not([data-act])');
    if (modeEl && modeEl.classList.contains('mode-btn')) { setMode(modeEl.dataset.mode); return; }
    const tab = ev.target.closest('[data-myf-tab]'); if (tab) { UI.myfTab = tab.dataset.myfTab; saveUI(); renderMyFormulations(); return; }
    const pr = ev.target.closest('[data-pack-row]'); if (pr) { setPackKey(pr.dataset.packRow); return; }
    if (ev.target.classList.contains('modal-backdrop') && ev.target.id !== 'uiDialog') closeModal(ev.target.id);
  });
  document.addEventListener('keydown', ev => {
    if (onMenuKey(ev)) return;
    if (ev.key === 'Escape' && qsa('[data-menu] .menu-pop').some(p => !p.hidden)) { closeMenus(); return; }
    if (ev.key === 'Escape' && modalStack.length) { closeModal(modalStack[modalStack.length - 1]); return; }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('[data-pack-row]')) { ev.preventDefault(); setPackKey(ev.target.dataset.packRow); }
  });
  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.closest('#formulaTableBody') && el.dataset.field) return onRowChange(el);
    if (el.classList.contains('product-select')) return switchFormulation(el.value);
    if (['productName', 'productForm', 'batchSize', 'formulationIntention'].includes(el.id) || el.classList.contains('species-checkbox')) return onMetaChange(el);
    if (el.dataset.packField) return onPackFieldChange(el);
    if (el.id === 'packSizeSelect') return setPackKey(el.value);
    if (el.id === 'compBasisSelect') { UI.compBasis = el.value; saveUI(); return renderAll(); }
    if (el.id === 'compCustomValue') { UI.compCustom = toNum(el.value) || 1; saveUI(); return renderAll(); }
    if (el.classList.contains('comm-input')) return onCommercialInput();
    if (el.id === 'materialsShowArchived') return renderMaterials();
    if (el.dataset.importIdx !== undefined) { importDraft.items[Number(el.dataset.importIdx)].decision = el.value; return renderImportReview(); }
    if (el.dataset.bulkIdx !== undefined) { bulkDraft[Number(el.dataset.bulkIdx)].decision = el.value; return renderBulkReview(); }
    if (['compOurProductSelect', 'compOurPack', 'compExtBasisUnit', 'compExtPackUnit'].includes(el.id)) { if (el.id === 'compOurProductSelect') $('compOurPack').dataset.for = ''; return renderComparison(); }
    if (el.id === 'restoreJsonInput') { const file = el.files?.[0]; el.value = ''; if (file) restoreFromFile(file); return; }
    if (el.id === 'importSheetFile' && el.files?.[0]) { readTextFile(el.files[0]).then(t => { $('importFormulaTextarea').value = t.trim(); if (!$('importName').value) $('importName').value = el.files[0].name.replace(/\.[^.]+$/, ''); el.value = ''; }); return; }
    if (el.id === 'importPhotoFile' && el.files?.[0]) { const st = $('importOcrStatus'); ocrImage(el.files[0], st).then(t => { $('importFormulaTextarea').value = normalizeOcrFormulaText(t); st.innerHTML = '<strong class="text-amber-800">Extracted — review required.</strong> Check names, decimals and units before reviewing matches.'; }).catch(e => { st.textContent = e.message; }).finally(() => { el.value = ''; }); return; }
    if (el.id === 'bulkSheetFile' && el.files?.[0]) { readTextFile(el.files[0]).then(t => { $('bulkImportTextarea').value = t.trim(); el.value = ''; }); return; }
    if (el.id === 'bulkPhotoFile' && el.files?.[0]) { const st = $('bulkOcrStatus'); ocrImage(el.files[0], st).then(t => { $('bulkImportTextarea').value = normalizeOcrFormulaText(t); st.innerHTML = '<strong class="text-amber-800">Extracted — review required.</strong> Fix names and rates before reviewing.'; }).catch(e => { st.textContent = e.message; }).finally(() => { el.value = ''; }); return; }
    if (el.id === 'analyzeFile' && el.files?.[0]) { const st = $('analyzeOcrStatus'); const file = el.files[0]; (/\.(txt|csv)$/i.test(file.name) ? readTextFile(file) : ocrImage(file, st)).then(t => { const p = parseLabelText(t); $('analyzeLiteratureTextarea').value = p.claims.length ? p.claims.join('\n') : t.trim(); if (p.name && !$('analyzeRefName').value) $('analyzeRefName').value = p.name; st.innerHTML = `<strong class="text-amber-800">Extracted — review required.</strong> ${p.claims.length} claim(s) recognised. Amounts must be per 1 ml / 1 g.`; }).catch(e => { st.textContent = e.message; }).finally(() => { el.value = ''; }); return; }
    if (el.id === 'competitorFile') return onCompetitorFile(el);
  });
  document.addEventListener('input', ev => {
    const el = ev.target;
    if (el.id === 'productName') { const f = current(); if (f && canEdit()) { f.name = normalizeVitaminTerms(el.value).trim() || f.name; markDirty('formulation', f.id); } return; }
    if (el.id === 'dosageNotes' || el.id === 'processNotes') return onNotesInput(el);
    if (el.classList.contains('comm-input') && el.tagName === 'INPUT') return onCommercialInput();
    if (el.id === 'materialsSearch') return renderMaterials();
    if (el.id === 'myFormulationsSearch') return renderMyFormulations();
    if (['compExtCompTextarea', 'compExtBasis', 'compExtPrice', 'compExtPackSize', 'compExtName'].includes(el.id)) { renderComparison(); if (el.id === 'compExtCompTextarea') suggestComparison(); }
  });
  $('createForm').addEventListener('submit', createFromForm);
  $('quickAddForm').addEventListener('submit', quickAdd);
  $('editIngredientForm').addEventListener('submit', saveIngredientEdit);
  $('settingsForm').addEventListener('submit', saveSettings);
  $('authForm').addEventListener('submit', submitAuth);
  $('authSignOutBtn').addEventListener('click', signOut);
  $('authSignupBtn').addEventListener('click', signUp);
  $('importReviewBtn').addEventListener('click', importReview);
  $('importBackBtn').addEventListener('click', () => { $('importStepInput').hidden = false; $('importStepReview').hidden = true; });
  $('importCommitBtn').addEventListener('click', importCommit);
  $('bulkReviewBtn').addEventListener('click', bulkReview);
  $('bulkBackBtn').addEventListener('click', () => { $('bulkStepInput').hidden = false; $('bulkStepReview').hidden = true; });
  $('bulkCommitBtn').addEventListener('click', bulkCommit);
  $('applyAllSwapsBtn').addEventListener('click', applyAllSwaps);
  $('analyzePreviewBtn').addEventListener('click', renderAnalyzePreview);
  $('analyzeGenerateBtn').addEventListener('click', analyzeGenerate);
  window.addEventListener('beforeprint', () => { $('printDate').textContent = new Date().toLocaleString(); qsa('details.pl-howto').forEach(d => { d.open = true; }); });
}
async function boot() {
  const source = loadLocal();
  if (!S.settings) S.settings = sanitizeSettings({});
  for (const i of Object.values(S.ingredients)) for (const c of i.categories) if (!S.settings.categories.includes(c)) S.settings.categories.push(c);
  ensureCurrentValid();
  wireEvents(); initCollapsibles(); initEnterNavigation(); initBackToTop();
  renderAll();
  persistLocalNow(); updateStatusBadges();
  if (source === 'legacy') toast('Your data from the previous Forvet version was imported. The old copy is kept untouched in this browser.');
  const st = stashData(); if (st && (st.formulations?.length || st.ingredients?.length)) showBanner('stash', 'info', 'Some local-only data from this browser was set aside when the cloud connected.', [{ label: 'Review', act: 'open-sync' }]);
  await initCloud();
  window.__forvetReady = true;
}
document.addEventListener('DOMContentLoaded', () => { boot().catch(err => { console.error(err); showBanner('boot', 'error', `Forvet failed to start: ${err.message}. Download a backup from Settings if possible and reload.`); }); });
