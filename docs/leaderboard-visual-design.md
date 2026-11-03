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
- Names wrap within the name column. All rows share a height measured from the tallest wrapped name, so long names cannot overlap neighboring ranks. Font size is fixed per tablet width instead of shrinking with viewport height.
- Row height is measured from content; the tablet fits the rows when space permits and scrolls the same masked view when all entries cannot fit. A cached Phaser WebGL mask (Canvas GeometryMask fallback) clips scrolling rows inside the tablet.

## Layout and interaction

- Wide landscape (at least 1100 CSS pixels) uses two balanced panels inside shared safe margins. Portrait and medium-width layouts stack the champion composition above a tablet up to 820 CSS pixels wide. Short viewports keep bounded scroll rather than clipping the UI.
- Back navigation remains the existing menu action. `window.__brMenu.open('leaderboard')` and `.screen()` remain useful browser QA hooks.
- All baked textures use `bakeCanvas`, which caps DPR and releases replaced canvas backing stores. Only transforms/alpha animate.

## Source files

- `src/game/scenes/TitleScene.ts` — leaderboard fetch, layout, row rendering/scrolling, title integration, animations.
- `src/game/rendering/OlympusHallArt.ts` — static environment and tablet canvas art.
- `src/game/rendering/ChampionPodiumArt.ts` — static champion column and plinth canvas art.
- `src/game/rendering/RoughArt.ts` — shared canvas bake/cache helper.
