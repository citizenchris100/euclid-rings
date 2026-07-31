// js/controlsPanel.js — IMPURE right-column UI: transport (play, neon BPM dial, swing, meter,
// position readout), the lane list, and the selected-lane inspector (voice, n/k/rotation steppers,
// accent controls, gain, mute/solo, remove, add-lane). Built from themed DOM/SVG, no libraries.
//
// Render discipline: the TRANSPORT is built ONCE and updated in place, so a continuous BPM/swing
// drag is never interrupted by a rebuild. The lane list + inspector are rebuilt on render() (their
// controls are click/stepper based). The gain slider's live drag updates the model without a
// re-render (main folds it into the player mix). So no active drag is ever torn down mid-gesture.

import { VOICES, VOICE_IDS } from './engine/drumModel.js';
import { TIME_SIGS, MIN_BPM, MAX_BPM } from './engine/clickModel.js';
import { SWING_MAX } from './grooveModel.js';
import { MAX_STEPS, MIN_STEPS } from './generators.js';
import { MAX_LANES } from './patternModel.js';
import { intervalVector, euclidRotated } from './euclid.js';

const LANE_LABELS = { kick: 'Kick', snare: 'Snare', closedHat: 'Closed Hat', openHat: 'Open Hat', lowTom: 'Low Tom', midTom: 'Mid Tom', highTom: 'High Tom', crash: 'Crash', ride: 'Ride', clap: 'Clap', hiConga: 'Hi Conga', loConga: 'Lo Conga' };

function h(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

// ---- neon SVG dial (BPM) ----------------------------------------------------
function dialPolar(r, angleDeg) { const a = (angleDeg - 90) * Math.PI / 180; return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]; }
function dialArc(r, a0, a1) {
  const [x0, y0] = dialPolar(r, a0), [x1, y1] = dialPolar(r, a1);
  const large = (a1 - a0) > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}
function buildDial(min, max, onChange, onCommit) {
  const A0 = -135, SWEEP = 270;
  let value = min;
  const wrap = h('div', 'dial');
  wrap.innerHTML = `<svg viewBox="0 0 100 100" class="dialsvg">
    <path class="track" d="${dialArc(40, A0, A0 + SWEEP)}" fill="none"/>
    <path class="val" fill="none"/>
    <text class="num" x="50" y="54" text-anchor="middle">120</text>
  </svg>`;
  const svg = wrap.querySelector('svg');
  const valPath = wrap.querySelector('.val');
  const num = wrap.querySelector('.num');
  function paint() {
    const frac = (value - min) / (max - min);
    valPath.setAttribute('d', dialArc(40, A0, A0 + SWEEP * frac));
    num.textContent = String(Math.round(value));
  }
  function setValue(v, fire) { value = clampInt(v, min, max); paint(); if (fire && onChange) onChange(value); }
  // vertical drag
  let dragging = false, startY = 0, startVal = 0;
  svg.addEventListener('pointerdown', (ev) => { dragging = true; startY = ev.clientY; startVal = value; svg.setPointerCapture(ev.pointerId); ev.preventDefault(); });
  svg.addEventListener('pointermove', (ev) => { if (!dragging) return; const dv = (startY - ev.clientY) / 170 * (max - min); setValue(startVal + dv, true); });
  const up = (ev) => { if (dragging) { dragging = false; try { svg.releasePointerCapture(ev.pointerId); } catch { /* */ } if (onCommit) onCommit(value); } };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', (ev) => { ev.preventDefault(); setValue(value + (ev.deltaY < 0 ? 1 : -1), true); if (onCommit) onCommit(value); }, { passive: false });
  svg.addEventListener('dblclick', () => { setValue(120, true); if (onCommit) onCommit(value); });
  num.addEventListener('dblclick', (ev) => { ev.stopPropagation(); });
  return { el: wrap, setValue: (v) => setValue(v, false) };
}

// ---- stepper ([-] value [+] with wheel + hold-repeat) -----------------------
function buildStepper(label, get, set, min, max) {
  const wrap = h('div', 'stepper');
  wrap.appendChild(h('span', 'steplabel', label));
  const dec = h('button', 'sbtn', '−');
  // Clamp the DISPLAYED value into [min,max]: accent hits/rotation are stored independent of the
  // live onset count, so after lowering k the raw get() can exceed the stepper's own max (=onsets).
  const val = h('span', 'sval', String(clampInt(get(), min(), max())));
  const inc = h('button', 'sbtn', '+');
  const apply = (nv) => { const c = clampInt(nv, min(), max()); val.textContent = String(c); set(c); };
  dec.addEventListener('click', () => apply(get() - 1));
  inc.addEventListener('click', () => apply(get() + 1));
  wrap.addEventListener('wheel', (ev) => { ev.preventDefault(); apply(get() + (ev.deltaY < 0 ? 1 : -1)); }, { passive: false });
  wrap.append(dec, val, inc);
  return wrap;
}

export function createControls(root, handlers) {
  root.innerHTML = '';

  // --- transport (persistent) ---
  const transport = h('div', 'panel transport');
  const playBtn = h('button', 'play', '▶');
  playBtn.setAttribute('aria-label', 'Play');
  playBtn.addEventListener('click', () => handlers.onPlayToggle());

  const dial = buildDial(MIN_BPM, MAX_BPM, (v) => handlers.onBpm(v), () => {});
  const dialCol = h('div', 'dialcol');
  dialCol.append(dial.el, h('div', 'caps', 'BPM'));

  const rightCol = h('div', 'tcol');
  const meterField = h('label', 'field');
  meterField.appendChild(h('span', 'caps', 'Meter'));
  const meterSel = h('select', 'sel');
  TIME_SIGS.forEach((m, i) => { const o = h('option', null, m.label); o.value = String(i); meterSel.appendChild(o); });
  meterSel.addEventListener('change', () => handlers.onTimeSig(parseInt(meterSel.value, 10)));
  meterField.appendChild(meterSel);

  const swingField = h('label', 'field');
  swingField.appendChild(h('span', 'caps', 'Swing'));
  const swing = h('input', 'range');
  swing.type = 'range'; swing.min = '0'; swing.max = String(SWING_MAX); swing.step = '0.01'; swing.value = '0';
  swing.addEventListener('input', () => handlers.onSwing(parseFloat(swing.value)));
  swingField.appendChild(swing);

  const posScreen = h('div', 'screen pos');
  posScreen.textContent = '1.1';
  rightCol.append(meterField, swingField, posScreen);

  transport.append(playBtn, dialCol, rightCol);
  root.appendChild(transport);

  // --- lane list ---
  const lanePanel = h('div', 'panel');
  lanePanel.appendChild(h('div', 'caps', 'Lanes'));
  const laneList = h('div', 'lanelist');
  const addBtn = h('button', 'btn wide', '+ Add lane');
  addBtn.addEventListener('click', () => handlers.onAddLane());
  lanePanel.append(laneList, addBtn);
  root.appendChild(lanePanel);

  // --- inspector ---
  const inspector = h('div', 'panel inspector');
  root.appendChild(inspector);

  function renderLaneList(pattern, selected) {
    laneList.innerHTML = '';
    (pattern.lanes || []).forEach((lane, i) => {
      const row = h('div', 'lanerow' + (i === selected ? ' active' : ''));
      row.style.setProperty('--lh', `var(--lane-${(i % 5) + 1})`);
      const swatch = h('span', 'swatch');
      const name = h('button', 'lanename');
      const p = (lane.generator && lane.generator.params) || {};
      name.innerHTML = `<b>${LANE_LABELS[lane.voice] || lane.voice}</b> <span class="dim">E(${p.k},${p.n})</span>`;
      name.addEventListener('click', () => handlers.onSelectLane(i));
      const m = h('button', 'tsarm' + (lane.mute ? ' on' : ''), 'M');
      m.addEventListener('click', () => handlers.onMute(i));
      const s = h('button', 'tsarm' + (lane.solo ? ' on' : ''), 'S');
      s.addEventListener('click', () => handlers.onSolo(i));
      row.append(swatch, name, m, s);
      laneList.appendChild(row);
    });
    addBtn.style.display = (pattern.lanes || []).length >= MAX_LANES ? 'none' : '';
  }

  function renderInspector(pattern, selected) {
    inspector.innerHTML = '';
    const lane = (pattern.lanes || [])[selected];
    if (!lane) {
      inspector.appendChild(h('div', 'caps', 'Inspector'));
      inspector.appendChild(h('div', 'dim', 'Add a lane, then select it to edit.'));
      return;
    }
    const p = lane.generator.params;
    const ring = euclidRotated(p.k, p.n, p.rotation);
    inspector.appendChild(h('div', 'caps', `${LANE_LABELS[lane.voice] || lane.voice}  ·  E(${p.k},${p.n})  (${intervalVector(ring).join('')})`));

    // voice picker
    const vf = h('label', 'field');
    vf.appendChild(h('span', 'caps', 'Voice'));
    const vsel = h('select', 'sel');
    VOICES.forEach((v) => { const o = h('option', null, v.label); o.value = v.id; if (v.id === lane.voice) o.selected = true; vsel.appendChild(o); });
    vsel.addEventListener('change', () => handlers.onVoice(selected, vsel.value));
    vf.appendChild(vsel);
    inspector.appendChild(vf);

    // steppers
    const steps = h('div', 'steprow');
    steps.appendChild(buildStepper('Steps', () => lane.generator.params.n, (v) => handlers.onN(selected, v), () => MIN_STEPS, () => MAX_STEPS));
    steps.appendChild(buildStepper('Hits', () => lane.generator.params.k, (v) => handlers.onK(selected, v), () => 0, () => lane.generator.params.n));
    steps.appendChild(buildStepper('Rotate', () => lane.generator.params.rotation, (v) => handlers.onRotation(selected, v), () => 0, () => lane.generator.params.n - 1));
    inspector.appendChild(steps);

    // gain (live; does not re-render)
    const gf = h('label', 'field');
    gf.appendChild(h('span', 'caps', 'Gain'));
    const g = h('input', 'range'); g.type = 'range'; g.min = '0'; g.max = '1.5'; g.step = '0.01'; g.value = String(lane.gain);
    g.addEventListener('input', () => handlers.onGain(selected, parseFloat(g.value)));
    gf.appendChild(g);
    inspector.appendChild(gf);

    // accent
    const acc = h('div', 'accentbox');
    const accTop = h('label', 'checkline');
    const accChk = h('input'); accChk.type = 'checkbox'; accChk.checked = !!lane.accent.enabled;
    accChk.addEventListener('change', () => handlers.onAccentToggle(selected, accChk.checked));
    accTop.append(accChk, h('span', 'caps', 'Accents'));
    acc.appendChild(accTop);
    if (lane.accent.enabled) {
      const onsetCount = ring.filter(Boolean).length;
      const arow = h('div', 'steprow');
      arow.appendChild(buildStepper('Accent hits', () => lane.accent.hits, (v) => handlers.onAccentHits(selected, v), () => 0, () => onsetCount));
      arow.appendChild(buildStepper('Accent rot', () => lane.accent.rotation, (v) => handlers.onAccentRotation(selected, v), () => 0, () => Math.max(0, onsetCount - 1)));
      acc.appendChild(arow);
      const df = h('label', 'field');
      df.appendChild(h('span', 'caps', 'Ghost depth'));
      const d = h('input', 'range'); d.type = 'range'; d.min = '0'; d.max = '1'; d.step = '0.01'; d.value = String(lane.accentDepth);
      d.addEventListener('input', () => handlers.onAccentDepth(selected, parseFloat(d.value)));
      df.appendChild(d);
      acc.appendChild(df);
    }
    inspector.appendChild(acc);

    // mute / solo / remove
    const btns = h('div', 'inspbtns');
    const mBtn = h('button', 'tsarm' + (lane.mute ? ' on' : ''), 'Mute');
    mBtn.addEventListener('click', () => handlers.onMute(selected));
    const sBtn = h('button', 'tsarm' + (lane.solo ? ' on' : ''), 'Solo');
    sBtn.addEventListener('click', () => handlers.onSolo(selected));
    const rm = h('button', 'btn danger', 'Remove');
    let armed = false, armTimer = null;
    rm.addEventListener('click', () => {
      if (!armed) { armed = true; rm.textContent = 'Tap again to remove'; rm.classList.add('armed'); armTimer = setTimeout(() => { armed = false; rm.textContent = 'Remove'; rm.classList.remove('armed'); }, 2500); }
      else { clearTimeout(armTimer); handlers.onRemoveLane(selected); }
    });
    btns.append(mBtn, sBtn, rm);
    inspector.appendChild(btns);
  }

  function render(pattern, selected, isPlaying) {
    dial.setValue(pattern.bpm);
    meterSel.value = String(pattern.timeSigIndex);
    swing.value = String(pattern.swing || 0);
    playBtn.classList.toggle('on', !!isPlaying);
    playBtn.innerHTML = isPlaying ? '&#9632;' : '&#9654;';
    renderLaneList(pattern, selected);
    renderInspector(pattern, selected);
  }

  function setPosition(text) { posScreen.textContent = text; }
  function setPlaying(isPlaying) { playBtn.classList.toggle('on', !!isPlaying); playBtn.innerHTML = isPlaying ? '&#9632;' : '&#9654;'; }

  return { render, setPosition, setPlaying };
}
