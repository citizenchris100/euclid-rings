// js/player.js — IMPURE lightweight lookahead player. This is the app's own scheduler (the reused
// drumMachine.js is hard-locked to a 16-step grid and cannot place euclidean onsets at i/n of the
// bar). It loads Kit 4 via the reused loadKit, holds one persistent GainNode per lane (the mute/
// solo/gain gate), and fires one AudioBufferSource per hit:
//
//   BufferSource -> hitGain(velocity) -> laneGain[i] -> master -> destination   (mono)
//
// Timing is a Chris-Wilson lookahead over patternSchedule() sorted by swung `frac`; every hit time
// is absolute off a single startAt, so it never drifts and the loop seam never skips/dupes. Voice
// and per-hit velocity are read LIVE from the pattern, so changing a voice/gain needs no reschedule
// (updateMix); only position-changing edits rebuild the schedule (setPattern -> restart while playing).

import { loadKit } from './engine/drumKits.js';
import { patternSchedule, cycleSeconds, MAX_LANES } from './patternModel.js';
import { velocityFor } from './exportModel.js';
import { soloActive } from './laneModel.js';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const LEAD = 0.06;

// laneAudible(pattern, i) -> is lane i actually producing sound (not muted, not solo-excluded)?
// The onset visual pulse is gated by this so a silenced lane's dots don't keep flashing.
export function laneAudible(pattern, i) {
  const lanes = (pattern && pattern.lanes) || [];
  const lane = lanes[i];
  if (!lane || lane.mute) return false;
  return soloActive(lanes)[i];
}

// resumeCursor(fracs, phase) -> index of the first onset at/after `phase`: the point to resume from
// after a phase-preserving resync, so a tempo/swing/meter change while playing neither re-fires an
// onset already played this revolution nor skips one. Pure + node-testable (the core of the resync).
export function resumeCursor(fracs, phase) {
  const ph = ((phase % 1) + 1) % 1;
  let i = 0;
  while (i < fracs.length && fracs[i] < ph) i++;
  return i;
}

export function createPlayer() {
  let ctx = null, buffers = {}, master = null;
  const laneGains = [];
  let pattern = null, schedule = [], cyc = 1;
  let running = false, timer = null;
  let startAt = 0, cycleIndex = 0, cursor = 0;
  let onFire = null;

  async function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    for (let i = 0; i < MAX_LANES; i++) {
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(master);
      laneGains.push(g);
    }
    buffers = await loadKit(ctx, 'kit4');
  }

  function setOnFire(cb) { onFire = cb; }

  // Fold mute/solo/gain-scale onto the persistent lane gains (instant, no reschedule).
  function updateMix(p) {
    pattern = p;
    if (!ctx) return;
    const lanes = p.lanes || [];
    const active = soloActive(lanes);
    for (let i = 0; i < MAX_LANES; i++) {
      const lane = lanes[i];
      const audible = !!(lane && active[i] && !lane.mute);
      laneGains[i].gain.setTargetAtTime(audible ? 1 : 0, ctx.currentTime, 0.01);
    }
  }

  // Rebuild the schedule (positions/tempo/swing changed). While playing, RESYNC to the current phase
  // instead of restart()ing to the downbeat, so dragging BPM/Swing advances the loop smoothly rather
  // than machine-gunning the downbeat every input event (restart() is only for a fresh play()).
  function setPattern(p) {
    const prevPhase = running ? getCyclePhase() : 0;   // capture with the OLD cyc/startAt
    pattern = p;
    schedule = patternSchedule(p);
    cyc = Math.max(0.05, cycleSeconds(p));
    updateMix(p);
    if (running) resyncTo(prevPhase);
  }

  // Rebase the transport so `now` maps to `phase` under the new cyc/schedule, resuming from the next
  // onset due this revolution. Preserves continuity across a tempo/swing/meter change while playing.
  function resyncTo(phase) {
    if (timer) { clearTimeout(timer); timer = null; }
    const ph = ((phase % 1) + 1) % 1;
    startAt = ctx.currentTime - ph * cyc;
    cycleIndex = 0;
    cursor = resumeCursor(schedule.map((e) => e.frac), ph);
    loop();
  }

  function scheduleHit(e, when) {
    const lane = pattern.lanes[e.laneIndex];
    if (!lane) return;
    const buf = buffers[lane.voice];
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = velocityFor(lane, e.accented) / 127;
      src.connect(g);
      g.connect(laneGains[e.laneIndex] || master);
      src.start(when);
    }
    if (onFire && laneAudible(pattern, e.laneIndex)) {
      const delayMs = Math.max(0, (when - ctx.currentTime) * 1000);
      setTimeout(() => { if (running) onFire(e.laneIndex, e.ringIndex); }, delayMs);
    }
  }

  function loop() {
    if (!running) return;
    if (schedule.length === 0) { timer = setTimeout(loop, LOOKAHEAD_MS); return; }
    for (;;) {
      if (cursor >= schedule.length) { cycleIndex++; cursor = 0; }
      const e = schedule[cursor];
      const t = startAt + cycleIndex * cyc + e.frac * cyc;
      if (t >= ctx.currentTime + SCHEDULE_AHEAD) break;
      scheduleHit(e, t);
      cursor++;
    }
    timer = setTimeout(loop, LOOKAHEAD_MS);
  }

  function restart() {
    if (timer) { clearTimeout(timer); timer = null; }
    startAt = ctx.currentTime + LEAD;
    cycleIndex = 0;
    cursor = 0;
    loop();
  }

  async function play() {
    await init();
    if (ctx.state === 'suspended') await ctx.resume();
    if (pattern) { schedule = patternSchedule(pattern); cyc = Math.max(0.05, cycleSeconds(pattern)); updateMix(pattern); }
    running = true;
    restart();
  }

  function stop() {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function isPlaying() { return running; }

  // 0..1 position within the current revolution (linear; the playhead sweeps at constant speed).
  function getCyclePhase() {
    if (!running || !ctx) return 0;
    const el = ctx.currentTime - startAt;
    if (el < 0) return 0;
    return (el / cyc) % 1;
  }

  return { init, setOnFire, setPattern, updateMix, play, stop, isPlaying, getCyclePhase };
}
