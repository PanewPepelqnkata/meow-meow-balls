# Ball Rush — Logical Stage Size Decision (Phase 0)

Status: **Decided for scaffold: 720×1280.** Centralized in `src/config/stage.ts`;
changing it requires no geometry rewrites in systems (all consumers read config).
This is a calculation-based decision, **not a substitute for testing on physical
devices** — revisit after first on-device runs (tracked as an open item).

## Candidates

- A: 720×1280 (ratio 0.5625)
- B: 720×1400 (ratio 0.5143)

Scaling is uniform `Phaser.Scale.FIT`: `scale = min(viewW/stageW, viewH/stageH)`.
Letterbox bands are the vertical/horizontal leftover where the React HUD lives.

## Calculations (uniform FIT, CSS px)

### Stage A: 720×1280

| Viewport        | Limiting | Scale  | Rendered   | Letterbox (total)  | HUD bands (v)   |
|-----------------|----------|--------|------------|--------------------|-----------------|
| 320×568 phone   | height   | 0.4437 | 320×568    | 1 h × 0 v          | 0 px            |
| 390×844 phone   | width    | 0.5417 | 390×693    | 0 h × 151 v        | ~75 px top/bot  |
| 430×932 phone   | width    | 0.5972 | 430×764    | 0 h × 168 v        | ~84 px top/bot  |
| 1440×900 desktop| height   | 0.7031 | 506×900    | 934 h × 0 v        | side margins    |

### Stage B: 720×1400

| Viewport        | Limiting | Scale  | Rendered   | Letterbox (total)  | HUD bands (v)   |
|-----------------|----------|--------|------------|--------------------|-----------------|
| 320×568 phone   | height   | 0.4057 | 292×568    | 28 h × 0 v         | 0 px            |
| 390×844 phone   | width    | 0.5417 | 390×758    | 0 h × 86 v         | ~43 px top/bot  |
| 430×932 phone   | width    | 0.5972 | 430×836    | 0 h × 96 v         | ~48 px top/bot  |
| 1440×900 desktop| height   | 0.6429 | 463×900    | 977 h × 0 v        | side margins    |

## Analysis

- **Modern portrait phones (390×844, 430×932)**: width-limited for both stages —
  identical ball scale. A leaves 151–168 px vertical letterbox; B leaves only
  86–96 px. The letterbox bands are where the score/PB top bar and power-up row
  sit (ART_DIRECTION §6A.3). A gives roughly **2× the HUD room**.
- **Desktop 1440×900**: height-limited for both. A renders ~9.4% larger
  (scale 0.7031 vs 0.6429) — everything (container, balls, HUD in DOM) reads
  bigger. B's extra stage height buys nothing here.
- **Small phone 320×568**: A's ratio (0.5625) matches the viewport almost
  exactly — fills it fully. B renders 28 px narrower (smaller balls on the
  smallest supported screen).
- **Cost of A**: less built-in vertical room for the container *inside* the
  stage. Mitigation: the container is positioned/sized within the stage with
  explicit margins (top band ~120 u for drop zone + danger area, bottom band
  ~170 u for progression indicator space). These margins live in
  `src/config/stage.ts` alongside the stage size and are tunable without
  touching systems. If on-device testing shows the container feels cramped, the
  fallback is B — a one-config change.

## Decision

**720×1280** for the scaffold, with stage-internal layout margins in config.

> ⚠️ These viewport calculations are model-based, not device-verified. Validate
> on real hardware (TEST_PLAN §5, R1–R5) before locking in Phase 10.
