/**
 * Touch "envelope" math: contact radius, attack velocity, sustain jitter, dwell.
 * DOM-free — reuse in other projects with your own event wiring and canvas.
 *
 * iOS Safari Limitation: Real-time pressure tracking during touch movement is NOT possible.
 * - webkitForce returns 0.0 during all touchmove events (only available at touchstart)
 * - radiusX/Y are frozen at initial contact area throughout the gesture
 * - Pressure can only be captured once per touch at initial contact
 * - Different touches can have different pressures, but pressure cannot change during a touch
 *
 * Tested workarounds (all failed): stationary re-sampling, Pointer Events API, alternative Touch properties
 * For true pressure-sensitive drawing, use native iOS APIs (UITouch.force) or Apple Pencil with PencilKit.
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
 * Normalize force/pressure value to usable range.
 * Standard force: already 0-1, scale to 0-2
 * webkitForce: observed range ~5-70, normalize to 0-2
 */
export function normalizeForce(rawForce, isWebkit) {
  if (rawForce === null || rawForce === undefined || rawForce <= 0) {
    return 0;
  }

  if (isWebkit) {
    // webkitForce empirical range: ~5-10 light, ~40-70 hard
    // Map to 0-2 range: divide by 35, clamp to 2 max
    return Math.min(2, Math.max(0, rawForce / 35));
  }
  // Standard force is 0-1, scale to match webkit range (0-2)
  return Math.min(2, Math.max(0, rawForce * 2));
}

/**
 * Calculate effective radius using base contact area + force (pressure)
 * iOS provides radiusX/Y (contact area) and force (pressure)
 * We scale the radius based on normalized force to show pressure changes
 */
export function radiusWithForce(baseRadius, force) {
  if (force === null || force === undefined || force <= 0) {
    return baseRadius;
  }
  // Map normalized force (0-2) to radius scale (0.5x to 2.5x)
  // Light: 0.5 -> 0.75x, Normal: 1.0 -> 1.25x, Hard: 2.0 -> 2.25x
  const scale = 0.5 + (force * 0.75);
  return baseRadius * scale;
}

/**
 * Calculate velocity between two samples (px/sec)
 */
export function velocityBetweenSamples(s1, s0) {
  const dx = s1.x - s0.x;
  const dy = s1.y - s0.y;
  const dt = (s1.t - s0.t) / 1000; // seconds
  if (dt <= 0) return 0;
  return Math.sqrt(dx * dx + dy * dy) / dt;
}

/**
 * Constants for velocity-based size modulation
 */
export const VELOCITY_SLOW_THRESHOLD = 15; // px/sec - below this = "dwelling"
export const VELOCITY_FAST_THRESHOLD = 50; // px/sec - above this = "fast movement"
export const DWELL_GROWTH_RATE = 5; // px added per second when slow
export const FAST_DECAY_RATE = 10; // px removed per second when fast
export const MAX_VELOCITY_BONUS = 50; // px maximum growth from dwelling
export const MIN_VELOCITY_SCALE = 0.5; // minimum multiplier (can't shrink below 0.5x initial)

/**
 * Calculate velocity-based radius adjustment over time
 * Returns the delta to add to current radius based on velocity
 */
export function velocityRadiusDelta(velocity, dtSeconds) {
  if (velocity < VELOCITY_SLOW_THRESHOLD) {
    // Dwelling - grow radius
    return DWELL_GROWTH_RATE * dtSeconds;
  } else if (velocity > VELOCITY_FAST_THRESHOLD) {
    // Fast movement - shrink radius
    return -FAST_DECAY_RATE * dtSeconds;
  }
  // Medium velocity (15-50 px/sec) - no change
  return 0;
}

/**
 * Apply velocity-based radius modulation
 * @param {number} baseRadius - Initial radius from force
 * @param {number} velocityBonus - Accumulated bonus from dwelling (can be negative)
 * @returns {number} Final radius clamped to reasonable bounds
 */
export function radiusWithVelocityModulation(baseRadius, velocityBonus) {
  // Clamp velocity bonus to max range
  const clampedBonus = Math.max(-baseRadius * MIN_VELOCITY_SCALE,
                                 Math.min(MAX_VELOCITY_BONUS, velocityBonus));
  const finalRadius = baseRadius + clampedBonus;

  // Never go below 50% of base, never exceed base + max bonus
  return Math.max(baseRadius * MIN_VELOCITY_SCALE,
                  Math.min(baseRadius + MAX_VELOCITY_BONUS, finalRadius));
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
 * Calculate average velocity across all samples
 */
function calculateAverageVelocity(samples) {
  if (samples.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < samples.length; i++) {
    sum += velocityBetweenSamples(samples[i], samples[i - 1]);
  }
  return sum / (samples.length - 1);
}

/**
 * Calculate maximum velocity across all samples
 */
function calculateMaxVelocity(samples) {
  if (samples.length < 2) return 0;
  let max = 0;
  for (let i = 1; i < samples.length; i++) {
    const v = velocityBetweenSamples(samples[i], samples[i - 1]);
    if (v > max) max = v;
  }
  return max;
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
    velocityMetrics: {
      avgVelocity: calculateAverageVelocity(active.samples),
      maxVelocity: calculateMaxVelocity(active.samples),
      finalVelocityBonus: active.velocityBonus || 0
    },
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
