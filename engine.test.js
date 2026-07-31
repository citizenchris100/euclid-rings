// engine.test.js — zero-dependency node test harness for Euclid Rings.
// Run: `node engine.test.js` (or `npm test`). Green is the hard gate before every deploy.
// Same discipline as the sibling MIDI Drum Auditioner: every PURE model is imported and
// exercised directly here; impure browser code (player/view/stores) is verified behaviorally
// in Chrome, not covered by node vectors. Add a vector whenever a model changes.
//
// Sections:
//   0. engine smoke (copied engine files load + core maps)
//   1. euclid.js
//   2. generators.js
//   3. accentModel.js + laneModel.js
//   4. grooveModel.js + patternModel.js
//   5. exportModel.js (SMF byte round-trips)
//   6. presetModel.js + preset catalog

let pass = 0, fail = 0;
const fails = [];
function ok(label, cond) { if (cond) pass++; else { fail++; fails.push(label); } }
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; fails.push(`${label}\n     got:  ${g}\n     want: ${w}`); }
}
function approx(label, got, want, eps = 1e-9) {
  if (Number.isFinite(got) && Math.abs(got - want) <= eps) pass++;
  else { fail++; fails.push(`${label}\n     got:  ${got}\n     want: ~${want}`); }
}
function throws(label, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(label, threw);
}
function noThrow(label, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(label, !threw);
}

// ============================================================================
// 0. Engine smoke — the copied-verbatim engine files load under node and the
//    core maps we depend on are intact.
// ============================================================================
import { VOICES, VOICE_IDS, GM_NOTE_TO_VOICE, voiceForNote, KITS } from './js/engine/drumModel.js';
import { TIME_SIGS, barSeconds, barTicks as barTicksTsi, MIN_BPM, MAX_BPM } from './js/engine/clickModel.js';
import { writeVarLen, SESSION_PPQ, barTicks as barTicksSmf, writeSMF, readSMF } from './js/smf.js';
import { readVarLen, parseSMF } from './js/engine/midiParse.js';

eq('0.1 VOICE_IDS length is 12', VOICE_IDS.length, 12);
eq('0.2 kit4 is the first/only kit we ship', KITS[0].id, 'kit4');
eq('0.3 voiceForNote(36) is kick', voiceForNote(36), 'kick');
eq('0.4 voiceForNote(38) is snare', voiceForNote(38), 'snare');
eq('0.5 voiceForNote(42) is closedHat', voiceForNote(42), 'closedHat');
ok('0.6 voiceForNote(200) is null (unmapped)', voiceForNote(200) === null);
eq('0.7 barSeconds(120, 4/4[idx2]) is 2.0', barSeconds(120, 2), 2);
eq('0.8 clickModel barTicks 4/4 @480 is 1920', barTicksTsi(2, 480), 1920);
eq('0.9 smf barTicks 4/4 @960 is 3840', barTicksSmf(960, 4, 4), 3840);
eq('0.10 SESSION_PPQ is 960', SESSION_PPQ, 960);
eq('0.11 BPM range 20..300', [MIN_BPM, MAX_BPM], [20, 300]);
// writeVarLen (smf) <-> readVarLen (midiParse) round-trip on a spread of values.
for (const v of [0, 1, 127, 128, 255, 8192, 0x0FFFFFFF]) {
  const bytes = writeVarLen(v);
  const parsed = readVarLen(Uint8Array.from(bytes), 0);
  eq(`0.12 varlen round-trip ${v}`, parsed.value, v);
}
// A tiny SMF written then read back, proving the writer half we reuse works end-to-end.
{
  const bytes = writeSMF({
    ppq: SESSION_PPQ, tempoUsPerQuarter: 500000, timeSig: { numerator: 4, denominator: 4 },
    events: [
      { tick: 0, type: 'noteOn', note: 36, velocity: 100 },
      { tick: 30, type: 'noteOff', note: 36, velocity: 0 },
    ], endTick: 3840,
  });
  const back = readSMF(bytes);
  eq('0.13 written SMF is format 0', back.format, 0);
  eq('0.14 tempo round-trips', back.tempoUsPerQuarter, 500000);
  eq('0.15 timeSig round-trips', back.timeSig, { numerator: 4, denominator: 4 });
  eq('0.16 two note events round-trip', back.events.length, 2);
}

// ============================================================================
// 1. euclid.js — Bjorklund + rotation. Catalog box-forms pinned as onset-index
//    regressions (values verified against the vendored euclidean-rhythms lib),
//    plus rotation direction/wrap and totality.
// ============================================================================
import { euclid, rotate, euclidRotated, onsetIndices, intervalVector } from './js/euclid.js';
const on = (k, n, r = 0) => onsetIndices(euclidRotated(k, n, r));

eq('1.1 tresillo E(3,8) onsets', on(3, 8), [0, 3, 6]);
eq('1.2 tresillo E(3,8) interval vector', intervalVector(euclid(3, 8)), [3, 3, 2]);
eq('1.3 E(2,5) onsets', on(2, 5), [0, 2]);
eq('1.4 cinquillo E(5,8) onsets', on(5, 8), [0, 2, 3, 5, 6]);
eq('1.5 cinquillo E(5,8) interval vector', intervalVector(euclid(5, 8)), [2, 1, 2, 1, 2]);
eq('1.6 bossa E(5,16) onsets', on(5, 16), [0, 3, 6, 9, 12]);
eq('1.7 samba E(7,16) onsets', on(7, 16), [0, 3, 5, 7, 10, 12, 14]);
eq('1.8 Bembe E(7,12) onsets', on(7, 12), [0, 2, 3, 5, 7, 8, 10]);
eq('1.9 E(9,16) onsets', on(9, 16), [0, 2, 3, 5, 7, 9, 10, 12, 14]);
eq('1.10 E(4,8) four-on-floor onsets', on(4, 8), [0, 2, 4, 6]);
eq('1.11 cumbia E(3,4) onsets', on(3, 4), [0, 2, 3]);

// Every non-trivial E(k,n) has exactly k onsets and length n.
for (const [k, n] of [[3, 8], [5, 8], [5, 16], [7, 12], [7, 16], [2, 5], [4, 9], [11, 24]]) {
  const ring = euclid(k, n);
  eq(`1.12 E(${k},${n}) length`, ring.length, n);
  eq(`1.12 E(${k},${n}) onset count`, onsetIndices(ring).length, k);
  eq(`1.12 E(${k},${n}) interval vector sums to n`, intervalVector(ring).reduce((a, b) => a + b, 0), n);
}

// Rotation: clockwise, mod-normalized, wraps for negative and >= n.
eq('1.13 rotate tresillo by 3', on(3, 8, 3), [1, 3, 6]);
eq('1.14 rotate tresillo by -1', on(3, 8, -1), [2, 5, 7]);
eq('1.15 rotate wraps (r=11 == r=3)', on(3, 8, 11), on(3, 8, 3));
eq('1.16 rotate by 0 is identity', on(3, 8, 0), [0, 3, 6]);
eq('1.17 rotate by n is identity', on(3, 8, 8), [0, 3, 6]);

// Totality: trivial cases + out-of-range never throw.
eq('1.18 E(0,8) is all rests', onsetIndices(euclid(0, 8)), []);
eq('1.19 E(8,8) is all onsets', onsetIndices(euclid(8, 8)).length, 8);
eq('1.20 E(k>n) clamps to all onsets', onsetIndices(euclid(12, 8)).length, 8);
eq('1.21 E(3,0) is empty', euclid(3, 0), []);
noThrow('1.22 euclid(12,8) does not throw', () => euclid(12, 8));
noThrow('1.23 euclid(-1,8) does not throw', () => euclid(-1, 8));
noThrow('1.24 euclid(NaN,NaN) does not throw', () => euclid(NaN, NaN));
eq('1.25 intervalVector single onset is [n]', intervalVector(euclid(1, 5)), [5]);
eq('1.26 intervalVector no onsets is []', intervalVector(euclid(0, 5)), []);
// n bounds we support in the UI (2..32) all produce valid rings.
for (let n = 2; n <= 32; n++) noThrow(`1.27 euclid(2,${n}) ok`, () => euclid(2, n));

// ============================================================================
// 2. generators.js — the pluggable registry. euclidean dispatch matches euclid.js,
//    clamp/validate/normalize, totality on unknown type, and pluggability.
// ============================================================================
import {
  REGISTRY, GENERATOR_TYPES, defaultGenerator, clampGenerator,
  validateGenerator, normalizeGenerator, generatorRing, MIN_STEPS, MAX_STEPS,
} from './js/generators.js';

ok('2.1 euclidean is a registered type', GENERATOR_TYPES.includes('euclidean'));
eq('2.2 default generator is valid', validateGenerator(defaultGenerator()).ok, true);
eq('2.3 euclidean dispatch matches euclid.js (tresillo)',
  onsetIndices(generatorRing({ type: 'euclidean', params: { k: 3, n: 8, rotation: 0 } })), [0, 3, 6]);
eq('2.4 dispatch honors rotation',
  onsetIndices(generatorRing({ type: 'euclidean', params: { k: 3, n: 8, rotation: 3 } })), [1, 3, 6]);

// Totality: unknown type -> a silent (all-rests) ring, no throw.
noThrow('2.5 unknown type does not throw', () => generatorRing({ type: 'nope', params: { n: 8 } }));
eq('2.6 unknown type coerces to euclidean default length',
  generatorRing({ type: 'nope', params: {} }).length, 8);

// Clamp fixes out-of-range euclidean params.
eq('2.7 clamp n over max', clampGenerator({ type: 'euclidean', params: { k: 3, n: 99, rotation: 0 } }).params.n, MAX_STEPS);
eq('2.8 clamp n under min', clampGenerator({ type: 'euclidean', params: { k: 1, n: 1, rotation: 0 } }).params.n, MIN_STEPS);
eq('2.9 clamp k to [0,n]', clampGenerator({ type: 'euclidean', params: { k: 20, n: 8, rotation: 0 } }).params.k, 8);
eq('2.10 clamp rotation to [0,n-1]', clampGenerator({ type: 'euclidean', params: { k: 3, n: 8, rotation: 99 } }).params.rotation, 7);
eq('2.11 clamp NaN params to sane defaults', clampGenerator({ type: 'euclidean', params: { k: NaN, n: NaN, rotation: NaN } }), { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } });
eq('2.12 clamp missing/garbage generator', clampGenerator(null).type, 'euclidean');

// Validate rejects bad shapes.
eq('2.13 validate rejects unknown type', validateGenerator({ type: 'zzz', params: {} }).ok, false);
eq('2.14 validate rejects k>n', validateGenerator({ type: 'euclidean', params: { k: 9, n: 8, rotation: 0 } }).ok, false);
eq('2.15 validate rejects non-integer n', validateGenerator({ type: 'euclidean', params: { k: 3, n: 8.5, rotation: 0 } }).ok, false);
eq('2.16 normalize == clamp', normalizeGenerator({ type: 'euclidean', params: { k: 3, n: 8, rotation: 0 } }), clampGenerator({ type: 'euclidean', params: { k: 3, n: 8, rotation: 0 } }));

// Pluggability: a type registered at runtime must be honoured by clamp/validate/dispatch — the seam
// consults the LIVE registry, not a load-time snapshot. Use a DISCRIMINATING generator (onset only
// at 0) so a regression that coerced it to euclidean (which would fire [0,1,2,3] for n=4) is caught.
{
  const savedTypes = GENERATOR_TYPES.slice();
  REGISTRY.pulseFirst = ({ n }) => { const a = new Array(n > 0 ? n : 0).fill(false); if (n > 0) a[0] = true; return a; };
  ok('2.17 a new type can be registered at runtime', Object.keys(REGISTRY).includes('pulseFirst'));
  eq('2.18 dispatch honours the runtime type (not coerced to euclidean)',
    onsetIndices(generatorRing({ type: 'pulseFirst', params: { n: 4 } })), [0]);
  eq('2.18b validate accepts the runtime type', validateGenerator({ type: 'pulseFirst', params: {} }).ok, true);
  eq('2.18c clamp preserves the runtime type', clampGenerator({ type: 'pulseFirst', params: { n: 4 } }).type, 'pulseFirst');
  delete REGISTRY.pulseFirst;   // leave the registry as the module shipped it
  eq('2.19 removed type is rejected + coerced again', [validateGenerator({ type: 'pulseFirst', params: {} }).ok, clampGenerator({ type: 'pulseFirst' }).type], [false, 'euclidean']);
  eq('2.19b euclidean remained the shipped default type', savedTypes, ['euclidean']);
}

// ============================================================================
// 3. accentModel.js + laneModel.js
// ============================================================================
import { defaultAccent, clampAccent, validateAccent, accentMask } from './js/accentModel.js';
import { defaultLane, clampLane, validateLane, normalizeLane, laneOnsets, soloActive, MAX_GAIN } from './js/laneModel.js';

// accentMask: euclidean subset of the k onsets.
eq('3.1 accents off -> no mask', accentMask(5, defaultAccent()), [false, false, false, false, false]);
eq('3.2 accent E(2,5) over 5 onsets',
  onsetIndices(accentMask(5, { enabled: true, hits: 2, rotation: 0 })), [0, 2]);
eq('3.3 accent hits clamped to onset count',
  onsetIndices(accentMask(3, { enabled: true, hits: 9, rotation: 0 })), [0, 1, 2]);
eq('3.4 accent rotation wraps against onset count',
  onsetIndices(accentMask(4, { enabled: true, hits: 2, rotation: 5 })), onsetIndices(accentMask(4, { enabled: true, hits: 2, rotation: 1 })));
eq('3.5 accentMask over 0 onsets is []', accentMask(0, { enabled: true, hits: 2, rotation: 0 }), []);
eq('3.6 clampAccent coerces garbage', clampAccent({ enabled: 'yes', hits: -3, rotation: 2.7 }), { enabled: true, hits: 0, rotation: 3 });
eq('3.7 validateAccent rejects non-int hits', validateAccent({ enabled: true, hits: 1.5, rotation: 0 }).ok, false);
eq('3.8 default accent is valid', validateAccent(defaultAccent()).ok, true);

// laneModel.
eq('3.9 default lane is valid', validateLane(defaultLane()).ok, true);
eq('3.10 default lane is kick four-on-floor', laneOnsets(defaultLane()), [0, 2, 4, 6]);
eq('3.11 clampLane bad voice -> kick', clampLane({ voice: 'kazoo' }).voice, 'kick');
eq('3.12 clampLane gain over max -> clamped', clampLane({ voice: 'snare', gain: 9 }).gain, MAX_GAIN);
eq('3.13 clampLane keeps valid voice', clampLane({ voice: 'closedHat' }).voice, 'closedHat');
eq('3.14 normalizeLane == clampLane', normalizeLane({ voice: 'snare', gain: 1 }), clampLane({ voice: 'snare', gain: 1 }));
eq('3.15 validateLane rejects unknown voice', validateLane({ ...defaultLane(), voice: 'zzz' }).ok, false);
eq('3.16 laneOnsets follows the generator',
  laneOnsets({ generator: { type: 'euclidean', params: { k: 3, n: 8, rotation: 0 } } }), [0, 3, 6]);

// soloActive.
{
  const mk = (solo, mute = false) => ({ ...defaultLane(), solo, mute });
  eq('3.17 no solos -> all active', soloActive([mk(false), mk(false), mk(false)]), [true, true, true]);
  eq('3.18 one solo -> only it', soloActive([mk(false), mk(true), mk(false)]), [false, true, false]);
  eq('3.19 two solos -> both', soloActive([mk(true), mk(false), mk(true)]), [true, false, true]);
  eq('3.20 empty lanes', soloActive([]), []);
}

// ============================================================================
// 4. grooveModel.js + patternModel.js
// ============================================================================
import { warpFraction, SWING_MAX } from './js/grooveModel.js';
import {
  defaultPattern, clampPattern, validatePattern, normalizePattern,
  cycleSeconds, cycleTicks, beatsOf, onsetFraction, patternSchedule, MAX_LANES,
} from './js/patternModel.js';

// warpFraction: identity at swing 0, monotonic, endpoints fixed, midpoint moves later.
eq('4.1 swing 0 is identity', warpFraction(0.3, 4, 0), 0.3);
approx('4.2 beat start is fixed', warpFraction(0.25, 4, 0.667), 0.25, 1e-9);   // beat 2 start (0.25) stays
approx('4.3 bar start fixed', warpFraction(0, 4, 1), 0, 1e-9);
{
  // Within beat 1 of 4/4, the beat midpoint (f=0.125) is pushed later as swing rises.
  const straight = warpFraction(0.125, 4, 0);
  const swung = warpFraction(0.125, 4, 0.667);
  ok('4.4 midpoint pushed later under swing', swung > straight);
  // Monotonic across a beat.
  let prev = -1, mono = true;
  for (let f = 0; f < 0.25; f += 0.01) { const w = warpFraction(f, 4, 0.6); if (w < prev) mono = false; prev = w; }
  ok('4.5 warp is monotonic within a beat', mono);
  approx('4.6 triplet pivot ~2/3 of the beat', warpFraction(0.125, 4, 0.667) * 4, 0.6667, 2e-3);
}
eq('4.7 swing clamps to SWING_MAX', warpFraction(0.125, 4, 99), warpFraction(0.125, 4, SWING_MAX));

// patternModel timing.
const P = defaultPattern();
eq('4.8 default pattern is valid', validatePattern(P).ok, true);
approx('4.9 cycleSeconds 120bpm 4/4 = 2.0', cycleSeconds(P), 2.0);
eq('4.10 cycleTicks 4/4 @960 = 3840', cycleTicks(P), 3840);
eq('4.11 beatsOf 4/4 = 4', beatsOf(P), 4);
approx('4.12 onsetFraction(3,8)', onsetFraction(3, 8), 0.375);

// clamp / validate / normalize.
eq('4.13 clamp caps lanes at 5', clampPattern({ lanes: new Array(9).fill(0).map(() => ({ voice: 'kick' })) }).lanes.length, MAX_LANES);
eq('4.14 clamp bpm out of range', clampPattern({ bpm: 9999, lanes: [] }).bpm, 300);
eq('4.15 clamp allows 0 lanes (empty state)', clampPattern({ lanes: [] }).lanes.length, 0);
eq('4.16 normalize drops unknown fields', 'junk' in normalizePattern({ junk: 1, lanes: [] }), false);
eq('4.17 normalize stamps schemaVersion', normalizePattern({ lanes: [] }).schemaVersion, 1);
eq('4.18 normalize defaults missing swing', normalizePattern({ lanes: [] }).swing, 0);
eq('4.19 validate rejects wrong schemaVersion', validatePattern({ ...P, schemaVersion: 2 }).ok, false);

// patternSchedule.
{
  const pat = normalizePattern({
    bpm: 120, timeSigIndex: 2, swing: 0, lanes: [
      { voice: 'kick', generator: { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } } },
      { voice: 'snare', generator: { type: 'euclidean', params: { k: 3, n: 8, rotation: 0 } } },
    ],
  });
  const sched = patternSchedule(pat);
  eq('4.20 schedule length = total onsets (4+3)', sched.length, 7);
  ok('4.21 schedule sorted by frac', sched.every((e, i) => i === 0 || sched[i - 1].frac <= e.frac));
  eq('4.22 kick onset fracs (no swing)', sched.filter((e) => e.voice === 'kick').map((e) => e.fracRaw), [0, 0.25, 0.5, 0.75]);
  ok('4.23 schedule carries laneIndex', sched.every((e) => e.laneIndex === 0 || e.laneIndex === 1));
  // Accents: mark 2 of the kick's 4 onsets loud.
  const pat2 = normalizePattern({
    lanes: [{ voice: 'kick', generator: { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } }, accent: { enabled: true, hits: 2, rotation: 0 } }],
  });
  eq('4.24 two of four kick onsets accented', patternSchedule(pat2).filter((e) => e.accented).length, 2);
  // Swing shifts a mid-beat onset later but leaves the downbeat fixed. E(3,8) slot 3 = 0.375,
  // the middle of beat 2 (beats are at 0/.25/.5/.75), so it is a genuine off-beat.
  const laneGen = { type: 'euclidean', params: { k: 3, n: 8, rotation: 0 } };
  const dry = patternSchedule(normalizePattern({ lanes: [{ voice: 'kick', generator: laneGen }] }));
  const wet = patternSchedule(normalizePattern({ swing: 0.6, lanes: [{ voice: 'kick', generator: laneGen }] }));
  approx('4.25 swing leaves downbeat at 0', wet.find((e) => e.ringIndex === 0).frac, 0, 1e-9);
  ok('4.26 swing moves the mid-beat onset (slot 3) later', wet.find((e) => e.ringIndex === 3).frac > dry.find((e) => e.ringIndex === 3).frac);
}

// ============================================================================
// 5. exportModel.js — pattern -> SMF, verified by writing then reading back.
// ============================================================================
import { EXPORT_NOTE, velocityFor, patternToEvents, exportSpec, exportBytes, exportFileName } from './js/exportModel.js';

// Every export note round-trips through voiceForNote to its own voice.
for (const v of VOICE_IDS) {
  eq(`5.1 EXPORT_NOTE[${v}] round-trips`, voiceForNote(EXPORT_NOTE[v]), v);
}
ok('5.2 all 12 export notes are distinct', new Set(Object.values(EXPORT_NOTE)).size === 12);

// A tresillo kick lane -> note-ons at ticks [0,1440,2880] (onsets [0,3,6] of 8 over 3840 ticks).
{
  const pat = normalizePattern({ lanes: [{ voice: 'kick', generator: { type: 'euclidean', params: { k: 3, n: 8, rotation: 0 } } }] });
  const ev = patternToEvents(pat);
  const ons = ev.filter((e) => e.type === 'noteOn').map((e) => e.tick);
  eq('5.3 tresillo kick note-on ticks', ons, [0, 1440, 2880]);
  eq('5.4 every note-on has a note-off', ev.filter((e) => e.type === 'noteOff').length, 3);
  ok('5.5 note is GM kick 36', ev.every((e) => e.note === 36));
}

// Accent velocities: accented onsets louder than ghosts.
{
  const pat = normalizePattern({ lanes: [{ voice: 'snare', gain: 1.0, accentDepth: 0.5, generator: { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } }, accent: { enabled: true, hits: 2, rotation: 0 } }] });
  const lane = pat.lanes[0];
  eq('5.6 accented velocity = gain*100', velocityFor(lane, true), 100);
  eq('5.7 ghost velocity = gain*(1-depth)*100', velocityFor(lane, false), 50);
  const vels = new Set(patternToEvents(pat).filter((e) => e.type === 'noteOn').map((e) => e.velocity));
  ok('5.8 exported note-ons carry two velocity levels', vels.has(100) && vels.has(50));
}

// Full byte round-trip via readSMF.
{
  const pat = normalizePattern({
    bpm: 120, timeSigIndex: 2, lanes: [
      { voice: 'kick', generator: { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } } },
      { voice: 'snare', generator: { type: 'euclidean', params: { k: 2, n: 8, rotation: 2 } } },
      { voice: 'closedHat', generator: { type: 'euclidean', params: { k: 8, n: 8, rotation: 0 } } },
    ],
  });
  const bytes = exportBytes(pat);
  const back = readSMF(bytes);
  eq('5.9 exported file is Format 0', back.format, 0);
  eq('5.10 tempo meta = 500000us (120bpm)', back.tempoUsPerQuarter, 500000);
  eq('5.11 meter meta = 4/4', back.timeSig, { numerator: 4, denominator: 4 });
  // The one-bar loop length lives in the End-of-Track meta (readSMF.endTick tracks the last
  // NOTE, so check the EOT via parseSMF and confirm all notes fit inside the bar).
  eq('5.12 exportSpec loop length is one bar', exportSpec(pat).endTick, 3840);
  {
    const eot = parseSMF(bytes).tracks[0].find((e) => e.type === 'meta' && e.metaType === 0x2f);
    eq('5.12b End-of-Track sits at the one-bar boundary', eot.tick, 3840);
    ok('5.12c all notes fall inside the bar', back.events.every((e) => e.tick <= 3840));
  }
  const onsets = 4 + 2 + 8;
  eq('5.13 event count = 2x onsets', back.events.length, onsets * 2);
  ok('5.14 events sorted by tick', back.events.every((e, i) => i === 0 || back.events[i - 1].tick <= e.tick));
  ok('5.15 all events on GM drum channel 10', back.events.every((e) => e.channel === 9));
}

// Mute / solo folding at export.
{
  const base = () => ([
    { voice: 'kick', generator: { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } } },
    { voice: 'snare', generator: { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } } },
  ]);
  const muted = normalizePattern({ lanes: base().map((l, i) => (i === 1 ? { ...l, mute: true } : l)) });
  eq('5.16 muted lane emits nothing', patternToEvents(muted).filter((e) => e.type === 'noteOn').every((e) => e.note === 36), true);
  const soloed = normalizePattern({ lanes: base().map((l, i) => (i === 0 ? { ...l, solo: true } : l)) });
  ok('5.17 solo suppresses the non-soloed lane', patternToEvents(soloed).filter((e) => e.type === 'noteOn').every((e) => e.note === 36));
}

// Swing shifts EXPORT ticks the same direction it shifts playback fractions.
{
  const gen = { type: 'euclidean', params: { k: 3, n: 8, rotation: 0 } };
  const dryTick = patternToEvents(normalizePattern({ lanes: [{ voice: 'kick', generator: gen }] })).find((e) => e.type === 'noteOn' && e.tick > 0).tick;
  const wetTick = patternToEvents(normalizePattern({ swing: 0.6, lanes: [{ voice: 'kick', generator: gen }] })).filter((e) => e.type === 'noteOn').map((e) => e.tick).sort((a, b) => a - b)[1];
  ok('5.18 swing pushes the mid-beat export tick later', wetTick > dryTick);
}

eq('5.19 exportFileName sanitizes', exportFileName({ bpm: 128 }, 'Latin — Bossa!'), 'euclid_latin-bossa_128bpm.mid');

// Compound-meter tempo: the exported bar must last exactly as long as the PLAYED bar for EVERY
// meter. barSeconds treats bpm as the per-beat pulse, so a fixed 60e6/bpm made every /8 meter export
// at HALF its played length; exportSpec now derives the tempo from cycleSeconds so they agree.
{
  for (const [tsi, bpm] of [[2, 120], [5, 66], [4, 100], [7, 120], [13, 90]]) {
    const pat = normalizePattern({ bpm, timeSigIndex: tsi, lanes: [{ voice: 'kick', generator: { type: 'euclidean', params: { k: 2, n: 6, rotation: 0 } } }] });
    const spec = exportSpec(pat);
    const exportedSec = (spec.endTick / SESSION_PPQ) * (spec.tempoUsPerQuarter / 1e6);
    approx(`5.20 exported bar duration == played bar (tsi ${tsi})`, exportedSec, cycleSeconds(pat), 2e-3);
  }
  eq('5.21 4/4 @120 tempo unchanged (500000us)', exportSpec(normalizePattern({ bpm: 120, timeSigIndex: 2, lanes: [] })).tempoUsPerQuarter, 500000);
}

// ============================================================================
// 6. presetModel.js + the bundled preset catalog. Every presets/<id>.json must
//    validate, expand, and export end-to-end (the "validate every content file"
//    gate, mirroring the songwriter sync-feels test).
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { GENRES, validatePreset, normalizePreset, presetToPattern } from './js/presetModel.js';

const presetIds = JSON.parse(readFileSync(new URL('./presets/index.json', import.meta.url), 'utf8'));
const loadPreset = (id) => JSON.parse(readFileSync(new URL(`./presets/${id}.json`, import.meta.url), 'utf8'));

eq('6.1 index lists 12 presets', presetIds.length, 12);
ok('6.2 every genre has at least one preset', GENRES.every((g) => presetIds.some((id) => loadPreset(id).genre === g)));

for (const id of presetIds) {
  const p = loadPreset(id);
  const v = validatePreset(p);
  ok(`6.3 preset ${id} validates${v.ok ? '' : ' -> ' + v.errors.join('; ')}`, v.ok);
  eq(`6.4 preset ${id} file id matches index`, p.id, id);
  const pat = presetToPattern(p);
  eq(`6.5 preset ${id} -> valid pattern`, validatePattern(pat).ok, true);
  ok(`6.6 preset ${id} has 1..5 lanes`, pat.lanes.length >= 1 && pat.lanes.length <= 5);
  // End-to-end: preset -> pattern -> SMF -> read back as Format 0.
  eq(`6.7 preset ${id} exports a Format-0 file`, readSMF(exportBytes(pat)).format, 0);
}

// normalizePreset lifts flat {k,n,rotation} into a euclidean generator.
{
  const lifted = normalizePreset(loadPreset('rock-four-on-the-floor'));
  eq('6.8 flat lane lifted to euclidean generator', lifted.lanes[0].generator, { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } });
}

// Named-rhythm onset assertions on the catalog (the presets really are the named rhythms).
eq('6.9 son tresillo kick onsets [0,3,6]', laneOnsets(presetToPattern(loadPreset('latin-son-tresillo')).lanes[0]), [0, 3, 6]);
eq('6.10 son cinquillo conga onsets', laneOnsets(presetToPattern(loadPreset('latin-son-tresillo')).lanes[1]), [0, 2, 3, 5, 6]);
eq('6.11 bossa clave onsets (E(5,16) rot 3)', laneOnsets(presetToPattern(loadPreset('latin-bossa-nova')).lanes[0]), [3, 6, 9, 12, 15]);
eq('6.12 Bembe bell onsets (E(7,12))', laneOnsets(presetToPattern(loadPreset('world-bembe-bell')).lanes[0]), [0, 2, 3, 5, 7, 8, 10]);
// A rock preset really does express a backbeat euclideanly (snare on beats 2 and 4).
eq('6.13 rock backbeat snare on slots 2 and 6', laneOnsets(presetToPattern(loadPreset('rock-four-on-the-floor')).lanes[1]), [2, 6]);
// The swung-ride jazzy preset carries swing through to the pattern.
ok('6.14 jazzy swung-ride preset keeps its swing', presetToPattern(loadPreset('jazzy-swung-ride')).swing > 0);

// ============================================================================
// 7. Offline-shell tripwire: every js/** module and every preset must be listed in
//    sw.js ASSETS (cache-first => anything unlisted is unavailable offline).
// ============================================================================
{
  const swSrc = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  const listJs = (dir, base) => {
    let out = [];
    for (const ent of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (ent.isDirectory()) out = out.concat(listJs(`${dir}${ent.name}/`, `${base}${ent.name}/`));
      else if (ent.name.endsWith('.js')) out.push(`${base}${ent.name}`);
    }
    return out;
  };
  const modules = listJs('./js/', './js/');
  for (const m of modules) ok(`7.1 sw.js ASSETS lists ${m}`, swSrc.includes(`"${m}"`));
  for (const id of presetIds) ok(`7.2 sw.js ASSETS lists preset ${id}`, swSrc.includes(`"./presets/${id}.json"`));
  ok('7.3 sw.js ASSETS lists the preset index', swSrc.includes('"./presets/index.json"'));
}

// ============================================================================
// 8. Click-safety of `hidden`-toggled elements. index.html boots #status and
//    #overlay with the `hidden` attribute; main.js shows/hides them by flipping
//    `.hidden`. But an author rule like `.overlay { display: flex }` OVERRIDES
//    the UA sheet's `[hidden] { display:none }` (author beats UA regardless of
//    specificity), so the "hidden" overlay stays painted as a fixed, full-screen,
//    z-index:20 layer that swallows every click and dims the app. This tripwire
//    asserts every hidden-by-default element is actually kept display:none.
// ============================================================================
{
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const cssRaw = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');           // strip comments
  const esc = (s) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

  // Elements index.html renders with a bare `hidden` attribute -> boot hidden.
  const hiddenEls = [];
  for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const tag = m[0];
    if (!/\shidden(\s|>|\/|=)/.test(tag)) continue;
    const cls = (tag.match(/class\s*=\s*"([^"]*)"/) || [, ''])[1].trim();
    const id = (tag.match(/id\s*=\s*"([^"]*)"/) || [, null])[1];
    hiddenEls.push({ id, classes: cls ? cls.split(/\s+/) : [] });
  }
  ok('8.1 index.html has hidden-by-default elements', hiddenEls.length >= 1);

  // A global `[hidden] { display:none }` guard covers every such element at once.
  const globalGuard = /(^|[}{;,])\s*\[hidden\][^{}]*\{[^}]*display\s*:\s*none/i.test(css);
  // Does a class rule set `display` to a NON-none value (the hazard)?
  const classHazard = (cls) => {
    const re = new RegExp('\\.' + esc(cls) + '\\s*\\{([^}]*)\\}', 'g');
    let m, bad = false;
    while ((m = re.exec(css))) {
      const dm = m[1].match(/display\s*:\s*([a-z-]+)/i);
      if (dm && dm[1].toLowerCase() !== 'none') bad = true;
    }
    return bad;
  };
  // A per-class `.<cls>[hidden]{display:none}` guard also suffices.
  const classGuard = (cls) => new RegExp('\\.' + esc(cls) + '\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none', 'i').test(css);

  for (const el of hiddenEls) {
    for (const cls of el.classes) {
      const ref = `.${cls}${el.id ? ' (#' + el.id + ')' : ''}`;
      ok(`8.2 ${ref} stays display:none when [hidden]`, !classHazard(cls) || globalGuard || classGuard(cls));
    }
  }
}

// ============================================================================
// 9. player.js PURE helpers. player.js touches AudioContext only inside init()/createPlayer,
//    never at module top level, so its pure surface is node-importable. Covers the mute/solo
//    visual-pulse gate (B4) and the resync resume-point that stops a tempo/swing edit from
//    restarting the loop to the downbeat (B1).
// ============================================================================
import { laneAudible, resumeCursor } from './js/player.js';
{
  const p2 = normalizePattern({ lanes: [
    { voice: 'kick', generator: { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } } },
    { voice: 'snare', generator: { type: 'euclidean', params: { k: 3, n: 8, rotation: 0 } } },
  ] });
  ok('9.1 no mute/solo -> both lanes audible', laneAudible(p2, 0) && laneAudible(p2, 1));
  const muted = normalizePattern({ ...p2, lanes: p2.lanes.map((l, i) => (i === 1 ? { ...l, mute: true } : l)) });
  ok('9.2 muted lane not audible', laneAudible(muted, 1) === false);
  ok('9.3 non-muted lane still audible', laneAudible(muted, 0) === true);
  const soloed = normalizePattern({ ...p2, lanes: p2.lanes.map((l, i) => (i === 0 ? { ...l, solo: true } : l)) });
  ok('9.4 soloed lane audible', laneAudible(soloed, 0) === true);
  ok('9.5 non-soloed lane not audible', laneAudible(soloed, 1) === false);
  ok('9.6 out-of-range / empty -> not audible', laneAudible(p2, 9) === false && laneAudible({ lanes: [] }, 0) === false);

  // resumeCursor: resume from the first onset at/after the preserved phase (no re-fire, no skip).
  const fr = [0, 0.25, 0.5, 0.75];
  eq('9.7 phase 0 resumes at 0', resumeCursor(fr, 0), 0);
  eq('9.8 mid-bar phase resumes at the next onset', resumeCursor(fr, 0.3), 2);
  eq('9.9 phase exactly on an onset resumes at it', resumeCursor(fr, 0.5), 2);
  eq('9.10 phase past all resumes at end (loop wraps next cycle)', resumeCursor(fr, 0.9), 4);
  eq('9.11 empty schedule -> 0', resumeCursor([], 0.5), 0);
  eq('9.12 phase normalizes (1.3 == 0.3)', resumeCursor(fr, 1.3), resumeCursor(fr, 0.3));
  eq('9.13 negative phase normalizes (-0.1 == 0.9)', resumeCursor(fr, -0.1), resumeCursor(fr, 0.9));
}

// ---- report ----
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  ✗ ' + f);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
