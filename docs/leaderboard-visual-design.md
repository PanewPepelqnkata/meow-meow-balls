# Leaderboard Visual Design — Mount Olympus Hall of Glory

## Art direction

The leaderboard is a cartoon Mount Olympus temple scene, not a dashboard with ornamental pillars. The screen combines pale sky, rounded clouds, distant temple architecture, a marble floor, a title fascia, three champion columns, and a large ivory leaderboard tablet. Warm cream marble and restrained gold details pair with Ball Rush's thick ink outlines, rounded geometry, colorful balls, and playful type.

### Environment and title

- `drawOlympusHall` paints a full-viewport environment once per layout size: clouds, quiet distant colonnade and temple, a restrained gold rule behind the safe-inset title frame, and perspective marble floor.
- The leaderboard has its own inset header frame and Back button; the title stays separated from the frame edges at desktop and phone widths. Back returns to the menu.
- Background architecture stays soft and low contrast where content sits. Near columns frame the scene; no per-frame canvas drawing or large glow effects.
- Two low-opacity clouds may drift horizontally through transform-only tweens; those and podium entrance motion are skipped under reduced motion. Table text appears together for immediate legibility.

### Champion podium

- The champion component order is character, rank medal, measured nameplate, score. All three plate widths match; text anchors are derived from the same local geometry as the baked medals and columns.
- Existing Ball Rush ball character artwork, faces, colors, top-three tiers, and first-place crown are retained. All three column bases align while the columns retain distinct heights.

### Ranking tablet

- `drawOlympusTablet` bakes a rounded ivory marble tablet with thick ink silhouette, double gold frame, sparse veins, and Greek-key lower trim.
- The ranked data occupies a right-side tablet on wide landscape and stacks below the champions on phones and medium windows. Dedicated rank/avatar/name/score columns keep avatars and scores aligned.
- Player names and scores use locally bundled Nunito Bold without outlines/shadows, at 26px in wide tablets and 21px in narrow tablets. The LEADERBOARD heading keeps Lilita One. All players use charcoal `#25283A`; secondary headings use `#555467`.
- Names wrap within the measured name column. All rows share a height based on the tallest wrapped name; font size does not shrink with viewport height. Scores use one measured right-aligned column.
- Tablet height depends on viewport and a six-row desktop/four-row phone target, not player count. Only the list scrolls. A cached Phaser WebGL mask (Canvas GeometryMask fallback) keeps rows below stationary headings.
- First place uses a restrained `#F5D78B` fill and `#A77A32` border. Other rows alternate `#FFF8E9`/`#F0E7D5`; current-user identification uses a quiet gold border, not cyan text or outlines.
- The list recycles a viewport-sized pool with two overscan rows, keeping the number of mounted text/avatar objects bounded for 100+ players. One temporary text object measures names/scores; offscreen rows do not each allocate a text canvas.
- Miniature avatars use the original ball contour/face/collectible renderers. Graphics are baked at DPR 2–3 into cached textures with 64-segment contours; avatar artwork is 36–40px and includes the original pupils, highlights, outlines and colors.

## Layout and interaction

- Wide landscape (at least 1100 CSS pixels) uses two balanced panels inside shared safe margins. Phone landscape uses side-by-side panels from 600 CSS pixels wide when height is below 600; below 500px height, margins and the panel gap compact consistently.
- Stacked layouts reserve the tablet header, insets, and one full measured row before allocating height to the podium. Podium art and spacing interpolate to compact dimensions while the measured player-name and score typography remain unchanged. The tablet consumes the remaining height without an independent minimum that could extend it past the viewport.
- Portrait and medium-width layouts stack the champion composition above a tablet up to 820 CSS pixels wide. Verified with wide 20-character names at 390×568, 390×640, 640×360, 667×375, and 844×390; each shows at least one complete row inside the viewport.
- Back navigation remains the existing menu action. `window.__brMenu.open('leaderboard')` and `.screen()` remain useful browser QA hooks.
- All baked textures use `bakeCanvas`, which caps DPR and releases replaced canvas backing stores. Only transforms/alpha animate.

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
