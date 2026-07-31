// js/laneModel.js — PURE per-lane model. A lane = one Kit-4 voice playing the onset ring of a
// pluggable generator, with an optional accent subset and solo/mute/gain. No audio/DOM/Date, so
// engine.test.js pins it. Lane shape:
//   { voice, gain, mute, solo, generator:{type,params}, accent:{enabled,hits,rotation}, accentDepth }
// accentDepth in [0,1] = how much quieter the NON-accented onsets are when accents are on
// (non-accented velocity = gain * (1 - accentDepth); accented = gain).

import { VOICE_IDS } from './engine/drumModel.js';
import { defaultGenerator, clampGenerator, validateGenerator, generatorRing } from './generators.js';
import { defaultAccent, clampAccent, validateAccent } from './accentModel.js';
import { onsetIndices } from './euclid.js';

const clampNum = (v, lo, hi, dflt) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : dflt;
};

export const MAX_GAIN = 1.5;

// defaultLane() -> a musical starting lane (kick, four-on-the-floor over 8).
export function defaultLane() {
  return { voice: 'kick', gain: 1.0, mute: false, solo: false, generator: defaultGenerator(), accent: defaultAccent(), accentDepth: 0.45 };
}

// clampLane(l) -> a valid lane. Bad voice -> 'kick'; gain clamped; generator/accent clamped.
export function clampLane(l) {
  const src = l || {};
  return {
    voice: VOICE_IDS.includes(src.voice) ? src.voice : 'kick',
    gain: clampNum(src.gain, 0, MAX_GAIN, 1.0),
    mute: !!src.mute,
    solo: !!src.solo,
    generator: clampGenerator(src.generator),
    accent: clampAccent(src.accent),
    accentDepth: clampNum(src.accentDepth, 0, 1, 0.45),
  };
}

// validateLane(l) -> { ok, errors }.
export function validateLane(l) {
  const errors = [];
  const src = l || {};
  if (!VOICE_IDS.includes(src.voice)) errors.push(`unknown voice: ${src.voice}`);
  if (!(Number.isFinite(src.gain) && src.gain >= 0 && src.gain <= MAX_GAIN)) errors.push('gain must be in [0,1.5]');
  if (typeof src.mute !== 'boolean') errors.push('mute must be boolean');
  if (typeof src.solo !== 'boolean') errors.push('solo must be boolean');
  const g = validateGenerator(src.generator); if (!g.ok) errors.push(...g.errors);
  const a = validateAccent(src.accent); if (!a.ok) errors.push(...a.errors);
  if (!(Number.isFinite(src.accentDepth) && src.accentDepth >= 0 && src.accentDepth <= 1)) errors.push('accentDepth must be in [0,1]');
  return { ok: errors.length === 0, errors };
}

// normalizeLane(l) -> canonical clamped lane (additive-defaulted on read).
export function normalizeLane(l) {
  return clampLane(l);
}

// laneOnsets(lane) -> number[] of ring indices where the lane fires (from its generator).
export function laneOnsets(lane) {
  return onsetIndices(generatorRing((lane || {}).generator));
}

// soloActive(lanes) -> boolean[] : which lanes are NOT solo-muted. If any lane solos, only soloed
// lanes are active; otherwise all are. (mute is applied separately at velocity time.)
export function soloActive(lanes) {
  const arr = lanes || [];
  const anySolo = arr.some((l) => l && l.solo);
  return arr.map((l) => (anySolo ? !!(l && l.solo) : true));
}
