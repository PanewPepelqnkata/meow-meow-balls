# ACCOUNT MENU — DESIGN & PRODUCT SPECIFICATION

## 1. Overview & Theme
The **Account** screen (`src/game/rendering/KingsWardrobeView.ts`, `src/config/kingsWardrobe.ts`) provides a unified player identity, avatar collection, trophy cabinet, and lifetime statistics hub built in Phaser and styled to match Ball Rush's Throne Vault Hall art direction:
- **Full-Bleed Royal Archive & Trophy Hall Background**: Gothic stone courses, timber hammerbeam rafters, stained-glass lancet windows casting warm diagonal sunbeams, crimson-and-gold royal banners, perspective marble checkerboard floor with crimson runner, and animated floating gold dust motes.
- **Carved Oak & Illuminated Parchment Cards**: Oak wood frames (`#6e3516` / `#3d1c0a`) with brass rivets, gold trim (`#ffce42`), and warm ivory parchment (`#fff9ec`) panels.
- **Clean Dual-Font Hierarchy**: `Lilita One` with crisp dark strokes for titles and hero numbers; `Nunito ExtraBold` for readable descriptions, progress counters, and metadata.
- **Proportional Canonical Ball Art**: Core slime balls (`core:1`–`core:8`) and collectible characters (`collectible:9:shark`…`collectible:10:crab`) rendered with proportional framing (`0.84R` for Tier 9, `0.78R` for Tier 10 Crab) and canonical 4-point star coins (`drawCoin`).

## 2. Entry Points & Navigation
- **Main Menu (`KingdomHome`)**: Clicking the **Account** navigation button (`data-kingdom-action="account"`) opens `TitleScene.openScreen('account')` with header `ACCOUNT` (`PROFILE, AVATARS, TROPHIES & LIFETIME STATS`).
- **Four Account Tabs**:
  1. **`PROFILE & CREST` (`mirror`)**:
     - **Player Identity**: Ornate golden avatar frame with live breathing/blinking animation, display name, equipped Player Title ribbon, and one-time username change status (`1 Free Lifetime Username Change Available` or `Username Change Used (1/1 Lifetime)`).
     - **Player Card & Favorites**: Royal purple crest banner, 3 velvet pedestals showcasing Favorite Champions (tap to jump to Avatars), and summary stat medallions (`Best Score`, `Collection`, `Trophies`).
  2. **`AVATARS & FAVORITES` (`avatars`)**:
     - **Character Collection**: Responsive grid of all 14 canonical Ball Rush characters (`core:1`–`core:8`, all 5 Tier 9 skins, and Tier 10 Crab).
     - **Champion Stand**: Large spotlight pedestal, character tier & unlock requirement, plus `SET AS AVATAR` (synced to `profiles.selected_avatar_id` and displayed on the global leaderboard) and `ADD TO FAVORITES` / `REMOVE FAVORITE` (up to 3 slots in `profiles.favorite_ball_ids`).
  3. **`TROPHIES & TITLES` (`trophies`)**:
     - **Trophy Cabinet**: Category filter pills (`ALL`, `RUNS`, `MERGES`, `BALLS`, `SCORE`, `TIERS`), paginated achievement cards with progress bars (`current / target`), and reward title tags.
     - **Player Titles**: Paginated title selector allowing players to equip or unequip any unlocked title (`profiles.active_title_id`).
  4. **`STATS & ACCOUNT` (`ledger`)**:
     - **Royal Passport**: Official account seal with avatar, cloud/guest status badge, Account ID, Enlisted Date, Sign-In method, `SIGN OUT`, and two-step `DELETE ACCOUNT` (`DELETE` confirmation modal).
     - **Lifetime Statistics**: Overall Account Mastery progress bar + **2×4 Hero Stat Cards** (`Best Score`, `Games Played`, `Total Merges`, `Highest Tier`, `Coins Earned` with canonical 4-point star coin, `Average Score`, `Playtime`, and `Collection`).

## 3. Canonical Character & Avatar Catalog (`src/config/kingsWardrobe.ts`)
| ID | Name | Tier / Theme | Default Unlock Condition |
|---|---|---|---|
| `core:1` | Sunny | Tier 1 | Starter Character (Unlocked by default) |
| `core:2` | Berry | Tier 2 | Starter Character (Unlocked by default) |
| `core:3` | Minty | Tier 3 | Starter Character (Unlocked by default) |
| `core:4` | Tangerine | Tier 4 | Reach Tier 4 in a run |
| `core:5` | Bubblegum | Tier 5 | Reach Tier 5 in a run |
| `core:6` | Cobalt | Tier 6 | Reach Tier 6 in a run |
| `core:7` | Amethyst | Tier 7 | Reach Tier 7 in a run |
| `core:8` | Prism | Tier 8 | Reach Tier 8 in a run |
| `collectible:9:shark` | Finny | Tier 9 (`shark`) | Discover Tier 9 Shark |
| `collectible:9:pig` | Truffle | Tier 9 (`pig`) | Discover Tier 9 Pig |
| `collectible:9:drunko` | Tipsy | Tier 9 (`drunko`) | Discover Tier 9 Drunko |
| `collectible:9:robo` | Bolt | Tier 9 (`robo`) | Discover Tier 9 Robo |
| `collectible:9:pirate` | Captain | Tier 9 (`pirate`) | Discover Tier 9 Pirate |
| `collectible:10:crab` | Clawdius | Tier 10 (`crab`) | Discover Tier 10 Crab |

## 4. Achievements & Player Titles Catalog
| Achievement ID | Name | Category | Condition | Reward Title (`title_id` → Name) |
|---|---|---|---|---|
| `first_run` | First Run | `gameplay` | 1 game played | `royal_initiate` → **Royal Initiate** |
| `regular_player` | Regular Player | `gameplay` | 50 games played | — |
| `veteran` | Veteran | `gameplay` | 250 games played | `kingdom_veteran` → **Kingdom Veteran** |
| `dedicated` | Dedicated | `gameplay` | 1,000 games played | `the_unstoppable` → **The Unstoppable** |
| `first_merge` | First Merge | `merge` | 1 ball merged | — |
| `merge_novice` | Merge Novice | `merge` | 100 balls merged | — |
| `merge_master` | Merge Master | `merge` | 1,000 balls merged | `master_merger` → **Master Merger** |
| `merge_legend` | Merge Legend | `merge` | 10,000 balls merged | `grand_alchemist` → **Grand Alchemist** |
| `collector_i` | Collector I | `collection` | 5 characters unlocked | — |
| `collector_ii` | Collector II | `collection` | 10 characters unlocked | `treasure_seeker` → **Treasure Seeker** |
| `full_wardrobe` | Full Wardrobe | `collection` | All 14 characters unlocked | `lord_of_the_wardrobe` → **Lord of the Wardrobe** |
| `high_roller` | High Roller | `score` | 5,000+ single-run score | — |
| `score_champion` | Score Champion | `score` | 10,000+ single-run score | `high_score_sovereign` → **High Score Sovereign** |
| `score_legend` | Score Legend | `score` | 50,000+ single-run score | `crown_imperial` → **Crown Imperial** |
| `tier_explorer` | Tier Explorer | `milestone` | Reach Tier 5 | — |
| `tier_conqueror` | Tier Conqueror | `milestone` | Reach Tier 8 | `tier_conqueror` → **Tier Conqueror** |
| `tier_master` | Tier Master | `milestone` | Reach Tier 10 | `duke_of_discovery` → **Duke of Discovery** |
| `apex_predator` | Apex Predator | `milestone` | Reach Tier 12 | `king_of_balls` → **King of Balls** |
