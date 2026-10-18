# Phase 2.12.2 Delivery Report — Full-Screen Discovery Modal, Layering, and Verified Presentation

## 1. Precise cause of the inset overlay

`DiscoveryOverlay` was instantiated **in `PlaygroundScene`** — the world scene, whose camera is **zoomed** (`layout.world.zoom`) and `centerOn`-framed to the fixed 720×1280 stage. The overlay's dim `Graphics` rect was sized in screen pixels (`scale.width × scale.height`) and marked `setScrollFactor(0)`.

**`setScrollFactor(0)` exempts an object from camera scroll but not from camera zoom.** The zoomed/centered camera therefore transformed the screen-sized dim into a smaller, displaced rectangle — exactly the reported panel starting ~48px from the left and ~12px from the top, ending before the right edge. The HUD stayed bright because it belongs to UIScene (a *different* camera), which the dim never covered — the dim was dimming world-space coordinates, not the HUD scene above it.

This is the same class of coordinate-space defect as the 2.12.1 background bug, in the opposite direction: the background needed to *leave* the zoomed camera's scene; the overlay needed to *join* a 1:1 camera's scene.

## 2. Scene/camera changes

- **Discovery modal moved to `UIScene`** (`src/game/scenes/UIScene.ts` owns a `DiscoveryOverlay` instance). UIScene's camera is exactly 1:1 with the viewport — no zoom, no scroll — the same proven property that makes `GameOverView`'s full-screen dim correct.
- **World → UI trigger:** PlaygroundScene's merge handler now emits `gameBus.emit('discovery:show', { tier, seed })` (new typed event in `gameBus.ts`). First-time-tier *state* stays with the world scene; *presentation* lives in the screen-space scene.
- **Seed consistency:** `MergeSystem.onMerge` now passes the replacement ball's real appearance seed, so the modal shows the exact character that spawned (the previous seed was synthesized from the clock).
- No changes to scene ordering (BackgroundScene → PlaygroundScene → UIScene), world camera, physics, or layout.

## 3. How full-screen bounds are calculated and updated

`DiscoveryOverlay.show()` builds from `scene.scale.width/height` of the UIScene — since that camera is 1:1, these *are* viewport dimensions:

- Dim: `scene.add.rectangle(vw/2, vh/2, vw, vh)` at depth 80 — no masks, no world coords, no scroll-factor tricks.
- Ball radius: `min(120, max(40, min(vw, vh) * 0.15))`; ball at `(vw/2, vh*0.46)`; label clamped above the bottom HUD zone.
- Headline: bottom-anchored above the ball, **word-wrapped at `vw − 112`** so it can never reach the viewport edges (on 320px it wraps to two lines), plus a scale-fit guard and a top-HUD collision guard (`y − height ≥ 24`).
- **Resize:** a `scale.on(RESIZE)` handler rebuilds the settled presentation at the new bounds (registered once, auto-unregistered on scene shutdown). Restart/shutdown call `reset()` for instant teardown.

## 4. HUD dimming during discovery

Deliberate and consistent: **every HUD element is dimmed uniformly behind the modal** — score, Best/Global, next-ball preview, Check Out, tier progression, ability bar all sit under the single 72% `#101018` dim (depth 80), with the modal content at depths 81–82 above it. No accidentally-bright elements remain (verified per-viewport by edge-strip luminance and the ASCII structure maps).

Input behavior: a full-viewport interactive `Zone` swallows pointer events; `UIScene.isPointerOverUi()` returns true for the whole viewport while the modal shows; the world scene additionally gates `dropBall`, `doSwap`, and `doRaise` through `discoveryBlocking()`. Drops, abilities, and aim are paused mid-reveal; everything restores on fade-out (verified programmatically).

## 5. Screenshot inspection — honest tooling statement

**Direct image viewing is unavailable in this session** (the model harness filters image content — read attempts returned "content filtered"). Per the spec's honesty requirement, I did not claim visual approval from viewing. Instead each screenshot was inspected via **`qa/phase2122-inspect.mjs`**, which renders the actual saved PNGs as ASCII brightness maps plus per-region luminance statistics. From those renders I verified composition directly:

- All four edge strips uniformly dark on all 7 viewports (avg luminance ~78, min ≤ 19 — dim texture of the HUD showing through, no bright edge, no inset boundary).
- Bright centered ball blob at ~46% height with the character face readable in the map.
- Headline row above the ball, tier label below, both centered, clear of edges and HUD.
- 320×568: headline wraps to two lines with wide margins; ball and label centered.

## 6. Required viewport evidence — `qa/screens/p2122/`

For each of 320×568, 390×844, 768×1024, 1280×720, 1648×936, 1728×864, 1920×1080:
`{w}x{h}-1-normal.png`, `{w}x{h}-2-discovery.png`, `{w}x{h}-3-completed.png` (21 files), all produced by real T1+T1 merges in the production merge system (`qa/phase2122-discovery.mjs`).

Automated verification per viewport (63/63 passed): modal active with correct tier · **every edge/corner pixel dark** (4px-granularity scans of all edges) · no bright strip at the reported defect offsets (48,12) · content present in central zone · content centroid within 1.6% of center (worst case, 320px) · world input blocked during modal · modal exits with no stale objects · input restored · restart mid-modal clears popups/overlay/balls.

## 7. Other visual effects re-verified through real gameplay (`qa/phase2121-pixels.mjs`, all passing after the refactor)

- Real merge → live popup text `+4`, score 0→4, popup clears.
- Chain merge → `+8, 2x Combo!`.
- First-time discovery → modal `tier=2`, completes cleanly.
- Tier 8 rainbow (7 hue sectors) · Tier 9 pastel-pink body — in gameplay renders.
- Theme coverage at 10 viewports × 2 themes (`qa/phase2121-viewports.mjs`, 20/20) after the modal refactor.

## 8. Gates

- Tests **184/184** · typecheck clean · lint clean · production build ✓ (315ms)

## 9. Changed files

- `src/game/rendering/DiscoveryOverlay.ts` — rewritten as a UIScene-native screen-space modal (dim, input blocker, content container, resize rebuild, sparkle polish, width-safe headline).
- `src/game/scenes/UIScene.ts` — owns the modal; `discovery:show` subscription; input gating; shutdown reset; `discoveryState()` QA hook.
- `src/game/scenes/PlaygroundScene.ts` — emits `discovery:show` with the real seed; modal instance removed; restart clears score popups (regression fix); ability/drop gating during modal.
- `src/game/systems/MergeSystem.ts` — `onMerge` now carries the replacement's appearance seed.
- `src/game/events/gameBus.ts` — `discovery:show` event.
- `qa/phase2122-discovery.mjs`, `qa/phase2122-inspect.mjs` — new verification tooling.

## 10. Remaining issues

None blocking an acceptance criterion. One honest caveat: because direct image viewing is filtered in this session, the "actual screenshot inspection" was performed via faithful ASCII luminance renders of the saved PNGs (composition, boundaries, centering, and layering are all legible and verified there); a human reviewer can confirm at a glance using the paths in §5.
