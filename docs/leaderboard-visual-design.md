# Leaderboard Visual Design — Mount Olympus Hall of Glory

## Art direction

The leaderboard is a cartoon Mount Olympus temple scene, not a dashboard with ornamental pillars. The screen combines pale sky, rounded clouds, distant temple architecture, a marble floor, a title fascia, three champion columns, and a large ivory leaderboard tablet. Warm cream marble and restrained gold details pair with Ball Rush's thick ink outlines, rounded geometry, colorful balls, and playful type.

### Environment and title

- `drawOlympusHall` paints a full-viewport environment once per layout size: clouds, quiet distant colonnade and temple, top cream-and-gold fascia, Greek-key trim, and perspective marble floor.
- The fascia is composed behind the existing Back button and `HALL OF GLORY` screen header; Back continues to return to the menu.
- Background architecture stays soft and low contrast where content sits. Near columns frame the scene; no per-frame canvas drawing or large glow effects.
- Two low-opacity clouds may drift horizontally through transform-only tweens; those and podium/row entrance motion remain skipped under reduced motion.

### Champion podium

- The left-side centerpiece is three separated marble columns: #1 highest and centered, #2 left, #3 right. Each gets a fluted shaft, layered capital, stepped base, gold detailing, and rank-colored laurel medal.
- Existing Ball Rush ball character artwork, faces, colors, top-three tiers, first-place crown, names, and scores are retained. Each ball seats on its capital; names and scores remain readable against reserved marble plaques.
- The podium and its characters/labels animate together inside `podiumGroup`.

### Ranking tablet

- `drawOlympusTablet` bakes a rounded ivory marble tablet with thick ink silhouette, double gold frame, sparse veins, and Greek-key lower trim.
- The existing ranked data and masked rows occupy the right side on desktop and below the champions on mobile. Header/rank/player/score text uses dark ink for contrast; row one remains gold, the current-user row cyan, and other rows alternate warm stone.
- Existing responsive columns, crown placement, score formatting, and scroll model are retained: wheel scroll, touch drag, and thumb drag use the same bounded offset. Up to 50 fetched entries render; Supabase request and stale-fetch guard are unchanged.
- Row names stay on one line and scale uniformly to both their measured column width and 72% of row height; long display names cannot wrap into adjacent ranks.

## Layout and interaction

- Landscape desktop widths of at least 900 CSS pixels use the available safe width (up to 1760 CSS pixels) with a slightly wider champion area and taller tablet; both adapt to viewport height.
- Portrait and medium-width layouts stack the champion composition above a tablet up to 820 CSS pixels wide. This avoids squeezing names and headers near the former 720px side-by-side breakpoint.
- Back navigation remains the existing `buildScreenHeader` action. `window.__brMenu.open('leaderboard')` and `.screen()` remain useful browser QA hooks.
- All baked textures use `bakeCanvas`, which caps DPR and releases replaced canvas backing stores. Only transforms/alpha animate.

## Source files

- `src/game/scenes/TitleScene.ts` — leaderboard fetch, layout, row rendering/scrolling, title integration, animations.
- `src/game/rendering/OlympusHallArt.ts` — static environment and tablet canvas art.
- `src/game/rendering/ChampionPodiumArt.ts` — static champion column and plinth canvas art.
- `src/game/rendering/RoughArt.ts` — shared canvas bake/cache helper.
