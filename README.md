# touch-asdr

A small **vanilla HTML/CSS/JS** web app for **iPhone** (and other touch devices) that visualizes a touch “envelope” and draws a **crosshair** driven by contact radius.

It tracks `touchstart` / `touchmove` / `touchend`, uses `radiusX` / `radiusY` from the active touch, and derives:

- **Attack** — how quickly the contact radius grows in the first **150 ms**
- **Sustain** — micro-oscillation (“jitter”) in radius while the finger stays down

The canvas draws a crosshair centered on the initial touch point; arm length follows the **current** radius, and stroke width follows **attack**. Completed touches leave a **ghost** crosshair at **20% opacity**. On release, metrics are **logged to the console** as JSON.

## Project layout

| File        | Purpose                          |
| ----------- | -------------------------------- |
| `index.html` | Page shell and asset links      |
| `styles.css` | Full-screen layout, no scroll/zoom |
| `app.js`     | Touch handling, envelope math, drawing, haptics |

## Run locally

Static files only—serve the folder over HTTP (recommended for mobile testing):

```bash
cd touch-asdr
python3 -m http.server 8080
```

Then open `http://localhost:8080` on your machine, or `http://<your-lan-ip>:8080` on your phone (same Wi‑Fi).

Opening `index.html` directly via `file://` may block or restrict external `app.js` / `styles.css` in some browsers—use a local server when possible.

## Publish to a static site folder

If you keep a separate clone or folder for **GitLab Pages**, **GitHub Pages**, or another static root, copy the three runtime files into that directory, then commit/push that repo:

```bash
./scripts/publish-static.sh /absolute/path/to/your/static/site/root
```

That copies `index.html`, `styles.css`, and `app.js` only (no `README.md` / `dev_diary.md`).

**Disney GitLab Pages (dg-sandbox):** app files live under the Pages repo’s `public/touch-asdr/` directory (same pattern as `public/rivals/`). After copying, commit and push **`dg-sandbox`**, not only `touch-asdr`.

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
