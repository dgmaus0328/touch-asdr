(function () {
  'use strict';

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const hintEl = document.getElementById('hint');

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

  const ATTACK_MS = 150;
  const MIN_TRUSTED_RADIUS = 3;

  /**
   * Browsers often report tiny radiusX/Y (e.g. 0.5) for stylus/trackpad or
   * buggy values — treat those as unknown and use a sane default.
   */
  function clampContactRadius(r) {
    if (!isFinite(r) || r < MIN_TRUSTED_RADIUS) {
      return 22;
    }
    return r;
  }

  function touchRadius(touch) {
    const rx = touch.radiusX || 0;
    const ry = touch.radiusY || 0;
    const r = (rx + ry) / 2;
    if (r <= 0) {
      return 22;
    }
    return clampContactRadius(r);
  }

  /**
   * Pointer geometry when the browser exposes width/height; else mouse uses
   * a synthetic radius so desktop can exercise attack/sustain.
   */
  function syntheticRadius(now, t0) {
    const dt = Math.max(0, now - t0);
    if (dt <= ATTACK_MS) {
      return 22 + (dt / ATTACK_MS) * 10;
    }
    return 32 + 2.2 * Math.sin(now * 0.055);
  }

  /**
   * Mouse reports ~1px width/height; some Safari builds omit pointerType or use
   * tiny geometry — only trust explicit mouse as synthetic; otherwise require
   * meaningful size before using width/height.
   */
  function radiusFromPointerEvent(e, now, t0) {
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

  const ghosts = [];

  let active = null;
  let rafId = null;
  let hapticTimer = null;
  let lastHapticTune = 0;

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

  function frame() {
    rafId = null;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i];
      drawCrosshair(g.x, g.y, g.halfLen, g.lineWidth, 0.2);
    }

    if (active) {
      const halfLen = active.currentRadius;
      const lw = active.lockedLineWidth != null ? active.lockedLineWidth : active.lineWidth;
      drawCrosshair(active.x0, active.y0, halfLen, lw, 1);
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

  function attackVelocityFromSamples(samples, t0, r0, attackEnd) {
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

  function sustainJitterFromSamples(samples, attackEnd) {
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

  function hideHintOnce() {
    if (hintEl && !hintEl.classList.contains('is-hidden')) {
      hintEl.classList.add('is-hidden');
    }
  }

  function onPointerDown(e) {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    e.preventDefault();
    hideHintOnce();

    const t0 = performance.now();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const r0 = radiusFromPointerEvent(e, t0, t0);

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {}

    stopHaptics();

    active = {
      pointerId: e.pointerId,
      x0: x0,
      y0: y0,
      t0: t0,
      r0: r0,
      samples: [{ t: t0, r: r0 }],
      peakR: r0,
      currentRadius: r0,
      attackVelocity: 0,
      sustainJitter: 0,
      lineWidth: 2,
      lockedLineWidth: null,
      attackDone: false
    };
    lastHapticTune = 0;
    scheduleFrame();
  }

  function onPointerMove(e) {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    if (!active || active._touch || e.pointerId !== active.pointerId) return;
    const now = performance.now();
    const r = radiusFromPointerEvent(e, now, active.t0);

    active.samples.push({ t: now, r: r });
    if (r > active.peakR) active.peakR = r;
    active.currentRadius = r;

    const attackEnd = active.t0 + ATTACK_MS;
    active.attackVelocity = attackVelocityFromSamples(active.samples, active.t0, active.r0, attackEnd);

    const lw = Math.min(24, Math.max(1, 1 + active.attackVelocity * 0.08));
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

  function endPointer(e) {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    if (!active || active._touch || e.pointerId !== active.pointerId) return;

    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}

    const attackEnd = active.t0 + ATTACK_MS;
    const finalAttack = attackVelocityFromSamples(active.samples, active.t0, active.r0, attackEnd);
    const lwFromAttack = Math.min(24, Math.max(1, 1 + finalAttack * 0.08));
    const strokeW = active.lockedLineWidth != null ? active.lockedLineWidth : lwFromAttack;

    const out = {
      peakRadius: active.peakR,
      attackVelocity: finalAttack,
      coordinates: { x: active.x0, y: active.y0 }
    };
    console.log(JSON.stringify(out));

    ghosts.push({
      x: active.x0,
      y: active.y0,
      halfLen: active.peakR,
      lineWidth: strokeW
    });

    stopHaptics();
    active = null;
    scheduleFrame();
  }

  function onPointerUp(e) {
    endPointer(e);
  }

  function onPointerCancel(e) {
    endPointer(e);
  }

  function onLostPointerCapture(e) {
    if (active && active._touch) return;
    if (active && e.pointerId === active.pointerId) {
      stopHaptics();
      active = null;
      scheduleFrame();
    }
  }

  /** Touch-only: real radiusX/Y when PointerEvent width/height are 0. */
  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    hideHintOnce();

    const touch = e.touches[0];
    const t0 = performance.now();
    const x0 = touch.clientX;
    const y0 = touch.clientY;
    const r0 = touchRadius(touch);

    stopHaptics();

    active = {
      pointerId: touch.identifier,
      x0: x0,
      y0: y0,
      t0: t0,
      r0: r0,
      samples: [{ t: t0, r: r0 }],
      peakR: r0,
      currentRadius: r0,
      attackVelocity: 0,
      sustainJitter: 0,
      lineWidth: 2,
      lockedLineWidth: null,
      attackDone: false,
      _touch: true
    };
    lastHapticTune = 0;
    scheduleFrame();
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (!active || !active._touch) return;
    const touch = Array.prototype.find.call(e.touches, function (t) {
      return t.identifier === active.pointerId;
    });
    if (!touch) return;

    const now = performance.now();
    const r = touchRadius(touch);

    active.samples.push({ t: now, r: r });
    if (r > active.peakR) active.peakR = r;
    active.currentRadius = r;

    const attackEnd = active.t0 + ATTACK_MS;
    active.attackVelocity = attackVelocityFromSamples(active.samples, active.t0, active.r0, attackEnd);

    const lw = Math.min(24, Math.max(1, 1 + active.attackVelocity * 0.08));
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
    if (!active || !active._touch) return;
    const still = e.touches.length > 0;
    if (still) return;

    const attackEnd = active.t0 + ATTACK_MS;
    const finalAttack = attackVelocityFromSamples(active.samples, active.t0, active.r0, attackEnd);
    const lwFromAttack = Math.min(24, Math.max(1, 1 + finalAttack * 0.08));
    const strokeW = active.lockedLineWidth != null ? active.lockedLineWidth : lwFromAttack;

    const out = {
      peakRadius: active.peakR,
      attackVelocity: finalAttack,
      coordinates: { x: active.x0, y: active.y0 }
    };
    console.log(JSON.stringify(out));

    ghosts.push({
      x: active.x0,
      y: active.y0,
      halfLen: active.peakR,
      lineWidth: strokeW
    });

    stopHaptics();
    active = null;
    scheduleFrame();
  }

  function onTouchCancel(e) {
    e.preventDefault();
    if (!active || !active._touch) return;
    stopHaptics();
    active = null;
    scheduleFrame();
  }

  const opts = { passive: false };
  canvas.addEventListener('pointerdown', onPointerDown, opts);
  canvas.addEventListener('pointermove', onPointerMove, opts);
  canvas.addEventListener('pointerup', onPointerUp, opts);
  canvas.addEventListener('pointercancel', onPointerCancel, opts);
  canvas.addEventListener('lostpointercapture', onLostPointerCapture);

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
})();
