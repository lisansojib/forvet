'use strict';
/* =====================================================================
   FORVET — Veterinary formulation, costing & commercial ERP
   Single-file app. Data lives in browser storage (local mode) or in
   Supabase (cloud mode, public read / admin write), with this browser
   as an offline cache and outbox.
   ===================================================================== */

const APP_SCHEMA = 6;
const LS_DATA = 'FORVET_DATA_V6';
const LS_OUTBOX = 'FORVET_OUTBOX_V6';
const LS_UI = 'FORVET_UI_V6';
const LS_STASH = 'FORVET_LOCAL_STASH_V6';
const LS_LEGACY = 'FORMUVET_AZ_SHOHAN_ERP_V1';
const CFG = Object.assign({ supabaseUrl: '', supabaseAnonKey: '', allowSignup: false }, window.FORVET_CONFIG || {});
const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
const TESSERACT_JS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
const CARRIER_ROLE = 'Carrier / Base';
const ACTIVE_ROLE = 'Active Ingredients';
const DEFAULT_CATEGORIES = ['Active Ingredients', 'Carrier / Base', 'Preservative', 'Color', 'Flavor', 'Sweetener', 'Excipient', 'Solvent', 'Binder'];

/* ---------------- small utilities ---------------- */
const $ = id => document.getElementById(id);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
function uid(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function nowIso() { return new Date().toISOString(); }
function toNum(v) { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function round(n, d = 6) { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; }
function fmtBDT(amount) {
  const n = Number(amount) || 0;
  return (n < 0 ? '-' : '') + '৳' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n, max = 3) { return (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: max }); }
function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
function sameDoc(a, b) { return canonicalJson(a) === canonicalJson(b); }

/* Token-aware vitamin normalisation: "Vit D3" → "Vitamin D3"; leaves words like "Vitality" alone. */
function normalizeVitaminTerms(value) {
  return String(value ?? '').replace(/\bVit\.?\s*(A|B1|B2|B3|B5|B6|B7|B9|B12|C|D3|D|E|K3|K)\b/gi, (_, v) => `Vitamin ${v.toUpperCase()}`);
}
function nameKey(v) { return normalizeVitaminTerms(v).trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
function aliasKey(name) {
  let v = normalizeVitaminTerms(String(name || '')).toLowerCase();
  const map = [
    [/\b(msp|mono\s*sodium phosphate|monosodium phosphate)\b/g, 'monosodium phosphate'],
    [/\b(mcp|mono\s*calcium phosphate|monocalcium phosphate)\b/g, 'monocalcium phosphate'],
    [/\b(dcp|di\s*calcium phosphate|dicalcium phosphate)\b/g, 'dicalcium phosphate'],
    [/\b(dm water|deionized water|de-ionized water|distilled water|purified water|demineralized water)\b/g, 'purified water'],
    [/\b(caco3|calcium carbonate|limestone)\b/g, 'calcium carbonate'],
    [/\b(pg|propylene glycol)\b/g, 'propylene glycol'],
    [/\b(dextrose monohydrate|glucose monohydrate)\b/g, 'dextrose monohydrate'],
    [/\b(cmc|sodium carboxymethyl cellulose|carboxymethyl cellulose)\b/g, 'carboxymethyl cellulose'],
    [/\b(cholecalciferol)\b/g, 'vitamin d3'],
    [/\b(ascorbic acid)\b/g, 'vitamin c'],
    [/\b(cyanocobalamin)\b/g, 'vitamin b12']
  ];
  for (const [re, rep] of map) v = v.replace(re, rep);
  v = v.replace(/\([^)]*\)/g, ' ').replace(/\b(usp|bp|ep|ip|pharma grade|feed grade|food grade|vet grade|industrial grade|powder|liquid|crystalline|fine)\b/g, ' ');
  return v.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function editDistance(a, b) {
  if (a === b) return 0;
  const prev = new Array(b.length + 1); for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = prev[j]; prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1)); diag = tmp; }
  }
  return prev[b.length];
}
function similarity(a, b) { const m = Math.max(a.length, b.length) || 1; return 1 - editDistance(a, b) / m; }
function normalizeCategory(v) { const s = String(v || '').trim(); return s === 'Colorant' ? 'Color' : s; }

/* ---------------- reference data (ported from the previous build) ---------------- */
const REFERENCE_LOOKUP = [
  { keywords: ['mono sodium phosphate', 'monosodium', 'msp'], rate: 260, potency: 25.8, elementGroup: 'Inorganic Phosphorus & Calcium', activeElement: 'Available Phosphorus (25.8% P)', absorption: 92, elementalMap: { 'Elemental Phosphorus (P)': 25.8 }, indication: 'Water-soluble phosphorus source for rapid correction of hypophosphatemia.' },
  { keywords: ['magnesium', 'mgso4'], rate: 65, potency: 9.8, elementGroup: 'Elemental Magnesium Source', activeElement: 'Elemental Magnesium (9.8% Mg)', absorption: 75, elementalMap: { 'Elemental Magnesium (Mg)': 9.8 }, indication: 'Prevents grass tetany in cattle and supports ionic balance in shrimp.' },
  { keywords: ['selenite', 'selenium'], rate: 1850, potency: 4.5, elementGroup: 'Elemental Selenium Source', activeElement: 'Elemental Selenium (4.5% Se)', absorption: 82, elementalMap: { 'Elemental Selenium (Se)': 4.5 }, indication: 'Synergistic antioxidant with Vitamin E.' },
  { keywords: ['cobalt'], rate: 1450, potency: 21.0, elementGroup: 'Elemental Cobalt Source', activeElement: 'Elemental Cobalt (21% Co)', absorption: 78, elementalMap: { 'Elemental Cobalt (Co)': 21.0 }, indication: 'Precursor for rumen microbial synthesis of Vitamin B12.' },
  { keywords: ['lysine'], rate: 310, potency: 98.5, elementGroup: 'Essential Amino Acid (Lysine)', activeElement: 'L-Lysine HCl (78.8% Base)', absorption: 96, elementalMap: { 'L-Lysine': 78.8 }, indication: 'Essential amino acid for muscle growth and feed conversion efficiency.' },
  { keywords: ['methionine'], rate: 490, potency: 99.0, elementGroup: 'Essential Amino Acid (Methionine)', activeElement: 'DL-Methionine (99%)', absorption: 97, elementalMap: { 'DL-Methionine': 99.0 }, indication: 'Sulfur amino acid for feather growth, egg weight, and liver health.' },
  { keywords: ['choline'], rate: 175, potency: 60.0, elementGroup: 'Lipid Metabolism Factor', activeElement: 'Choline Chloride (60%)', absorption: 88, elementalMap: { 'Choline Chloride': 60.0 }, indication: 'Prevents fatty liver syndrome and improves lipid transport.' }
];
function referenceSpecs(name) { const l = String(name || '').toLowerCase(); return REFERENCE_LOOKUP.find(r => r.keywords.some(k => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(l))) || null; }

/* Legacy-format defaults; passed through migrateLegacy() so new and old data share one path. */
const LEGACY_DEFAULTS = {
  ingredientsDB: [
    { id: 'cal_gluco', name: 'Calcium Gluconate BP (Injectable/Oral Grade)', category: 'Active Ingredients', rate: 680, elementGroup: 'Elemental Calcium Source', activeElement: 'Calcium Gluconate (9.3% Elemental Ca)', potencyPct: 100, absorption: 95, elementalMap: { 'Elemental Calcium (Ca)': 9.3 }, indication: 'High-absorption organic calcium; prevents milk fever, rickets, and eggshell fragility.', speciesRule: 'NONE' },
    { id: 'cal_lactate', name: 'Calcium Lactate Pentahydrate USP (Soluble)', category: 'Active Ingredients', rate: 390, elementGroup: 'Elemental Calcium Source', activeElement: 'Calcium Lactate (13.0% Elemental Ca)', potencyPct: 100, absorption: 90, elementalMap: { 'Elemental Calcium (Ca)': 13.0 }, indication: 'Bioavailable soluble calcium source for bone mineralization and milk yield.', speciesRule: 'NONE' },
    { id: 'cal_carbonate', name: 'Calcium Carbonate Fine Powder (Feed/Vet Grade)', categories: ['Active Ingredients', 'Carrier / Base'], rate: 85, elementGroup: 'Elemental Calcium Source', activeElement: 'Calcium Carbonate (38% Elemental Ca)', potencyPct: 100, absorption: 62, elementalMap: { 'Elemental Calcium (Ca)': 38.0 }, indication: 'Economical macromineral calcium for skeletal development and carapace hardening.', speciesRule: 'NONE', aliases: ['CaCO3', 'Limestone'] },
    { id: 'msp_26', name: 'Mono Sodium Phosphate (MSP 25.8% P, Water Soluble)', category: 'Active Ingredients', rate: 265, elementGroup: 'Inorganic Phosphorus & Calcium', activeElement: 'Mono Sodium Phosphate (25.8% P, 19.1% Na)', potencyPct: 100, absorption: 94, elementalMap: { 'Elemental Phosphorus (P)': 25.8, 'Elemental Sodium (Na)': 19.1 }, indication: 'Ultra-absorbable phosphorus and sodium source for liquid and soluble formulations.', speciesRule: 'NONE', aliases: ['MSP', 'Monosodium Phosphate'] },
    { id: 'mcp_22', name: 'Monocalcium Phosphate (MCP 22.7% P, 16.0% Ca)', category: 'Active Ingredients', rate: 210, elementGroup: 'Inorganic Phosphorus & Calcium', activeElement: 'Monocalcium Phosphate (22.7% P, 16% Ca)', potencyPct: 100, absorption: 86, elementalMap: { 'Elemental Phosphorus (P)': 22.7, 'Elemental Calcium (Ca)': 16.0 }, indication: 'High-digestibility dual phosphorus and calcium source for fertility and growth.', speciesRule: 'NONE', aliases: ['MCP'] },
    { id: 'dcp_18', name: 'Dicalcium Phosphate Dihydrate (DCP 18.0% P, 23.0% Ca)', category: 'Active Ingredients', rate: 125, elementGroup: 'Inorganic Phosphorus & Calcium', activeElement: 'Dicalcium Phosphate (18% P, 23% Ca)', potencyPct: 100, absorption: 72, elementalMap: { 'Elemental Phosphorus (P)': 18.0, 'Elemental Calcium (Ca)': 23.0 }, indication: 'Cost-effective macromineral phosphorus and calcium supplementation.', speciesRule: 'NONE', aliases: ['DCP'] },
    { id: 'vit_d3_500', name: 'Vitamin D3 (Cholecalciferol) Water-Dispersible Powder', category: 'Active Ingredients', rate: 3200, elementGroup: 'Cholecalciferol (Vitamin D3)', activeElement: 'Cholecalciferol (Vitamin D3)', potencyPct: 100, absorption: 95, elementalMap: { 'Vitamin D3 (Cholecalciferol)': 100.0 }, indication: 'Essential regulator for intestinal Calcium and Phosphorus absorption.', speciesRule: 'NONE', aliases: ['Cholecalciferol', 'Vitamin D3 500'] },
    { id: 'vit_e_dsm', name: 'Vitamin E 50% Micellized Adsorbate (High Bioavailability)', category: 'Active Ingredients', rate: 2450, elementGroup: 'Alpha-Tocopherol (Vitamin E)', activeElement: 'dl-Alpha-Tocopheryl Acetate (50%)', potencyPct: 50, absorption: 94, elementalMap: { 'Vitamin E (Alpha-Tocopherol)': 50.0 }, indication: 'Potent antioxidant; enhances immunity, fertility, and hatchability.', speciesRule: 'NONE' },
    { id: 'vit_e_asian', name: 'Vitamin E 50% Carrier Powder (Standard Feed Grade)', category: 'Active Ingredients', rate: 1620, elementGroup: 'Alpha-Tocopherol (Vitamin E)', activeElement: 'dl-Alpha-Tocopheryl Acetate (50%)', potencyPct: 50, absorption: 78, elementalMap: { 'Vitamin E (Alpha-Tocopherol)': 50.0 }, indication: 'Antioxidant defense and reproductive hormone support.', speciesRule: 'NONE' },
    { id: 'vit_c_coated', name: 'Ascorbic Acid (Vitamin C) 97% Ethylcellulose Coated', category: 'Active Ingredients', rate: 1180, elementGroup: 'Ascorbic Acid (Vitamin C)', activeElement: 'L-Ascorbic Acid (97% Coated)', potencyPct: 97, absorption: 95, elementalMap: { 'Vitamin C (L-Ascorbic Acid)': 97.0 }, indication: 'Heat-stable coated Vitamin C; combats heat stress and boosts immunity.', speciesRule: 'NONE' },
    { id: 'vit_c_pure', name: 'Ascorbic Acid (Vitamin C) 99% Crystalline BP', category: 'Active Ingredients', rate: 760, elementGroup: 'Ascorbic Acid (Vitamin C)', activeElement: 'L-Ascorbic Acid (99%)', potencyPct: 99, absorption: 82, elementalMap: { 'Vitamin C (L-Ascorbic Acid)': 99.0 }, indication: 'Anti-stress vitamin and immune modulator.', speciesRule: 'NONE' },
    { id: 'vit_b12_1pct', name: 'Cyanocobalamin (Vitamin B12 1% Carrier Trituration)', category: 'Active Ingredients', rate: 4500, elementGroup: 'Cyanocobalamin (Vitamin B12)', activeElement: 'Cyanocobalamin (1% Pure)', potencyPct: 1, absorption: 92, elementalMap: { 'Vitamin B12 (Cyanocobalamin)': 1.0 }, indication: 'Stimulates red blood cell formation and energy metabolism.', speciesRule: 'NONE' },
    { id: 'zn_chelate', name: 'Zinc Glycinate Chelate (26% Organic Zn - High Absorption)', category: 'Active Ingredients', rate: 960, elementGroup: 'Elemental Zinc Source', activeElement: 'Organic Chelated Zinc (26% Zn)', potencyPct: 26, absorption: 96, elementalMap: { 'Elemental Zinc (Zn)': 26.0 }, indication: 'Superior bioavailability chelated zinc for hoof integrity, udder health, and gut repair.', speciesRule: 'NONE' },
    { id: 'zn_sulfate', name: 'Zinc Sulfate Monohydrate (36% Inorganic Zn)', category: 'Active Ingredients', rate: 240, elementGroup: 'Elemental Zinc Source', activeElement: 'Inorganic Zinc Sulfate (36% Zn)', potencyPct: 36, absorption: 65, elementalMap: { 'Elemental Zinc (Zn)': 36.0 }, indication: 'Economical trace mineral for epithelial integrity and enzyme activation.', speciesRule: 'NONE' },
    { id: 'sod_selenite', name: 'Sodium Selenite Premix (4.5% Elemental Se)', category: 'Active Ingredients', rate: 1850, elementGroup: 'Elemental Selenium Source', activeElement: 'Elemental Selenium (4.5% Se)', potencyPct: 4.5, absorption: 85, elementalMap: { 'Elemental Selenium (Se)': 4.5 }, indication: 'Antioxidant co-factor working synergistically with Vitamin E.', speciesRule: 'NONE' },
    { id: 'cu_sulfate', name: 'Copper Sulfate Pentahydrate (25% Elemental Cu)', category: 'Active Ingredients', rate: 480, elementGroup: 'Elemental Copper Source', activeElement: 'Elemental Copper (25% Cu)', potencyPct: 25, absorption: 74, elementalMap: { 'Elemental Copper (Cu)': 25.0 }, indication: 'Co-factor for hemoglobin synthesis and cartilage formation.', speciesRule: 'CAUTION_AQUA' },
    { id: 'urea_vet', name: 'Urea Prills (46% Nitrogen - Ruminant NPN Source)', category: 'Active Ingredients', rate: 95, elementGroup: 'Non-Protein Nitrogen (Ruminant)', activeElement: 'Non-Protein Nitrogen (46% N)', potencyPct: 46, absorption: 88, elementalMap: { 'Non-Protein Nitrogen (N)': 46.0 }, indication: 'Rumen microbial crude protein synthesis enhancer exclusively for Cattle.', speciesRule: 'NO_POULTRY_AQUA' },
    { id: 'sod_bicarb', name: 'Sodium Bicarbonate BP (27.4% Elemental Na)', category: 'Active Ingredients', rate: 110, elementGroup: 'Electrolyte Sodium / Buffer', activeElement: 'Sodium Bicarbonate (27.4% Na)', potencyPct: 100, absorption: 95, elementalMap: { 'Elemental Sodium (Na)': 27.4 }, indication: 'Prevents rumen acidosis in cattle and restores blood bicarbonate.', speciesRule: 'NONE' },
    { id: 'pot_chloride', name: 'Potassium Chloride USP (52.4% Elemental K)', category: 'Active Ingredients', rate: 165, elementGroup: 'Electrolyte Potassium', activeElement: 'Potassium Chloride (52.4% K)', potencyPct: 100, absorption: 95, elementalMap: { 'Elemental Potassium (K)': 52.4 }, indication: 'Maintains intracellular osmotic pressure and electrolyte balance.', speciesRule: 'NONE' },
    { id: 'methyl_paraben', name: 'Methyl Paraben Sodium BP (Broad-Spectrum Antimicrobial)', category: 'Preservative', rate: 1150, elementGroup: 'Antimicrobial Preservative', activeElement: 'Excipient', potencyPct: 0, absorption: 95, elementalMap: {}, indication: '', speciesRule: 'NONE' },
    { id: 'sod_benzoate', name: 'Sodium Benzoate BP (Economical Preservative)', category: 'Preservative', rate: 410, elementGroup: 'Antimicrobial Preservative', activeElement: 'Excipient', potencyPct: 0, absorption: 85, elementalMap: {}, indication: '', speciesRule: 'NONE' },
    { id: 'sucralose', name: 'Sucralose Micronized (High-Palatability Sweetener)', category: 'Sweetener', rate: 3600, elementGroup: 'Palatability Sweetener', activeElement: 'Excipient', potencyPct: 0, absorption: 96, elementalMap: {}, indication: '', speciesRule: 'NONE' },
    { id: 'sod_saccharin', name: 'Sodium Saccharin BP (Economical Sweetener)', category: 'Sweetener', rate: 1120, elementGroup: 'Palatability Sweetener', activeElement: 'Excipient', potencyPct: 0, absorption: 82, elementalMap: {}, indication: '', speciesRule: 'NONE' },
    { id: 'flavor_banana_prem', name: 'Micro-Encapsulated Sweet Banana Flavor (High Retention)', category: 'Flavor', rate: 2200, elementGroup: 'Aromatic Feed/Oral Flavor', activeElement: 'Excipient', potencyPct: 0, absorption: 95, elementalMap: {}, indication: '', speciesRule: 'NONE' },
    { id: 'flavor_molasses', name: 'Concentrated Green Apple / Molasses Vet Flavor', category: 'Flavor', rate: 1150, elementGroup: 'Aromatic Feed/Oral Flavor', activeElement: 'Excipient', potencyPct: 0, absorption: 84, elementalMap: {}, indication: '', speciesRule: 'NONE' },
    { id: 'color_ponceau', name: 'Ponceau 4R Supra (Pharma Lake Red Colorant)', category: 'Colorant', rate: 2800, elementGroup: 'Visual Identification Dye', activeElement: 'Excipient', potencyPct: 0, absorption: 92, elementalMap: {}, indication: '', speciesRule: 'NONE' },
    { id: 'color_sunset', name: 'Sunset Yellow FCF (Standard Water-Soluble Dye)', category: 'Colorant', rate: 1650, elementGroup: 'Visual Identification Dye', activeElement: 'Excipient', potencyPct: 0, absorption: 85, elementalMap: {}, indication: '', speciesRule: 'NONE' },
    { id: 'purified_water', name: 'Purified Water / DM Water', category: 'Carrier / Base', rate: 15, elementGroup: 'Liquid Aqueous Vehicle', activeElement: 'Vehicle', potencyPct: 0, absorption: 100, elementalMap: {}, indication: '', speciesRule: 'NONE', aliases: ['DM Water', 'Purified Water', 'Deionized Water', 'Distilled Water', 'Water'] },
    { id: 'dextrose_carrier', name: 'Dextrose Monohydrate / Limestone Carrier Base', category: 'Carrier / Base', rate: 115, elementGroup: 'Solid Powder Carrier', activeElement: 'Carrier', potencyPct: 0, absorption: 100, elementalMap: {}, indication: '', speciesRule: 'NONE', aliases: ['Dextrose Monohydrate', 'Dextrose', 'Glucose Monohydrate'] }
  ],
  packagingStore: {
    Liquid: {
      '100ml': { label: '100 ml Bottle', sizeInUnit: 0.1, bottle: 11.5, sticker: 2.2, foil: 0.8, wrapping: 0.6, innerCarton: 3.0, masterCarton: 2.4 },
      '500ml': { label: '500 ml Bottle', sizeInUnit: 0.5, bottle: 24.0, sticker: 3.5, foil: 1.2, wrapping: 1.0, innerCarton: 4.5, masterCarton: 3.8 },
      '1L': { label: '1 Liter Bottle', sizeInUnit: 1.0, bottle: 36.0, sticker: 4.5, foil: 1.5, wrapping: 1.5, innerCarton: 6.0, masterCarton: 5.0 },
      '3L': { label: '3 Liter Jerrycan', sizeInUnit: 3.0, bottle: 78.0, sticker: 7.0, foil: 2.5, wrapping: 2.0, innerCarton: 0.0, masterCarton: 10.0 },
      '5L': { label: '5 Liter Jerrycan', sizeInUnit: 5.0, bottle: 110.0, sticker: 9.0, foil: 3.0, wrapping: 2.5, innerCarton: 0.0, masterCarton: 14.0 }
    },
    Powder: {
      '100g': { label: '100 g Foil Sachet', sizeInUnit: 0.1, sachet: 6.5, labelCost: 1.8, innerCarton: 2.5, masterCarton: 1.8 },
      '500g': { label: '500 g Pouch', sizeInUnit: 0.5, sachet: 14.0, labelCost: 2.8, innerCarton: 4.0, masterCarton: 3.2 },
      '1kg': { label: '1 kg Stand-Up Pouch', sizeInUnit: 1.0, sachet: 22.0, labelCost: 3.5, innerCarton: 5.0, masterCarton: 4.5 },
      '5kg': { label: '5 kg Bucket / Bag', sizeInUnit: 5.0, sachet: 85.0, labelCost: 7.0, innerCarton: 0.0, masterCarton: 12.0 },
      '25kg': { label: '25 kg Laminated Bag', sizeInUnit: 25.0, sachet: 160.0, labelCost: 10.0, innerCarton: 0.0, masterCarton: 20.0 }
    }
  },
  presets: {
    liquid_cal_vit: {
      name: 'VetCal-D3 Plus Oral Liquid', form: 'Liquid', batchSize: 100, status: 'Complete', intention: 'Cost Effective', species: ['Cattle', 'Poultry'],
      commercial: { packSizeKey: '1L', mrp: 320, tp: 250, bonusMode: '1_5', customFree: 1, customPaid: 5, cashDiscPct: 5, addOfferBdt: 0 },
      rows: [{ ingId: 'cal_lactate', qtyKg: 10 }, { ingId: 'mcp_22', qtyKg: 5 }, { ingId: 'msp_26', qtyKg: 2.5 }, { ingId: 'vit_d3_500', qtyKg: 0.045 }, { ingId: 'vit_b12_1pct', qtyKg: 0.025 }, { ingId: 'zn_chelate', qtyKg: 0.8 }, { ingId: 'methyl_paraben', qtyKg: 0.08 }, { ingId: 'sucralose', qtyKg: 0.03 }, { ingId: 'flavor_banana_prem', qtyKg: 0.06 }, { ingId: 'color_ponceau', qtyKg: 0.015 }, { ingId: 'purified_water', qtyKg: 81.445 }]
    },
    powder_electrolyte: {
      name: 'ElectroVit-C Forte WS Powder', form: 'Powder', batchSize: 100, status: 'Complete', intention: 'Performance', species: ['Cattle', 'Poultry', 'Fish and Shrimps'],
      commercial: { packSizeKey: '1kg', mrp: 480, tp: 380, bonusMode: '2_10', customFree: 2, customPaid: 10, cashDiscPct: 5, addOfferBdt: 0 },
      rows: [{ ingId: 'sod_bicarb', qtyKg: 25 }, { ingId: 'pot_chloride', qtyKg: 10 }, { ingId: 'vit_c_coated', qtyKg: 5 }, { ingId: 'vit_e_dsm', qtyKg: 2 }, { ingId: 'sod_selenite', qtyKg: 0.04 }, { ingId: 'zn_sulfate', qtyKg: 0.085 }, { ingId: 'sod_benzoate', qtyKg: 0.075 }, { ingId: 'sod_saccharin', qtyKg: 0.04 }, { ingId: 'color_sunset', qtyKg: 0.02 }, { ingId: 'dextrose_carrier', qtyKg: 57.74 }]
    },
    aqua_growth: {
      name: 'AquaMin-Pro Pond & Feed Premix', form: 'Powder', batchSize: 100, status: 'In Progress', intention: 'Cost Effective', species: ['Fish and Shrimps', 'Cattle'],
      commercial: { packSizeKey: '1kg', mrp: 260, tp: 205, bonusMode: '1_5', customFree: 1, customPaid: 5, cashDiscPct: 4, addOfferBdt: 0 },
      rows: [{ ingId: 'cal_carbonate', qtyKg: 30 }, { ingId: 'dcp_18', qtyKg: 18 }, { ingId: 'mcp_22', qtyKg: 8 }, { ingId: 'pot_chloride', qtyKg: 8 }, { ingId: 'vit_c_coated', qtyKg: 1.5 }, { ingId: 'cu_sulfate', qtyKg: 0.06 }, { ingId: 'sod_benzoate', qtyKg: 0.05 }, { ingId: 'dextrose_carrier', qtyKg: 34.39 }]
    }
  }
};
const PACK_FIELDS = {
  Liquid: [['bottle', 'Bottle / jerrycan'], ['sticker', 'Label sticker'], ['foil', 'Foil seal'], ['wrapping', 'Wrapping / shrink'], ['innerCarton', 'Inner carton'], ['masterCarton', 'Master carton share']],
  Powder: [['sachet', 'Sachet / pouch'], ['labelCost', 'Label sticker'], ['innerCarton', 'Inner carton'], ['masterCarton', 'Master carton share']]
};
const DEFAULT_CARRIER = { Liquid: 'purified_water', Powder: 'dextrose_carrier' };
const BONUS_PRESETS = { none: [0, 1], '1_5': [1, 5], '2_10': [2, 10] };

/* ---------------- state ---------------- */
let S = { ingredients: {}, formulations: {}, settings: null };
let META = { versions: { ingredient: {}, formulation: {}, settings: {} }, touched: {}, lastBackupAt: null, lastSyncAt: null, lastLocalSaveAt: null, cloudUrl: '' };
let UI = { currentId: null, mode: 'formulate', packKey: {}, compBasis: '1', compCustom: 10, collapsed: {}, myfTab: 'active', adminUserId: null };
let outbox = new Map();      // key "kind:id" → { kind, id, seq, force }
let conflicts = new Map();   // key → { kind, id, cloud }
let editSeq = 0;

/* ---------------- migration ---------------- */
function sanitizeIngredient(raw, fallbackId) {
  const cats = (Array.isArray(raw.categories) && raw.categories.length ? raw.categories : [raw.category || ACTIVE_ROLE]).map(normalizeCategory).filter(Boolean);
  const em = {};
  if (raw.elementalMap && typeof raw.elementalMap === 'object') for (const [k, v] of Object.entries(raw.elementalMap)) { const n = toNum(v); if (k && n !== null) em[normalizeVitaminTerms(k)] = n; }
  const rate = toNum(raw.rate);
  return {
    id: String(raw.id || fallbackId || uid('ing')),
    name: normalizeVitaminTerms(String(raw.name || 'Unnamed material').replace(/\s*\(Q\.S\.[^)]*\)\s*$/i, '').trim()),
    formVersion: normalizeVitaminTerms(String(raw.formVersion || '').trim()),
    aliases: Array.isArray(raw.aliases) ? [...new Set(raw.aliases.map(a => String(a).trim()).filter(Boolean))] : [],
    categories: [...new Set(cats.length ? cats : [ACTIVE_ROLE])],
    rate: rate === null ? 0 : Math.max(0, rate),
    potencyPct: toNum(raw.potencyPct) ?? 0,
    absorption: toNum(raw.absorption) ?? 85,
    vitaminIUPerGram: Math.max(0, toNum(raw.vitaminIUPerGram) || 0),
    elementGroup: String(raw.elementGroup || ''),
    activeElement: normalizeVitaminTerms(String(raw.activeElement || '')),
    elementalMap: em,
    indication: normalizeVitaminTerms(String(raw.indication || '')),
    speciesRule: ['NONE', 'NO_POULTRY_AQUA', 'CAUTION_AQUA'].includes(raw.speciesRule) ? raw.speciesRule : 'NONE',
    targetPhEffect: raw.targetPhEffect || 'neutral',
    supplierNote: String(raw.supplierNote || ''),
    unconfirmed: !!raw.unconfirmed,
    archived: !!raw.archived,
    updatedAt: raw.updatedAt || nowIso()
  };
}
function sanitizeCommercial(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    mrp: Math.max(0, toNum(c.mrp) ?? 0), tp: Math.max(0, toNum(c.tp) ?? 0),
    bonusMode: ['none', '1_5', '2_10', 'custom'].includes(c.bonusMode) ? c.bonusMode : 'none',
    customFree: Math.max(0, Math.floor(toNum(c.customFree) ?? 0)), customPaid: Math.max(1, Math.floor(toNum(c.customPaid) ?? 1)),
    cashDiscPct: Math.min(100, Math.max(0, toNum(c.cashDiscPct) ?? 0)), addOfferBdt: Math.max(0, toNum(c.addOfferBdt) ?? 0),
    promoNote: String(c.promoNote || '').slice(0, 200)
  };
}
function sanitizeFormulation(raw, fallbackId, ingredientIndex) {
  const form = raw.form === 'Powder' ? 'Powder' : 'Liquid';
  const carrierId = DEFAULT_CARRIER[form];
  let qsSeen = false;
  const rows = [];
  for (const r of (Array.isArray(raw.rows) ? raw.rows : [])) {
    if (!r || typeof r !== 'object') continue;
    const ingId = r.ingId ? String(r.ingId) : null;
    let auto = r.autoMakeup === true || (!r.category && !r.role && ingId === carrierId && r.autoMakeup !== false);
    if (auto && qsSeen) auto = false;
    if (auto) qsSeen = true;
    const ing = ingId ? ingredientIndex[ingId] : null;
    const role = normalizeCategory(r.role || r.category || (auto ? CARRIER_ROLE : (ing ? ing.categories[0] : ''))) || null;
    rows.push({ lineId: r.lineId || uid('l'), ingId, role: ingId ? role : null, qty: auto ? null : toNum(r.qty ?? r.qtyKg), autoMakeup: auto });
  }
  if (!qsSeen) rows.push({ lineId: uid('l'), ingId: carrierId, role: CARRIER_ROLE, qty: null, autoMakeup: true });
  const cbp = {};
  if (raw.commercialByPack && typeof raw.commercialByPack === 'object') for (const [k, v] of Object.entries(raw.commercialByPack)) { const c = sanitizeCommercial(v); if (c) cbp[k] = c; }
  else if (raw.commercial && raw.commercial.packSizeKey) { const c = sanitizeCommercial(raw.commercial); if (c) cbp[raw.commercial.packSizeKey] = c; }
  const status = raw.status === 'Complete' || raw.status === 'Saved' ? 'Complete' : 'In Progress';
  return {
    id: String(raw.id || fallbackId || uid('f')),
    name: normalizeVitaminTerms(String(raw.name || 'Untitled formulation').trim()) || 'Untitled formulation',
    form, batchSize: Math.max(0.01, toNum(raw.batchSize) || 100), status,
    intention: raw.intention === 'Performance' ? 'Performance' : 'Cost Effective',
    species: Array.isArray(raw.species) ? raw.species.filter(s => ['Cattle', 'Poultry', 'Fish and Shrimps'].includes(s)) : [],
    rows, commercialByPack: cbp,
    notes: { dosage: String(raw.notes?.dosage || ''), process: String(raw.notes?.process || '') },
    createdAt: raw.createdAt || nowIso(), updatedAt: raw.updatedAt || nowIso(), deletedAt: raw.deletedAt || null
  };
}
function sanitizePackaging(p) {
  const base = clone(LEGACY_DEFAULTS.packagingStore);
  if (!p || typeof p !== 'object') return base;
  const out = {};
  for (const form of ['Liquid', 'Powder']) {
    out[form] = {};
    const src = p[form] && typeof p[form] === 'object' && Object.keys(p[form]).length ? p[form] : base[form];
    for (const [k, v] of Object.entries(src)) {
      const size = toNum(v.sizeInUnit);
      if (!size || size <= 0) continue;
      const item = { label: String(v.label || k), sizeInUnit: size };
      for (const [f] of PACK_FIELDS[form]) item[f] = Math.max(0, toNum(v[f]) || 0);
      out[form][k] = item;
    }
    if (!Object.keys(out[form]).length) out[form] = base[form];
  }
  return out;
}
function sanitizeSettings(raw) {
  raw = raw || {};
  const exp = raw.expenses || {};
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...(Array.isArray(raw.categories) ? raw.categories : []).map(normalizeCategory).filter(Boolean)])];
  return {
    id: 'main', categories: cats, packaging: sanitizePackaging(raw.packaging),
    overheadPerUnit: Math.max(0, toNum(raw.overheadPerUnit) ?? 10),
    expenses: { marketing: Math.max(0, toNum(exp.marketing) ?? 20), office: Math.max(0, toNum(exp.office) ?? 10), misc: Math.max(0, toNum(exp.misc) ?? 5) },
    updatedAt: raw.updatedAt || nowIso()
  };
}
/** Accepts schema-6 backups, legacy v4/v5 backups/localStorage blobs, and returns a clean state. */
function importAnyState(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a JSON object.');
  if (obj.schema >= 6 && (obj.formulations || obj.ingredients)) {
    const ingList = Array.isArray(obj.ingredients) ? obj.ingredients : Object.values(obj.ingredients || {});
    const ingredients = {};
    for (const raw of ingList) { const i = sanitizeIngredient(raw); ingredients[i.id] = i; }
    const fList = Array.isArray(obj.formulations) ? obj.formulations : Object.values(obj.formulations || {});
    const formulations = {};
    for (const raw of fList) { const f = sanitizeFormulation(raw, null, ingredients); formulations[f.id] = f; }
    return { ingredients, formulations, settings: sanitizeSettings(obj.settings) };
  }
  if (Array.isArray(obj.ingredientsDB) && obj.presets && typeof obj.presets === 'object') return migrateLegacy(obj);
  throw new Error('This file is not a Forvet backup (no formulations or materials found).');
}
function migrateLegacy(obj) {
  const ingredients = {};
  const defaultsById = Object.fromEntries(LEGACY_DEFAULTS.ingredientsDB.map(i => [i.id, i]));
  for (const raw of obj.ingredientsDB) {
    if (!raw || !raw.id) continue;
    const i = sanitizeIngredient({ ...raw, aliases: raw.aliases || defaultsById[raw.id]?.aliases });
    ingredients[i.id] = i;
  }
  const formulations = {};
  for (const [key, p] of Object.entries(obj.presets)) { if (!p) continue; const f = sanitizeFormulation({ ...p, id: key }, key, ingredients); formulations[f.id] = f; }
  const settings = sanitizeSettings({ categories: obj.ingredientCategories, packaging: obj.packagingStore });
  for (const i of Object.values(ingredients)) for (const c of i.categories) if (!settings.categories.includes(c)) settings.categories.push(c);
  return { ingredients, formulations, settings };
}
function makeDefaultState() { const st = migrateLegacy(clone(LEGACY_DEFAULTS)); return st; }

/* ---------------- accessors ---------------- */
function getIng(id) { return id ? (S.ingredients[id] || null) : null; }
function ingLabel(ing) { if (!ing) return ''; return ing.formVersion && nameKey(ing.formVersion) !== nameKey(ing.name) ? `${ing.name} — ${ing.formVersion}` : ing.name; }
function current() { return S.formulations[UI.currentId] || null; }
function activeFormulations() { return Object.values(S.formulations).filter(f => !f.deletedAt).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); }
function mainUnit(form) { return form === 'Powder' ? 'kg' : 'L'; }
function smallUnit(form) { return form === 'Powder' ? 'g' : 'ml'; }
function primaryRole(ing) { return ing?.categories?.[0] || ACTIVE_ROLE; }
function sortedIngredients(includeArchived = false) { return Object.values(S.ingredients).filter(i => includeArchived || !i.archived).sort((a, b) => ingLabel(a).localeCompare(ingLabel(b), undefined, { sensitivity: 'base' })); }

/* ---------------- persistence (browser) ---------------- */
function persistLocalNow() {
  try {
    localStorage.setItem(LS_DATA, JSON.stringify({ schema: APP_SCHEMA, savedAt: nowIso(), ingredients: S.ingredients, formulations: S.formulations, settings: S.settings, meta: META }));
    localStorage.setItem(LS_OUTBOX, JSON.stringify([...outbox.values()]));
    META.lastLocalSaveAt = nowIso();
    hideBanner('storage');
    return true;
  } catch (err) {
    console.error('Local save failed', err);
    showBanner('storage', 'error', 'This browser could not save your data (storage full or blocked). Download a backup now to avoid losing changes.', [{ label: 'Download backup', act: 'backup' }]);
    return false;
  }
}
const persistLocalSoon = debounce(() => { persistLocalNow(); updateStatusBadges(); }, 250);
function saveUI() { try { localStorage.setItem(LS_UI, JSON.stringify(UI)); } catch (_) { /* ignore */ } }
function loadLocal() {
  try { const ui = JSON.parse(localStorage.getItem(LS_UI) || 'null'); if (ui && typeof ui === 'object') UI = Object.assign(UI, ui); } catch (_) { /* ignore */ }
  try {
    const raw = JSON.parse(localStorage.getItem(LS_DATA) || 'null');
    if (raw && raw.schema >= 6) {
      const st = importAnyState(raw);
      S = st;
      if (raw.meta && typeof raw.meta === 'object') META = Object.assign(META, raw.meta, { versions: Object.assign({ ingredient: {}, formulation: {}, settings: {} }, raw.meta.versions || {}) });
      const ob = JSON.parse(localStorage.getItem(LS_OUTBOX) || '[]');
      if (Array.isArray(ob)) ob.forEach(it => { if (it && it.kind && it.id) outbox.set(`${it.kind}:${it.id}`, { kind: it.kind, id: it.id, seq: ++editSeq, force: !!it.force }); });
      return 'v6';
    }
  } catch (err) { console.error('Stored data unreadable', err); showBanner('storage', 'error', 'Saved data in this browser could not be read. Defaults were loaded; restore a backup if needed.'); }
  try {
    const legacy = JSON.parse(localStorage.getItem(LS_LEGACY) || 'null');
    if (legacy && Array.isArray(legacy.ingredientsDB)) {
      S = migrateLegacy(legacy);
      if (legacy.currentPresetKey && S.formulations[legacy.currentPresetKey]) UI.currentId = legacy.currentPresetKey;
      for (const f of Object.values(S.formulations)) META.touched[`formulation:${f.id}`] = true;
      for (const i of Object.values(S.ingredients)) META.touched[`ingredient:${i.id}`] = true;
      META.touched['settings:main'] = true;
      return 'legacy';
    }
  } catch (err) { console.warn('Legacy data unreadable', err); }
  S = makeDefaultState();
  return 'defaults';
}

/* ---------------- change tracking ---------------- */
function docFor(kind, id) { return kind === 'settings' ? S.settings : kind === 'ingredient' ? S.ingredients[id] : S.formulations[id]; }
function markDirty(kind, id, opts = {}) {
  const doc = docFor(kind, id);
  if (doc) doc.updatedAt = nowIso();
  const key = `${kind}:${id}`;
  if (!isCloudMode()) META.touched[key] = true;
  if (isCloudMode() && CLOUD.emptyCloud && CLOUD.isAdmin) {
    // First edit against an empty cloud: upload the complete dataset so references stay intact.
    for (const iid of Object.keys(S.ingredients)) outbox.set(`ingredient:${iid}`, { kind: 'ingredient', id: iid, seq: ++editSeq });
    for (const fid of Object.keys(S.formulations)) outbox.set(`formulation:${fid}`, { kind: 'formulation', id: fid, seq: ++editSeq });
    outbox.set('settings:main', { kind: 'settings', id: 'main', seq: ++editSeq });
    CLOUD.emptyCloud = false; hideBanner('seed');
  }
  if (isCloudMode()) outbox.set(key, { kind, id, seq: ++editSeq, force: !!opts.force || !!outbox.get(key)?.force });
  persistLocalSoon();
  scheduleFlush();
  updateStatusBadges();
}

/* =====================================================================
   CLOUD (Supabase) — public read, admin write, optimistic concurrency
   ===================================================================== */
const TABLES = { ingredient: 'forvet_ingredients', formulation: 'forvet_formulations', settings: 'forvet_settings' };
const CLOUD = { client: null, configured: false, ready: false, user: null, isAdmin: false, online: navigator.onLine, flushing: false, lastPull: 0, error: '', retryMs: 4000, retryTimer: null, emptyCloud: false };
function isCloudMode() { return CLOUD.configured; }
function canEdit() { return !isCloudMode() || CLOUD.isAdmin; }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = qsa('script').find(s => s.src === src);
    if (existing && existing.dataset.loaded === '1') return resolve();
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
function cloudConfigLooksValid() {
  return /^https?:\/\/[^\s]+$/i.test(CFG.supabaseUrl || '') && String(CFG.supabaseAnonKey || '').length > 20 && !/YOUR[-_]/i.test(CFG.supabaseUrl + CFG.supabaseAnonKey);
}

async function initCloud() {
  CLOUD.configured = cloudConfigLooksValid();
  if (!CLOUD.configured) { updateStatusBadges(); return; }
  if (META.cloudUrl && META.cloudUrl !== CFG.supabaseUrl) {
    // Different project than last time: forget versions so nothing is overwritten blindly.
    META.versions = { ingredient: {}, formulation: {}, settings: {} };
    outbox.clear();
  }
  updateStatusBadges();
  try {
    if (!window.supabase?.createClient) await loadScript(window.FORVET_SUPABASE_JS_URL || SUPABASE_JS_URL);
    CLOUD.client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'forvet-auth' } });
    const { data } = await CLOUD.client.auth.getSession();
    CLOUD.user = data?.session?.user || null;
    await refreshAdmin();
    CLOUD.client.auth.onAuthStateChange((event, session) => {
      const prev = CLOUD.user?.id || null;
      CLOUD.user = session?.user || null;
      if ((CLOUD.user?.id || null) !== prev || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        setTimeout(async () => { await refreshAdmin(); await pullAll(); renderAll(); if (CLOUD.isAdmin) flushOutbox(); }, 0);
      }
    });
    await pullAll({ first: true });
    CLOUD.ready = true;
    META.cloudUrl = CFG.supabaseUrl;
    persistLocalNow();
    renderAll();
    if (CLOUD.isAdmin) flushOutbox();
  } catch (err) {
    console.error('Cloud init failed', err);
    CLOUD.error = friendlyError(err);
    CLOUD.online = navigator.onLine;
    if (UI.adminUserId && CLOUD.user && UI.adminUserId === CLOUD.user.id) CLOUD.isAdmin = true; // cached admin, offline editing allowed
    renderAll();
  }
  updateStatusBadges();
}

async function refreshAdmin() {
  CLOUD.isAdmin = false;
  if (!CLOUD.client || !CLOUD.user) { UI.adminUserId = null; saveUI(); return; }
  try {
    const { data, error } = await CLOUD.client.rpc('is_forvet_admin');
    if (error) throw error;
    CLOUD.isAdmin = data === true;
    UI.adminUserId = CLOUD.isAdmin ? CLOUD.user.id : null; saveUI();
  } catch (err) {
    console.warn('Admin check failed', err);
    if (UI.adminUserId === CLOUD.user.id) CLOUD.isAdmin = true; // offline: trust cached role; the database still enforces RLS on upload
  }
}

async function fetchTable(table) {
  const rows = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await CLOUD.client.from(table).select('id,data,deleted,version,updated_at').order('id').range(from, from + page - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return rows;
}

/** Merge cloud → local without discarding unsent local edits; detects conflicts. */
async function pullAll(opts = {}) {
  if (!CLOUD.client) return;
  setSyncState('loading');
  try {
    const [ings, forms, sets] = await Promise.all([fetchTable(TABLES.ingredient), fetchTable(TABLES.formulation), fetchTable(TABLES.settings)]);
    CLOUD.online = true; CLOUD.error = '';
    const empty = !ings.length && !forms.length && !sets.length;
    CLOUD.emptyCloud = empty;
    const stash = { ingredients: [], formulations: [] };
    const applyRows = (kind, rows) => {
      const seen = new Set();
      for (const row of rows) {
        seen.add(row.id);
        const key = `${kind}:${row.id}`;
        const known = META.versions[kind][row.id];
        if (outbox.has(key)) {
          if (known !== undefined && row.version !== known) {
            const local = docFor(kind, row.id);
            if (local && sameDoc(local, row.data)) { META.versions[kind][row.id] = row.version; outbox.delete(key); }
            else if (!conflicts.has(key)) conflicts.set(key, { kind, id: row.id, cloud: row });
          } else if (known === undefined) {
            const local = docFor(kind, row.id);
            if (local && sameDoc(local, row.data)) { META.versions[kind][row.id] = row.version; outbox.delete(key); }
            else if (!conflicts.has(key)) conflicts.set(key, { kind, id: row.id, cloud: row });
          }
          continue;
        }
        const data = row.data || {};
        if (kind === 'ingredient') S.ingredients[row.id] = sanitizeIngredient({ ...data, id: row.id });
        else if (kind === 'formulation') S.formulations[row.id] = sanitizeFormulation({ ...data, id: row.id, deletedAt: row.deleted ? (data.deletedAt || row.updated_at) : null }, row.id, S.ingredients);
        else S.settings = sanitizeSettings(data);
        META.versions[kind][row.id] = row.version;
      }
      return seen;
    };
    // Ingredients first so formulation sanitising can resolve roles.
    const seenIng = applyRows('ingredient', ings);
    const seenForm = applyRows('formulation', forms);
    applyRows('settings', sets);
    if (!empty) {
      for (const [kind, seen, store] of [['ingredient', seenIng, S.ingredients], ['formulation', seenForm, S.formulations]]) {
        for (const id of Object.keys(store)) {
          if (seen.has(id)) continue;
          const key = `${kind}:${id}`;
          if (outbox.has(key)) continue;
          if (META.versions[kind][id] !== undefined) { delete store[id]; delete META.versions[kind][id]; continue; } // removed in cloud
          if (META.touched[key]) (kind === 'ingredient' ? stash.ingredients : stash.formulations).push(store[id]);
          delete store[id];
        }
      }
      if (stash.ingredients.length || stash.formulations.length) {
        try {
          const prev = JSON.parse(localStorage.getItem(LS_STASH) || 'null') || { ingredients: [], formulations: [] };
          localStorage.setItem(LS_STASH, JSON.stringify({ savedAt: nowIso(), ingredients: [...prev.ingredients, ...stash.ingredients], formulations: [...prev.formulations, ...stash.formulations] }));
        } catch (_) { /* ignore */ }
      }
      META.touched = {};
    }
    if (!S.settings) S.settings = sanitizeSettings({});
    CLOUD.lastPull = Date.now();
    META.lastSyncAt = nowIso();
    ensureCurrentValid();
    persistLocalNow();
    if (empty) setTimeout(offerCloudSeed, 50);
    else hideBanner('seed');
  } catch (err) {
    console.error('Cloud load failed', err);
    CLOUD.error = friendlyError(err);
    if (!navigator.onLine || /fetch|network/i.test(String(err?.message))) CLOUD.online = false;
    throw err;
  } finally {
    setSyncState();
  }
}

async function offerCloudSeed() {
  if (!CLOUD.emptyCloud) return;
  if (!CLOUD.isAdmin) { showBanner('seed', 'info', 'The cloud database is empty. An administrator needs to sign in once to upload the starting data. You are viewing this browser\'s copy.'); return; }
  if (CLOUD.seedPrompted) return;
  CLOUD.seedPrompted = true;
  const nf = Object.keys(S.formulations).length, ni = Object.keys(S.ingredients).length;
  const ok = await uiConfirm('Cloud database is empty', `Upload this browser's data to the cloud? (${nf} formulations, ${ni} materials, settings). Everyone with the link will then see it.`, 'Upload to cloud');
  if (!ok) { showBanner('seed', 'info', 'The cloud is still empty. Your first edit will upload all current data.'); return; }
  for (const id of Object.keys(S.ingredients)) outbox.set(`ingredient:${id}`, { kind: 'ingredient', id, seq: ++editSeq });
  for (const id of Object.keys(S.formulations)) outbox.set(`formulation:${id}`, { kind: 'formulation', id, seq: ++editSeq });
  outbox.set('settings:main', { kind: 'settings', id: 'main', seq: ++editSeq });
  hideBanner('seed');
  persistLocalNow();
  await flushOutbox();
  CLOUD.emptyCloud = false;
}

const scheduleFlush = debounce(() => flushOutbox(), 1200);
async function flushOutbox() {
  if (!CLOUD.client || !CLOUD.isAdmin || CLOUD.flushing) { updateStatusBadges(); return; }
  if (!navigator.onLine) { CLOUD.online = false; updateStatusBadges(); return; }
  CLOUD.flushing = true; setSyncState('syncing');
  let failed = false;
  try {
    for (const item of [...outbox.values()]) {
      const key = `${item.kind}:${item.id}`;
      if (conflicts.has(key)) continue;
      const doc = docFor(item.kind, item.id);
      if (!doc) { outbox.delete(key); continue; }
      const seqAtStart = item.seq;
      const payload = clone(doc);
      const deleted = item.kind === 'formulation' && !!doc.deletedAt;
      const table = TABLES[item.kind];
      const known = META.versions[item.kind][item.id];
      let newVersion = null;
      if (known === undefined && !item.force) {
        const { data, error } = await CLOUD.client.from(table).insert({ id: item.id, data: payload, deleted }).select('version');
        if (error && error.code !== '23505') throw error;
        if (!error) newVersion = data?.[0]?.version ?? null;
      } else {
        let q = CLOUD.client.from(table).update({ data: payload, deleted }).eq('id', item.id);
        if (!item.force) q = q.eq('version', known);
        const { data, error } = await q.select('version');
        if (error) throw error;
        if (data && data.length) newVersion = data[0].version;
        else if (item.force) {
          const ins = await CLOUD.client.from(table).insert({ id: item.id, data: payload, deleted }).select('version');
          if (ins.error) throw ins.error;
          newVersion = ins.data?.[0]?.version ?? null;
        }
      }
      if (newVersion === null) {
        // Version mismatch or duplicate id: decide between "already saved" and a real conflict.
        const { data: rows, error } = await CLOUD.client.from(table).select('id,data,deleted,version,updated_at').eq('id', item.id);
        if (error) throw error;
        const row = rows?.[0];
        if (!row) {
          const ins = await CLOUD.client.from(table).insert({ id: item.id, data: payload, deleted }).select('version');
          if (ins.error) throw ins.error;
          newVersion = ins.data?.[0]?.version ?? null;
        } else if (sameDoc(row.data, payload) && row.deleted === deleted) newVersion = row.version;
        else { conflicts.set(key, { kind: item.kind, id: item.id, cloud: row }); continue; }
      }
      META.versions[item.kind][item.id] = newVersion;
      const latest = outbox.get(key);
      if (latest && latest.seq === seqAtStart) outbox.delete(key);
      else if (latest) latest.force = false;
    }
    CLOUD.error = ''; CLOUD.online = true; CLOUD.retryMs = 4000;
    META.lastSyncAt = nowIso();
  } catch (err) {
    failed = true;
    console.error('Cloud save failed', err);
    CLOUD.error = friendlyError(err);
    if (!navigator.onLine || /fetch|network/i.test(String(err?.message))) CLOUD.online = false;
  } finally {
    CLOUD.flushing = false;
    persistLocalNow();
    setSyncState();
    if (conflicts.size) showBanner('conflict', 'error', `${conflicts.size} item(s) were changed on another device. Choose which version to keep.`, [{ label: 'Resolve', act: 'open-sync' }]);
    else hideBanner('conflict');
    if (failed && outbox.size) { clearTimeout(CLOUD.retryTimer); CLOUD.retryTimer = setTimeout(flushOutbox, CLOUD.retryMs); CLOUD.retryMs = Math.min(CLOUD.retryMs * 2, 60000); }
    else if (!failed && [...outbox.keys()].some(k => !conflicts.has(k))) scheduleFlush();
  }
}
function friendlyError(err) {
  const m = String(err?.message || err || 'Unknown error');
  if (err?.code === '42501' || /row-level security|permission denied/i.test(m)) return 'This account is not allowed to save. Ask the owner to add it to forvet_admins.';
  if (/relation .* does not exist|forvet_/i.test(m) && /exist/i.test(m)) return 'Cloud tables are missing. Run supabase/forvet_schema.sql in the Supabase SQL editor.';
  if (/fetch|network|Failed to load/i.test(m)) return 'Cannot reach the cloud (offline or blocked). Changes are kept in this browser.';
  if (/JWT|token/i.test(m)) return 'Your session expired. Sign in again.';
  return m;
}
function resolveConflict(key, choice) {
  const c = conflicts.get(key); if (!c) return;
  if (choice === 'mine') { META.versions[c.kind][c.id] = c.cloud.version; conflicts.delete(key); const it = outbox.get(key); if (it) it.force = false; else outbox.set(key, { kind: c.kind, id: c.id, seq: ++editSeq }); }
  else {
    const data = c.cloud.data || {};
    if (c.kind === 'ingredient') S.ingredients[c.id] = sanitizeIngredient({ ...data, id: c.id });
    else if (c.kind === 'formulation') S.formulations[c.id] = sanitizeFormulation({ ...data, id: c.id, deletedAt: c.cloud.deleted ? (data.deletedAt || c.cloud.updated_at) : null }, c.id, S.ingredients);
    else S.settings = sanitizeSettings(data);
    META.versions[c.kind][c.id] = c.cloud.version;
    conflicts.delete(key); outbox.delete(key);
    ensureCurrentValid();
  }
  persistLocalNow(); renderAll(); renderSyncModal(); flushOutbox();
}

window.addEventListener('online', async () => { CLOUD.online = true; if (CLOUD.client) { try { await pullAll(); renderAll(); } catch (_) { /* shown in badge */ } flushOutbox(); } updateStatusBadges(); });
window.addEventListener('offline', () => { CLOUD.online = false; updateStatusBadges(); });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !CLOUD.client || CLOUD.flushing) return;
  if (Date.now() - CLOUD.lastPull < 60000) return;
  try { await pullAll(); renderAll(); } catch (_) { /* badge shows */ }
});
window.addEventListener('pagehide', () => persistLocalNow());

let syncVisualState = '';
function setSyncState(s) { syncVisualState = s || ''; updateStatusBadges(); }
function updateStatusBadges() {
  const badge = $('cloudStatusBadge'); const save = $('saveStatusBadge');
  if (!badge || !save) return;
  const pending = outbox.size, nConf = conflicts.size;
  let text, cls;
  // cls → dot colour: ok (green), warn (amber), err (red pill), info (pulsing blue), muted (grey)
  if (!isCloudMode()) { text = 'Local only · not synced'; cls = 'warn'; }
  else if (nConf) { text = `${nConf} conflict${nConf > 1 ? 's' : ''}`; cls = 'err'; }
  else if (syncVisualState === 'loading') { text = 'Loading…'; cls = 'info'; }
  else if (syncVisualState === 'syncing') { text = 'Syncing…'; cls = 'info'; }
  else if (!CLOUD.online) { text = pending ? `Offline · ${pending} pending` : 'Offline · cached copy'; cls = 'warn'; }
  else if (CLOUD.error) { text = pending ? `Sync error · ${pending} pending` : 'Cloud error'; cls = 'err'; }
  else if (pending && CLOUD.isAdmin) { text = `${pending} pending`; cls = 'warn'; }
  else if (pending) { text = `${pending} unsent · sign in`; cls = 'warn'; }
  else if (!CLOUD.ready) { text = 'Connecting…'; cls = 'info'; }
  else if (CLOUD.isAdmin) { text = 'Synced'; cls = 'ok'; }
  else { text = 'View only'; cls = 'muted'; }
  badge.className = 'cloud-state is-' + cls;
  badge.innerHTML = `<span class="dot" aria-hidden="true"></span><span>${esc(text)}</span>`;
  const t = META.lastLocalSaveAt ? new Date(META.lastLocalSaveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  save.textContent = !canEdit() ? 'View only' : (t ? `Saved ${t}` : 'Ready');
  save.title = META.lastLocalSaveAt ? `Last saved in this browser: ${fmtDate(META.lastLocalSaveAt)}` : '';
  const ab = $('authButton');
  if (ab) {
    ab.hidden = !isCloudMode();
    if (CLOUD.user) {
      const email = CLOUD.user.email || '';
      const initials = (email.split('@')[0].split(/[._-]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('') || '?').toUpperCase();
      ab.className = 'btn btn-ghost !px-1.5 !pr-2.5';
      ab.innerHTML = `<span class="avatar">${esc(initials)}</span><span class="hidden md:inline">${CLOUD.isAdmin ? 'Admin' : 'Viewer'}</span>`;
      ab.title = `${email} · ${CLOUD.isAdmin ? 'administrator (can edit)' : 'view only'}`;
      ab.setAttribute('aria-label', `Account: ${email}`);
    } else {
      ab.className = 'btn btn-secondary';
      ab.textContent = 'Sign in'; ab.title = 'Sign in to edit'; ab.removeAttribute('aria-label');
    }
  }
  const fb = $('footerBackupInfo'); if (fb) fb.textContent = `Last backup download: ${META.lastBackupAt ? fmtDate(META.lastBackupAt) : 'never'}${isCloudMode() ? ` · Last cloud sync: ${fmtDate(META.lastSyncAt)}` : ''}`;
}
