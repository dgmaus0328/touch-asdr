# touch-asdr

A small **vanilla HTML/CSS/JS** web app for **iPhone** (and other touch devices) that visualizes a touch “envelope” and draws a **crosshair** driven by contact radius and **dwell** (how long the finger stays down).

It tracks `touchstart` / `touchmove` / `touchend`, uses `radiusX` / `radiusY` from the active touch, and derives:

- **Attack** — how quickly the contact radius grows in the first **150 ms**
- **Sustain** — micro-oscillation (“jitter”) in radius while the finger stays down
- **Dwell** — after the attack window, **elapsed time** adds extra crosshair arm length and stroke width (capped; tunable in `envelope.js`)

There is **no separate Decay stage** in the model; release timing is summarized in the JSON.

The canvas draws a crosshair centered on the initial touch point; arm length follows **radius + dwell bonus**, and stroke follows **attack + dwell**. Completed touches leave a **ghost** crosshair at **20% opacity**. On release, metrics and a **keyframe timeline** are **logged to the console** as JSON.

## Project layout

| File          | Purpose |
| ------------- | ------- |
| `index.html`  | Page shell and asset links |
| `styles.css`  | Layout (input stage, no scroll/zoom) |
| `envelope.js` | **Reusable** touch envelope math (radius, attack, sustain, dwell, milestones, report) — no DOM |
| `app.js`      | Canvas UI, pointer/touch wiring, drawing, haptics, CSS custom properties (`import` from `envelope.js`) |

## Run locally

Static files only—serve the folder over HTTP (recommended for mobile testing):

```bash
cd touch-asdr
python3 -m http.server 8080
```

Then open `http://localhost:8080` on your machine, or `http://<your-lan-ip>:8080` on your phone (same Wi‑Fi).

The app uses **`type="module"`** (`app.js` imports `envelope.js`). Opening via `file://` often fails for ES modules—use a local server. The **Pages bundle** inlines both into one `index.html` so a single file works anywhere.

## Publish to a static site folder

For static hosts that need a **single file**, run **`publish-static.sh`** (runs `bundle-for-pages.py`), which writes one **`index.html`** with inlined CSS + inlined **`envelope.js` + `app.js`** as one module script. Commit that file to your Pages repo.

**Disney GitLab Pages (dg-sandbox):** deploy a **single bundled `index.html`** (inlined CSS + JS) via `./scripts/publish-static.sh`. Some Pages setups serve `app.js` with a non-JavaScript `Content-Type`; with `X-Content-Type-Options: nosniff`, the browser will not run external scripts—bundling avoids that.

App output lives under the Pages repo’s `public/touch-asdr/` (same idea as `public/rivals/`). After publishing, commit and push **`dg-sandbox`**, not only `touch-asdr`.

- Site: [touch-asdr on dg-sandbox Pages](https://dg-sandbox-69d828.pages.gitlab.disney.com/touch-asdr/)
- Example publish path on this machine: `~/GitLab/dg-sandbox/public/touch-asdr/`

```bash
./scripts/publish-static.sh "$HOME/GitLab/dg-sandbox/public/touch-asdr"
```

## Touch & output

- Default touch behaviors (scroll, pinch-zoom) are reduced via CSS (`touch-action: none`, etc.) and `preventDefault` on touch handlers where needed.
- On **touchend** (or pointer up), the console receives JSON including:
  - **`peakRadius`**, **`attackVelocity`**, **`coordinates`** `{ x, y }`
  - **`pressDurationMs`**, **`msToPeakRadius`**, **`msFromPeakToRelease`**
  - **`sustainJitter`**, **`dwellNormAtEnd`**
  - **`keyframes`**: ordered milestones with **`kind`** `start` | `attackEnd` | `peakRadius` | `release`, plus times and geometry where applicable

**Hardware note:** After lift, contact radius is usually **not** sampled, so “time to return to zero” radius is **not** measured; **`msFromPeakToRelease`** is the time from first reaching the final peak radius until release.

## iOS Safari Limitations

### Real-Time Pressure Tracking is Not Possible

**iOS Safari does not support continuous pressure detection during a touch gesture.** This is a platform limitation, not an implementation issue.

**What works:**
- ✅ Different initial pressures between separate touches (hard press vs light touch at touchstart)
- ✅ Initial `webkitForce` value captured at touchstart
- ✅ `radiusX/Y` contact area at initial touch

**What doesn't work:**
- ❌ Detecting pressure changes **during** a single touch gesture
- ❌ `webkitForce` returns **0.0 during all touchmove events** (even when stationary)
- ❌ `radiusX/Y` are **frozen at initial contact area** throughout the gesture

**Why:**
iOS designed `touch.force` for **3D Touch** press-and-hold gestures, not for continuous pressure tracking during swipes/drags. Safari does not expose real-time pressure data during movement for security and performance reasons.

**Tested workarounds that failed:**
- ❌ Re-sampling force when finger becomes stationary (still returns 0.0)
- ❌ Using Pointer Events API (same limitation)
- ❌ Alternative Touch properties (altitudeAngle, etc. are stylus-only)

**Data proven via JSON logging:** Test gestures show all samples have identical radius values with `attackVelocity: 0` and `sustainJitter: 0`, confirming zero variation during movement.

**Implication:** This app captures initial touch pressure and applies it throughout the gesture. For true pressure-sensitive drawing (like Apple Pencil), a **native iOS app** or **different API** would be required.

### Tunables (`envelope.js`)

| Constant | Role |
| -------- | ---- |
| `ATTACK_MS` | Attack window (default 150 ms) |
| `DWELL_HALF_LEN_SATURATION_MS` / `DWELL_HALF_LEN_MAX_BONUS` | Dwell → extra crosshair half-length |
| `DWELL_LINE_WIDTH_SATURATION_MS` / `DWELL_LINE_WIDTH_MAX_BONUS` | Dwell → extra stroke width |

### CSS bridge (set on `:root` while a gesture is active)

The demo updates these **custom properties** every frame so external CSS can map them to color, opacity, filters, etc. They are **removed** when the gesture ends.

| Variable | Meaning |
| -------- | ------- |
| `--touch-press-ms` | Elapsed ms since touch start |
| `--touch-phase` | `attack` or `sustain` |
| `--touch-current-radius` | Current contact radius (px) |
| `--touch-peak-radius` | Running max radius |
| `--touch-ms-to-peak` | ms from start to first reach current peak |
| `--touch-dwell-norm-half` | 0..1 for half-length dwell curve |
| `--touch-dwell-norm-line` | 0..1 for line-width dwell curve |
| `--touch-x`, `--touch-y` | Initial centroid (canvas px) |
| `--touch-attack-velocity` | Attack velocity estimate |

## Haptics

After the attack window, the app uses `navigator.vibrate` with a low-frequency pulse pattern tuned from sustain jitter. **iOS Safari often does not support or limits `vibrate`**—behavior may be a no-op on iPhone; Android/desktop Chrome may show clearer results.

## Requirements

- Modern mobile browser with **Touch Events** and (for radius) support for **`radiusX` / `radiusY`** where the platform exposes them.

## License

Internal / team use per your Disney GitLab policy unless you add a public license.
