// js/ringView.js — IMPURE SVG concentric-ring renderer. Up to 5 lanes drawn as rings, each
// divided into its own n slots (start at 12 o'clock, clockwise). Onsets are filled dots in the
// lane hue; accented onsets are larger/brighter; rests are hollow pegs. One shared playhead sweeps
// clockwise (constant speed); a slot flashes when its hit sounds. Slot geometry is stable (the
// euclidean n-gon), independent of swing, which only warps audio/playhead timing.
//
// SVG (not canvas): themeable via CSS vars with no redraw, native per-slot hit-testing, class-
// toggle state, crisp at any size via a unitless viewBox. ~340 nodes worst case (5x32) is trivial.

import { generatorRing } from './generators.js';
import { onsetIndices } from './euclid.js';
import { accentMask } from './accentModel.js';

const NS = 'http://www.w3.org/2000/svg';
const CX = 500, CY = 500, R_IN = 190, R_OUT = 470, GUTTER = 8;
const TAP_SLOP_DEG = 0;   // any angular travel on the active ring rotates

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
// point on the circle: angleDeg 0 = top (12 o'clock), increasing clockwise.
function polar(r, angleDeg) {
  const a = (angleDeg - 90) * Math.PI / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}
function slotAngle(i, n) { return (i / n) * 360; }

// Annular-sector path covering a whole slot wedge (the generous hit target).
function sectorPath(rInner, rOuter, a0, a1) {
  const [x0o, y0o] = polar(rOuter, a0);
  const [x1o, y1o] = polar(rOuter, a1);
  const [x1i, y1i] = polar(rInner, a1);
  const [x0i, y0i] = polar(rInner, a0);
  const large = (a1 - a0) % 360 > 180 ? 1 : 0;
  return `M ${x0o} ${y0o} A ${rOuter} ${rOuter} 0 ${large} 1 ${x1o} ${y1o}`
    + ` L ${x1i} ${y1i} A ${rInner} ${rInner} 0 ${large} 0 ${x0i} ${y0i} Z`;
}

export function createRingView(svg, hubEl, handlers = {}) {
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  let laneMeta = [];      // per lane: { r, n }
  let selected = -1;
  let playhead = null;

  function clear() { while (svg.firstChild) svg.removeChild(svg.firstChild); }

  function render(pattern, selectedLane) {
    selected = selectedLane;
    clear();
    laneMeta = [];
    const lanes = (pattern && pattern.lanes) || [];
    const count = lanes.length;

    if (count === 0) {
      svg.appendChild(el('circle', { class: 'placeholder', cx: CX, cy: CY, r: R_OUT }));
      svg.appendChild(el('circle', { class: 'hub', cx: CX, cy: CY, r: R_IN - 20 }));
      return;
    }

    const band = (R_OUT - R_IN) / count;
    for (let k = 0; k < count; k++) {
      const lane = lanes[k];
      const r = R_IN + band * (k + 0.5);
      const params = (lane.generator && lane.generator.params) || {};
      const n = params.n || 8;
      laneMeta.push({ r, n });
      const ring = generatorRing(lane.generator);
      const onsets = onsetIndices(ring);
      const mask = accentMask(onsets.length, lane.accent);
      const accentAt = new Set();
      onsets.forEach((slot, j) => { if (mask[j]) accentAt.add(slot); });

      const g = el('g', { class: 'lane' + (k === selected ? ' active' : ''), 'data-lane': k });
      g.style.setProperty('--lh', `var(--lane-${(k % 5) + 1})`);
      // baseline ring
      g.appendChild(el('circle', { class: 'baseline', cx: CX, cy: CY, r, 'vector-effect': 'non-scaling-stroke' }));
      const half = 180 / n;
      const rIn = r - band / 2 + GUTTER / 2;
      const rOut = r + band / 2 - GUTTER / 2;
      // Cap the dot so a single lane (huge band) doesn't balloon; shrink for dense rings.
      const dotR = Math.max(4, Math.min(26, band * 0.32 * Math.min(1, 16 / n)));
      for (let i = 0; i < n; i++) {
        const ang = slotAngle(i, n);
        // hit target (full wedge)
        g.appendChild(el('path', { class: 'hit', 'data-lane': k, 'data-slot': i, d: sectorPath(rIn, rOut, ang - half, ang + half) }));
        const [x, y] = polar(r, ang);
        const isOn = ring[i];
        const isAcc = accentAt.has(i);
        const cls = isOn ? (isAcc ? 'dot onset accent' : 'dot onset') : 'dot rest';
        const rr = isOn ? (isAcc ? dotR * 1.35 : dotR) : dotR * 0.45;
        g.appendChild(el('circle', { class: cls, 'data-lane': k, 'data-slot': i, cx: x, cy: y, r: rr }));
      }
      svg.appendChild(g);
    }

    svg.appendChild(el('circle', { class: 'hub', cx: CX, cy: CY, r: R_IN - 20 }));
    playhead = el('g', { class: 'playhead' });
    const [hx, hy] = polar(R_OUT + 6, 0);
    playhead.appendChild(el('line', { x1: CX, y1: CY - (R_IN - 24), x2: hx, y2: hy, 'vector-effect': 'non-scaling-stroke' }));
    playhead.appendChild(el('circle', { class: 'head', cx: hx, cy: hy, r: 9 }));
    svg.appendChild(playhead);
  }

  // Called every animation frame with the player's 0..1 phase.
  function tickPlayhead(phase) {
    if (playhead) playhead.setAttribute('transform', `rotate(${phase * 360} ${CX} ${CY})`);
  }

  // Flash a slot when its hit sounds.
  function firePulse(laneIndex, slot) {
    const dot = svg.querySelector(`.dot[data-lane="${laneIndex}"][data-slot="${slot}"]`);
    if (!dot) return;
    dot.classList.remove('fire');
    // force reflow so re-adding the class restarts the animation
    void dot.getBoundingClientRect();
    dot.classList.add('fire');
    setTimeout(() => dot.classList.remove('fire'), 150);
  }

  // ---- interaction: click a ring to select; drag the ACTIVE ring to rotate ----
  let dragLane = -1, lastAngle = 0, accumSteps = 0;
  function angleFromEvent(ev) {
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    return Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
  }
  svg.addEventListener('pointerdown', (ev) => {
    const hit = ev.target.closest('[data-lane]');
    if (!hit) return;
    const lane = parseInt(hit.getAttribute('data-lane'), 10);
    if (lane !== selected) { if (handlers.onSelectLane) handlers.onSelectLane(lane); return; }
    // active ring: begin drag-to-rotate
    dragLane = lane;
    lastAngle = angleFromEvent(ev);
    accumSteps = 0;
    try { svg.setPointerCapture(ev.pointerId); } catch { /* no active pointer (e.g. programmatic) */ }
  });
  svg.addEventListener('pointermove', (ev) => {
    if (dragLane < 0) return;
    const n = (laneMeta[dragLane] && laneMeta[dragLane].n) || 8;
    const stepDeg = 360 / n;
    const a = angleFromEvent(ev);
    let d = a - lastAngle;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    accumSteps += d;
    while (accumSteps >= stepDeg) { accumSteps -= stepDeg; if (handlers.onRotate) handlers.onRotate(dragLane, 1); }
    while (accumSteps <= -stepDeg) { accumSteps += stepDeg; if (handlers.onRotate) handlers.onRotate(dragLane, -1); }
    lastAngle = a;
  });
  const endDrag = (ev) => { if (dragLane >= 0) { try { svg.releasePointerCapture(ev.pointerId); } catch { /* ignore */ } dragLane = -1; } };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  return { render, tickPlayhead, firePulse };
}
