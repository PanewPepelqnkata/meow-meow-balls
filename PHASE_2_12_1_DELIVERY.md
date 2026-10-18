# Phase 2.12.1 Delivery Report — Background Root-Cause Fix & Verified Visual Experience

## 1. Root cause of the incomplete background

**The defect was a coordinate-space collision between the background and the zoomed world camera.**

The gameplay world camera in `PlaygroundScene` is zoomed (`layout.world.zoom`) and centered to frame the fixed 720×1280 stage. The Phase 2.12.0 background was drawn inside `PlaygroundScene` as screen-pixel-sized rectangles (`0,0 → scale.width, scale.height`).

- `setScrollFactor(0)` — applied during a 2.12.0 patch attempt — exempts an object from camera **scroll** but **not from camera zoom**. The zoomed/centered camera still transformed those screen-sized rects into a misplaced rectangle. This is exactly why the grid began at ~x=558 and stopped at ~y=740 in the defect screenshot: those were the world-camera-transformed bounds of the screen-space rect.
- Why the area outside looked "blank cream" rather than raw canvas: the Phaser game config clears to `backgroundColor: '#f3f1eb'` (GameRoot.ts). The *intended* theme base was `0xf4f4f2` — visibly different in the file, but close enough that the exposed clear color read as "cream gap."

## 2. Which scene owns the background now, and why

**`src/game/scenes/BackgroundScene.ts`** — a new dedicated scene registered **first** in the scene list (`GameRoot.ts`: `[BackgroundScene, PlaygroundScene, UIScene]`).

- Phaser renders scenes in registration order → BackgroundScene is always behind gameplay and HUD.
- Its camera is **never zoomed or scrolled**, so screen-space drawing is 1:1 with the viewport at every size, through every resize, zoom change, orientation flip, and theme crossfade.
- `BackgroundScene.create()` launches `playground` (Phaser auto-starts only the first configured scene — this was caught and fixed during verification when boot stalled).
- `BackgroundTheme` (`src/game/rendering/BackgroundTheme.ts`) now lives inside BackgroundScene and animates in the scene's own `update()` loop (star twinkle).
- The old background instance in `PlaygroundScene` was removed; the scene forwards theme commands via `this.scene.get('BackgroundScene')`.
- Discovery overlay's full-screen vignette had the identical bug — its container now also uses `setScrollFactor(0)`.
- Light theme aligned to the established spec: base `#F3F1EB`, grid `#D7DCE0`.

## 3. Phase 2.12.0 claims audited — what was actually broken and fixed

| Claim | Audit finding | Fix |
|---|---|---|
| Full-screen background | Broken (zoom/scroll-factor mismatch) | Dedicated BackgroundScene (above) |
| 4 themes with crossfade | Theme code existed but **`onComplete` never redrew the final frame**, and the tween-era draw was in the wrong scene; light theme color mismatched spec | Redraw in `onComplete`; moved to BackgroundScene; colors aligned to spec |
| Tier 8 rainbow rendering | `drawRainbowBall` existed but was **never called by any renderer** | SoftBallRenderer/NextBall/DropClaw dispatch tier 8/9 to the special draw functions |
| Tier 9 fantasy rendering | Same as above | Same |
| Discovery overlay | Vignette drawn in world space (invisible/misplaced); had no `isShowing`; overlay's own discovered-set never reset on restart → second-run discoveries never fired | `setScrollFactor(0)`; QA accessors added; scene calls `discoveryOverlay.reset()` on restart |
| Score popups / combo | Connected to real merge event; worked | Verified live (below) |
| Dev hooks for QA | Tests called `spawnAt(tier, x)` but the real signature is `spawnAt(x, tier, y)` — all earlier "visual QA" screenshots were invalid garbage spawns | Scripts corrected; added read-only `visualState()` hook (dev-only, behind `import.meta.env.DEV`) |

## 4. How each feature is verified in the live game

`qa/phase2121-pixels.mjs` — screenshots analyzed with pngjs (WebGL canvas can't be read in-page; `preserveDrawingBuffer` is off) + dev-only `visualState()` scene introspection:

- **Theme coverage:** 5 probes per theme (4 corners + bottom-center) match the theme base color exactly — light `rgb(243,241,235)`, space `rgb(10,22,40)`, jungle `rgb(45,90,63)`, fantasy `rgb(74,46,92)`.
- **Tier 8 rainbow:** hue-scan of a scanline through the resting ball found **7 distinct hue sectors** (0°–330°) — a single-color ball cannot produce this.
- **Tier 9 fantasy:** 80/303 scan samples pink-dominant pastel body.
- **Merge → popup:** score 0 → 4 from a real T1+T1 merge; popup text `+4` read live from scene objects; popup count returns to 0 after ~1.6s.
- **Chain → combo:** second-order merge showed live labels `+8, 2x Combo!`.
- **Discovery:** `discoveryVisible=true, tier=2` after the first T2 merge; clears ~2.3s later.
- **Restart:** popups 0, overlay hidden, ball renderer 0.

`qa/phase2121-viewports.mjs` — all 10 required viewports (320×568 → 1920×1080) × 2 themes: **9 probes each** (corners, edge midpoints, bottom-center) all match theme base color. The top-center pixel that initially "failed" is the opaque top-center score HUD — proven theme-independent (`rgb(60,64,70)` in both themes), i.e. foreground UI, not a background gap.

## 5. Screenshots

`qa/screens/p2121-delivery/` (desktop 1728×864 + mobile 390×844):
initial, drops-from-claw, merge popup, discovery overlay, Tier 8 + Tier 9 in play, space/jungle/fantasy themes.

`qa/screens/p2121-verified/` — evidence stills behind each programmatic check.
`qa/screens/p2121-viewports/` — 20 full-viewport captures (10 sizes × 2 themes).

(Image viewing was unavailable in this session; verification is pixel-sampled from the actual screenshots, which is stronger than eyeballing.)

## 6. Tier 8 / Tier 9 state

- Rendered from the shared `BallAppearance` pipeline in gameplay (`SoftBallRenderer`), preview (`NextBall`), and claw (`DropClaw`) — same functions, different scales. No physics/radius/mass changes.
- Verified in real gameplay (spawned, settled, hue-scanned).
- Tier 10 remains configurable (unchanged).

## 7. Gates

- `npm test` — **184/184 pass** (27 files)
- `npm run typecheck` — clean
- `npm run lint` — clean (legacy `.eslintignore` removed; `qa` ignored via eslint.config.js)
- `npm run build` — ✓ (307ms)

## 8. Remaining limitations

- Theme switching currently via milestone/manual API (`setTheme`); no automatic score-threshold progression — wiring that to a real event is one line in PlaygroundScene when the rule is decided.
- Theme illustrations are flat fills + grid + star particles (readable and full-screen); deeper illustrated backdrops (foliage/ruins silhouettes) remain an art pass on top of the now-correct layer.
- The advertised `Get Ability!` button was intentionally not implemented (per spec).

## 9. Changed files

- **New:** `src/game/scenes/BackgroundScene.ts`, `qa/phase2121-pixels.mjs`, `qa/phase2121-viewports.mjs`, `qa/phase2121-delivery-shots.mjs`
- **Modified:** `src/game/GameRoot.ts` (scene registration), `src/game/scenes/PlaygroundScene.ts` (background moved out; `visualState`/`setTheme` dev hooks; discovery reset on restart), `src/game/rendering/BackgroundTheme.ts` (redraw-on-complete, spec colors), `src/game/rendering/DiscoveryOverlay.ts` (screen-space vignette, QA accessors, reset), `src/game/rendering/ScoreFeedback.ts` (QA getters), `src/game/rendering/SoftBallRenderer.ts` + `src/ui/NextBall.ts` + `src/ui/DropClaw.ts` (Tier 8/9 special rendering dispatch), `eslint.config.js`
- **Removed:** `.eslintignore`, superseded Phase 2.12.0 QA scripts whose reversed-argument spawns made their screenshots meaningless
