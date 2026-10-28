# Ball Rush — Master Engineering, Optimization & Polish Takeover
**Status Log & Architecture Roadmap**

---

## 1. System-by-System Architectural Map

### Core Pipeline
```
[React / Browser DOM: GameCanvas.tsx]
       │
       ▼ createGame(parent: HTMLElement)
[Phaser.Game] (Scale.NONE, Buffer capped at DPR 2, physical buffer / CSS size)
       │
       ├── Scene Sequence: [BackgroundScene, PlaygroundScene, UIScene, TitleScene, StartIntroScene]
       │
       ├──► BackgroundScene (Backdrop gradient, stars, camera zoom = displayScale)
       ├──► PlaygroundScene (Matter.js 120Hz physics, SoftBallManager, MergeSystem, DropClaw, ScoreSystem)
       ├──► UIScene (1:1 HUD camera, ScoreDisplay, AbilityBar, NextBall, GameOverView, DiscoveryOverlay)
       ├──► TitleScene (Uiverse DOM button overlay, gumball machine, journal/leaderboard/collection/settings)
       └──► StartIntroScene (Transient gumball/iris transition overlay)
```

### Event Bus Architecture (`src/game/state/gameBus.ts`)
- Pure TypeScript typed singleton event bus.
- Decouples UI (`UIScene`, `TitleScene`) from World Simulation (`PlaygroundScene`, `PhysicsWorld`).
- Resets are coordinated via `ui:restart` without reconstructing Phaser Scene graphs.

---

## 2. Audit Findings Matrix

### Critical
1. **Ghost Ball Freeze on 3-Way Collision Races (`MergeSystem.ts:274-277`)**:
   - `this.reserve(ea) || !this.reserve(eb)`: If ball A succeeds in transition to `'merging'` while ball B fails reservation, ball A is permanently orphaned in the `'merging'` state. It never settles, never merges, and cannot be cleared.
   - *Fix*: Atomic two-phase reservation with automatic rollback of $A$ if $B$ fails.
2. **Missing Touch Event Interception (`preventDefault`) on Canvas (`InputSystem.ts:47-56`, `GameCanvas.tsx`)**:
   - iOS Safari disregards `touch-action: none` on multi-finger taps or edge drags, causing pull-to-refresh or navigation gesture conflicts.
   - *Fix*: Explicit non-passive touch listeners calling `preventDefault()` on canvas container.
3. **PWA Offline Failure & Manifest Inconsistencies**:
   - Manifest references a service worker that doesn't exist; manifest theme colors flash cream before loading navy space theme.
   - *Fix*: Correct manifest colors and provide clean standalone configuration.

### High
1. **Per-Frame Dynamic Allocation Deluge in Soft-Body Contour & Physics (`SoftBall.ts:660-760`, `BallAppearance.ts:210-250`)**:
   - Catmull-Rom interpolation and `wobbleContour` allocate upwards of **288,000 temporary vector objects per second** at 120Hz on ProMotion devices via successive `.map()` operations.
   - *Fix*: Point buffer pooling and in-place vector mutation across `renderContour` and `wobbleContour`.
2. **Safe-Area Clipping on TitleScene (`TitleScene.ts:360-435`)**:
   - Hardcoded margins in TitleScene ignore `readSafeArea()`, colliding logo with Dynamic Island / notch and clipping bottom navigation into home indicator bar.
   - *Fix*: Apply `readSafeArea()` in TitleScene layout calculations.
3. **Severe Touch Target Violations (< 44x44px) & Panel Squeezing (`TitleScene.ts`, `GameOverView.ts`)**:
   - Settings toggles shrink to 23px; Game Over buttons scale down to 27px on small mobile displays. Navigation panels lack vertical scroll containers.
   - *Fix*: Enforce minimum 44px touch envelopes and responsive modal scroll clamping.
4. **Resolution Scaling Defects on Game Over and In-Game HUD Text (`ScoreFeedback.ts:105-139`)**:
   - Floating scores and combo banners hardcode `resolution: 1` on Retina DPR 2/3 displays, causing visible pixelation and blurry text.
   - *Fix*: Bind resolution dynamically to `dpr`.

### Medium
1. **Container Clamp Asymmetric Escape Vulnerability (`SoftBallManager.ts:1017-1023`)**:
   - Horizontal projection distance instead of orthogonal distance allows high-compression lateral squashes to skip boundary clamping.
2. **TitleScene Resize Layout Flash (`TitleScene.ts:175-176`)**:
   - `buildAll()` executes before `applyDprCamera()` on resize events, causing a 1-frame visual layout glitch during orientation flips.
3. **Missing Sensory Audio Feedback**:
   - Audio infrastructure is completely missing from merge impacts, ball drops, and ability activation.

### Low & Dead Code
1. **Zombie / Deprecated Files**:
   - `src/game/rendering/BallRenderer.ts` (100% unused rigid renderer)
   - `src/ui/MenuButton.ts` (100% unreferenced legacy button class)
   - `src/utils/fit.ts` (unused utility)
   - Legacy rigid branches in `src/game/systems/MergeSystem.ts`

---

## 3. "DO NOT TOUCH" Systems (Working as Intended)
- **Soft-Body Slime Ring Dynamics (`SoftBall.ts`)**: Ring topology (16 particles), spoke compliance (0.18), rim stiffness (0.5), and gas pressure damping are exceptionally well-tuned. Do not rewrite the spring mesh or pressure model.
- **Physics Fixed Accumulator (`PhysicsWorld.ts`)**: 120Hz fixed substepping ensures deterministic behavior across 60Hz and 120Hz ProMotion screens without time dilation.
- **Doodle Visual Silhouette Generator (`doodleSilhouette`, `rough` styling)**: Procedural card outlines and ink outlines are consistent and high-quality.
- **DropClaw Mechanical Linkage & Easing**: 2-element articulated arms and hydraulic bracket animations are fully working and verified.
- **Game Bus Protocol (`gameBus.ts`)**: Typed singleton event dispatch is clean and properly decoupled.

---

## 4. Master Takeover Phased Execution Roadmap

- [ ] **PHASE 2: Critical Bugs & Stability**
  - Fix 3-way merge reservation race condition in `MergeSystem.ts`.
  - Fix container boundary orthogonal clamp in `SoftBallManager.ts`.
  - Add native non-passive gesture suppression on canvas touch events.
- [ ] **PHASE 3: Runtime Performance & GC Optimization**
  - Pool vector allocations in `SoftBall.ts:renderContour`.
  - Eliminate `.map()` heap allocations in `BallAppearance.ts:wobbleContour`.
  - Pre-allocate collision queue arrays in `PhysicsWorld.ts`.
- [ ] **PHASE 4: Mobile & PWA First-Class Polish**
  - Apply `readSafeArea()` to `TitleScene.ts` top/bottom margins.
  - Optimize responsive layout DOM probe to eliminate resize layout thrashing.
  - Fix manifest theme color consistency and standalone meta tags.
- [ ] **PHASE 5: Game Feel & Impact Tuning**
  - Enhance merge juice: subtle screen shake on combo $\ge 2$, tier-scaled impact feedback.
  - Add optional synthetic Web Audio sound effects for drop, bounce, merge, and ability.
- [ ] **PHASE 6: UI/UX & Touch Envelopes**
  - Enforce minimum 44px touch targets across Settings, Navigation, and Game Over.
  - Fix blurry text resolution in `ScoreFeedback.ts` and UI text surfaces.
  - Improve Game Over responsive scaling on small devices.
- [ ] **PHASE 7: Dead Code & Architecture Cleanup**
  - Prune `BallRenderer.ts`, `MenuButton.ts`, and legacy rigid body references.
  - Clean up type casts and assert clean test suites across all 39 test files.
- [ ] **PHASE 8: Adversarial Verification**
  - Verify complete lifecycle on mobile viewport (390x844 DPR 2/3) and desktop (1280x800).
