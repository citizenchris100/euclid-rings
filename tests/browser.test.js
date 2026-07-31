// tests/browser.test.js — the browser-layer suite the node harness deliberately can't cover.
// Exercises the IMPURE modules (controlsPanel, ringView, stores, presetStore) against a REAL
// DOM + REAL CSS, plus the click-safety of `hidden`-toggled elements (the reported bug, proven
// behaviorally via getComputedStyle rather than by parsing the source). Load tests/browser.test.html
// in Chrome; results land in #summary, #log, and window.__RESULTS__ (for automation to read).
//
// Modules are imported by absolute path (/js/...) so they resolve from server root regardless of
// where this file lives; presetStore's relative fetch('./presets/...') resolves via <base href="/">.

import { createControls } from '/js/controlsPanel.js';
import { createRingView } from '/js/ringView.js';
import { laneAudible } from '/js/player.js';
import { savePattern, loadPattern, clearPattern } from '/js/patternStore.js';
import { loadPresets, groupByGenre } from '/js/presetStore.js';
import { GENRES } from '/js/presetModel.js';
import { normalizePattern, defaultPattern } from '/js/patternModel.js';
import { onsetIndices, euclidRotated } from '/js/euclid.js';

const R = { pass: 0, fail: 0, failures: [] };
const logEl = document.getElementById('log');
function line(txt, good) { const d = document.createElement('div'); d.className = good ? 'ok' : 'bad'; d.textContent = (good ? '  ok  ' : ' FAIL ') + txt; logEl.appendChild(d); }
function ok(label, cond) { if (cond) { R.pass++; line(label, true); } else { R.fail++; R.failures.push(label); line(label, false); } }
function eq(label, got, want) { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { R.pass++; line(label, true); } else { R.fail++; R.failures.push(`${label} | got ${g} want ${w}`); line(`${label} | got ${g} want ${w}`, false); } }
function approx(label, got, want, eps = 1) { if (Number.isFinite(got) && Math.abs(got - want) <= eps) { R.pass++; line(label, true); } else { R.fail++; R.failures.push(`${label} | got ${got} want ~${want}`); line(`${label} | got ${got} want ~${want}`, false); } }
async function section(name, fn) { try { await fn(); } catch (e) { R.fail++; R.failures.push(`${name} threw: ${e && e.message}`); line(`${name} threw: ${e && e.stack || e}`, false); } }

const mount = document.getElementById('mount');
function freshRoot() { const d = document.createElement('div'); mount.appendChild(d); return d; }
// A handlers object that records every call.
function spyHandlers() {
  const calls = {};
  const names = ['onPlayToggle', 'onBpm', 'onSwing', 'onTimeSig', 'onSelectLane', 'onAddLane', 'onRemoveLane', 'onVoice', 'onN', 'onK', 'onRotation', 'onGain', 'onMute', 'onSolo', 'onAccentToggle', 'onAccentHits', 'onAccentRotation', 'onAccentDepth', 'onRotate'];
  const h = {};
  for (const n of names) { calls[n] = []; h[n] = (...a) => calls[n].push(a); }
  return { h, calls };
}
const twoLane = () => normalizePattern({
  bpm: 120, timeSigIndex: 2, swing: 0, lanes: [
    { voice: 'kick', gain: 1, generator: { type: 'euclidean', params: { k: 4, n: 8, rotation: 0 } } },
    { voice: 'snare', gain: 1, generator: { type: 'euclidean', params: { k: 3, n: 8, rotation: 0 } } },
  ],
});
const stepperByLabel = (rootEl, label) => [...rootEl.querySelectorAll('.stepper')].find((s) => s.querySelector('.steplabel')?.textContent === label);
const incOf = (st) => st.querySelectorAll('.sbtn')[1];
const decOf = (st) => st.querySelectorAll('.sbtn')[0];

// ============================================================================
// A. Click-safety of `hidden`-toggled elements (the reported bug, proven live).
// ============================================================================
await section('A. hidden/overlay click-safety', async () => {
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.hidden = true; ov.style.zIndex = '9999';
  document.body.appendChild(ov);
  ok('A1 .overlay[hidden] computes display:none (not flex)', getComputedStyle(ov).display === 'none');
  // With it hidden, a click at viewport center must NOT land on the overlay.
  const cx = Math.round(innerWidth / 2), cy = Math.round(innerHeight / 2);
  ok('A2 hidden overlay does not intercept center clicks', document.elementFromPoint(cx, cy) !== ov);
  // Shown, it becomes a real flex layer that DOES cover (this is the intended, working behavior).
  ov.hidden = false;
  ok('A3 shown .overlay computes display:flex', getComputedStyle(ov).display === 'flex');
  ok('A4 shown overlay covers the viewport center', document.elementFromPoint(cx, cy) === ov || ov.contains(document.elementFromPoint(cx, cy)));
  ov.remove();
  // A .status element toggled the same way must also collapse.
  const st = document.createElement('div'); st.className = 'status'; st.hidden = true; st.textContent = 'x';
  document.body.appendChild(st);
  ok('A5 .status[hidden] computes display:none', getComputedStyle(st).display === 'none');
  st.remove();
});

// ============================================================================
// B. controlsPanel — the transport/lane-list/inspector wiring.
// ============================================================================
await section('B. controlsPanel wiring', async () => {
  const root = freshRoot();
  const { h, calls } = spyHandlers();
  const controls = createControls(root, h);
  const pat = twoLane();
  controls.render(pat, 0, false);

  // structure
  eq('B1 one lane row per lane', root.querySelectorAll('.lanerow').length, 2);
  ok('B2 selected lane row marked active', root.querySelectorAll('.lanerow')[0].classList.contains('active'));
  ok('B3 inspector rendered for the selected lane', !!root.querySelector('.inspector .steprow'));

  // transport
  root.querySelector('.play').click();
  eq('B4 play button -> onPlayToggle', calls.onPlayToggle.length, 1);

  const meter = root.querySelector('.transport select.sel');
  meter.value = '0'; meter.dispatchEvent(new Event('change'));
  eq('B5 meter select -> onTimeSig(0)', calls.onTimeSig.at(-1), [0]);

  const swing = root.querySelector('.transport input.range');
  swing.value = '0.4'; swing.dispatchEvent(new Event('input'));
  approx('B6 swing slider -> onSwing(~0.4)', calls.onSwing.at(-1)?.[0], 0.4, 1e-6);

  // lane list select + mute/solo
  root.querySelectorAll('.lanerow')[1].querySelector('.lanename').click();
  eq('B7 lane name click -> onSelectLane(1)', calls.onSelectLane.at(-1), [1]);
  root.querySelectorAll('.lanerow')[0].querySelectorAll('.tsarm')[0].click();
  eq('B8 lane-row M -> onMute(0)', calls.onMute.at(-1), [0]);
  root.querySelectorAll('.lanerow')[0].querySelectorAll('.tsarm')[1].click();
  eq('B9 lane-row S -> onSolo(0)', calls.onSolo.at(-1), [0]);

  // add lane
  root.querySelector('.btn.wide').click();
  eq('B10 + Add lane -> onAddLane', calls.onAddLane.length, 1);

  // inspector steppers on lane 0 (k=4, n=8, rotation=0)
  const insp = root.querySelector('.inspector');
  incOf(stepperByLabel(insp, 'Steps')).click();
  eq('B11 Steps + -> onN(0, 9)', calls.onN.at(-1), [0, 9]);
  decOf(stepperByLabel(insp, 'Steps')).click();
  eq('B12 Steps - -> onN(0, 7)', calls.onN.at(-1), [0, 7]);
  incOf(stepperByLabel(insp, 'Hits')).click();
  eq('B13 Hits + -> onK(0, 5)', calls.onK.at(-1), [0, 5]);
  incOf(stepperByLabel(insp, 'Rotate')).click();
  eq('B14 Rotate + -> onRotation(0, 1)', calls.onRotation.at(-1), [0, 1]);

  // voice + gain
  const vsel = insp.querySelector('select.sel');
  vsel.value = 'closedHat'; vsel.dispatchEvent(new Event('change'));
  eq('B15 voice select -> onVoice(0, closedHat)', calls.onVoice.at(-1), [0, 'closedHat']);
  const gain = insp.querySelector('input.range');
  gain.value = '0.5'; gain.dispatchEvent(new Event('input'));
  approx('B16 gain slider -> onGain(~0.5)', calls.onGain.at(-1)?.[1], 0.5, 1e-6);

  // remove requires arming (two clicks)
  const rm = insp.querySelector('.btn.danger');
  rm.click();
  eq('B17 first Remove click does NOT remove (arming)', calls.onRemoveLane.length, 0);
  rm.click();
  eq('B18 second Remove click -> onRemoveLane(0)', calls.onRemoveLane.at(-1), [0]);
});

// ============================================================================
// B'. Stepper clamp bounds — the Hits/Rotate maxima must track n (stale-closure risk).
// ============================================================================
await section("B'. stepper clamp bounds", async () => {
  const root = freshRoot();
  const { h, calls } = spyHandlers();
  const controls = createControls(root, h);
  // lane where k == n and rotation == n-1: '+' must clamp, not overflow.
  const pat = normalizePattern({ timeSigIndex: 2, lanes: [{ voice: 'kick', generator: { type: 'euclidean', params: { k: 8, n: 8, rotation: 7 } } }] });
  controls.render(pat, 0, false);
  const insp = root.querySelector('.inspector');
  incOf(stepperByLabel(insp, 'Hits')).click();
  eq("B'1 Hits + at k==n clamps to n (8), not 9", calls.onK.at(-1), [0, 8]);
  incOf(stepperByLabel(insp, 'Rotate')).click();
  eq("B'2 Rotate + at rotation==n-1 clamps to n-1 (7), not 8", calls.onRotation.at(-1), [0, 7]);
  // Steps + at n==32 (MAX) clamps.
  const pat2 = normalizePattern({ timeSigIndex: 2, lanes: [{ voice: 'kick', generator: { type: 'euclidean', params: { k: 2, n: 32, rotation: 0 } } }] });
  controls.render(pat2, 0, false);
  incOf(stepperByLabel(root.querySelector('.inspector'), 'Steps')).click();
  eq("B'3 Steps + at n==32 (MAX) clamps to 32", calls.onN.at(-1), [0, 32]);
});

// ============================================================================
// C. ringView — geometry, dot counts, selection, drag-rotate, placeholder.
// ============================================================================
await section('C. ringView render + interaction', async () => {
  const root = freshRoot();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'rings stage-svg');
  root.appendChild(svg);
  const hub = document.createElement('div'); root.appendChild(hub);
  const { h, calls } = spyHandlers();
  const view = createRingView(svg, hub, h);

  const pat = twoLane(); // lane0 k4n8, lane1 k3n8
  view.render(pat, 0);

  const totalOnsets = onsetIndices(euclidRotated(4, 8, 0)).length + onsetIndices(euclidRotated(3, 8, 0)).length;
  eq('C1 onset dots == total onsets (4+3)', svg.querySelectorAll('.dot.onset').length, totalOnsets);
  eq('C2 total dots == sum of n (8+8)', svg.querySelectorAll('.dot').length, 16);
  eq('C3 one baseline ring per lane', svg.querySelectorAll('.baseline').length, 2);
  ok('C4 a playhead was drawn', !!svg.querySelector('.playhead'));

  // slot 0 sits at 12 o'clock: cx == CX(500), cy < CY(500).
  const d0 = svg.querySelector('.dot.onset[data-lane="0"][data-slot="0"]');
  approx('C5 slot0 dot x == center (500)', parseFloat(d0.getAttribute('cx')), 500, 0.5);
  ok('C6 slot0 dot y above center', parseFloat(d0.getAttribute('cy')) < 500);

  // click a NON-selected lane's hit wedge -> onSelectLane(that lane)
  const hit1 = svg.querySelector('.hit[data-lane="1"]');
  hit1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, clientX: 0, clientY: 0 }));
  eq('C7 pointerdown on lane 1 -> onSelectLane(1)', calls.onSelectLane.at(-1), [1]);

  // firePulse flashes the right dot
  view.firePulse(0, 0);
  ok('C8 firePulse adds .fire to lane0/slot0', d0.classList.contains('fire'));

  // placeholder when no lanes
  view.render(normalizePattern({ lanes: [] }), -1);
  ok('C9 zero lanes -> placeholder drawn', !!svg.querySelector('.placeholder'));
  eq('C10 zero lanes -> no lane groups', svg.querySelectorAll('.lane').length, 0);

  // drag the ACTIVE ring (lane 0) clockwise by just over one slot -> onRotate(0, +1)
  view.render(pat, 0);
  const rect = svg.getBoundingClientRect();
  const ccx = rect.left + rect.width / 2, ccy = rect.top + rect.height / 2;
  const Rr = rect.width * 0.35;
  const at = (deg) => [ccx + Rr * Math.cos(deg * Math.PI / 180), ccy + Rr * Math.sin(deg * Math.PI / 180)];
  const [x0, y0] = at(0);
  const anyHit0 = svg.querySelector('.hit[data-lane="0"]');
  anyHit0.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 2, clientX: x0, clientY: y0 }));
  const [x1, y1] = at(50); // +50deg clockwise (screen y-down) > one 45deg step for n=8
  svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 2, clientX: x1, clientY: y1 }));
  svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 2, clientX: x1, clientY: y1 }));
  ok('C11 dragging the active ring +1 slot -> onRotate(0, +1)', calls.onRotate.some((a) => a[0] === 0 && a[1] === 1));
});

// ============================================================================
// D. patternStore — persistence round-trip + corrupt-payload safety.
// ============================================================================
await section('D. patternStore', async () => {
  clearPattern();
  ok('D1 empty store loads null', loadPattern() === null);
  const pat = twoLane();
  savePattern(pat);
  const back = loadPattern();
  eq('D2 saved pattern round-trips (bpm)', back.bpm, 120);
  eq('D3 saved pattern round-trips (lane count)', back.lanes.length, 2);
  eq('D4 saved pattern round-trips (kick onsets)', onsetIndices(euclidRotated(back.lanes[0].generator.params.k, back.lanes[0].generator.params.n, 0)), [0, 2, 4, 6]);
  // Corrupt payload must NOT throw and must yield null.
  localStorage.setItem('euc:pattern', '{ not valid json ');
  let threw = false, val;
  try { val = loadPattern(); } catch { threw = true; }
  ok('D5 corrupt payload does not throw', !threw);
  ok('D6 corrupt payload loads null', val === null);
  // Old/partial payload upgrades via normalize (missing swing -> 0).
  localStorage.setItem('euc:pattern', JSON.stringify({ bpm: 90, lanes: [] }));
  const up = loadPattern();
  eq('D7 partial payload normalized (swing defaulted)', up.swing, 0);
  eq('D8 partial payload normalized (schemaVersion stamped)', up.schemaVersion, 1);
  clearPattern();
});

// ============================================================================
// E. presetStore — grouping order + live catalog load (needs the real files).
// ============================================================================
await section('E. presetStore', async () => {
  const grouped = groupByGenre([{ genre: 'rock', name: 'a' }, { genre: 'pop', name: 'b' }, { genre: 'rock', name: 'c' }, { genre: 'zzz', name: 'x' }]);
  eq('E1 groupByGenre keys are GENRES in order', Object.keys(grouped), GENRES);
  eq('E2 rock got both rock presets', grouped.rock.length, 2);
  eq('E3 unknown genre dropped', 'zzz' in grouped, false);
  // Live load of the bundled catalog (served from the same origin).
  const presets = await loadPresets();
  eq('E4 loadPresets returns all 12', presets.length, 12);
  ok('E5 every loaded preset has a name and lanes', presets.every((p) => p.name && Array.isArray(p.lanes) && p.lanes.length));
});

// ============================================================================
// F. player.laneAudible — the mute/solo gate the onset visual pulse now respects.
// ============================================================================
await section('F. player.laneAudible (visual-pulse gate)', async () => {
  const p = twoLane();
  ok('F1 no mute/solo -> both audible', laneAudible(p, 0) && laneAudible(p, 1));
  const muted = normalizePattern({ ...p, lanes: p.lanes.map((l, i) => (i === 1 ? { ...l, mute: true } : l)) });
  ok('F2 muted lane not audible', laneAudible(muted, 1) === false);
  ok('F3 non-muted lane still audible', laneAudible(muted, 0) === true);
  const soloed = normalizePattern({ ...p, lanes: p.lanes.map((l, i) => (i === 0 ? { ...l, solo: true } : l)) });
  ok('F4 soloed lane audible', laneAudible(soloed, 0) === true);
  ok('F5 non-soloed lane not audible', laneAudible(soloed, 1) === false);
  ok('F6 out-of-range index -> not audible', laneAudible(p, 9) === false);
});

// ============================================================================
// G. accent stepper display clamps to its own max after k is lowered.
// ============================================================================
await section('G. accent stepper display clamp', async () => {
  const root = freshRoot();
  const { h } = spyHandlers();
  const controls = createControls(root, h);
  // kick E(2,8) -> onsets [0,4] (count 2); accent hits=6, rotation=5 stored (independent of k).
  const pat = normalizePattern({ timeSigIndex: 2, lanes: [{ voice: 'kick', gain: 1, generator: { type: 'euclidean', params: { k: 2, n: 8, rotation: 0 } }, accent: { enabled: true, hits: 6, rotation: 5 }, accentDepth: 0.45 }] });
  controls.render(pat, 0, false);
  const insp = root.querySelector('.inspector');
  eq('G1 Accent hits display clamped to onset count (2)', stepperByLabel(insp, 'Accent hits').querySelector('.sval').textContent, '2');
  eq('G2 Accent rot display clamped to onsetCount-1 (1)', stepperByLabel(insp, 'Accent rot').querySelector('.sval').textContent, '1');
});

// ============================================================================
// H. overlay backdrop-close delegation (persistent, not {once:true}).
// ============================================================================
await section('H. overlay backdrop-close delegation', async () => {
  const ov = document.createElement('div'); ov.className = 'overlay';
  const panel = document.createElement('div'); panel.className = 'ovpanel';
  const card = document.createElement('button'); card.className = 'ovcard'; panel.appendChild(card);
  ov.appendChild(panel); document.body.appendChild(ov);
  let closes = 0;
  ov.addEventListener('click', (ev) => { if (ev.target === ov) closes++; });   // the fix
  card.dispatchEvent(new MouseEvent('click', { bubbles: true }));               // in-panel click bubbles up
  eq('H1 in-panel click does not close', closes, 0);
  ov.dispatchEvent(new MouseEvent('click', { bubbles: true }));                 // real backdrop click
  eq('H2 backdrop click closes even after an in-panel click', closes, 1);
  ov.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  eq('H3 backdrop close keeps working (not consumed)', closes, 2);
  ov.remove();
});

// ---- finish ----
const summary = document.getElementById('summary');
summary.className = R.fail ? 'fail' : 'pass';
summary.textContent = `${R.pass} passed, ${R.fail} failed`;
window.__RESULTS__ = R;
