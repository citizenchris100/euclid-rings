// js/accentModel.js — PURE accent model. An accent is a euclidean SUBSET of a lane's own onsets:
// given a lane with `k` onsets, accentMask picks `hits` of them (spaced as evenly as possible, in
// ring order from the lane's first onset) to play LOUD. This reuses the euclid primitive, is
// always well-defined (hits clamps to [0,k] live), and renders as bigger/brighter dots on the ring.
//
// accent.hits is stored independent of the live onset count k, so editing the lane's k never
// corrupts the stored accent; the clamp against k happens at mask time. Total, node-testable.

import { euclidRotated } from './euclid.js';
import { MAX_STEPS } from './generators.js';

const clampInt = (v, lo, hi, dflt) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : dflt;
};

// defaultAccent() -> accents off.
export function defaultAccent() {
  return { enabled: false, hits: 0, rotation: 0 };
}

// clampAccent(a) -> valid accent. hits/rotation kept as non-negative ints in a generous range
// ([0,MAX_STEPS]); the tight clamp to the lane's live onset count happens in accentMask.
export function clampAccent(a) {
  const src = a || {};
  return {
    enabled: !!src.enabled,
    hits: clampInt(src.hits, 0, MAX_STEPS, 0),
    rotation: clampInt(src.rotation, 0, MAX_STEPS - 1, 0),
  };
}

// validateAccent(a) -> { ok, errors }.
export function validateAccent(a) {
  const errors = [];
  const src = a || {};
  if (typeof src.enabled !== 'boolean') errors.push('accent.enabled must be boolean');
  if (!Number.isInteger(src.hits) || src.hits < 0) errors.push('accent.hits must be a non-negative integer');
  if (!Number.isInteger(src.rotation) || src.rotation < 0) errors.push('accent.rotation must be a non-negative integer');
  return { ok: errors.length === 0, errors };
}

// accentMask(onsetCount, accent) -> boolean[] of length onsetCount, true where that onset (by
// ring ordinal) is accented. Off/empty when disabled or hits<=0; hits>=onsetCount accents all.
export function accentMask(onsetCount, accent) {
  const m = Math.max(0, Math.floor(Number(onsetCount) || 0));
  if (m === 0) return [];
  const a = clampAccent(accent);
  if (!a.enabled || a.hits <= 0) return new Array(m).fill(false);
  const hits = Math.min(a.hits, m);
  const rotation = ((a.rotation % m) + m) % m;
  return euclidRotated(hits, m, rotation);
}
