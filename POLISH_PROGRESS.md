# Ball Rush — Master Engineering, Optimization & Polish Takeover
**Status Log & Architecture Roadmap**

---

## Leaderboard podium polish — 2026-11-03

- Rounded pastel podium blocks and a pill-shaped plinth replace the hard-edged pedestal styling.
- Podium balls retain their gameplay faces without sunglasses or sparkle rays; the champion wears a curved, pearl-tipped crown.
- Highlight and plinth corner radii stay within half their height to prevent protruding corners on mobile.
- Desktop keeps the podium beside the existing table; mobile keeps the stacked layout.


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
       ├──► TitleScene (Ball Rush Kingdom courtyard menu, journal/leaderboard/collection/store/settings)
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
  - Enhance merge juice: subtle screen shake on combo $\\ge 2$, tier-scaled impact feedback.
  - Add optional synthetic Web Audio sound effects for drop, bounce, merge, and ability.
- [ ] **PHASE 6: UI/UX & Touch Envelopes**
  - Enforce minimum 44px touch targets across Settings, Navigation, and Game Over.
  - Fix blurry text resolution in `ScoreFeedback.ts` and UI text surfaces.
  - Improve Game Over responsive scaling on small mobile displays.
- [ ] **PHASE 7: Dead Code & Architecture Cleanup**
  - Prune `BallRenderer.ts`, `MenuButton.ts`, and legacy rigid body references.
  - Clean up type casts and assert clean test suites across all 39 test files.
- [ ] **PHASE 8: Adversarial Verification**
  - Verify complete lifecycle on mobile viewport (390x844 DPR 2/3) and desktop (1280x800).

## 5. Collection Book and Secondary Menus — 2026-10-28

- `CollectionBookView` lays out each paper leaf in its own local coordinates. Core tiers and Tier 9 variants occupy four entries per leaf; crab artwork and field notes use separate leaves. Text, portraits, stamps, and page numbers reserve the binding gutter and stay inside the parchment. Discovery dates remain visible on recorded entries.
- Page turns lift only the source paper leaf, reveal the destination underneath, and settle its readable back face across the spine. The leather cover, rings, bookmarks, and navigation never scale with the sheet. Bookmark and Prev/Next hit zones persist across turns, including rapid successive navigation. Horizontal swipes start only inside the paper.
- TitleScene owns the book lifetime. Back, PLAY, resize, panel rebuild, and shutdown dispose its active tween, live-art timer, and scene-level swipe listeners. Relayout follows GameRoot's settled `br:dpr` event rather than intermediate native resize dimensions.
- Headers reserve separate Back/title bounds. Narrow home navigation prioritizes readable labels; PLAY retains its animated character. Secondary menus use the existing blue tactile button style without a duplicate DOM input path.
- Leaderboard displays the saved local top ten, with two five-row columns in short landscape and a bounded empty state. Settings persists background choices, displays lifetime statistics, and resets saved progress only after a second distinct tap within four seconds. Navigation and timeout cancel reset confirmation; reset refreshes home and HUD best scores.
- Browser smoke covered 320×568, 390×844, 844×390, and 1280×800: all four chapters, forward/backward turns, Prev/Next, swipe, populated/empty leaderboard, persisted theme choice, reset expiry/confirmation, and Back/resize during an active turn.


## 6. In-Game Pause Menu — 2026-10-28

- A 48px blue pause control sits at the HUD's safe right edge, vertically centered on the score row on desktop and portrait phones. Its top outline stays below the safe-area boundary. It is hidden with discovery-card HUD chrome and disabled when game over owns the run.
- `PauseScene` stays active over scene-paused `playground` and `UIScene`. Physics, world/HUD timer events, abilities, held-ball cooldown, and wall countdown do not advance behind the card. Resume preserves score, balls, queue, and consumed charges; its release cannot drop a ball.
- `PauseMenuView` uses the game's cream card, thick ink outline, blue mascot, Lucide icons, and blue/red tactile buttons. Portrait stacks Resume, Restart, Settings, and Main Menu; landscape uses a two-column action grid. The dim backdrop consumes outside taps rather than dismissing the menu.
- Restart uses the existing full run reset and restores the ball queue and one-use abilities. Main Menu resets the abandoned run and uses the same navigation route as Game Over; PLAY can start again normally.
- Settings opens TitleScene's existing Settings screen in one-shot `returnToPause` mode. Theme changes persist normally, but Back restores the paused card without resuming or resetting the run. No duplicate settings implementation or audio controls are introduced.
- Gameplay deadlines and input cooldown use one active-time clock rather than wall time. UI hit testing converts buffer-pixel pointers through the HUD camera; control taps never consume a drop or its cooldown. Input regression tests cover UI releases, paused cooldown boundaries, and restart while input is disabled.
- Browser smoke covered 320×568, 390×844, 844×390, and 1280×800, including live falling balls, a scored merge, wall countdown, shortcuts, all pause actions, paused settings return, and orientation changes.


### Pause-card spacing polish — 2026-10-28

- Rebalanced `PauseMenuView` around rendered title/score heights instead of nominal font blocks. Portrait action gaps are now 18px on compact phones and 20px on standard phones; landscape row gaps are 16px with a 10px column gap. These account for the ChunkyButton extrusion so visible button edges no longer touch or overlap.
- Added responsive card insets and a 9px bottom-slab allowance. Verified card/button containment and minimum 44px touch heights at 320×568, 390×844, 844×390, and 1280×800; visible row clearances are 7.75–9.75px portrait and 5.75px landscape.

## 7. Glossy Telescoping Container — 2026-10-29

- Preserved normal desktop/portrait playable proportions, invariant sloped wall lines, fixed floor, and transparent interior. Raise Walls now adds 255 stage units on desktop (320→575) and 120 on portrait phones (400→520), 25% less extra lift; the 900 ms raise/lower, 25 s hold, and one-use behavior are unchanged.
- `ContainerView` caches the glossy royal-blue lower U and two narrow sliding sleeves at native texture resolution. Broad charcoal/cream stripes, navy bevels, and a cyan inner lip share the same artwork pipeline. Each sleeve slides behind the stationary lower frame through one fixed collar; no frame repaint, crop, stretch, or canvas upload occurs during movement.
- Flat chamfered caps use `tipCollidersAt()` vertices for both rendering and Matter collision. Cached cap graphics and sleeves translate with every live animator update instead of trailing the old 24-unit repaint quantization. Combo glow rebuilds its geometry only while active after the wall height changes.
- Browser smoke completed raise→hold→lower on 1280×800 desktop and 390×844 DPR-3 emulation. Floor drift was zero; rendered cap vertices agreed with live Matter vertices within floating-point tolerance; sleeve dimensions stayed fixed; container texture update/refresh calls remained zero. Physical-iPhone smoothness is not claimed from emulation.

## Coin balance and token polish — 2026-11-05

- The home screen separates the saved coin balance from lifetime score and collection progress. The balance uses a dedicated outlined pill in the top-right safe area on desktop and compact landscape, and beside the stats pill in portrait; the two portrait bounds reserve a gap.
- Replaced the generic layered coin circles with a bold arcade token: dark offset edge, warm gold rim, inset face, and compact Ball Rush face emblem. `drawCoin` remains shared by the menu balance and game-over earnings row.
- Browser verification is pending for 390×844 DPR 3, 844×390, and 1280×800. Compare the coin/stats bounds with the viewport and logo, and check coin-face readability at menu and game-over sizes.

## Main menu Kingdom cutover — 2026-11-07

- Replaced the legacy home-screen layout and DOM button overlay with `KingdomMenuView`, `KingdomStallArt`, `KingdomMenuEffects`, and `KingdomWidgetsArt`: a dark timber merchant recess, animated red/cream canopy, warm lantern atmosphere, crested `BALL RUSH` logo, carved stats plaque, timber signboard navigation, and the glass Magical Ball Capsule on its counter.
- Removed dead `src/ui/UiverseDomButtons.ts` and the `.uiverse-btn-layer` CSS rules from `src/index.css`; updated QA fallback PLAY tap coordinates in `qa/lib-game.mjs` and `qa/verify-prod-diag.mjs`.
- Preserved all existing route handlers (`PLAY`, `LOGIN`, `LEADERBOARD`, `COLLECTION`, `STORE`, `SETTINGS`), `state:save` and auth listeners, `prefers-reduced-motion` handling, and `__brMenu` QA hooks. Verified across 1440×900 desktop and 390×844 / 393×852 / 430×932 mobile portrait viewports.

## Store-style main menu — 2026-11-08

- Replaced the courtyard/castle rendering with a dark planked merchant stall, inked timber posts, red/cream canopy, and a dedicated counter supporting the glass gumball machine. Removed the retired courtyard/landscape painters and signpost bake paths.
- Canopy scallops animate as live cloth; two wrought-iron lantern rigs share cached radial lighting, layered flame flicker, pendulum swing, and breathing warm light. Fourteen bounded dust motes and rare hardware/counter twinkles keep the scene warm without filling the navigation area with effects.
- Native React controls retain navigation and live saved statistics. PLAY uses the Store green beveled hero treatment; secondary controls and the progress plaque use carved timber with brass hardware. Responsive layouts separate title/progress, machine/counter, and navigation; hidden/reduced-motion menus stop scene animation.

## Soft-body deformation protection — 2026-11-10

 - Applied the existing small-ball shape-integrity controls to tiers 2–3 and the same-radius tiers 8–12 without making them rigid. Those tiers use a 0.52 minimum ring-radius floor, a 1.04 upper envelope, smoothed adjacent-particle transitions, and a protected bulge cap; rim/spoke compliance remains adaptive.
 - Tier 1 retains its proven 0.68 inner-ring floor and firmer stiffness. Tiers 4–7 retain the normal 0.36 floor and flexible bulge response.
 - The tier 2, 3, and 8 Tier-7 corner-load regressions require a peak within-frame radial span above 0.15× nominal ring radius, alongside radial, neighbor-continuity, area, and aspect integrity bounds. Tier-class selection is checked through tier 12.
 - Focused tier-group tests (4 passed), all soft-body tests (17 passed), and `npx tsc --noEmit` pass. `npm test` currently has two unrelated failures that reproduce at pushed baseline `3fe11c0`: `merge-cooldown.test.ts` replacement chain contact revalidation and `merge-gameplay.test.ts` maximum-squeeze contour jump.
## Adaptive audio and Settings controls — 2026-11-10

- Added a GameRoot-owned Web Audio director with independent Music/Effects gains, first-gesture unlock, visibility suspension, and Phaser teardown. The 84 BPM twilight soundtrack and SFX are synthesized at runtime; no downloaded audio assets or packages. Mix levels were reduced after the user reported ear discomfort.
- UI hover/accepted-release, drop, floor landing, merge reward, ability, pause/resume, and game-over cues are event-driven. Floor landings are deduplicated per ball per drained frame; no sound work runs in the physics substep.
- Settings has separate Music/Effects sliders and independent mute toggles; slider writes coalesce during dragging and flush on release/exit. Progress reset preserves audio preferences. The lingering theme explainer note was removed.
- ChunkyButton pointer release survives pointerout and cancels on pointerupoutside. Unit tests cover one activation and outside cancellation. Browser smoke at 390×844 verified Settings→Back clears the note, and one Play press enters gameplay without JS errors. Headless audio loudness was not independently measured by listening.
 - Focused UI/settings/landing tests: 65 passed. TypeScript and production build passed. Latest `npm test`: 61/63 files passed; the two known merge physics failures (`merge-cooldown` contact revalidation and `merge-gameplay` contour jump) also reproduce at pre-audio baseline `3fe11c0`.

- Compact portrait Settings now places the Account card directly below the fixed header and before theme/audio controls; Account and Login targets fit at 320×568. Browser clicks opened the Account screen and the username/password Login modal. The fresh test profile was signed out, so this did not verify an existing user session.

- Account backend recovery — production was missing migration `20261111000000_container_skins_and_royal_keep.sql`; deployed that existing reviewed migration after dry-run confirmed it was the sole pending migration. Production now reports the profile skin columns and Account overview/equip RPCs present. The wardrobe previously discarded overview errors, and several mutation paths leaked rejected RPC promises; these now surface errors and use the authenticated overview to hydrate the profile cache. Added regressions for missing/malformed overview data, profile recovery after direct profile-read failure, and rejected mutation RPCs. `auth-session.test.ts` (45 passed), TypeScript, and `git diff --check` passed. Browser session was signed out; authenticated user-specific profile/mutation behavior remains unverified.

- Resize renderer repair — bounded throne backrest geometry prevents negative velvet gradient radii during collapsed viewport rebuilds. Removed the unused no-op Round Table front painter/image that left `br-round-table-front` texture consumers orphaned; the carousel now owns only its rendered back image. Added narrow phone/tablet/desktop geometry regressions. Fresh resize stress across 320×568, 390×844, 667×375, and 1280×800 found zero browser/console errors, no `br-round-table-front` texture, and valid frame sources on every live Round Table image. Focused geometry tests: 17 passed; TypeScript and `git diff --check` passed.

## Account refresh and compact layout — 2026-11-11

- Account overview hydration now writes changed container cosmetics without broadcasting `state:save`, so TitleScene no longer rebuilds and destroys the open wardrobe during its own refresh. Unchanged cosmetics still write nothing. Both cases persist the authoritative owned and equipped skins.
- Compact Trophies and Ledger geometry is now pure and shared. Short screens page fewer rows, reserve one pager inset, and keep title controls at least 36px tall. Every non-wide passport reserves metadata start, a 31px pill gap, the action button, and its inset, while leaving statistics above 80px.
- Follow-up: the first floor stayed at 187px above 420px body height, leaving the 520px passport only 25px of metadata clearance. The floor is now derived from those reserves.
- `KingsWardrobeLayout.test.ts`: 10 passed after the follow-up. `auth-session.test.ts`: 47 passed. TypeScript and production build passed before the passport follow-up. No browser reproduction in this pass.
