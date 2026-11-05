# Leaderboard Visual Design — Mount Olympus Hall of Glory

## Art direction

The leaderboard is a cartoon Mount Olympus temple scene, not a dashboard with ornamental pillars. The screen combines pale sky, rounded clouds, distant temple architecture, a marble floor, a title fascia, three champion columns, and a large ivory leaderboard tablet. Warm cream marble and restrained gold details pair with Ball Rush's thick ink outlines, rounded geometry, colorful balls, and playful type.

### Environment and title

- `drawOlympusHall` paints the full-viewport environment once per layout size: clouds, quiet distant colonnade and temple, and perspective marble floor.
- The main LEADERBOARD heading and Back button sit directly on the temple background with safe margins; no header box, outline, or divider. Back returns to the menu. The modal keeps its own marble header.
- Leaderboard Back uses the same rounded marble-gold surface, extrusion, highlight, and white display label as the modal Close button. SHOW ALL PLAYERS uses the heading's gold `#FFE19A` display lettering.
- Background architecture stays soft and low contrast where content sits. Near columns frame the scene; no per-frame canvas drawing or large glow effects.
- Two low-opacity clouds drift with transform-only tweens. Ambient motion and cinematic animation are skipped under reduced motion.

### Champion podium

- The champion component order is character, laurel medal with its rank stamped into the metal texture, measured Greek-corner name plaque, and dedicated gold-framed score plaque. Marble column artwork is a separate base layer; balls, medals, name plaques and score plaques each have independent animation containers.
- Original Ball Rush ball artwork, faces, colors, top-three tiers, and first-place crown are retained. Column bases align; heights stay distinct. Score plaques have identical construction, measured padding, warm marble faces and bold dark values.

### Ranking tablet

- `drawOlympusTablet` bakes a rounded ivory marble slab with a thick ink silhouette, double gold frame, sparse veins, and Greek-key lower trim.
- Desktop landscape keeps the podium-left/tablet-right composition. Portrait initially shows only the three champion columns and a gold `SHOW ALL PLAYERS` button with the player count.
- The portrait button opens the same virtualized full-screen leaderboard used on desktop: safe-inset heading and close button stay fixed above stationary rank/player/score headings; only the row viewport scrolls.
- Names wrap within the measured name column. All rows share a height based on the tallest wrapped name. Scores use one measured right-aligned column.
- Player names and scores use bundled Nunito Bold with optical emboldening, at 26px in wide tablets and 21px in narrow tablets. The LEADERBOARD heading keeps Lilita One. Text stays charcoal with restrained gold first-three-place treatments.
- The viewport-sized row pool and DPR-baked game-ball avatars are shared by desktop and modal; scrolling reaches every paginated player without creating objects for offscreen rows.

### Portrait modal

- The full-screen list respects iOS safe-area insets and visual viewport height. Close and Escape return to the same live podium, without rebuilding the temple or replaying its entrance.
- A full-viewport black scrim fades to 65% opacity. The popup scales from 90% to 100% over 280ms with `Cubic.easeOut`; closing scales/fades it out over 190ms. Blur is intentionally omitted on mobile.
- Background scrolling locks until the close completes. Navigation, resize and shutdown cancel animations, dispose input ownership, and restore the previous overflow style. The list hit zone is disabled while hidden or transitioning.
- The modal reuses the same score snapshot, row pool, avatar textures and scrolling implementation as desktop.

## Layout and interaction

- Wide landscape keeps balanced panels inside shared safe margins. Portrait presents the podium and SHOW ALL PLAYERS action, with the list opened only on demand; landscape never uses the portrait modal.

### Entrance and reusable transition

- Entering from another screen plays a non-blocking 500ms golden diagonal light sweep via `playGoldenScreenTransition`. It owns its objects/tweens and exposes idempotent cancellation for future major-screen callers.
- After the async leaderboard data is ready, one shared 1800ms sequence runs on desktop and phone: dark temple, top-down warm light, architecture fade, 20px podium rise, ball landings with 7%/8% squash, medal settle, name/score plaques, actual-score count-up, then the desktop tablet reveal.
- Score counters begin at zero and finish at fetched values. They settle to exact values if navigation cancels the sequence. Layout geometry is not tweened; only transforms and alpha change. The numeric counter updates only three text objects.
- Entrance is scheduled only by an explicit navigation into the leaderboard, not by a viewport/auth/save rebuild or modal toggle. All sequences skip directly to finished state under reduced motion.
- No per-frame canvas bakes, particles, or blur filters are used. Static plaque/medal textures are cached and DPR-capped through the existing bake helper.


## Data and scrolling

- The UI requests all available distinct players. The score service reads ordered 250-row Supabase range pages until exhausted, preserving the highest score per user. Score ID is a stable secondary key for tied scores; no schema, authentication, or scoring changes.
- Mouse wheel/trackpad, row drag, thumb drag, and mobile touch drag update the same clamped list offset. A non-passive canvas wheel handler prevents document scroll within the player list and is removed on teardown. The scrollbar track remains visible while scrolling.
- Back/navigation teardown destroys the separately owned scroll input zone, along with the mask and wheel handler. Leaving the leaderboard cannot leave an invisible touch target over the menu.
- `src/services/auth-leaderboard.test.ts` covers players beyond the API row cap, deduplication across pages, distinct-player limits, and later-page errors.
- The gameplay HUD shows `Global #N` for the authenticated player's ordinal among distinct players, using this same best-score order; guests, unranked accounts, and failed rank loads show `Global #—`. Rank refreshes on login/account changes and successful score persistence.

## Source files

- `src/game/scenes/TitleScene.ts` — leaderboard fetch, layout, row rendering/scrolling, title integration, animations.
- `src/game/rendering/OlympusHallArt.ts` — static environment and tablet canvas art.
- `src/game/rendering/ChampionPodiumArt.ts` — static champion column and plinth canvas art.
- `src/game/rendering/LeaderboardEntrance.ts` — coordinated champion/temple reveal and score count-up.
- `src/game/rendering/GoldenScreenTransition.ts` — reusable 500ms light sweep with owned cleanup.
- `src/game/rendering/RoughArt.ts` — shared canvas bake/cache helper.

## Collection identity

- Tiers 9–12 each expose eight character slots; a slot is a character, not a recolor. The current random-run catalog supplies Tier 9 shark/pig/drunko/robo and Tier 10 crab. Unimplemented character slots remain visibly locked and are not added to any run roll.
- Discovery saves use a `${tier}:${character}:${palette}` key inside the existing variants map. Tier 9 pig and shark therefore persist and render as separate characters across run changes; each retains its first-found palette. The full discovery card fires for each new character identity, not only the first time a tier is reached.
- Legacy numeric collectible keys do not establish a character identity; the book reports them as unidentified rather than guessing or duplicating the current run's character.
- The collection book has dedicated Tier 9, Tier 10, Tier 11 and Tier 12 chapters with four slots per leaf (eight per spread). Character artwork is rendered with its saved theme and palette using the shared Ball Rush renderer. On narrow phone layouts the collectible thumbnails use a larger compact radius so they remain readable at small card heights.
- Supabase account reconciliation no longer fabricates a collectible character/palette from score rows, because score data contains no character identity. Existing explicit collection keys continue through the existing save merge and cloud-progress JSON without database changes.
