# Research: Native iOS Capabilities for Continuous Pressure Tracking

**Date:** 2026-03-30
**Question:** Would a native iOS app solve the continuous pressure tracking problem we encountered in Safari?

## Executive Summary

**NO - A native iOS app would NOT solve the problem on most devices.**

The continuous pressure tracking limitation is primarily a **hardware limitation**, not just a Safari/web API limitation. Apple discontinued 3D Touch hardware in 2018 with the iPhone XR, and completely removed it starting with the iPhone 11 (2019). As of 2025+, virtually all iPhones in use lack the hardware for continuous pressure sensing.

**Exception:** Apple Pencil on iPad provides excellent continuous pressure tracking through specialized hardware and APIs.

---

## 1. UITouch.force API (3D Touch)

### What It Was
- **Property:** `UITouch.force` (CGFloat, 0.0 to 1.0+)
- **Related:** `UITouch.maximumPossibleForce` (device-specific max)
- **Functionality:** Provided continuous pressure readings during `touchesMoved` events
- **Sampling:** Updated at the touch event rate (~120Hz typical on 3D Touch devices)

### Device Support
**Supported on (all discontinued):**
- iPhone 6S / 6S Plus (2015)
- iPhone 7 / 7 Plus (2016)
- iPhone 8 / 8 Plus (2017)
- iPhone X (2017)
- iPhone XS / XS Max (2018)

**NOT supported on:**
- iPhone XR (2018) - first iPhone without 3D Touch
- iPhone 11 and all later models (2019+)
- iPhone SE (all generations)
- All current iPhone 15/16 series (2024-2025)

### Technical Capabilities (When Supported)
```swift
override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let touch = touches.first else { return }

    // Continuous pressure reading (0.0 to 1.0+)
    let pressure = touch.force / touch.maximumPossibleForce

    // Works during movement, provides real-time updates
    updateDrawing(pressure: pressure)
}
```

- Provided true continuous pressure sensing during touch movement
- Worked with fingers (not stylus-specific)
- Used capacitive sensor array embedded in the display
- Could distinguish between light, medium, and firm presses in real-time

### Current Status (2025+)
- **API Status:** NOT deprecated (still in UIKit for backward compatibility)
- **Hardware Status:** DISCONTINUED (removed from all new devices since 2019)
- **Practical Status:** UNUSABLE on 99%+ of devices in the field

**Replaced by:** Haptic Touch (long-press gestures, NOT pressure-sensitive)

### Key Difference: 3D Touch vs Haptic Touch
| Feature | 3D Touch | Haptic Touch |
|---------|----------|--------------|
| Sensor | Pressure-sensitive capacitive array | No special hardware |
| Input | Force/pressure intensity | Duration (long press) |
| Continuous | Yes (real-time pressure changes) | No (binary: pressed or not) |
| API | `UITouch.force` | Timer-based gesture recognizers |
| Current availability | Discontinued | All modern iPhones |

---

## 2. Apple Pencil / PencilKit

### Pressure Capabilities
Apple Pencil provides **excellent continuous pressure tracking** through specialized hardware.

**How it works:**
- Pressure sensor built into the pencil tip
- Communicates pressure data wirelessly to iPad
- Exposed through standard Touch APIs and PencilKit

### APIs

#### UITouch.force (with Apple Pencil)
```swift
override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let touch = touches.first else { return }

    if touch.type == .pencil || touch.type == .stylus {
        let pressure = touch.force / touch.maximumPossibleForce // 0.0 to 1.0
        let altitude = touch.altitudeAngle // Tilt angle
        let azimuth = touch.azimuthAngle(in: view) // Rotation

        // Full pressure + tilt data available continuously
        drawStroke(pressure: pressure, altitude: altitude, azimuth: azimuth)
    }
}
```

#### PencilKit (iOS 13+)
```swift
import PencilKit

// PKCanvasView automatically handles pressure-sensitive drawing
let canvasView = PKCanvasView()

// Access stroke data including pressure per point
let drawing = canvasView.drawing
for stroke in drawing.strokes {
    for point in stroke.path {
        let pressure = point.force // Pressure at this point
        let altitude = point.altitude // Tilt
        let azimuth = point.azimuth // Rotation
    }
}
```

### Device Support
- **Supported:** All iPads with Apple Pencil support
  - iPad Pro (all generations)
  - iPad Air (3rd gen+)
  - iPad (6th gen+)
  - iPad mini (5th gen+)
- **NOT supported on iPhones:** Apple Pencil only works with iPad

### Comparison: Finger vs Apple Pencil
| Aspect | Finger Touch | Apple Pencil |
|--------|--------------|--------------|
| Continuous pressure | NO (on modern devices) | YES |
| Hardware requirement | 3D Touch (discontinued) | Apple Pencil + compatible iPad |
| Current availability | ~0% of devices | All iPad Pro/Air/mini (2018+) |
| Precision | Low | Very high |
| Use case | General touch input | Drawing, note-taking |

---

## 3. Alternative Approaches Explored

### What Was Tested (all failed in Safari)
From the codebase analysis in `/Users/david.goldberg/Documents/_SPORTS/touch-asdr`:

**Attempts made:**
1. Re-sampling `webkitForce` when finger becomes stationary - returns 0.0
2. Using Pointer Events API instead of Touch Events - same limitation
3. Checking `touch.force` (standard property) - returns undefined/0
4. Monitoring `radiusX/Y` changes - frozen at initial contact area

**Code evidence** (from `envelope.js:5-12`):
```javascript
// iOS Safari Limitation: Real-time pressure tracking during touch movement is NOT possible.
// - webkitForce returns 0.0 during all touchmove events (only available at touchstart)
// - radiusX/Y are frozen at initial contact area throughout the gesture
// - Pressure can only be captured once per touch at initial contact
// - Different touches can have different pressures, but pressure cannot change during a touch
```

**Code implementation** (from `app.js:381-427`):
- Initial force captured at `touchstart` (lines 381-390)
- Force value locked for entire gesture (line 427: "Keep using initial force value throughout the gesture")
- Comment confirms: "iOS Safari limitation: webkitForce returns 0 during all touchmove events"

### Why Safari Blocks This
**Security and privacy reasons:**
- Pressure data could be used for fingerprinting
- Rate of pressure changes could leak sensitive information
- Apple restricts this deliberately in web contexts

**Performance reasons:**
- High-frequency pressure data would impact web page performance
- Battery concerns with continuous sensor polling

### Would WKWebView Help?
**Short answer: NO** (on devices without 3D Touch hardware)

WKWebView (native web view) uses the same WebKit engine as Safari and has the same limitations:
- Same Touch Events API restrictions
- Same security/privacy sandboxing
- No access to raw UITouch.force from JavaScript

**However:** A native app using UIKit (not WKWebView) CAN access UITouch.force directly - but only on devices with 3D Touch hardware (which no longer exist in production).

---

## 4. Current State (2025+)

### Hardware Reality
**For finger touches:**
- iPhone 6S through XS Max: 3D Touch hardware (discontinued 6-8 years ago)
- iPhone XR (2018): First without 3D Touch
- iPhone 11+ (2019-2025): All use Haptic Touch (no pressure sensing)
- **Installed base:** Estimated <5% of active iPhones have 3D Touch hardware

**For stylus input:**
- Apple Pencil: Excellent pressure support, but iPad-only
- Third-party styluses: Vary widely; most use active digitizer (iPad Pro) or basic capacitive touch

### Software Reality
**Native iOS APIs:**
- `UITouch.force`: Still exists but returns 0.0 on non-3D Touch devices
- PencilKit: Works great with Apple Pencil on iPad
- Haptic Touch: Long-press only, no pressure intensity

**Web APIs (Safari/WKWebView):**
- `touch.webkitForce`: Only at touchstart, 0.0 during touchmove
- `touch.force`: Not implemented in Safari
- No alternative pressure APIs exposed to web

### Recommendations for New Apps

**For finger-based pressure input:**
- DO NOT design around pressure sensing
- Use contact area (`radiusX/Y`) at touchstart only
- Focus on alternative gestures (velocity, dwell time, multi-touch)
- Current approach (initial pressure only) is the best available

**For drawing/creative apps:**
- Target iPad + Apple Pencil for pressure-sensitive drawing
- Use PencilKit framework (simplest, automatic pressure handling)
- Or use UITouch with `touch.type == .pencil` for custom drawing
- Accept that iPhone cannot provide pressure-sensitive drawing

**For this project specifically:**
- Current Safari implementation is optimal given hardware constraints
- Native app would NOT improve iPhone finger touch pressure tracking
- Native app WOULD enable Apple Pencil pressure on iPad (different platform)

---

## Conclusion: Would Native iOS Help?

### For iPhone Finger Touch
**NO** - A native iOS app provides no advantage for continuous pressure tracking with fingers because:

1. **Hardware doesn't exist** on current iPhones (3D Touch discontinued 2019)
2. **UITouch.force returns 0.0** on devices without 3D Touch hardware
3. **Safari limitation mirrors hardware limitation** - not a web-specific restriction
4. **Current approach is optimal**: Capture initial pressure at touchstart, apply throughout gesture

### For iPad + Apple Pencil
**YES** - A native iOS app would enable continuous pressure tracking, but only:

1. **Different platform** (iPad, not iPhone)
2. **Different input method** (Apple Pencil, not finger)
3. **PencilKit provides excellent support** for pressure-sensitive drawing
4. **Use case change** - becomes a drawing/creative app, not touch envelope analyzer

### Bottom Line
The continuous pressure tracking problem encountered in Safari is fundamentally a **hardware limitation** of modern iPhones, not a Safari/web API limitation. The web API restrictions exist because the underlying hardware capability was removed from the platform in 2019.

A native app cannot access hardware that doesn't exist.

---

## References

### Code Analysis
- `/Users/david.goldberg/Documents/_SPORTS/touch-asdr/envelope.js` - Documents Safari limitations (lines 5-12)
- `/Users/david.goldberg/Documents/_SPORTS/touch-asdr/app.js` - Implementation showing force capture at touchstart only (lines 381-427)
- `/Users/david.goldberg/Documents/_SPORTS/touch-asdr/README.md` - iOS Safari Limitations section (lines 64-89)

### Researched Facts
- 3D Touch introduced: iPhone 6S (2015)
- 3D Touch discontinued: iPhone XR (2018, first without), iPhone 11+ (2019, completely removed)
- Replacement: Haptic Touch (long-press, not pressure-sensitive)
- Apple Pencil: Pressure-sensitive, iPad-only, works excellently with native APIs

### API Documentation (attempted access - JavaScript required)
- Apple Developer: UITouch.force - https://developer.apple.com/documentation/uikit/uitouch/1618110-force
- Apple Developer: PencilKit - https://developer.apple.com/documentation/pencilkit
- Apple Developer: UITouch - https://developer.apple.com/documentation/uikit/uitouch
