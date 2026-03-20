# touch-asdr

A small **vanilla HTML/CSS/JS** web app for **iPhone** (and other touch devices) that visualizes a touch “envelope” and draws a **crosshair** driven by contact radius.

It tracks `touchstart` / `touchmove` / `touchend`, uses `radiusX` / `radiusY` from the active touch, and derives:

- **Attack** — how quickly the contact radius grows in the first **150 ms**
- **Sustain** — micro-oscillation (“jitter”) in radius while the finger stays down

The canvas draws a crosshair centered on the initial touch point; arm length follows the **current** radius, and stroke width follows **attack**. Completed touches leave a **ghost** crosshair at **20% opacity**. On release, metrics are **logged to the console** as JSON.

## Project layout

| File          | Purpose |
| ------------- | ------- |
| `index.html`  | Page shell and asset links |
| `styles.css`  | Layout (input stage, no scroll/zoom) |
| `envelope.js` | **Reusable** touch envelope math (radius, attack, sustain, JSON fields) — no DOM |
| `app.js`      | Canvas UI, pointer/touch wiring, drawing, haptics (`import` from `envelope.js`) |

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
- On **touchend**, the console receives a JSON object with **`peakRadius`**, **`attackVelocity`**, and **`coordinates`** `{ x, y }`.

## Haptics

After the attack window, the app uses `navigator.vibrate` with a low-frequency pulse pattern tuned from sustain jitter. **iOS Safari often does not support or limits `vibrate`**—behavior may be a no-op on iPhone; Android/desktop Chrome may show clearer results.

## Requirements

- Modern mobile browser with **Touch Events** and (for radius) support for **`radiusX` / `radiusY`** where the platform exposes them.

## License

Internal / team use per your Disney GitLab policy unless you add a public license.
