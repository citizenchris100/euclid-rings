// js/generators.js — PURE pluggable pattern-generator registry. This is the extension seam
// that lets Euclid Rings "grow beyond euclidean": a lane's onset ring comes from a type-tagged
// generator dispatched through REGISTRY, so adding a `random`/`manual`/`markov` type later is a
// one-file change (a REGISTRY entry + a GENERATOR_TYPES string + clamp/validate branches) with
// no other module touched. Modeled on the songwriter notebook's type-tagged ruleset model.
//
// TOTAL by construction: an unknown type yields a silent (all-rests) ring rather than throwing,
// every registry fn takes only its params and returns a bounded boolean[], and clampGenerator
// guarantees valid params before dispatch. So engine.test.js can pin generator output headlessly.

import { euclidRotated } from './euclid.js';

// n bounds shared with the UI: 2..32 slots per lane; k in [0,n]; rotation in [0,n-1].
export const MIN_STEPS = 2;
export const MAX_STEPS = 32;

const clampInt = (v, lo, hi, dflt) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : dflt;
};

// The registry: type id -> pure fn(params) -> boolean[]. Euclidean is the first (and, in v1,
// only) plugin. A registry fn may assume its params are already clamped (dispatch clamps first).
export const REGISTRY = {
  euclidean: ({ k, n, rotation }) => euclidRotated(k, n, rotation),
};

// A load-time snapshot for enumeration/tests; the CLAMP/VALIDATE gates below consult the LIVE
// REGISTRY (isKnownType) instead, so a type registered at runtime through the seam is honoured
// rather than silently coerced to euclidean.
export const GENERATOR_TYPES = Object.keys(REGISTRY);
const isKnownType = (t) => Object.prototype.hasOwnProperty.call(REGISTRY, t);

// defaultGenerator() -> a musically neutral starting generator (four-on-the-floor over 8).
export function defaultGenerator() {
  return { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } };
}

// clampGenerator(gen) -> a valid generator of the same type (unknown type -> euclidean default).
// Euclidean: n in [2,32], k in [0,n], rotation in [0,n-1].
export function clampGenerator(gen) {
  const g = gen || {};
  if (g.type === 'euclidean' || !isKnownType(g.type)) {
    const p = g.params || {};
    const n = clampInt(p.n, MIN_STEPS, MAX_STEPS, 8);
    const k = clampInt(p.k, 0, n, Math.min(4, n));
    const rotation = clampInt(p.rotation, 0, n - 1, 0);
    return { type: 'euclidean', params: { k, n, rotation } };
  }
  // (future non-euclidean types clamp their own params here)
  return { type: g.type, params: { ...(g.params || {}) } };
}

// validateGenerator(gen) -> { ok, errors }. Strict shape check (used by preset validation + test).
export function validateGenerator(gen) {
  const errors = [];
  const g = gen || {};
  if (!isKnownType(g.type)) errors.push(`unknown generator type: ${g.type}`);
  else if (g.type === 'euclidean') {
    const p = g.params || {};
    if (!Number.isInteger(p.n) || p.n < MIN_STEPS || p.n > MAX_STEPS) errors.push('n must be an integer in [2,32]');
    if (!Number.isInteger(p.k) || p.k < 0 || (Number.isInteger(p.n) && p.k > p.n)) errors.push('k must be an integer in [0,n]');
    if (!Number.isInteger(p.rotation) || p.rotation < 0 || (Number.isInteger(p.n) && p.rotation > p.n - 1)) errors.push('rotation must be an integer in [0,n-1]');
  }
  return { ok: errors.length === 0, errors };
}

// normalizeGenerator(gen) -> canonical clamped generator (alias for clampGenerator; kept for the
// default/clamp/validate/normalize quartet symmetry the other pure models follow).
export function normalizeGenerator(gen) {
  return clampGenerator(gen);
}

// generatorRing(gen) -> boolean[]. Dispatch through the registry after clamping. Unknown type
// (defensively, though clamp coerces it) -> a silent ring so the caller never crashes.
export function generatorRing(gen) {
  const g = clampGenerator(gen);
  const fn = REGISTRY[g.type];
  if (!fn) {
    const n = (g.params && g.params.n) || 0;
    return new Array(n).fill(false);
  }
  return fn(g.params);
}
