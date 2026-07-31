// js/patternModel.js — PURE whole-loop model + onset time/tick math. A pattern is the app's
// single source of truth: global tempo/meter/swing plus up to 5 lanes. Phase-locked, one bar:
// one revolution of the circle = one bar, and every lane's n subdivides that same bar.
//
//   { schemaVersion:1, bpm, timeSigIndex, swing, lanes:[lane, ... 0..5] }
//
// patternSchedule() merges all lanes into one list of onsets for a single revolution, with swing
// folded into each onset's `frac` and the accent flag resolved. Mute/solo are NOT baked here (the
// player folds them live on per-lane gain nodes; export folds them at emit) so a mute/solo toggle
// needs no reschedule. Node-testable; timing carries no rounding (playback uses exact seconds).

import { barSeconds, barTicks as barTicksTsi, TIME_SIGS, MIN_BPM, MAX_BPM } from './engine/clickModel.js';
import { SESSION_PPQ } from './smf.js';
import { clampLane, laneOnsets, defaultLane } from './laneModel.js';
import { accentMask } from './accentModel.js';
import { warpFraction, SWING_MAX } from './grooveModel.js';

export const MAX_LANES = 5;
export const SCHEMA_VERSION = 1;

const clampInt = (v, lo, hi, dflt) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : dflt;
};
const clampNum = (v, lo, hi, dflt) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : dflt;
};

// Re-export for the shell so it imports the lane factory from one place.
export { defaultLane };

// defaultPattern() -> 120 BPM 4/4, no swing, one default lane (something to hear immediately).
export function defaultPattern() {
  return { schemaVersion: SCHEMA_VERSION, bpm: 120, timeSigIndex: 2, swing: 0, lanes: [defaultLane()] };
}

// clampPattern(p) -> valid pattern. Lanes capped at MAX_LANES, each clamped. 0 lanes allowed
// (the empty state). Always stamps schemaVersion, so it doubles as the read-normalizer.
export function clampPattern(p) {
  const src = p || {};
  const lanes = Array.isArray(src.lanes) ? src.lanes.slice(0, MAX_LANES).map(clampLane) : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    bpm: clampInt(src.bpm, MIN_BPM, MAX_BPM, 120),
    timeSigIndex: clampInt(src.timeSigIndex, 0, TIME_SIGS.length - 1, 2),
    swing: clampNum(src.swing, 0, SWING_MAX, 0),
    lanes,
  };
}

// validatePattern(p) -> { ok, errors }. Strict shape check for saved/preset-derived patterns.
export function validatePattern(p) {
  const errors = [];
  const src = p || {};
  if (src.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Number.isInteger(src.bpm) || src.bpm < MIN_BPM || src.bpm > MAX_BPM) errors.push('bpm out of range');
  if (!Number.isInteger(src.timeSigIndex) || src.timeSigIndex < 0 || src.timeSigIndex >= TIME_SIGS.length) errors.push('timeSigIndex out of range');
  if (!(Number.isFinite(src.swing) && src.swing >= 0 && src.swing <= SWING_MAX)) errors.push('swing out of range');
  if (!Array.isArray(src.lanes) || src.lanes.length > MAX_LANES) errors.push('lanes must be an array of 0..5');
  return { ok: errors.length === 0, errors };
}

// normalizePattern(p) -> canonical pattern (additive-defaulted on read, unknown fields dropped,
// schemaVersion stamped). The read gate for localStorage + preset-derived patterns.
export function normalizePattern(p) {
  return clampPattern(p);
}

// ---- timing math (phase-locked, one bar per revolution) ----

// cycleSeconds(p) -> real seconds for one revolution (= one bar at the pattern's tempo/meter).
export function cycleSeconds(p) {
  return barSeconds(p.bpm, p.timeSigIndex);
}
// cycleTicks(p) -> ticks for one revolution at SESSION_PPQ (export resolution).
export function cycleTicks(p) {
  return barTicksTsi(p.timeSigIndex, SESSION_PPQ);
}
// beatsOf(p) -> beats per bar (meter numerator), the swing warp unit.
export function beatsOf(p) {
  return (TIME_SIGS[p.timeSigIndex] || TIME_SIGS[0]).beats;
}
// onsetFraction(i, n) -> raw (unswung) bar-fraction of ring slot i of n.
export function onsetFraction(i, n) {
  return n > 0 ? i / n : 0;
}

// patternSchedule(p) -> [{ laneIndex, voice, onsetOrdinal, ringIndex, n, frac, fracRaw, accented }]
// for ONE revolution, all lanes merged and sorted by swung `frac`. `frac` is swing-warped (timing);
// `fracRaw` is the geometric slot position (ring drawing / playhead-to-slot mapping).
export function patternSchedule(p) {
  const beats = beatsOf(p);
  const swing = p.swing || 0;
  const out = [];
  const lanes = p.lanes || [];
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li];
    const onsets = laneOnsets(lane);
    const n = (lane.generator && lane.generator.params && lane.generator.params.n) || onsets.length;
    const mask = accentMask(onsets.length, lane.accent);
    for (let j = 0; j < onsets.length; j++) {
      const fracRaw = onsetFraction(onsets[j], n);
      out.push({
        laneIndex: li,
        voice: lane.voice,
        onsetOrdinal: j,
        ringIndex: onsets[j],
        n,
        frac: warpFraction(fracRaw, beats, swing),
        fracRaw,
        accented: !!mask[j],
      });
    }
  }
  out.sort((a, b) => a.frac - b.frac);
  return out;
}
