// js/patternStore.js — IMPURE. Persist the current pattern to localStorage so a reload restores
// your work. Metadata only (a small JSON object); the durable outputs are presets + exported .mid.
// normalizePattern is the read gate (additive-defaulted, schema-stamped), so an old/garbage save
// upgrades cleanly instead of crashing.

import { normalizePattern } from './patternModel.js';

const KEY = 'euc:pattern';

export function savePattern(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* quota / private mode: ignore */ }
}

export function loadPattern() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizePattern(JSON.parse(raw));
  } catch { return null; }
}

export function clearPattern() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
