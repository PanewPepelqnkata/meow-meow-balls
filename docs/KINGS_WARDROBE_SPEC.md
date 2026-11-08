# THE KING'S WARDROBE — DESIGN & PRODUCT SPECIFICATION

## 1. Overview & Theme
**The King's Wardrobe** (`src/game/rendering/KingsWardrobeView.ts`, `src/config/kingsWardrobe.ts`) replaces generic settings/profile menus with a full-screen royal chamber experience built in Phaser and styled to match Ball Rush's Royal Match / Supercell visual language:
- Warm royal purple (`#1c112a`) and burgundy velvet backdrops
- Carved oak wood frames (`#4a2810`) with brass rivets and gold filigrees (`#ffd13b`)
- Illuminated parchment scroll panels (`#fbf0d6`) with crisp dark-ink typography (`#23150b`)
- Canonical `BALL_DESIGN_STANDARD.md` ball rendering (`drawTier1Ball`–`drawTier12Ball`, `drawSpecialBall`, and `drawCoin`)

## 2. Entry Points & Navigation
- **Main Menu (`KingdomMainMenu`)**: Clicking the top-left **Account / Profile** badge (`data-kingdom-action="account"`) opens `TitleScene.openScreen('account')`, launching **The King's Wardrobe** directly.
- **Four Royal Chambers (Tabs)**:
  1. **`MIRROR` — The Royal Mirror & Personal Heraldic Crest**:
     - Ornate golden mirror with animated breathing avatar preview.
     - Displays current username, equipped Royal Title ribbon, and one-time username change status (`1 Free Lifetime Username Change Ready` or `Royal Decree: Name change used (1/1)`).
     - Interactive **Change Username** modal with live validation and explicit one-time confirmation.
     - **Royal Player Crest & Favorites**: Heraldic banner, 3 velvet pedestals showcasing the player's Favorite Champions, and summary pills (Best Score, Collection Progress, Trophies).
  2. **`WARDROBE` — Royal Wardrobe Cabinet & Champion Stand**:
     - Grid of all 14 canonical Ball Rush characters (Tiers 1–12 + Bomb & Rainbow special balls).
     - Unlocked characters render in full canonical art; locked characters render as mystery silhouettes with clear unlock requirements in the **Champion Stand** inspector.
     - Actions: **Set as Avatar** (synced to `profiles.selected_avatar_id` and displayed on the global leaderboard) and **Add to Favorites / Remove Favorite** (up to 3 slots in `profiles.favorite_ball_ids`).
  3. **`TROPHIES` — Royal Trophy Cabinet & Royal Titles**:
     - Category filter bar (`ALL`, `RUNS`, `MERGES`, `COLLECTION`, `SCORE`, `TIERS`) and paginated medal cards for all 18 achievements.
     - **Royal Titles & Honors** selector allowing players to equip or unequip any unlocked title (`profiles.active_title_id`).
  4. **`ACCOUNT` — The Royal Ledger & Royal Account Desk**:
     - **The Royal Ledger**: 3×3 grid of lifetime statistics (`Total Games Played`, `Total Balls Merged`, `Highest Ball Tier`, `Best Score Record`, `Average Run Score`, `Total Playtime`, `Total Coins Earned` with canonical 4-point star coin, `Collection Progress`, and `Achievements Unlocked`).
     - **Royal Account Desk**: Displays account status, Royal Account ID, Enlisted Date, Linked Sign-In providers, **Sign Out**, and two-step **Delete Account** (`DELETE` confirmation modal).

## 3. Canonical Character & Avatar Catalog (`src/config/kingsWardrobe.ts`)
| ID | Name | Tier / Type | Default Unlock Condition |
|---|---|---|---|
| `tier_1` | Sunny | Tier 1 | Unlocked by default |
| `tier_2` | Berry | Tier 2 | Unlocked by default |
| `tier_3` | Minty | Tier 3 | Unlocked by default |
| `tier_4` | Frosty | Tier 4 | Discover Tier 4 in a run |
| `tier_5` | Peachy | Tier 5 | Discover Tier 5 in a run |
| `tier_6` | Sparky | Tier 6 | Discover Tier 6 in a run |
| `tier_7` | Violet | Tier 7 | Discover Tier 7 in a run |
| `tier_8` | Magma | Tier 8 | Discover Tier 8 in a run |
| `tier_9` | Chomper | Tier 9 Collectible | Discover a Tier 9 collectible |
| `tier_10` | Oinker | Tier 10 Collectible | Discover a Tier 10 collectible |
| `tier_11` | Whiskers | Tier 11 Collectible | Discover a Tier 11 collectible |
| `tier_12` | Sovereign | Tier 12 Collectible | Discover a Tier 12 collectible |
| `special_bomb` | Royal Bomb | Special | Complete 5 runs or score 2,500+ |
| `special_rainbow` | Prism Orb | Special | Complete 10 runs or score 5,000+ |

## 4. Achievements & Royal Titles Catalog
| Achievement ID | Name | Category | Condition | Reward Title (`title_id` → Name) |
|---|---|---|---|---|
| `first_run` | First Run | `runs` | 1 game played | `royal_initiate` → **Royal Initiate** |
| `regular_player` | Regular Player | `runs` | 50 games played | — |
| `veteran` | Veteran | `runs` | 250 games played | `kingdom_veteran` → **Kingdom Veteran** |
| `dedicated` | Dedicated | `runs` | 1,000 games played | `the_unstoppable` → **The Unstoppable** |
| `first_merge` | First Merge | `merges` | 1 ball merged | — |
| `merge_novice` | Merge Novice | `merges` | 100 balls merged | — |
| `merge_master` | Merge Master | `merges` | 1,000 balls merged | `master_merger` → **Master Merger** |
| `merge_legend` | Merge Legend | `merges` | 10,000 balls merged | `grand_alchemist` → **Grand Alchemist** |
| `collector_i` | Collector I | `collection` | 5 characters unlocked | — |
| `collector_ii` | Collector II | `collection` | 10 characters unlocked | `treasure_seeker` → **Treasure Seeker** |
| `full_wardrobe` | Full Wardrobe | `collection` | All 14 characters unlocked | `lord_of_the_wardrobe` → **Lord of the Wardrobe** |
| `high_roller` | High Roller | `score` | 5,000+ single-run score | — |
| `score_champion` | Score Champion | `score` | 10,000+ single-run score | `high_score_sovereign` → **High Score Sovereign** |
| `score_legend` | Score Legend | `score` | 50,000+ single-run score | `crown_imperial` → **Crown Imperial** |
| `tier_explorer` | Tier Explorer | `tiers` | Reach Tier 5 | — |
| `tier_conqueror` | Tier Conqueror | `tiers` | Reach Tier 8 | `tier_conqueror` → **Tier Conqueror** |
| `tier_master` | Tier Master | `tiers` | Reach Tier 10 | `duke_of_discovery` → **Duke of Discovery** |
| `apex_predator` | Apex Predator | `tiers` | Reach Tier 12 | `king_of_balls` → **King of Balls** |
