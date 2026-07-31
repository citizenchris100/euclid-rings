// js/euclid.js — PURE Bjorklund euclidean-rhythm primitive + rotation. No lane/voice/audio
// knowledge; just "distribute k onsets as evenly as possible across n steps." Node-importable
// so engine.test.js pins it exactly. Total: never throws, never loops forever, bounded output.
//
// `bjorklund` is the array-concatenation form of Bjorklund's algorithm (which Toussaint proves
// shares Euclid's GCD recursion), ported verbatim from the `euclidean-rhythms` npm library
// (mkontogiannis), TS types dropped. The canonical output always places an onset on index 0;
// `rotate` is how a lane turns that canonical necklace into the named world rhythms (Take Five,
// bossa, samba, ... are specific rotations of an E(k,n)).

// Array-concatenation Bjorklund. Returns number[] of 0/1, length `steps`, onset-at-0.
// Only called for 0 < pulses < steps; the trivial cases are short-circuited in `euclid`.
function bjorklund(pulses, steps) {
  let first = new Array(pulses).fill(0).map(() => [1]);
  let second = new Array(steps - pulses).fill(0).map(() => [0]);

  let firstLength = first.length;
  let minLength = Math.min(firstLength, second.length);

  let loopThreshold = 0;
  while (minLength > loopThreshold) {
    if (loopThreshold === 0) loopThreshold = 1;
    for (let x = 0; x < minLength; x++) first[x] = [...first[x], ...second[x]];
    if (minLength === firstLength) {
      second = second.slice(minLength);
    } else {
      second = first.slice(minLength);
      first = first.slice(0, minLength);
    }
    firstLength = first.length;
    minLength = Math.min(firstLength, second.length);
  }
  return [...first.flat(), ...second.flat()];
}

// euclid(k, n) -> boolean[] of length max(0,n). k<=0 -> all rests; k>=n -> all onsets; else the
// canonical Bjorklund necklace (onset on index 0). Fractional/NaN inputs are floored/coerced.
export function euclid(k, n) {
  const steps = Math.max(0, Math.floor(Number(n) || 0));
  if (steps === 0) return [];
  const pulses = Math.floor(Number(k) || 0);
  if (pulses <= 0) return new Array(steps).fill(false);
  if (pulses >= steps) return new Array(steps).fill(true);
  return bjorklund(pulses, steps).map((v) => v === 1);
}

// rotate(ring, r) -> boolean[]. Clockwise by r: the value at index i comes from (i - r) mod n,
// so the onset that was at 0 moves to index r. r is mod-normalized (negative and r>=n wrap).
export function rotate(ring, r) {
  const n = ring.length;
  if (n === 0) return [];
  const shift = ((Math.floor(Number(r) || 0) % n) + n) % n;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = ring[((i - shift) % n + n) % n];
  return out;
}

// euclidRotated(k, n, rotation) -> boolean[]. The lane-facing form.
export function euclidRotated(k, n, rotation) {
  return rotate(euclid(k, n), rotation || 0);
}

// onsetIndices(ring) -> number[]. Ascending indices where an onset sits.
export function onsetIndices(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) if (ring[i]) out.push(i);
  return out;
}

// intervalVector(ring) -> number[]. Cyclic gaps between successive onsets (sums to n). This is
// the rhythm's signature, e.g. E(3,8)=[3,3,2] -> "(332)" on the ring label. [] if no onsets;
// [n] if a single onset.
export function intervalVector(ring) {
  const n = ring.length;
  const on = onsetIndices(ring);
  if (on.length === 0) return [];
  const out = [];
  for (let i = 0; i < on.length; i++) {
    const next = i + 1 < on.length ? on[i + 1] : on[0] + n;
    out.push(next - on[i]);
  }
  return out;
}
