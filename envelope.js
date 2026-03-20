/**
 * Touch "envelope" math: contact radius, attack velocity, sustain jitter.
 * DOM-free — reuse in other projects with your own event wiring and canvas.
 */

export const ATTACK_MS = 150;
export const MIN_TRUSTED_RADIUS = 3;

/**
 * Browsers often report tiny radiusX/Y (e.g. 0.5) — treat as unknown.
 */
export function clampContactRadius(r) {
  if (!isFinite(r) || r < MIN_TRUSTED_RADIUS) {
    return 22;
  }
  return r;
}

export function touchRadius(touch) {
  const rx = touch.radiusX || 0;
  const ry = touch.radiusY || 0;
  const r = (rx + ry) / 2;
  if (r <= 0) {
    return 22;
  }
  return clampContactRadius(r);
}

/** Fake radius curve for mouse / pointer when real geometry is unusable. */
export function syntheticRadius(now, t0) {
  const dt = Math.max(0, now - t0);
  if (dt <= ATTACK_MS) {
    return 22 + (dt / ATTACK_MS) * 10;
  }
  return 32 + 2.2 * Math.sin(now * 0.055);
}

export function radiusFromPointerEvent(e, now, t0) {
  if (e.pointerType === 'mouse') {
    return syntheticRadius(now, t0);
  }
  const w = e.width || 0;
  const h = e.height || 0;
  const geom = (w + h) / 4;
  if (geom >= MIN_TRUSTED_RADIUS) {
    return geom;
  }
  return syntheticRadius(now, t0);
}

export function attackVelocityFromSamples(samples, t0, r0, attackEnd) {
  let best = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.t > attackEnd) break;
    const dt = (s.t - t0) / 1000;
    if (dt <= 0.001) continue;
    const v = (s.r - r0) / dt;
    if (v > best) best = v;
  }
  return best;
}

export function sustainJitterFromSamples(samples, attackEnd) {
  const post = samples.filter(function (s) {
    return s.t >= attackEnd;
  });
  if (post.length < 3) return 0;
  const radii = post.map(function (s) {
    return s.r;
  });
  let sum = 0;
  for (let i = 0; i < radii.length; i++) sum += radii[i];
  const mean = sum / radii.length;
  let sq = 0;
  for (let i = 0; i < radii.length; i++) {
    const d = radii[i] - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / radii.length);
}

/** Stroke width from attack velocity (same mapping as the demo UI). */
export function lineWidthFromAttackVelocity(attackVelocity) {
  return Math.min(24, Math.max(1, 1 + attackVelocity * 0.08));
}

/**
 * Active gesture with samples, times, and position — e.g. your pointer/touch state.
 * Expects: peakR, samples, t0, r0, x0, y0
 */
export function finalizeEnvelopeOutput(active) {
  const attackEnd = active.t0 + ATTACK_MS;
  const finalAttack = attackVelocityFromSamples(active.samples, active.t0, active.r0, attackEnd);
  return {
    peakRadius: active.peakR,
    attackVelocity: finalAttack,
    coordinates: { x: active.x0, y: active.y0 }
  };
}
