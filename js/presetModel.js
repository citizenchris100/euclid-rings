// js/presetModel.js — PURE preset validation + conversion. A preset is an authored starting point
// (rock / pop / jazzy / ballad / latin / world), stored as presets/<id>.json with author-friendly
// FLAT lanes ({voice,k,n,rotation}) that normalizePreset lifts into euclidean generators and
// presetToPattern turns into a full pattern. Mirrors the songwriter notebook's feel model: one
// validate() shared by the loader, the test suite, and the sync tool.

import { VOICE_IDS } from './engine/drumModel.js';
import { MIN_STEPS, MAX_STEPS } from './generators.js';
import { MIN_BPM, MAX_BPM, TIME_SIGS } from './engine/clickModel.js';
import { clampLane } from './laneModel.js';
import { defaultAccent } from './accentModel.js';
import { normalizePattern, MAX_LANES } from './patternModel.js';
import { SWING_MAX } from './grooveModel.js';

export const GENRES = ['rock', 'pop', 'jazzy', 'ballad', 'latin', 'world'];

const isSlug = (s) => typeof s === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
const isInt = (v) => Number.isInteger(v);

// validatePreset(p) -> { ok, errors }. Validates the authored (flat-lane) form.
export function validatePreset(p) {
  const errors = [];
  const src = p || {};
  if (!isSlug(src.id)) errors.push('id must be a kebab-case slug');
  if (typeof src.name !== 'string' || !src.name.trim()) errors.push('name is required');
  if (!GENRES.includes(src.genre)) errors.push(`genre must be one of ${GENRES.join('/')}`);
  if (!isInt(src.bpm) || src.bpm < MIN_BPM || src.bpm > MAX_BPM) errors.push('bpm out of range');
  if (!isInt(src.timeSigIndex) || src.timeSigIndex < 0 || src.timeSigIndex >= TIME_SIGS.length) errors.push('timeSigIndex out of range');
  if (src.swing != null && !(typeof src.swing === 'number' && src.swing >= 0 && src.swing <= SWING_MAX)) errors.push('swing out of range');
  if (!Array.isArray(src.lanes) || src.lanes.length < 1 || src.lanes.length > MAX_LANES) {
    errors.push('lanes must be an array of 1..5');
  } else {
    src.lanes.forEach((l, i) => {
      const where = `lane ${i}`;
      if (!VOICE_IDS.includes(l && l.voice)) errors.push(`${where}: unknown voice ${l && l.voice}`);
      if (!isInt(l && l.n) || l.n < MIN_STEPS || l.n > MAX_STEPS) errors.push(`${where}: n must be an integer in [2,32]`);
      if (!isInt(l && l.k) || l.k < 0 || (isInt(l && l.n) && l.k > l.n)) errors.push(`${where}: k must be an integer in [0,n]`);
      if (l && l.rotation != null && (!isInt(l.rotation) || l.rotation < 0 || (isInt(l.n) && l.rotation > l.n - 1))) errors.push(`${where}: rotation must be an integer in [0,n-1]`);
      if (l && l.accent != null) {
        if (!isInt(l.accent.hits) || l.accent.hits < 0) errors.push(`${where}: accent.hits must be a non-negative integer`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

// Lift one authored flat lane into the lane-model shape (euclidean generator + accent object).
function presetLaneToLane(pl) {
  const l = pl || {};
  return clampLane({
    voice: l.voice,
    gain: l.gain != null ? l.gain : 1.0,
    mute: false,
    solo: false,
    generator: { type: 'euclidean', params: { k: l.k, n: l.n, rotation: l.rotation || 0 } },
    accent: l.accent ? { enabled: true, hits: l.accent.hits, rotation: l.accent.rotation || 0 } : defaultAccent(),
    accentDepth: l.accentDepth != null ? l.accentDepth : 0.45,
  });
}

// normalizePreset(p) -> preset with lanes lifted to the lane-model shape (generators expanded).
export function normalizePreset(p) {
  const src = p || {};
  return {
    id: src.id, name: src.name, genre: src.genre,
    bpm: src.bpm, timeSigIndex: src.timeSigIndex, swing: src.swing || 0,
    lanes: (src.lanes || []).map(presetLaneToLane),
  };
}

// presetToPattern(p) -> a full normalized pattern ready to play/edit/export.
export function presetToPattern(p) {
  const src = p || {};
  return normalizePattern({
    bpm: src.bpm,
    timeSigIndex: src.timeSigIndex,
    swing: src.swing || 0,
    lanes: (src.lanes || []).map(presetLaneToLane),
  });
}
