// js/exportModel.js — PURE pattern -> Standard MIDI File spec. Turns the current pattern into one
// merged Format-0 GM drum loop (channel 10, forced by writeSMF) at SESSION_PPQ, one bar long.
// Onset positions carry swing exactly as playback does (both read patternSchedule().frac), so the
// exported .mid matches what you hear. Node-testable via the smf writer/reader round-trip.
//
// EXPORT_NOTE picks the CONVENTIONAL GM note for each Kit-4 voice; every choice round-trips through
// voiceForNote back to its voice (asserted in engine.test.js), so a re-imported loop lands on the
// same kit voice in the sibling auditioner / a DAW.

import { SESSION_PPQ, writeSMF } from './smf.js';
import { TIME_SIGS } from './engine/clickModel.js';
import { patternSchedule, cycleTicks, cycleSeconds } from './patternModel.js';
import { soloActive } from './laneModel.js';

export const EXPORT_NOTE = {
  kick: 36, snare: 38, closedHat: 42, openHat: 46, lowTom: 45, midTom: 47,
  highTom: 50, crash: 49, ride: 51, clap: 39, hiConga: 63, loConga: 64,
};

// A short fixed gate; drum machines ignore note length, but a valid file needs a note-off.
const GATE_TICKS = Math.round(SESSION_PPQ / 8);   // 32nd note at 960 PPQ = 120 ticks

// velocityFor(lane, accented) -> MIDI velocity 1..127. gain 1.0 -> 100. When accents are enabled,
// non-accented onsets drop by accentDepth; accented onsets keep full gain.
export function velocityFor(lane, accented) {
  const gain = lane && lane.gain != null ? lane.gain : 1;
  const acc = !!(lane && lane.accent && lane.accent.enabled);
  const depth = lane && lane.accentDepth != null ? lane.accentDepth : 0.45;
  const g = (acc && !accented) ? gain * (1 - depth) : gain;
  return Math.max(1, Math.min(127, Math.round(g * 100)));
}

// patternToEvents(p) -> [{tick,type,note,velocity}] for one revolution. Mute/solo folded here.
// Ticks are round(frac * cycleTicks); onsets clamp inside the bar and each gets a short gated off.
export function patternToEvents(p) {
  const ticks = cycleTicks(p);
  const lanes = p.lanes || [];
  const active = soloActive(lanes);
  const events = [];
  for (const e of patternSchedule(p)) {
    const lane = lanes[e.laneIndex];
    if (!lane || lane.mute || !active[e.laneIndex]) continue;
    const note = EXPORT_NOTE[lane.voice];
    if (note == null) continue;
    const velocity = velocityFor(lane, e.accented);
    let onTick = Math.round(e.frac * ticks);
    if (onTick < 0) onTick = 0;
    if (onTick > ticks - 1) onTick = ticks - 1;
    let offTick = Math.min(ticks, onTick + GATE_TICKS);
    if (offTick <= onTick) offTick = Math.min(ticks, onTick + 1);
    events.push({ tick: onTick, type: 'noteOn', note, velocity });
    events.push({ tick: offTick, type: 'noteOff', note, velocity: 0 });
  }
  return events;
}

// exportSpec(p) -> the writeSMF spec (tempo + meter meta, one-bar endTick).
// The MIDI tempo is DERIVED from the actual played bar length so the exported .mid plays back at
// exactly the app's tempo for EVERY meter. barSeconds treats bpm as the per-beat pulse (a 6/8 bar =
// 6 eighths) while the bar spans (beats*4/den) quarters of ticks; a fixed 60e6/bpm would make every
// /8 meter export at half its played length. secondsPerQuarter = playedBarSeconds / (ticks/ppq).
export function exportSpec(p) {
  const m = TIME_SIGS[p.timeSigIndex] || TIME_SIGS[0];
  const ticks = cycleTicks(p);
  const tempoUsPerQuarter = Math.round((1e6 * cycleSeconds(p) * SESSION_PPQ) / ticks);
  return {
    ppq: SESSION_PPQ,
    tempoUsPerQuarter,
    timeSig: { numerator: m.beats, denominator: m.den || 4 },
    events: patternToEvents(p),
    endTick: ticks,
  };
}

// exportBytes(p) -> Uint8Array (a complete .mid file).
export function exportBytes(p) {
  return writeSMF(exportSpec(p));
}

// exportFileName(p, label) -> a safe suggested filename, e.g. "euclid_latin-bossa_128bpm.mid".
export function exportFileName(p, label) {
  const base = String(label || 'pattern').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pattern';
  return `euclid_${base}_${p.bpm}bpm.mid`;
}
