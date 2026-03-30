import {
  ATTACK_MS,
  touchRadius,
  attackVelocityFromSamples,
  sustainJitterFromSamples,
  buildGestureReport,
  lineWidthFromAttackVelocity,
  gestureStartMilestone,
  liveGestureState,
  diffLiveMilestones,
  crosshairHalfLength,
  lineWidthFromAttackAndDwell
} from './envelope.js';

(function () {
  'use strict';

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const hintEl = document.getElementById('hint');
  const modeLabelEl = document.getElementById('modeLabel');
  const radiusDisplayEl = document.getElementById('radiusDisplay');
  const radiusValueEl = document.getElementById('radiusValue');
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
    '--touch-attack-velocity'
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
  let visualizationMode = 1; // 1: Path+Crosshair, 2: Path only, 3: Path+Fixed, 4: Bubbles, 5: Radius Scale
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
      // Mode 4: Bubble Trail - draw circles showing actual contact radius at each point
      ctx.strokeStyle = '#e8e8f088';
      ctx.lineWidth = 1.5;
      const step = Math.max(1, Math.floor(samples.length / 50)); // Max 50 circles
      for (let i = 0; i < samples.length; i += step) {
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
    ctx.clearRect(0, 0, w, h);

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

    if (active) {
      const now = performance.now();

      // Desktop syntheticRadius code removed - touch-only app now

      const newMilestones = diffLiveMilestones(active, now);
      for (let m = 0; m < newMilestones.length; m++) {
        active.keyframes.push(newMilestones[m]);
      }

      const live = liveGestureState(active, now);
      applyTouchCssVars(live);

      // No dwell bonus - crosshair size equals actual radius
      const halfLen = crosshairHalfLength(active.currentRadius, 0);
      const lw = lineWidthFromAttackAndDwell(
        live.attackVelocity,
        0,
        active.lockedLineWidth
      );

      // Mode 5: Radius Scale - show numeric radius value
      if (visualizationMode === 5) {
        if (radiusDisplayEl && radiusValueEl) {
          radiusDisplayEl.style.display = 'block';
          radiusValueEl.textContent = active.currentRadius.toFixed(1);
        }
        // Draw simple crosshair at current position
        const crosshairX = active.currentX;
        const crosshairY = active.currentY;
        drawCrosshair(crosshairX, crosshairY, halfLen, lw, 1);
      } else {
        // Hide radius display in other modes
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
    const r0 = touchRadius(touch);

    stopHaptics();

    active = createActiveBase(t0, x0, y0, r0, touch.identifier);
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
    const r = touchRadius(touch);
    const p = canvasPointFromClient(touch.clientX, touch.clientY);

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
  const modeNames = ['', 'Path + Crosshair', 'Path Only', 'Path + Fixed', 'Bubble Trail', 'Radius Scale'];

  if (modeToggleBtn) {
    modeToggleBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      visualizationMode = (visualizationMode % 5) + 1;
      modeToggleBtn.textContent = String(visualizationMode);
      if (modeLabelEl) {
        modeLabelEl.textContent = '— ' + modeNames[visualizationMode];
      }
      scheduleFrame(); // Redraw with new mode
    });
  }
})();
