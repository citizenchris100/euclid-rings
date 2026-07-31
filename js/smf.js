// js/smf.js — PURE lossless-within-voices SMF read / slice / write for the slice & dice
// compositor. Node-importable (only depends on the verbatim engine parser + the kit's GM
// map), so engine.test.js covers it headlessly.
//
// The audition path (drumModel.smfToPattern) quantizes to a 4/4 16-step grid and throws away
// ticks/velocity/channel/note-offs — perfect for HEARING a loop, useless for re-exporting the
// bars you picked. This module is the parallel, faithful path: read the real note events,
// split into whole bars, and write a new SMF. "Lossless within the kit's 12 voices": every
// hit the tape deck can play is preserved with its exact tick + velocity; hits it can't play
// (unmapped GM notes) are dropped and counted, matching what you already hear through Kit 4.
//
// It reuses the vendored parseSMF for the hard parts (VLQ, running status, format-0/1 merge,
// SMPTE rejection) and adds only a dedicated 0x58 time-sig decode (parseSMF drops that
// payload) and the voice filter — so the five engine files stay verbatim.

import { parseSMF, readVarLen } from './engine/midiParse.js';
import { voiceForNote, MAX_BARS } from './engine/drumModel.js';

// One canonical ticks-per-quarter for every assembled/exported file. Divisible by the common
// source PPQs (96/120/192/240/480), so slice ticks rescale exactly.
export const SESSION_PPQ = 960;

const GM_DRUM_CHANNEL = 9;          // MIDI channel 10 (0-indexed) — GM percussion. Export forces
                                    // this; the tape deck ignores channel, but it keeps the file
                                    // a valid GM drum track for anything else.
// Sort key: ascending tick, and at a shared tick a note-OFF before a note-ON, so a bar-clamped
// off at a slot seam never cuts the next slice's re-trigger of the same voice.
const rank = (type) => (type === 'noteOff' ? 0 : 1);
const cmpEvents = (a, b) => (a.tick - b.tick) || (rank(a.type) - rank(b.type));

// readSMF(bytes) -> { format, ppq, tempoUsPerQuarter|null, timeSig|null, events, endTick }
// A FAITHFUL reader (all note events, both metas). `events` are {tick,type,channel,note,velocity}
// merged across tracks and sorted. Detect uses tempoUsPerQuarter + timeSig; slicing uses events.
export function readSMF(bytes) {
  const p = parseSMF(bytes);                 // { format, ntrks, ppq, tracks }
  let tempoTick = Infinity, tempoUsPerQuarter = null;
  const events = [];
  let endTick = 0;
  for (const track of p.tracks) {
    for (const e of track) {
      if (e.type === 'noteOn' || e.type === 'noteOff') {
        events.push({ tick: e.tick, type: e.type, channel: e.channel, note: e.note, velocity: e.velocity });
        if (e.tick > endTick) endTick = e.tick;
      } else if (e.type === 'meta') {
        if (e.metaType === 0x51 && typeof e.usPerQuarter === 'number' && e.usPerQuarter > 0 && e.tick < tempoTick) {
          tempoTick = e.tick; tempoUsPerQuarter = e.usPerQuarter;
        }
        // NB: the End-of-Track meta (0x2f) is deliberately NOT folded into endTick — real
        // files pad it far past the content (e.g. Akron_Grv_1.mid: 2 bars of hits, EOT at
        // 100 bars). endTick tracks the last NOTE event only, so bar count reflects content.
      }
    }
  }
  events.sort(cmpEvents);
  return { format: p.format, ppq: p.ppq, tempoUsPerQuarter, timeSig: readTimeSig(bytes), events, endTick };
}

// readTimeSig(bytes) -> { numerator, denominator } | null. parseSMF records the 0x58 meta but
// drops its payload, so re-walk the tracks (reusing readVarLen, skipping by length like parseSMF)
// to decode the FIRST time-sig. `dd` is a power-of-two exponent (2 -> /4, 3 -> /8).
export function readTimeSig(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 14) return null;
  const u32 = (p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  const u16 = (p) => ((b[p] << 8) | b[p + 1]) >>> 0;
  if (u32(0) !== 0x4d546864) return null;
  const headerLen = u32(4);
  const ntrks = u16(10);
  let pos = 8 + headerLen;
  for (let t = 0; t < ntrks && pos + 8 <= b.length; t++) {
    const chunkLen = u32(pos + 4);
    if (u32(pos) !== 0x4d54726b) { pos += 8 + chunkLen; continue; }
    const end = Math.min(pos + 8 + chunkLen, b.length);
    let p = pos + 8, running = 0;
    while (p < end) {
      const dv = readVarLen(b, p); p = dv.next;               // delta (discard)
      let status = b[p];
      if (status & 0x80) { p++; running = status < 0xf0 ? status : 0; }
      else { status = running; }
      const hi = status & 0xf0;
      if (hi === 0x90 || hi === 0x80 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) { p += 2; }
      else if (hi === 0xc0 || hi === 0xd0) { p += 1; }
      else if (status === 0xff) {
        const metaType = b[p++]; const ml = readVarLen(b, p); p = ml.next;
        const dataStart = p; p += ml.value;
        if (metaType === 0x58 && ml.value >= 2) {
          return { numerator: b[dataStart], denominator: Math.pow(2, b[dataStart + 1]) };
        }
      } else if (status === 0xf0 || status === 0xf7) {
        const sl = readVarLen(b, p); p = sl.next + sl.value;
      } else { break; }
    }
    pos = end;
  }
  return null;
}

// Ticks in one bar of `num/den` at `ppq` ticks-per-quarter: 4/4 -> 4*ppq, 6/8 -> 3*ppq.
export function barTicks(ppq, num, den) {
  return Math.round((ppq * num * 4) / den);
}

// Pair note-ons with their note-offs (newest-open match on channel|note) so each note has a
// duration. An unmatched note-on gets an off at endTick; an unmatched off is ignored. `events`
// must already be cmpEvents-sorted (off-before-on at a tick), so a same-tick retrigger closes
// the old note before opening the new one.
function pairNotes(events, endTick) {
  const open = new Map();          // key -> stack of open note-ons
  const out = [];
  for (const e of events) {
    const key = (e.channel << 8) | e.note;
    if (e.type === 'noteOn') {
      let stack = open.get(key); if (!stack) { stack = []; open.set(key, stack); }
      stack.push({ onTick: e.tick, velocity: e.velocity, channel: e.channel, note: e.note });
    } else {
      const stack = open.get(key);
      if (stack && stack.length) {
        const on = stack.pop();
        out.push({ channel: on.channel, note: on.note, velocity: on.velocity, onTick: on.onTick, offTick: e.tick, offVelocity: e.velocity });
      }
    }
  }
  for (const stack of open.values()) {
    for (const on of stack) out.push({ channel: on.channel, note: on.note, velocity: on.velocity, onTick: on.onTick, offTick: endTick, offVelocity: 64 });
  }
  out.sort((a, b) => a.onTick - b.onTick);
  return out;
}

// sliceByBar(smf, timeSig?) -> { slices, wholeBars, ticksPerBar, droppedUnmapped, droppedOverCap }.
// Splits into whole 1-bar slices on `timeSig` (default: the file's own, else 4/4) — the SESSION
// meter is passed in so slices match the output grid. Each BarSlice is { index, ppq, events } with
// events shifted to a bar-local tick 0 and note-offs clamped to the bar boundary (so slices
// concatenate cleanly).
//
// Bar count is derived from the LAST MAPPED NOTE, exactly as the auditioner's smfToPattern does
// (a hit anywhere in bar k makes the clip k+1 bars; silence after the last hit still completes its
// bar), NOT from endTick/EOT — real loops pad the End-of-Track far past the content. Capped at
// MAX_BARS to match the auditioner; the `barOf` snap (half a step) mirrors smfToPattern's round()
// so a note jittered just before a downbeat lands on it. Notes outside the kit's 12 voices are
// dropped and counted; mapped notes past the cap go to droppedOverCap.
export function sliceByBar(smf, timeSig) {
  const ppq = smf.ppq;
  const ts = timeSig || smf.timeSig || { numerator: 4, denominator: 4 };
  const tpb = barTicks(ppq, ts.numerator, ts.denominator);
  const snap = tpb > 0 ? Math.max(1, Math.round(tpb / 32)) : 0;         // half a 16th (4/4: ppq/8)
  const barOf = (tick) => (tpb > 0 ? Math.floor((tick + snap) / tpb) : 0);

  const paired = pairNotes(smf.events, smf.endTick);
  const mapped = paired.filter((n) => voiceForNote(n.note) != null);
  const droppedUnmapped = paired.length - mapped.length;

  let maxBar = -1;
  for (const n of mapped) { const b = barOf(n.onTick); if (b > maxBar) maxBar = b; }
  const wholeBars = maxBar < 0 ? 0 : Math.min(MAX_BARS, maxBar + 1);

  const slices = [];
  for (let i = 0; i < wholeBars; i++) slices.push({ index: i, ppq, events: [] });

  let droppedOverCap = 0;
  for (const n of mapped) {
    const k = barOf(n.onTick);
    if (k < 0 || k >= wholeBars) { droppedOverCap++; continue; }        // beyond the MAX_BARS cap
    const base = k * tpb;
    const onLocal = Math.max(0, n.onTick - base);                       // snap may nudge to next bar
    let offLocal = Math.min(n.offTick, base + tpb) - base;              // clamp to the bar end
    if (offLocal <= onLocal) offLocal = Math.min(onLocal + 1, tpb);
    const ev = slices[k].events;
    ev.push({ tick: onLocal, type: 'noteOn', channel: n.channel, note: n.note, velocity: n.velocity });
    ev.push({ tick: offLocal, type: 'noteOff', channel: n.channel, note: n.note, velocity: n.offVelocity });
  }
  for (const s of slices) s.events.sort(cmpEvents);

  return { slices, wholeBars, ticksPerBar: tpb, droppedUnmapped, droppedOverCap };
}

// Rescale event ticks from one ppq to another (round half-up; monotonic, so order holds).
export function rescaleTicks(events, fromPpq, toPpq) {
  if (fromPpq === toPpq) return events.map((e) => ({ ...e }));
  return events.map((e) => ({ ...e, tick: Math.round((e.tick * toPpq) / fromPpq) }));
}

// Variable-length quantity WRITER (the inverse of midiParse.readVarLen). 7 bits/byte, high bit
// set = "more bytes follow".
export function writeVarLen(value) {
  let v = value >>> 0;
  let buffer = v & 0x7f;
  while ((v >>>= 7)) buffer = (buffer << 8) | ((v & 0x7f) | 0x80);
  const out = [];
  for (;;) {
    out.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>>= 8;
    else break;
  }
  return out;
}

// writeSMF({ ppq, tempoUsPerQuarter, timeSig, events, endTick? }) -> Uint8Array. Format 0, one
// MTrk, ch 10, tempo + time-sig meta at tick 0, then delta-encoded note events (full status byte,
// no running status — always valid), trailing EOT.
export function writeSMF(spec) {
  const ppq = spec.ppq;
  const events = (spec.events || []).slice().sort(cmpEvents);
  const lastTick = events.length ? events[events.length - 1].tick : 0;
  const endTick = spec.endTick != null ? Math.max(spec.endTick, lastTick) : lastTick;

  const data = [];
  let prev = 0;
  const pushDelta = (tick) => { data.push(...writeVarLen(tick - prev)); prev = tick; };

  if (spec.tempoUsPerQuarter != null) {
    pushDelta(0);
    const u = spec.tempoUsPerQuarter;
    data.push(0xff, 0x51, 0x03, (u >> 16) & 0xff, (u >> 8) & 0xff, u & 0xff);
  }
  if (spec.timeSig) {
    pushDelta(0);
    const dd = Math.round(Math.log2(spec.timeSig.denominator));
    data.push(0xff, 0x58, 0x04, spec.timeSig.numerator & 0xff, dd & 0xff, 24, 8);
  }
  for (const e of events) {
    pushDelta(e.tick);
    const status = (e.type === 'noteOn' ? 0x90 : 0x80) | GM_DRUM_CHANNEL;
    data.push(status, e.note & 0x7f, e.velocity & 0x7f);
  }
  pushDelta(endTick);
  data.push(0xff, 0x2f, 0x00);            // End of Track

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff];
  const len = data.length;
  const track = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...data];
  return new Uint8Array([...header, ...track]);
}

// assembleOutput(slots, { ppq, tempoUsPerQuarter, timeSig, outputBars }) -> Uint8Array. Shift each
// placed 1-bar slice to its bar position (rescaling its source ppq to the session ppq), concatenate,
// and writeSMF. `slots` may contain nulls (skipped); export gating happens in the caller.
export function assembleOutput(slots, sessionMeta) {
  const outPpq = sessionMeta.ppq;
  const ts = sessionMeta.timeSig || { numerator: 4, denominator: 4 };
  const tpb = barTicks(outPpq, ts.numerator, ts.denominator);
  const events = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot) continue;
    const base = i * tpb;
    for (const e of rescaleTicks(slot.events, slot.ppq, outPpq)) events.push({ ...e, tick: e.tick + base });
  }
  return writeSMF({ ppq: outPpq, tempoUsPerQuarter: sessionMeta.tempoUsPerQuarter, timeSig: ts, events, endTick: sessionMeta.outputBars * tpb });
}
