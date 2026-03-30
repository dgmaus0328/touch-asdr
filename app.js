import {
  ATTACK_MS,
  touchRadius,
  radiusWithForce,
  normalizeForce,
  attackVelocityFromSamples,
  sustainJitterFromSamples,
  buildGestureReport,
  lineWidthFromAttackVelocity,
  gestureStartMilestone,
  liveGestureState,
  diffLiveMilestones,
  crosshairHalfLength,
  lineWidthFromAttackAndDwell,
  velocityBetweenSamples,
  velocityRadiusDelta,
  radiusWithVelocityModulation,
  VELOCITY_SLOW_THRESHOLD,
  VELOCITY_FAST_THRESHOLD
} from './envelope.js';

(function () {
  'use strict';

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const hintEl = document.getElementById('hint');
  const modeLabelEl = document.getElementById('modeLabel');
  const radiusDisplayEl = document.getElementById('radiusDisplay');
  const radiusValueEl = document.getElementById('radiusValue');
  const radiusRawValueEl = document.getElementById('radiusRawValue');
  const forceValueEl = document.getElementById('forceValue');
  const root = document.documentElement;

  const CSS_TOUCH_VARS = [
    '--touch-press-ms',
    '--touch-phase',
    '--touch-current-radius',
    '--touch-peak-radius',
    '--touch-ms-to-peak',
    '--touch-dwell-norm-half',
    '--touch-dwell-norm-line',
    '--touch-x',
    '--touch-y',
    '--touch-attack-velocity',
    '--touch-current-velocity',
    '--touch-velocity-bonus'
  ];

  /** Canvas-local CSS pixels (matches drawing after DPR transform). */
  function canvasPointFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  /**
   * Convert velocity to thermal color (for Mode 6)
   * Slow movement = hot (red), fast movement = cool (blue)
   * @param {number} velocity - Current velocity in px/sec
   * @returns {Object} RGB color object {r, g, b}
   */
  function velocityToThermalColor(velocity) {
    // Color stops:
    // 0-10 px/sec: Red (hot, dwelling)
    // 10-30: Orange
    // 30-50: Yellow
    // 50-100: Light blue (cooling)
    // 100+: Dark blue (cold, fast)

    if (velocity < 10) {
      // Very slow - deep red
      return { r: 220, g: 40, b: 40 };
    } else if (velocity < 30) {
      // Slow - orange
      const t = (velocity - 10) / 20; // 0-1
      return {
        r: Math.round(220 - t * 20), // 220->200
        g: Math.round(40 + t * 80),  // 40->120
        b: 40
      };
    } else if (velocity < 50) {
      // Medium - yellow
      const t = (velocity - 30) / 20; // 0-1
      return {
        r: Math.round(200 - t * 20), // 200->180
        g: Math.round(120 + t * 80), // 120->200
        b: 40
      };
    } else if (velocity < 100) {
      // Fast - cooling to blue
      const t = (velocity - 50) / 50; // 0-1
      return {
        r: Math.round(180 - t * 140), // 180->40
        g: Math.round(200 - t * 100), // 200->100
        b: Math.round(40 + t * 180)   // 40->220
      };
    } else {
      // Very fast - deep blue
      return { r: 40, g: 100, b: 220 };
    }
  }

  /**
   * Interpolate between two colors
   * @param {Object} from - Starting color {r, g, b}
   * @param {Object} to - Target color {r, g, b}
   * @param {number} speed - Interpolation speed (0-1)
   * @returns {Object} Interpolated color {r, g, b}
   */
  function interpolateColor(from, to, speed) {
    return {
      r: Math.round(from.r + (to.r - from.r) * speed),
      g: Math.round(from.g + (to.g - from.g) * speed),
      b: Math.round(from.b + (to.b - from.b) * speed)
    };
  }

  /**
   * Convert color object to CSS string
   * @param {Object} color - Color object {r, g, b}
   * @returns {string} CSS rgb() string
   */
  function colorToString(color) {
    return 'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';
  }

  /**
   * Update movement state based on recent velocity
   * @param {Object} active - Active gesture object
   */
  function updateMovementState(active) {
    const VELOCITY_THRESHOLD = 15; // px/sec
    const samples = active.recentSamples;

    if (samples.length < 2) {
      active.movementState = 'stationary';
      return;
    }

    // Calculate average velocity from recent samples
    let totalDist = 0;
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].x - samples[i - 1].x;
      const dy = samples[i].y - samples[i - 1].y;
      totalDist += Math.sqrt(dx * dx + dy * dy);
    }

    const totalTime = samples[samples.length - 1].t - samples[0].t;
    const velocity = totalTime > 0 ? (totalDist / totalTime) * 1000 : 0; // px/sec

    active.movementState = velocity > VELOCITY_THRESHOLD ? 'moving' : 'stationary';
  }

  function applyTouchCssVars(live) {
    root.style.setProperty('--touch-press-ms', String(Math.round(live.pressMs)));
    root.style.setProperty('--touch-phase', live.phase);
    root.style.setProperty('--touch-current-radius', String(live.currentRadius.toFixed(2)));
    root.style.setProperty('--touch-peak-radius', String(live.peakRadius.toFixed(2)));
    root.style.setProperty('--touch-ms-to-peak', String(Math.round(live.msToPeakSoFar)));
    root.style.setProperty('--touch-dwell-norm-half', String(live.dwellNormHalfLen.toFixed(4)));
    root.style.setProperty('--touch-dwell-norm-line', String(live.dwellNormLineWidth.toFixed(4)));
    root.style.setProperty('--touch-x', String(live.coordinates.x.toFixed(2)));
    root.style.setProperty('--touch-y', String(live.coordinates.y.toFixed(2)));
    root.style.setProperty('--touch-attack-velocity', String(live.attackVelocity.toFixed(4)));
    root.style.setProperty('--touch-current-velocity', String((live.currentVelocity || 0).toFixed(2)));
    root.style.setProperty('--touch-velocity-bonus', String((live.velocityBonus || 0).toFixed(2)));
  }

  function clearTouchCssVars() {
    for (let i = 0; i < CSS_TOUCH_VARS.length; i++) {
      root.style.removeProperty(CSS_TOUCH_VARS[i]);
    }
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const ghosts = [];

  let active = null;
  let rafId = null;
  let hapticTimer = null;
  let lastHapticTune = 0;
  let visualizationMode = 1; // 1: Path+Crosshair, 2: Path only, 3: Path+Fixed, 4: Bubbles, 5: Radius Scale, 6: Thermal
  let lastGestureJSON = null; // Store last gesture for sharing
  let thermalCooldownTimer = null; // For Mode 6 fade-out
  let currentThermalColor = null; // Track current thermal background (parsed as {r, g, b})
  let targetThermalColor = null; // Target color to interpolate toward
  const THERMAL_INTERPOLATION_SPEED = 0.15; // How fast colors transition (0-1, higher = faster)
  const MAX_GHOSTS = 15;
  const MAX_PATH_SEGMENTS = 100;

  function stopHaptics() {
    if (hapticTimer) {
      clearInterval(hapticTimer);
      hapticTimer = null;
    }
  }

  function startSustainHaptics(sustainJitter) {
    stopHaptics();
    if (!('vibrate' in navigator)) return;
    const j = Math.max(0, sustainJitter);
    const period = Math.min(280, Math.max(90, 220 - j * 18));
    const pulse = Math.min(12, Math.max(4, 6 + j * 0.4));
    hapticTimer = setInterval(function () {
      try {
        navigator.vibrate(pulse);
      } catch (_) {}
    }, period);
  }

  function drawCrosshair(cx, cy, halfLen, lineWidth, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#e8e8f0';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy - halfLen);
    ctx.lineTo(cx, cy + halfLen);
    ctx.moveTo(cx - halfLen, cy);
    ctx.lineTo(cx + halfLen, cy);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw finger path with radius variance visualization.
   * @param {Array} samples - Array of {t, r, x, y} objects
   * @param {number} t0 - Start time for calculating dwell per sample
   * @param {number} minR - Minimum radius for normalization
   * @param {number} maxR - Maximum radius for normalization
   * @param {number} alpha - Overall opacity
   * @param {number} mode - Visualization mode (1-4)
   */
  function drawFingerPath(samples, t0, minR, maxR, alpha, mode) {
    if (!samples || samples.length < 2) return;
    if (!samples[0].x || !samples[0].y) return; // No position data

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#e8e8f0';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (mode === 4) {
      // Mode 4: Bubble Trail - draw circles at EVERY sample point to show all radius changes
      ctx.strokeStyle = '#e8e8f088';
      ctx.lineWidth = 1.5;
      // Draw ALL samples (no subsampling) so radius changes are immediately visible
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (s.x !== undefined && s.y !== undefined && s.r !== undefined) {
          // Use actual radius at this sample point (reflects increases AND decreases)
          const bubbleRadius = s.r;
          ctx.beginPath();
          ctx.arc(s.x, s.y, bubbleRadius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    } else {
      // Modes 1-3: Draw path as connected line segments with varying thickness
      const step = Math.max(1, Math.floor((samples.length - 1) / MAX_PATH_SEGMENTS));
      for (let i = 0; i < samples.length - 1; i += step) {
        const s0 = samples[i];
        const s1 = samples[i + 1];
        if (s0.x === undefined || s0.y === undefined) continue;
        if (s1.x === undefined || s1.y === undefined) continue;

        // Map radius to line width (2-10px range)
        const rNorm = maxR > minR ? (s0.r - minR) / (maxR - minR) : 0.5;
        const lineWidth = 2 + rNorm * 8;

        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function frame() {
    rafId = null;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // Mode 6 (Thermal): Fill background with velocity-based color
    if (visualizationMode === 6) {
      if (currentThermalColor) {
        ctx.fillStyle = colorToString(currentThermalColor);
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    // Skip ghost drawing in Mode 6 (thermal mode)
    if (visualizationMode !== 6) {
      for (let i = 0; i < ghosts.length; i++) {
        const g = ghosts[i];

        // Draw ghost path if available
        if (g.path && g.path.length > 1 && g.t0 !== undefined && visualizationMode >= 1 && visualizationMode <= 4) {
          drawFingerPath(g.path, g.t0, g.minR, g.peakR, 0.12, visualizationMode);
        }

        // Draw ghost crosshair at endpoint (or initial position)
        if (visualizationMode !== 2) { // Show crosshair except in Path Only mode
          const endPoint = (g.path && g.path.length > 0 && g.path[g.path.length - 1].x !== undefined)
            ? g.path[g.path.length - 1]
            : { x: g.x, y: g.y };
          drawCrosshair(endPoint.x, endPoint.y, g.halfLen, g.lineWidth, 0.2);
        }
      }
    }

    if (active) {
      const now = performance.now();

      // Desktop syntheticRadius code removed - touch-only app now

      const newMilestones = diffLiveMilestones(active, now);
      for (let m = 0; m < newMilestones.length; m++) {
        active.keyframes.push(newMilestones[m]);
      }

      const live = liveGestureState(active, now);
      // Add velocity data to live state
      live.currentVelocity = active.currentVelocity || 0;
      live.velocityBonus = active.velocityBonus || 0;
      applyTouchCssVars(live);

      // No dwell bonus - crosshair size equals actual radius
      const halfLen = crosshairHalfLength(active.currentRadius, 0);
      const lw = lineWidthFromAttackAndDwell(
        live.attackVelocity,
        0,
        active.lockedLineWidth
      );

      // Mode 5: Radius Scale - show numeric radius value (clamped + raw + force)
      if (visualizationMode === 5) {
        if (radiusDisplayEl) {
          radiusDisplayEl.style.display = 'block';

          if (radiusValueEl) {
            radiusValueEl.textContent = active.currentRadius.toFixed(1);
          }

          if (radiusRawValueEl) {
            const rawAvg = active.rawRadiusAvg !== undefined ? active.rawRadiusAvg.toFixed(2) : '--';
            radiusRawValueEl.textContent = rawAvg;
          }

          if (forceValueEl) {
            let forceText;
            if (active.force === null || active.force === undefined) {
              forceText = 'N/A';
            } else {
              // Show normalized (used for calc) and raw (from device) values
              const norm = active.force.toFixed(3);
              const raw = active.rawForce !== undefined ? active.rawForce.toFixed(1) : '?';
              forceText = norm + ' (' + raw + ')';
            }
            forceValueEl.textContent = forceText;
          }

          const currentVelocityValueEl = document.getElementById('currentVelocityValue');
          if (currentVelocityValueEl) {
            currentVelocityValueEl.textContent = (active.currentVelocity || 0).toFixed(1);
          }

          const velocityBonusValueEl = document.getElementById('velocityBonusValue');
          if (velocityBonusValueEl) {
            velocityBonusValueEl.textContent = (active.velocityBonus || 0).toFixed(1);
          }
        }
        // Draw simple crosshair at current position
        const crosshairX = active.currentX;
        const crosshairY = active.currentY;
        drawCrosshair(crosshairX, crosshairY, halfLen, lw, 1);
      } else if (visualizationMode === 6) {
        // Mode 6: Thermal - update background color based on velocity
        // Hide radius display
        if (radiusDisplayEl) {
          radiusDisplayEl.style.display = 'none';
        }

        // Clear any cooldown timer
        if (thermalCooldownTimer) {
          clearInterval(thermalCooldownTimer);
          thermalCooldownTimer = null;
        }

        // Initialize current color if first frame (start at neutral gray)
        if (!currentThermalColor) {
          currentThermalColor = { r: 58, g: 58, b: 66 }; // Match stage-bg #3a3a42
        }

        // Set target color based on current velocity
        const velocity = active.currentVelocity || 0;
        targetThermalColor = velocityToThermalColor(velocity);

        // Smoothly interpolate toward target color
        currentThermalColor = interpolateColor(currentThermalColor, targetThermalColor, THERMAL_INTERPOLATION_SPEED);

        // No drawing - color is applied at frame start
      } else {
        // Modes 1-4: Hide radius display
        if (radiusDisplayEl) {
          radiusDisplayEl.style.display = 'none';
        }

        // Draw path first (behind crosshair) for modes 1-4
        if (visualizationMode >= 1 && visualizationMode <= 4) {
          drawFingerPath(active.samples, active.t0, active.r0, active.peakR, 0.6, visualizationMode);
        }

        // Show crosshair only when stationary (or always in Mode 3)
        const showCrosshair = visualizationMode === 3 ||
                              (visualizationMode !== 2 && active.movementState === 'stationary');

        if (showCrosshair) {
          const crosshairX = (visualizationMode === 1) ? active.currentX : active.x0;
          const crosshairY = (visualizationMode === 1) ? active.currentY : active.y0;
          drawCrosshair(crosshairX, crosshairY, halfLen, lw, 1);
        }
      }

      scheduleFrame();
    } else {
      // No active gesture - hide radius display
      if (radiusDisplayEl) {
        radiusDisplayEl.style.display = 'none';
      }

      // Mode 6: Thermal cooldown after touch ends
      if (visualizationMode === 6 && currentThermalColor) {
        // Start cooldown if not already running
        if (!thermalCooldownTimer) {
          let cooldownStep = 0;
          const maxSteps = 30; // Fade over ~0.5 seconds (30 frames at 60fps)
          thermalCooldownTimer = setInterval(function () {
            cooldownStep++;
            const progress = cooldownStep / maxSteps;

            if (cooldownStep >= maxSteps) {
              // Cooldown complete - clear color
              currentThermalColor = null;
              targetThermalColor = null;
              clearInterval(thermalCooldownTimer);
              thermalCooldownTimer = null;
              scheduleFrame();
            } else {
              // Fade to neutral gray
              const target = { r: 58, g: 58, b: 66 }; // #3a3a42 (stage-bg)

              // Interpolate toward target
              currentThermalColor = {
                r: Math.round(currentThermalColor.r + (target.r - currentThermalColor.r) * progress),
                g: Math.round(currentThermalColor.g + (target.g - currentThermalColor.g) * progress),
                b: Math.round(currentThermalColor.b + (target.b - currentThermalColor.b) * progress)
              };
              scheduleFrame();
            }
          }, 16); // ~60fps
        }
      }
    }
  }

  function scheduleFrame() {
    if (rafId == null) rafId = requestAnimationFrame(frame);
  }

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () {
      resize();
      scheduleFrame();
    }).observe(canvas);
  }

  function hideHintOnce() {
    if (hintEl && !hintEl.classList.contains('is-hidden')) {
      hintEl.classList.add('is-hidden');
    }
  }

  function createActiveBase(t0, x0, y0, r0, touchId) {
    const base = {
      touchId: touchId,
      x0: x0,
      y0: y0,
      t0: t0,
      r0: r0,
      samples: [{ t: t0, r: r0, x: x0, y: y0 }],
      peakR: r0,
      currentRadius: r0,
      currentX: x0,
      currentY: y0,
      tPeak: t0,
      attackVelocity: 0,
      sustainJitter: 0,
      lineWidth: 2,
      lockedLineWidth: null,
      attackDone: false,
      movementState: 'stationary',
      recentSamples: [{ x: x0, y: y0, t: t0 }],
      baseRadius: r0, // Store initial force-adjusted radius as baseline
      velocityBonus: 0, // Accumulated bonus from dwelling (positive) or fast movement (negative)
      lastVelocityUpdateTime: t0, // Track time for delta calculations
      currentVelocity: 0, // Store last calculated velocity for JSON export
      keyframes: [],
      _milestoneAttackEndEmitted: false,
      _milestoneLastPeakR: r0
    };
    base.keyframes.push(gestureStartMilestone(base));
    return base;
  }

  // Desktop/pointer event handlers removed - touch-only app now

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    hideHintOnce();

    const touch = e.touches[0];
    const t0 = performance.now();
    const p0 = canvasPointFromClient(touch.clientX, touch.clientY);
    const x0 = p0.x;
    const y0 = p0.y;
    const baseR0 = touchRadius(touch);

    stopHaptics();

    // Store initial force value (check both standard and webkit-prefixed)
    let rawForce = null;
    let normalizedForce = null;
    if (touch.force !== undefined && touch.force > 0) {
      rawForce = touch.force;
      normalizedForce = normalizeForce(touch.force, false);
    } else if (touch.webkitForce !== undefined && touch.webkitForce > 0) {
      rawForce = touch.webkitForce;
      normalizedForce = normalizeForce(touch.webkitForce, true);
    }

    // Calculate effective radius with normalized force
    const r0 = radiusWithForce(baseR0, normalizedForce);

    active = createActiveBase(t0, x0, y0, r0, touch.identifier);
    active.force = normalizedForce; // Normalized for calculations
    active.rawForce = rawForce; // Raw for debugging display
    active.rawRadiusX = touch.radiusX || 0;
    active.rawRadiusY = touch.radiusY || 0;
    active.rawRadiusAvg = (active.rawRadiusX + active.rawRadiusY) / 2;
    lastHapticTune = 0;
    scheduleFrame();
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (!active) return;
    const touch = Array.prototype.find.call(e.touches, function (t) {
      return t.identifier === active.touchId;
    });
    if (!touch) return;

    const now = performance.now();
    const baseR = touchRadius(touch);
    const p = canvasPointFromClient(touch.clientX, touch.clientY);

    // Store raw radius values for debugging in Mode 5
    const rx = touch.radiusX || 0;
    const ry = touch.radiusY || 0;
    active.rawRadiusX = rx;
    active.rawRadiusY = ry;
    active.rawRadiusAvg = (rx + ry) / 2;

    // iOS Safari limitation: webkitForce returns 0 during all touchmove events
    // radiusX/Y are also frozen at initial contact area
    // Keep using initial force value throughout the gesture
    const r = radiusWithForce(baseR, active.force);

    active.samples.push({ t: now, r: r, x: p.x, y: p.y });
    if (r > active.peakR) {
      active.peakR = r;
      active.tPeak = now;
    }
    active.currentRadius = r;
    active.currentX = p.x;
    active.currentY = p.y;

    // Update recent samples for velocity tracking
    active.recentSamples.push({ x: p.x, y: p.y, t: now });
    if (active.recentSamples.length > 5) {
      active.recentSamples.shift(); // Keep last 5 only
    }

    // Update movement state based on velocity
    updateMovementState(active);

    // Calculate instantaneous velocity for size modulation
    if (active.samples.length >= 2) {
      const currentSample = active.samples[active.samples.length - 1];
      const prevSample = active.samples[active.samples.length - 2];
      active.currentVelocity = velocityBetweenSamples(currentSample, prevSample);

      // Update velocity bonus based on time since last update
      const dtSeconds = (now - active.lastVelocityUpdateTime) / 1000;
      const delta = velocityRadiusDelta(active.currentVelocity, dtSeconds);
      active.velocityBonus += delta;
      active.lastVelocityUpdateTime = now;

      // Apply velocity modulation to current radius
      const modulatedRadius = radiusWithVelocityModulation(active.baseRadius, active.velocityBonus);
      active.currentRadius = modulatedRadius;

      // Update the sample with modulated radius
      active.samples[active.samples.length - 1].r = modulatedRadius;

      // Update peakR if modulated radius is larger
      if (modulatedRadius > active.peakR) {
        active.peakR = modulatedRadius;
        active.tPeak = now;
      }
    }

    const attackEnd = active.t0 + ATTACK_MS;
    active.attackVelocity = attackVelocityFromSamples(active.samples, active.t0, active.r0, attackEnd);

    const lw = lineWidthFromAttackVelocity(active.attackVelocity);
    active.lineWidth = lw;

    if (!active.attackDone && now >= attackEnd) {
      active.attackDone = true;
      active.lockedLineWidth = lw;
      active.sustainJitter = sustainJitterFromSamples(active.samples, attackEnd);
      startSustainHaptics(active.sustainJitter);
      lastHapticTune = now;
    } else if (active.attackDone) {
      active.sustainJitter = sustainJitterFromSamples(active.samples, attackEnd);
      const prevJ = active._lastHapticJitter;
      if (
        prevJ === undefined ||
        Math.abs(active.sustainJitter - prevJ) > 0.35 ||
        now - lastHapticTune > 400
      ) {
        active._lastHapticJitter = active.sustainJitter;
        lastHapticTune = now;
        startSustainHaptics(active.sustainJitter);
      }
    }

    scheduleFrame();
  }

  function onTouchEnd(e) {
    e.preventDefault();
    if (!active) return;
    const still = e.touches.length > 0;
    if (still) return;

    const tEnd = performance.now();
    const out = buildGestureReport(active, tEnd, active.keyframes);
    const ghostHalf = crosshairHalfLength(active.currentRadius, 0); // No dwell bonus
    const ghostW = lineWidthFromAttackAndDwell(
      out.attackVelocity,
      0,
      active.lockedLineWidth
    );

    console.log(JSON.stringify(out));

    // Store for sharing
    lastGestureJSON = out;
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) {
      shareBtn.disabled = false;
    }

    // Downsample path for ghost (every 3rd sample)
    const downsampledPath = active.samples.filter(function (s, i) {
      return i % 3 === 0;
    });

    ghosts.push({
      x: active.x0,
      y: active.y0,
      halfLen: ghostHalf,
      lineWidth: ghostW,
      path: downsampledPath,
      t0: active.t0,
      peakR: active.peakR,
      minR: active.r0
    });

    // Limit ghost count
    if (ghosts.length > MAX_GHOSTS) {
      ghosts.shift();
    }

    stopHaptics();
    clearTouchCssVars();
    active = null;
    scheduleFrame();
  }

  function onTouchCancel(e) {
    e.preventDefault();
    if (!active) return;
    stopHaptics();
    clearTouchCssVars();
    active = null;
    scheduleFrame();
  }

  const opts = { passive: false };
  // Pointer event listeners removed - touch-only app now

  canvas.addEventListener('touchstart', onTouchStart, opts);
  canvas.addEventListener('touchmove', onTouchMove, opts);
  canvas.addEventListener('touchend', onTouchEnd, opts);
  canvas.addEventListener('touchcancel', onTouchCancel, opts);

  document.body.addEventListener('touchmove', function (e) {
    e.preventDefault();
  }, opts);
  document.documentElement.addEventListener('touchmove', function (e) {
    e.preventDefault();
  }, opts);

  // Mode toggle button
  const modeToggleBtn = document.getElementById('modeToggle');
  const modeNames = ['', 'Path + Crosshair', 'Path Only', 'Path + Fixed', 'Bubble Trail', 'Radius Scale', 'Thermal'];

  if (modeToggleBtn) {
    modeToggleBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      visualizationMode = (visualizationMode % 6) + 1;
      modeToggleBtn.textContent = String(visualizationMode);
      if (modeLabelEl) {
        modeLabelEl.textContent = '— ' + modeNames[visualizationMode];
      }

      // Clear thermal state when switching modes
      if (visualizationMode !== 6) {
        currentThermalColor = null;
        targetThermalColor = null;
        if (thermalCooldownTimer) {
          clearInterval(thermalCooldownTimer);
          thermalCooldownTimer = null;
        }
      }

      scheduleFrame(); // Redraw with new mode
    });
  }

  // Share JSON button
  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    shareBtn.disabled = true; // Start disabled until first gesture
    shareBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      if (!lastGestureJSON) {
        alert('No gesture data yet. Perform a touch gesture first.');
        return;
      }

      const jsonStr = JSON.stringify(lastGestureJSON, null, 2);
      const subject = 'Touch Gesture Data - Mode ' + visualizationMode;
      const body = 'Touch gesture JSON:\n\n' + jsonStr;

      // Try mailto: first (has ~2000 char limit on some platforms)
      if (body.length < 1500) {
        const mailtoLink = 'mailto:david.goldberg@disney.com?subject=' +
          encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
        window.location.href = mailtoLink;
      } else {
        // Too large for mailto, copy to clipboard instead
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(jsonStr).then(function () {
            alert('JSON too large for email.\nCopied to clipboard instead!\n\nPaste it in your next message.');
          }).catch(function () {
            alert('Could not copy to clipboard.\nCheck console for JSON (F12).');
            console.log('Gesture JSON:', jsonStr);
          });
        } else {
          alert('Clipboard not available.\nCheck console for JSON (F12).');
          console.log('Gesture JSON:', jsonStr);
        }
      }
    });
  }
})();
