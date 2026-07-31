// js/presetStore.js — IMPURE loader for the bundled preset catalog. Fetches presets/index.json
// then each presets/<id>.json (served from the SW cache offline), validates, and groups by genre.
// Mirrors the songwriter notebook's feelStore: one validate() shared with the test + sync tool.

import { validatePreset, GENRES } from './presetModel.js';

// loadPresets() -> Promise<preset[]> (only the ones that validate; a bad file is skipped, logged).
export async function loadPresets() {
  let ids = [];
  try { ids = await (await fetch('./presets/index.json')).json(); }
  catch (e) { console.warn('[euclid] could not load preset index', e); return []; }
  const out = [];
  for (const id of ids) {
    try {
      const p = await (await fetch(`./presets/${id}.json`)).json();
      const v = validatePreset(p);
      if (v.ok) out.push(p);
      else console.warn(`[euclid] preset ${id} invalid`, v.errors);
    } catch (e) { console.warn(`[euclid] preset ${id} failed to load`, e); }
  }
  return out;
}

// groupByGenre(presets) -> { genre: preset[] } in GENRES order.
export function groupByGenre(presets) {
  const groups = {};
  for (const g of GENRES) groups[g] = [];
  for (const p of presets) if (groups[p.genre]) groups[p.genre].push(p);
  return groups;
}
