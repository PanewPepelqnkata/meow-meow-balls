# BALL RUSH — Art Direction

Version: 0.2 (updated for menu + gameplay reference screenshots — awaiting user review)

---

## 1. Visual Identity Statement

Ball Rush is a bright, bouncy cartoon arcade game. Balls are living characters —
soft, expressive, and eager — inside a bold striped machine. The look is hand-drawn
2D with thick outlines and flat playful shading. Original identity: the user's
reference image sets the *direction* (cute balls, thick outlines, striped container,
grid backdrop); Ball Rush's characters, palette, container design, logo, and UI are
its own.

**Never do:** photorealism, generic 3D spheres, heavy gradients, sterile corporate UI,
or any resemblance to another game's specific characters/logo/art.

## 2. Palette

### 2.1 Ball tiers (10) — bright, instantly distinguishable hues

| Tier | Name (working)  | Base color            | Accent/shade        | Notes |
|------|-----------------|-----------------------|---------------------|-------|
| 1    | Pip             | Sunny Yellow `#FFD93B`| `#E8A200`           | Smallest, wide innocent eyes |
| 2    | Berry           | Coral Red `#FF6B57`   | `#D43D2A`           | Cheerful grin |
| 3    | Sprout          | Leaf Green `#5BC236`  | `#3E8E1F`           | |
| 4    | Splash          | Sky Blue `#3FB4F6`    | `#1F7FBF`           | |
| 5    | Grape           | Violet `#9B5DE5`      | `#6F3BB0`           | |
| 6    | Peachy          | Bubblegum Pink `#FF7EB6` | `#D14E8C`        | |
| 7    | Ember           | Tangerine `#FF8C2E`   | `#D65F0A`           | Largest predictable tier |
| 8    | *(reserved)*    | TBD                   | TBD                 | Awaiting tier 8–10 mechanic from user |
| 9    | *(reserved)*    | TBD                   | TBD                 | |
| 10   | *(reserved)*    | TBD                   | TBD                 | |

Rules:
- Adjacent tiers must not be confusable at a glance (hue distance check).
- One tier = one hue family; never two tiers sharing a hue with different shades only.
- Tiers 8–10 colors are **reserved placeholders** until the user explains the
  tier 8–10 randomization mechanic. Do not finalize or implement.

### 2.2 Environment

| Element            | Color |
|--------------------|-------|
| Page/background    | Off-white `#F4F4F2` with light gray grid lines `#E0E0DE` |
| Container stripes  | Pure black `#1A1A1A` / white `#FFFFFF` diagonal barber stripes |
| Container glass    | Clear panels, subtle white sheen, 15–20% tint only |
| Danger line        | Warm red `#E5484D`, dashed, pulses when balls approach |
| UI primary         | Ink black `#1A1A1A` on cream `#FFF8E7`, accent yellow `#FFD93B` |
| Score popups       | White with black outline, tier-colored accents |

Accessibility: verify tier hue distinctiveness under common color-vision
deficiencies during implementation (contrast/deuteranopia spot check).

## 3. Character Design — the Balls

### 3.1 Construction (vector-style, per tier)
- Perfect circle silhouette (matches the physics body exactly).
- **Thick black outline**: ~4–6 px at base tier, scaling with radius (constant
  visual weight relative to size; never thinner than 3 px on screen).
- Body: flat base color fill + one simple darker crescent shade at bottom-right +
  one white specular highlight blob at top-left (two shapes, no gradients).
- Face: two large oval eyes (white sclera optional — prefer solid dark pupils for
  small tiers, white+pupil for larger tiers), tiny mouth.

### 3.2 Expressions (state machine per ball)
| State     | Trigger                          | Face |
|-----------|----------------------------------|------|
| Idle      | default                          | Neutral-cute; slow blink every 3–6 s |
| Anticipate| a same-tier ball nearby          | Eyes widen slightly |
| Happy     | merge imminent / just merged     | ^ ^ eyes or big smile, brief |
| Startled  | hard impact                      | O mouth, eyes wide, 300 ms |
| Worried   | stack near danger line           | Eyes look up, squiggle mouth |
| Dizzy     | after Shake power-up             | Swirl eyes, 1 s |

Faces are drawn as separate eye/mouth layers so expressions swap without redrawing
the body. Blink = scaleY 0 on eyes for 100 ms.

### 3.3 Personality per tier (subtle, not new characters)
- Same face construction across tiers; vary eye size ratio, pupil size, and
  default mouth so big balls read as "sleepy heavyweights" and small ones as
  "hyper gremlins."

## 4. Container & Environment

- **Container**: a bold arcade machine vibe — black-and-white diagonal striped
  outer frame on side walls; play area enclosed by *clear* panels (bottom and side
  walls visible as glass with a white sheen line and subtle corner screws/rivets).
  Top is open (that's where balls escape — glass rim visually emphasizes the rim).
- **Backdrop**: light gray fine grid (like graph paper), very low contrast; may
  scroll subtly or stay static — static for v1.
- **Danger line**: dashed warm-red line near the top of the container interior,
  with a small skull-free warning glyph (exclamation triangle) at its ends.
  Pulses only when a ball is above it.
- **Drop zone indicator**: subtle vertical guide line / ghost ball showing where
  the upcoming ball will fall.
- **Extend Walls power-up visual**: the striped walls visibly slide upward with a
  ratchet sound and a "clunk" at full extension; they retract with a countdown
  shimmer before they lower.

## 5. Animation Principles

- **Squash & stretch (exaggerated but convincing)**: on landing/impact, balls
  squash along the impact normal up to ~20–25% deformation, recovering with 2–3
  overshoot bounces (damped spring, ~400 ms settle). Stretch while falling fast
  (≤10% elongation). Deformation is *visual only* — the physics body stays a
  rigid circle (explicit: not soft-body simulation).
- **Wobble**: idle stacked balls breathe subtly (1–2% scale oscillation, staggered
  phases) so stacks feel alive.
- **Merge animation (the signature moment)**:
  1. Both balls lock eyes and lean toward each other (50 ms).
  2. Squash together with an inward splash of tier-colored droplets.
  3. New ball pops out at 130% scale, overshoots down to 100% with a jelly wobble.
  4. Ring shockwave + 6–10 droplet particles + score popup floats up.
  5. Chain merges stack a rising pitch and slightly larger ring per chain depth.
- **Dropping**: brief wind-up stretch of the upcoming ball, slight anticipation
  pause (60–80 ms) on release for game feel.
- **Game over**: ball that falls out gets a startled face, camera shake, slow-mo
  200 ms, then container "lights out" dim while UI slides in.
- Easing: springs and back-overs everywhere; almost no linear tweens.
- Mobile budgets: ≤ 60 particles on screen, effect durations clipped to essentials.

## 6. UI Direction

- **Style**: bold arcade cartoon — chunky rounded rectangles, 3–4 px black
  outlines, hard drop shadows (no blur), cream/yellow fills, ink-black text.
- **Typography**: one display font for numbers/logo (rounded, ultra-bold, e.g.,
  a free arcade face like Baloo/Fredoka-family or custom-drawn) + one clean
  support font for body text. Both must be open-licensed.
- **Buttons**: pill or rounded-square, press animation (squash down 5%, shadow
  collapses). Power-up buttons show character-styled icons + a "USED" strike state.
- **Game over screen**: big score count-up, "NEW BEST!" burst if applicable,
  stats row, retry + menu buttons.
- Everything readable at arm's length on a phone; minimum touch target 44 px.
- **Non-monetized by design**: the interface contains no shop, currency, ads,
  deals, timers, or promo surfaces anywhere. Cleanliness is a requirement, not a
  polish item.

## 6A. Screen Layouts (from menu + gameplay reference screenshots)

The two reference screenshots set the composition. Ball Rush adopts the overall
layout with its own original art and strips every commercial element. Both screens
share the grid backdrop, outlined cartoon style, and arcade button language of §6.

### 6A.1 Home screen

Composition, top to bottom (original arrangement — not a copy):

```
┌──────────────────────────────────────┐
│            BALL RUSH (logo)          │
│                          [⚙ settings]│
│                                      │
│      ┌────────────────────────┐      │
│      │   MERCHING MACHINE     │  ← hero illustration: container
│      │   ILLUSTRATION         │    with striped frame, cute balls
│      │   (balls with faces)   │    stacked inside, expressive faces
│      └────────────────────────┘      │
│                                      │
│   ┌──────────────────────────────┐   │
│   │      ▶  P L A Y  ▶           │   │  ← dominant action, largest element
│   └──────────────────────────────┘   │
│                                      │
│  [Best: 12,480]   [🏆 Leaderboards]  │  ← compact row: PB + leaderboard entry
└──────────────────────────────────────┘
```

- **Keep from reference**: grid background; hero machine/container illustration
  with cute faced balls; big Play button; compact profile/PB area; leaderboard
  entry; settings button.
- **Removed from reference**: ads, deals/promo timers, shop & purchase buttons,
  premium currencies, offer walls, monetization panels, decorative clutter.
- Hero illustration is static in v1 (idle blink/wobble animation acceptable as
  polish); it reuses the same ball-rendering pipeline as gameplay — one source
  of truth for ball art.
- Play is reachable in one tap from load. No interstitials, ever.

### 6A.2 Active gameplay screen

The gameplay screenshot is the **primary reference** for the run screen.

```
┌──────────────────────────────────────┐
│ [⏸]      SCORE 12,480          [mute]│   ← slim top bar
│           BEST 18,220                │
│   (danger indicator)      [NEXT ●]   │   ← danger line pulses near container
│  ┌──┐──────────────────────────┐┌──┐ │      top; upcoming-ball preview
│  │▒▒│                          │▒▒│ │      top-right, always visible
│  │▒▒│      open top            │▒▒│ │
│  │▒▒│  ╎ ╎ ╎ danger line ╎ ╎ ╎ │▒▒│ │
│  │▒▒│                          │▒▒│ │   ← container: thick black/white
│  │▒▒│      play area           │▒▒│ │      diagonal stripes on outer
│  │▒▒│     balls merging        │▒▒│ │      walls + bottom, clear glass
│  │▒▒│                          │▒▒│ │      interior, open top
│  └──┘▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒└──┘ │
│   ●──●──●──●──●──●──●──○──●──●       │   ← ball-progression indicator
│                                      │      (horizontal, near bottom)
│  [🧱 Extend]  [💫 Shake]  [🔄 Swap]   │   ← 3 power-up buttons, prominent,
│         within thumb reach           │      USED state struck through
└──────────────────────────────────────┘
```

Element rules:
- **Container = visual focus.** It occupies the majority of vertical space; HUD
  elements are compact and never cover the play area interior.
- Upcoming-ball preview: bordered window with the next ball (full art, idle
  animation) + "NEXT" label.
- Score & personal best: top of screen, display font, one glance readable.
- Ball-progression indicator: all 10 tier balls in a row, smallest→largest;
  tiers reached this run are full-color, unreached tiers are dimmed silhouettes.
  Tiers 8–10 slots exist visually but stay dimmed/locked pending the user's
  mechanic (do not invent their look or behavior).
- Power-up buttons: three equal buttons, icon + short label, one-use-per-run;
  pressed/used states per §6; positioned for thumbs on mobile without covering
  the container.
- Danger indicator: the in-container dashed line (§4) plus an optional slim
  warning strip above the rim that pulses when a ball is above the line. Warning
  only — it never ends the run.
- Pause/settings: small corner button opening a React overlay (resume, restart,
  mute, quit to menu). Never obstructs the container while playing.
- **Explicitly absent during a run**: sidebars, ads, shop icons, currencies,
  unrelated menus.

### 6A.3 HUD ↔ canvas relationship

- The container, balls, effects, drop guide, and in-container danger line are
  **drawn in the Phaser canvas** (they must track physics exactly).
- All chrome — top bar, score/PB, NEXT preview frame, progression indicator,
  power-up buttons, pause, menus — is **React DOM** overlaying the canvas.
- The NEXT preview's ball art is generated by the same Phaser texture pipeline
  and handed to React as an image/data-URL per tier (cached) — one art source,
  two renderers. No Phaser objects are manipulated from React.
- The React HUD reserves layout space (top bar + bottom rows); the canvas
  scales into the remaining space so HUD never overlaps the container.

## 7. Responsive Guidance

### 7.1 Logical stage: decided — 720×1280 (Phase 0)

**Decision made in Phase 0: 720×1280** — full candidate comparison, viewport
calculations, and caveats in `docs/STAGE_SIZE.md`; values live in
`src/config/stage.ts`. Summary: identical ball scale to 720×1400 on modern
portrait phones, ~2× the vertical letterbox for the HUD (151–168 px vs 86–96 px),
~9.4% larger rendering on height-limited desktops, near-exact fill on 320×568.
Stage-internal container margins are config values, so switching to 720×1400
after on-device testing is a one-file change.

> ⚠️ Still calculation-based, not device-verified. Confirm on physical devices
> (TEST_PLAN R1–R5) before Phase 10.

- **Mobile portrait (e.g., 390×844 CSS px, iPhone 14-ish)**: stage ratio 0.5625
  is *wider* than the viewport ratio (≈0.462), so `SCALE.FIT` picks the width
  ratio: scale ≈ 390/720 ≈ 0.54 → the stage renders 390×693, leaving ~151 px of
  vertical letterbox. That spare band is exactly where the React HUD (top bar +
  bottom power-up row) lives.
  - **Implication**: the container occupies the middle ~65–70% of stage height
    (margins in `src/config/stage.ts`), keeping it clear of HUD bands on every
    viewport.
- **Mobile landscape / short screens**: portrait stage letterboxes heavily.
  Acceptable at launch (game is portrait-first); show a "rotate device" hint
  rather than re-laying-out the game.
- **Desktop (16:9, e.g., 1440×900)**: stage centers at height-fit
  (900/1280 ≈ 0.70 → 506 px wide) with large empty margins. The grid backdrop
  fills the full window behind the stage; extra horizontal space hosts the HUD
  (React) — score/PB can move beside the container, power-ups flank it — without
  stretching the container. The container itself never scales beyond a max
  on-screen size cap to avoid feeling inflated.
- Rule for all cases: **never crop the container, never stretch it unnaturally,
  never scale it past its cap**; scale is uniform; HUD reflows in DOM.

### 7.2 Mobile requirements
- Container large enough to play comfortably within the fit-scaled stage.
- Score and upcoming-ball preview readable at arm's length.
- Power-up buttons in the bottom thumb zone, clear of the container interior;
  respect safe-area insets (notch / home indicator).
- No accidental page scroll/zoom during play: `touch-action: none` on the game
  area, viewport meta with `user-scalable=no`, overscroll containment.

### 7.3 Desktop requirements
- Container centered in the available play area; extra width used by the HUD
  (not by stretching the container).
- Mouse aiming + click/hold-release dropping, same clamping rules as touch.
- Identical visual identity and gameplay rules to mobile — one design, two
  input modes, no separate "desktop skin."

## 8. Audio Direction (art-adjacent)

- SFX palette: soft "boing"/"plop" cartoon foley; merge = pop + rising pentatonic
  chime scaled by tier; chain adds sparkle layering. UI clicks = short woodblock.
- Music: light, bouncy, loopable ~90–110 BPM chiptune-lite or ukulele/kalimba
  feel. Off by default? No — music optional but ON at low volume; mute toggle
  always visible.

## 9. Asset Strategy (incremental, zero paid assets)

Phase A (prototype): **runtime vector-drawn** balls via Phaser Graphics — code-
generated textures per tier (body, shade, highlight, eyes, mouth as separate
layers). Zero external files; fast iteration on tier colors/faces; already
"original artwork by construction."
Phase B (polish): replace with custom-drawn vector art (illustrator/Figma/Inkscape
or code-authored SVG) baked to PNG @2x, if a richer look is needed. Faces stay
layered.
Phase C (juice): particle textures, container art, UI skin, fonts (open-licensed),
audio (free CC0 libraries such as Kenney/freesound CC0, or self-synthesized).
This keeps art debt low: gameplay ships on Phase A art, upgrades slot in without
code changes because rendering is isolated in `BallRenderer`/`ScoreFeedback`.
