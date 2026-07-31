// js/main.js — IMPURE boot + wiring. Holds the single source of truth (the current pattern),
// the AudioContext-backed player, the SVG ring view, and the controls. Every edit funnels through
// commit(): update the pattern, persist it, refresh the player (reschedule for position changes,
// remix for sound-only changes), and re-render only what's needed. Also owns the preset overlay,
// MIDI export (open the save sink under the click gesture), and the SW registration.

import { defaultPattern, normalizePattern, MAX_LANES } from './patternModel.js';
import { defaultLane, clampLane } from './laneModel.js';
import { TIME_SIGS } from './engine/clickModel.js';
import { presetToPattern } from './presetModel.js';
import { loadPresets, groupByGenre } from './presetStore.js';
import { savePattern, loadPattern } from './patternStore.js';
import { exportBytes, exportFileName } from './exportModel.js';
import { openMidSink, writeMidSink } from './fileSink.js';
import { createPlayer } from './player.js';
import { createRingView } from './ringView.js';
import { createControls } from './controlsPanel.js';

const VOICE_ORDER = ['kick', 'snare', 'closedHat', 'openHat', 'ride', 'clap', 'hiConga', 'loConga', 'lowTom', 'midTom', 'highTom', 'crash'];
const LANE_LABELS = { kick: 'Kick', snare: 'Snare', closedHat: 'Closed Hat', openHat: 'Open Hat', lowTom: 'Low Tom', midTom: 'Mid Tom', highTom: 'High Tom', crash: 'Crash', ride: 'Ride', clap: 'Clap', hiConga: 'Hi Conga', loConga: 'Lo Conga' };
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

let pattern = loadPattern() || defaultPattern();
let selected = pattern.lanes.length ? 0 : -1;
let presetLabel = 'pattern';

const svg = document.getElementById('rings');
const hub = document.getElementById('hub');
const controlsRoot = document.getElementById('controls');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');

const player = createPlayer();
const ringView = createRingView(svg, hub, {
  onSelectLane: (i) => { selected = i; renderAll(); },
  onRotate: (i, delta) => rotateBy(i, delta),
});
const controls = createControls(controlsRoot, buildHandlers());

player.setOnFire((laneIndex, slot) => ringView.firePulse(laneIndex, slot));
player.setPattern(pattern);
player.init();                       // preload Kit 4 so the first Play has no decode latency
renderAll();

// ---- edit plumbing ----------------------------------------------------------
function commit(next, opts = {}) {
  const { reschedule = true, renderRing = true, renderControls = true } = opts;
  pattern = normalizePattern(next);
  savePattern(pattern);
  if (reschedule) player.setPattern(pattern); else player.updateMix(pattern);
  if (renderRing) ringView.render(pattern, selected);
  if (renderControls) controls.render(pattern, selected, player.isPlaying());
  updateHub();
}
function renderAll() {
  ringView.render(pattern, selected);
  controls.render(pattern, selected, player.isPlaying());
  updateHub();
}
function withLane(i, patch) {
  const lanes = pattern.lanes.map((l, idx) => (idx === i ? clampLane({ ...l, ...patch }) : l));
  return { ...pattern, lanes };
}
function withGen(i, paramPatch) {
  const lane = pattern.lanes[i];
  const params = { ...lane.generator.params, ...paramPatch };
  return withLane(i, { generator: { type: 'euclidean', params } });
}
function withAccent(i, patch) {
  const lane = pattern.lanes[i];
  return withLane(i, { accent: { ...lane.accent, ...patch } });
}
function rotateBy(i, delta) {
  const n = pattern.lanes[i].generator.params.n;
  const rot = (((pattern.lanes[i].generator.params.rotation + delta) % n) + n) % n;
  commit(withGen(i, { rotation: rot }), { reschedule: true, renderRing: true, renderControls: true });
}

function buildHandlers() {
  return {
    onPlayToggle: () => {
      if (player.isPlaying()) { player.stop(); controls.setPlaying(false); }
      else { player.play().then(() => controls.setPlaying(true)); }
    },
    onBpm: (v) => commit({ ...pattern, bpm: v }, { reschedule: true, renderRing: false, renderControls: false }),
    onSwing: (v) => commit({ ...pattern, swing: v }, { reschedule: true, renderRing: false, renderControls: false }),
    onTimeSig: (i) => commit({ ...pattern, timeSigIndex: i }, { reschedule: true, renderRing: false, renderControls: false }),
    onSelectLane: (i) => { selected = i; renderAll(); },
    onAddLane: () => {
      if (pattern.lanes.length >= MAX_LANES) return;
      const lane = clampLane({ ...defaultLane(), voice: nextVoice() });
      const lanes = pattern.lanes.concat([lane]);
      selected = lanes.length - 1;
      commit({ ...pattern, lanes });
    },
    onRemoveLane: (i) => {
      const lanes = pattern.lanes.filter((_, idx) => idx !== i);
      selected = Math.min(selected, lanes.length - 1);
      commit({ ...pattern, lanes });
    },
    onVoice: (i, voice) => commit(withLane(i, { voice }), { reschedule: false, renderRing: true, renderControls: true }),
    onN: (i, n) => commit(withGen(i, { n }), { reschedule: true, renderRing: true, renderControls: true }),
    onK: (i, k) => commit(withGen(i, { k }), { reschedule: true, renderRing: true, renderControls: true }),
    onRotation: (i, rotation) => commit(withGen(i, { rotation }), { reschedule: true, renderRing: true, renderControls: true }),
    onGain: (i, gain) => commit(withLane(i, { gain }), { reschedule: false, renderRing: false, renderControls: false }),
    onMute: (i) => commit(withLane(i, { mute: !pattern.lanes[i].mute }), { reschedule: false, renderRing: true, renderControls: true }),
    onSolo: (i) => commit(withLane(i, { solo: !pattern.lanes[i].solo }), { reschedule: false, renderRing: true, renderControls: true }),
    onAccentToggle: (i, on) => commit(withAccent(i, { enabled: on }), { reschedule: true, renderRing: true, renderControls: true }),
    onAccentHits: (i, hits) => commit(withAccent(i, { hits }), { reschedule: true, renderRing: true, renderControls: true }),
    onAccentRotation: (i, rotation) => commit(withAccent(i, { rotation }), { reschedule: true, renderRing: true, renderControls: true }),
    onAccentDepth: (i, accentDepth) => commit(withLane(i, { accentDepth }), { reschedule: false, renderRing: false, renderControls: false }),
  };
}

function nextVoice() {
  const used = new Set(pattern.lanes.map((l) => l.voice));
  return VOICE_ORDER.find((v) => !used.has(v)) || 'kick';
}

// ---- hub readout + animation ------------------------------------------------
function updateHub() {
  const phase = player.getCyclePhase();
  const beats = (TIME_SIGS[pattern.timeSigIndex] || TIME_SIGS[0]).beats;
  const beat = player.isPlaying() ? Math.floor(phase * beats) + 1 : 1;
  hub.innerHTML = `<div class="hubbpm">${pattern.bpm}</div><div class="hublabel">BPM</div><div class="hubpos">1.${beat}</div>`;
  controls.setPosition(`1.${beat}`);
}
function frame() {
  const phase = player.getCyclePhase();
  ringView.tickPlayhead(phase);
  if (player.isPlaying()) {
    const beats = (TIME_SIGS[pattern.timeSigIndex] || TIME_SIGS[0]).beats;
    const beat = Math.floor(phase * beats) + 1;
    const posEl = hub.querySelector('.hubpos');
    if (posEl) posEl.textContent = `1.${beat}`;
    controls.setPosition(`1.${beat}`);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- export -----------------------------------------------------------------
function showStatus(text, kind) {
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}
document.getElementById('exportBtn').addEventListener('click', async () => {
  if (!pattern.lanes.length) { showStatus('Add a lane before exporting.', 'warn'); return; }
  const name = exportFileName(pattern, presetLabel);
  const sink = await openMidSink(name);          // must run in the gesture (transient activation)
  if (!sink) { showStatus('Export cancelled.'); return; }
  try {
    const bytes = exportBytes(pattern);
    const done = await writeMidSink(sink, bytes);
    showStatus(done ? `Saved ${name}` : 'Export cancelled.', done ? 'good' : null);
  } catch (e) { showStatus('Export failed: ' + (e && e.message), 'warn'); }
});

// ---- preset overlay ---------------------------------------------------------
let presetsCache = null;
document.getElementById('presetsBtn').addEventListener('click', async () => {
  if (!presetsCache) presetsCache = await loadPresets();
  openPresets(presetsCache);
});
function closeOverlay() { overlay.hidden = true; overlay.innerHTML = ''; }
function openPresets(presets) {
  overlay.innerHTML = '';
  const panel = h('div', 'ovpanel');
  const head = h('div', 'ovhead');
  head.append(h('div', 'caps', 'Presets'));
  const closeBtn = h('button', 'btn sm', 'Close');
  closeBtn.addEventListener('click', closeOverlay);
  head.appendChild(closeBtn);
  panel.appendChild(head);

  const groups = groupByGenre(presets);
  for (const genre of Object.keys(groups)) {
    if (!groups[genre].length) continue;
    panel.appendChild(h('div', 'ovgenre', genre));
    const grid = h('div', 'ovgrid');
    for (const p of groups[genre]) grid.appendChild(presetCard(p));
    panel.appendChild(grid);
  }
  overlay.appendChild(panel);
  overlay.hidden = false;
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeOverlay(); }, { once: true });
}
function presetCard(p) {
  const card = h('button', 'ovcard');
  const voices = p.lanes.map((l) => LANE_LABELS[l.voice] || l.voice).join(' · ');
  card.innerHTML = `<b>${p.name}</b><span class="dim">${p.bpm} BPM · ${p.lanes.length} lanes</span><span class="ovvoices">${voices}</span>`;
  let armed = false, timer = null;
  card.addEventListener('click', () => {
    if (pattern.lanes.length && !armed) {
      armed = true; card.classList.add('armed');
      const tag = h('span', 'armtag', 'Replace current? Tap to load');
      card.appendChild(tag);
      timer = setTimeout(() => { armed = false; card.classList.remove('armed'); tag.remove(); }, 2500);
      return;
    }
    clearTimeout(timer);
    applyPreset(p);
  });
  return card;
}
function applyPreset(p) {
  presetLabel = `${p.genre}-${p.name}`;
  const pat = presetToPattern(p);
  selected = pat.lanes.length ? 0 : -1;
  closeOverlay();
  commit(pat);
}

// ---- service worker ---------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
