# Leaderboard Visual Design — Ancient Greek / Valhalla Theme

## Implemented Behavior

The leaderboard is a **celestial hall of heroes**: a marble temple floating among clouds, where the top 3 champions stand on a sun-bleached podium. All static art is baked once via `bakeCanvas`; all motion uses Phaser tweens on transform/alpha only (no per-frame bakes).

### Background

- **Baked texture** `br-lb-bg:WxH` (viewport-sized, DPR-capped) painted once per resize.
- **Sky**: twilight indigo gradient (`#1b2348 → #2c3a6e → #1a1f3a`) with a soft golden-hour glow behind the podium.
- **Marble columns**: two fluted columns frame the content (left/right edges), warm marble gradient (`#e8e2d6 → #f5f0e8 → #f0ebe0 → #d4cec2`), Doric capitals with gold accent bands, stepped bases, ink outlines.
- **Clouds**: subtle wisps baked into the background (alpha 0.06), plus two drifting cloud sprites (`br-lb-cloud`, 140×48 bake) sliding horizontally on `Sine.easeInOut` yoyo tweens (9s/12s, alpha 0.16/0.11) — transform-only motion, skipped under reduced motion.
- **Floor ledge**: marble slab at the bottom (`#d4cec2 → #a8a294`) grounding the scene.

### Podium

- **Gold/silver/bronze blocks** preserved; geometry unchanged.
- **No blue outline** on any podium block — the current user is identified in the table row only.
- **Plinth**: royal-indigo gradient (unchanged in this pass).
- **Crown**: texture key `br-leaderboard-crown-v4`, canvas 160×140 (was 160×120), peak coordinates shifted down 8px so the center pearl + ink outline fit fully inside the texture.
- **One group**: the baked podium image, ball characters (drawn into a dedicated `podiumG` Graphics), rank badges, name/score labels and the #1 crown all live in a single `podiumGroup` Container, so the entrance animation moves the whole monument as one piece.

### Table

- **Scrollable rows**: exactly `entries.length` rows (up to 50) rendered in a masked container — no placeholder/empty rows.
- **Mask**: `GeometryMask` clips rows to the area below the header. The #1 row crown is positioned so the whole 24×18 image stays inside the mask (crown top = row top + 1).
- **Scrollbar**: gold thumb (`0xd4af37`) on a dark track, sized proportionally to visible content, hidden when all rows fit.
- **Scroll input**: wheel (scene-level, bounds-checked), touch drag on rows, drag on thumb. Offset clamped to `[0, maxScroll]`.
  - Wheel handler signature is `(pointer, currentlyOver, deltaX, deltaY)` per `POINTER_WHEEL`; the scroll delta is `deltaY` (the 4th argument).
  - All handlers convert the pointer through `cameras.main.getWorldPoint(pointer.x, pointer.y)` so hit tests are correct under the HiDPI zoomed camera.
  - The input Zone covering the rows area uses `setOrigin(0, 0)` so its top-left sits at the well origin (Zone defaults to center origin).
- **Current user row**: cyan fill/stroke (`0x213d6b` / `0x4fc3f7`). At rank #1 the row keeps the gold fill but the stroke turns cyan and the player name renders cyan — the current user is identifiable even when they lead the board.

### Layout

- Desktop (`vw ≥ 720 && vw > vh`): podium and table side by side.
- Mobile (stacked): podium height is `min(268, max(150, availableH * 0.36))`, further clamped so the table keeps at least 120px; the table takes the remaining height (min 96px). Short viewports shrink the podium instead of overflowing.

### Animations

All gated behind `this.reducedMotion` (read once in `create()` via `window.matchMedia('(prefers-reduced-motion: reduce)')`):

- **Cloud drift**: two cloud sprites, x-only yoyo tweens (see Background).
- **Podium entrance**: the whole `podiumGroup` rises 30px from below with `Back.easeOut` overshoot (500ms, delay 100ms).
- **Crown shimmer**: alpha pulse (1 → 0.75, yoyo, 1200ms) on the #1 crown inside `podiumGroup`.
- **Row cascade**: staggered fade-in per row text (240ms, 45ms stagger).

Every leaderboard tween is tracked in `this.lbTweens`.

### Teardown & stale-fetch safety

- `clearPanelContent()` calls `teardownLeaderboardScroll()` before `removeAll(true)`; the scene `SHUTDOWN` handler also calls it.
- `teardownLeaderboardScroll()` stops all tracked tweens, removes scene-level input listeners (`wheel`, `pointermove`, `pointerup`, `pointerupoutside`), clears the rows mask, destroys the mask Graphics, and bumps `lbBuildSeq`.
- `buildLeaderboard` captures `lbBuildSeq` before the async fetch; after it resolves, the result is discarded if the scene closed, the screen changed, or the token no longer matches (resize/auth rebuild raced the fetch).
- All leaderboard GameObjects are in `panelContent` and destroyed with it.

---

## Runtime Verification Hooks

- `window.__brMenu.screen()` — current screen name.
- `window.__brMenu.buttons()` — menu/panel button rects.
- `window.__brMenu.open('leaderboard')` — navigate to leaderboard.
- `window.__brMenu.visible()` — menu visibility.

## Files

- `src/game/scenes/TitleScene.ts` — leaderboard build, scroll state, animations, crown bake.
- `src/game/rendering/RoughArt.ts` — `bakeCanvas`, `roundedRectPath` (unchanged).
- `src/game/rendering/DiscoveryOverlay.ts` — reduced-motion convention reference (unchanged).
