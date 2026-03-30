/**
 * Touch "envelope" math: contact radius, attack velocity, sustain jitter, dwell.
 * DOM-free — reuse in other projects with your own event wiring and canvas.
 */

export const ATTACK_MS = 150;
export const MIN_TRUSTED_RADIUS = 3;

/** Dwell: extra half-length (px) at saturation. */
export const DWELL_HALF_LEN_SATURATION_MS = 4000;
export const DWELL_HALF_LEN_MAX_BONUS = 40;

/** Dwell: extra line width at saturation. */
export const DWELL_LINE_WIDTH_SATURATION_MS = 4000;
export const DWELL_LINE_WIDTH_MAX_BONUS = 8;

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

/**
 * Calculate effective radius using base contact area + force (pressure)
 * iOS provides radiusX/Y (contact area) and force (pressure 0-1)
 * We scale the radius based on force to show pressure changes
 */
export function radiusWithForce(baseRadius, force) {
  if (force === null || force === undefined || force <= 0) {
    return baseRadius;
  }
  // Map force (0-1) to radius scale (0.5x to 2x)
  // Typical light touch: ~0.3, normal: ~0.5-0.7, hard press: ~1.0
  const scale = 0.5 + (force * 1.5); // 0.5 at force=0, 2.0 at force=1
  return baseRadius * scale;
}

/** Fake radius curve for mouse / pointer when real geometry is unusable. */
// Desktop/pointer functions removed - touch-only app now

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

/** 0..1 from sustain-only time (after ATTACK_MS). */
export function dwellNormHalfLen(pressMs) {
  const sustainMs = Math.max(0, pressMs - ATTACK_MS);
  return Math.min(1, sustainMs / DWELL_HALF_LEN_SATURATION_MS);
}

export function dwellNormLineWidth(pressMs) {
  const sustainMs = Math.max(0, pressMs - ATTACK_MS);
  return Math.min(1, sustainMs / DWELL_LINE_WIDTH_SATURATION_MS);
}

export function crosshairHalfLength(radius, pressMs) {
  return radius; // No dwell bonus - crosshair size equals actual radius
}

export function lineWidthFromAttackAndDwell(attackVelocity, pressMs, lockedAttackWidth) {
  const base =
    lockedAttackWidth != null ? lockedAttackWidth : lineWidthFromAttackVelocity(attackVelocity);
  return Math.min(24, base); // No dwell bonus - line width from attack only
}

/**
 * Per-frame scalars for hosts (CSS vars, canvas). `active` must have samples, t0, r0, peakR, tPeak, x0, y0, currentRadius.
 */
export function liveGestureState(active, now) {
  const pressMs = now - active.t0;
  const attackEnd = active.t0 + ATTACK_MS;
  const phase = now < attackEnd ? 'attack' : 'sustain';
  const av = attackVelocityFromSamples(active.samples, active.t0, active.r0, attackEnd);
  const tPeak = active.tPeak !== undefined ? active.tPeak : active.t0;
  const msToPeakSoFar = tPeak - active.t0;
  return {
    pressMs,
    phase,
    currentRadius: active.currentRadius,
    peakRadius: active.peakR,
    msToPeakSoFar,
    dwellNormHalfLen: dwellNormHalfLen(pressMs),
    dwellNormLineWidth: dwellNormLineWidth(pressMs),
    coordinates: { x: active.x0, y: active.y0 },
    attackVelocity: av,
    sustainJitter: sustainJitterFromSamples(active.samples, attackEnd),
    t0: active.t0
  };
}

export function gestureStartMilestone(active) {
  return {
    kind: 'start',
    tMs: 0,
    t: active.t0,
    x: active.x0,
    y: active.y0,
    r: active.r0
  };
}

/**
 * New milestones since last call. Mutates `active` milestone bookkeeping only.
 * Call after updating `peakR`, `tPeak`, `currentRadius` from samples.
 */
export function diffLiveMilestones(active, now) {
  const out = [];
  const attackEnd = active.t0 + ATTACK_MS;

  if (!active._milestoneAttackEndEmitted && now >= attackEnd) {
    active._milestoneAttackEndEmitted = true;
    out.push({
      kind: 'attackEnd',
      tMs: ATTACK_MS,
      t: attackEnd,
      x: active.x0,
      y: active.y0,
      r: active.currentRadius
    });
  }

  if (active.peakR > active._milestoneLastPeakR) {
    active._milestoneLastPeakR = active.peakR;
    out.push({
      kind: 'peakRadius',
      tMs: active.tPeak - active.t0,
      t: active.tPeak,
      x: active.x0,
      y: active.y0,
      r: active.peakR
    });
  }

  return out;
}

/**
 * Final gesture report for JSON. Appends `release` to `keyframes` (ordered live milestones + release).
 */
export function buildGestureReport(active, tEnd, keyframes) {
  const attackEnd = active.t0 + ATTACK_MS;
  const finalAttack = attackVelocityFromSamples(active.samples, active.t0, active.r0, attackEnd);
  const pressDurationMs = tEnd - active.t0;
  const tPeak = active.tPeak !== undefined ? active.tPeak : active.t0;
  const msToPeakRadius = tPeak - active.t0;
  const msFromPeakToRelease = tEnd - tPeak;
  const releaseMilestone = {
    kind: 'release',
    tMs: pressDurationMs,
    t: tEnd,
    x: active.x0,
    y: active.y0,
    r: active.currentRadius
  };
  const allKeyframes = (keyframes || []).concat([releaseMilestone]);

  // Calculate path metrics
  let totalDistance = 0;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (let i = 0; i < active.samples.length; i++) {
    const s = active.samples[i];
    if (s.x !== undefined && s.y !== undefined) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);

      if (i > 0) {
        const prev = active.samples[i - 1];
        if (prev.x !== undefined && prev.y !== undefined) {
          const dx = s.x - prev.x;
          const dy = s.y - prev.y;
          totalDistance += Math.sqrt(dx * dx + dy * dy);
        }
      }
    }
  }

  return {
    peakRadius: active.peakR,
    attackVelocity: finalAttack,
    coordinates: { x: active.x0, y: active.y0 },
    pressDurationMs,
    msToPeakRadius,
    msFromPeakToRelease,
    sustainJitter: sustainJitterFromSamples(active.samples, attackEnd),
    dwellNormAtEnd: dwellNormHalfLen(pressDurationMs),
    keyframes: allKeyframes,
    path: {
      samples: active.samples,
      totalDistance: totalDistance,
      boundingBox: {
        minX: minX,
        maxX: maxX,
        minY: minY,
        maxY: maxY
      }
    }
  };
}

/**
 * @deprecated Use buildGestureReport(active, tEnd, keyframes) for full output.
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
