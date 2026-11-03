# Leaderboard Visual Design — Mount Olympus Hall of Glory

## Art direction

The leaderboard is a cartoon Mount Olympus temple scene, not a dashboard with ornamental pillars. The screen combines pale sky, rounded clouds, distant temple architecture, a marble floor, a title fascia, three champion columns, and a large ivory leaderboard tablet. Warm cream marble and restrained gold details pair with Ball Rush's thick ink outlines, rounded geometry, colorful balls, and playful type.

### Environment and title

- `drawOlympusHall` paints a full-viewport environment once per layout size: clouds, quiet distant colonnade and temple, a restrained gold rule behind the safe-inset title frame, and perspective marble floor.
- The leaderboard has its own inset header frame and Back button; the title stays separated from the frame edges at desktop and phone widths. Back returns to the menu.
- Leaderboard Back uses the same rounded marble-gold surface, extrusion, highlight, and white display label as the modal Close button. SHOW ALL PLAYERS uses the heading's gold `#FFE19A` display lettering.
- Background architecture stays soft and low contrast where content sits. Near columns frame the scene; no per-frame canvas drawing or large glow effects.
- Two low-opacity clouds may drift horizontally through transform-only tweens; those and podium entrance motion are skipped under reduced motion. Table text appears together for immediate legibility.

### Champion podium

- The champion component order is character, rank medal, measured nameplate, score. All three plate widths match; text anchors are derived from the same local geometry as the baked medals and columns.
- Existing Ball Rush ball character artwork, faces, colors, top-three tiers, and first-place crown are retained. All three column bases align while the columns retain distinct heights.

### Ranking tablet

- `drawOlympusTablet` bakes a rounded ivory marble slab with a thick ink silhouette, double gold frame, sparse veins, and Greek-key lower trim.
- Desktop landscape keeps the podium-left/tablet-right composition. Portrait initially shows only the three champion columns and a gold `SHOW ALL PLAYERS` button with the player count.
- The portrait button opens the same virtualized full-screen leaderboard used on desktop: safe-inset heading and close button stay fixed above stationary rank/player/score headings; only the row viewport scrolls.
- Names wrap within the measured name column. All rows share a height based on the tallest wrapped name. Scores use one measured right-aligned column.
- Player names and scores use bundled Nunito Bold with optical emboldening, at 26px in wide tablets and 21px in narrow tablets. The LEADERBOARD heading keeps Lilita One. Text stays charcoal with restrained gold first-three-place treatments.
- The viewport-sized row pool and DPR-baked game-ball avatars are shared by desktop and modal; scrolling reaches every paginated player without creating objects for offscreen rows.

### Portrait modal

- The full-screen list respects iOS safe-area insets and uses the available visual viewport height. Its close button and Escape key return to the podium state.
- Opening locks document scrolling; close, resize rebuild, screen navigation, and scene shutdown restore the prior body overflow style.
- The modal reuses the same score snapshot, row pool, avatar textures, and scroll implementation as desktop.

## Layout and interaction

- Wide landscape keeps balanced panels inside shared safe margins. Portrait presents the podium and SHOW ALL PLAYERS action, with the list opened only on demand; landscape never uses the portrait modal.

## Data and scrolling

- The UI requests all available distinct players. The score service reads ordered 250-row Supabase range pages until exhausted, preserving the highest score per user. Score ID is a stable secondary key for tied scores; no schema, authentication, or scoring changes.
- Mouse wheel/trackpad, row drag, thumb drag, and mobile touch drag update the same clamped list offset. A non-passive canvas wheel handler prevents document scroll within the player list and is removed on teardown. The scrollbar track remains visible while scrolling.
- Back/navigation teardown destroys the separately owned scroll input zone, along with the mask and wheel handler. Leaving the leaderboard cannot leave an invisible touch target over the menu.
- `src/services/auth-leaderboard.test.ts` covers players beyond the API row cap, deduplication across pages, distinct-player limits, and later-page errors.

## Source files

- `src/game/scenes/TitleScene.ts` — leaderboard fetch, layout, row rendering/scrolling, title integration, animations.
- `src/game/rendering/OlympusHallArt.ts` — static environment and tablet canvas art.
- `src/game/rendering/ChampionPodiumArt.ts` — static champion column and plinth canvas art.
- `src/game/rendering/RoughArt.ts` — shared canvas bake/cache helper.
