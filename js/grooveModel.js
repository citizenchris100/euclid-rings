// js/grooveModel.js — PURE swing/groove as a per-BEAT timeline warp. "Delay the off-beats" is
// undefined on euclidean rings of arbitrary length n (n=5,7,... have no even off-beat), so swing
// here warps the TIMELINE by beat position instead of touching onset indices. Every onset, on any
// lane, is warped by the same function of its position in the bar, so a 5-slot ring and a 16-slot
// ring swing consistently. Applied identically in playback (exact seconds) and export (ticks).
//
// The bar is split into `beats` (the meter numerator). Within each beat, the midpoint pivot moves
// later as swing rises: swing 0 -> pivot 0.5 (straight); swing ~0.667 -> pivot ~0.667 (triplet
// shuffle); swing 1 -> pivot 0.75 (dotted, extreme). Piecewise-linear on each side keeps it
// monotonic, with beat starts and ends fixed. This is an app-specific definition of swing, chosen
// so it generalizes to any ring length, not the classic 16th-note shuffle.

export const SWING_MAX = 1.0;

// warpFraction(f, beats, swing) -> f' : maps a bar-fraction f in [0,1) to a swung bar-fraction.
// Total: swing<=0 (or beats<1) is identity; endpoints of every beat are fixed points.
export function warpFraction(f, beats, swing) {
  const s = Math.max(0, Math.min(SWING_MAX, Number(swing) || 0));
  const b = Math.max(1, Math.floor(Number(beats) || 1));
  const x = Number(f) || 0;
  if (s <= 0) return x;
  const scaled = x * b;                 // position measured in beats
  const beatIndex = Math.floor(scaled);
  const p = scaled - beatIndex;         // local phase within the beat, [0,1)
  const pivot = 0.5 + s * 0.25;         // new location of the beat's midpoint
  const pp = p < 0.5
    ? p * (pivot / 0.5)
    : pivot + (p - 0.5) * ((1 - pivot) / 0.5);
  return (beatIndex + pp) / b;
}
