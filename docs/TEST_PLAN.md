# BALL RUSH — Test Plan

Version: 0.2 (updated for menu + gameplay reference screenshots — awaiting user review)

Testing stack is intentionally light: Vitest for logic (pure systems, config,
merge math), headless Matter world simulations for physics regression, and
manual device checklists for feel/responsive/audio. No e2e framework until the
UI shell exists (Phase 7) — then Playwright smoke tests.

---

## 1. Physics (automated where possible)

Headless Matter engine driven by the game's fixed step; assertions over body
states after N simulated seconds.

| ID | Test | Pass criteria |
|----|------|---------------|
| P1 | Stability soak: 30 balls dropped, simulate 60 s | All bodies asleep/stable; no velocity spikes > threshold; no bodies escaped container |
| P2 | Tunneling: max-tier ball dropped from max height onto thin stack | No pass-through of walls/floor |
| P3 | Rest jitter: stacked identical balls | Positional drift < 1 px/s after settling |
| P4 | Determinism: same seed + input script → identical final state twice | Bitwise-close positions (tolerance defined in test) |
| P5 | Shake impulse bounds: apply Shake config at extremes | No ball exceeds escape trajectory that a legit game-over wouldn't allow unless intended; balls stay inside with walls extended |
| P6 | Extend Walls: wall bodies restored after timer | Wall geometry equals pre-extension values (exact) |
| P7 | Engine step rate: fixed 60 Hz accumulator under frame spikes | No missed-step drift; no double-step merges |

## 2. Merge Logic (automated, pure logic + engine events)

| ID | Test | Pass criteria |
|----|------|---------------|
| M1 | Two same-tier balls collide → exactly one next-tier ball | Old bodies removed; new body at midpoint; no residue |
| M2 | Three-way simultaneous collision | Exactly one merge resolves per pair; no double-merge; final count consistent |
| M3 | Chain: engineered cascade setup | Chain depth tracked; scoring applies chain bonus per depth; loop terminates |
| M4 | Different tiers collide | No merge; normal bounce |
| M5 | Merge cooldown race: two collision events same step for same ball | Single merge only |
| M6 | Momentum inheritance | New ball velocity ≈ average of parents (tolerance in test) |
| M7 | Score accounting: scripted run of known merges | Final score == sum from `ballTiers` config (no magic numbers) |
| M8 | Tier 7 merge guard | With tiers 8–10 unspecified, a tier-7 pair must **not** silently invent tier-8 behavior — test asserts current defined behavior (no merge OR documented placeholder) until user specifies the mechanic |

## 3. Game-Over Rules (locked requirements — explicit regression tests)

| ID | Test | Pass criteria |
|----|------|---------------|
| G1 | Ball body enters out-of-container sensor | Run ends exactly once; `run:over` emitted once |
| G2 | Danger line crossing only | Run does **NOT** end; warning state shows |
| G3 | Ball above danger line then rescued (settles below) | Warning clears; run continues |
| G4 | Ball escapes over a side rim | Run ends (container opening counts as out) |

## 4. Input

| ID | Test | Pass criteria |
|----|------|---------------|
| I1 | Pointer aim clamped to container interior at all widths | Ghost indicator never outside walls |
| I2 | Drop cooldown | No double-drop within cooldown window |
| I3 | Touch drag vs tap on mobile (manual) | Aim + release works; no scroll/zoom hijacking; `touch-action` correct |
| I4 | Input during game-over/restart transitions ignored | No ghost drops |
| I5 | Power-up buttons during disabled states (used, cooldown, non-playing scene) | No-ops |

## 5. Responsive Behavior

| ID | Test | Pass criteria |
|----|------|---------------|
| R1 | Canvas scale: 320 px phone → 4K desktop | Container always fully visible; no crop; letterbox correct |
| R2 | Orientation change mid-run (manual) | Layout recovers; physics continues; HUD reflows |
| R3 | Safe-area insets on notched device (manual) | HUD clear of notch/home indicator |
| R4 | HUD overlap: smallest supported height | Power-up bar never covers container interior controls |
| R5 | DevicePixelRatio rendering (manual) | No blur on outlines at 2x/3x screens |
| R6 | Home screen layout (manual, both platforms) | Matches ART_DIRECTION §6A.1: Play, PB chip, leaderboard entry, settings, hero illustration — **no** ads/shop/promo/currency elements anywhere |
| R7 | Gameplay HUD layout (manual, both platforms) | Matches ART_DIRECTION §6A.2: score+PB, NEXT preview, progression indicator, 3 power-ups, danger strip, pause — container unobstructed; **no** commercial elements |
| R8 | Scroll/zoom hijack prevention (manual, mobile) | Dragging on the game area never scrolls or pinch-zooms the page; overscroll contained |
| R9 | Desktop wide viewport (manual, e.g., 1440×900+) | Container centered at capped size, HUD uses side/edge space, container never stretched past its max scale |
| R10 | Landscape / short screens (manual) | Portrait-first letterboxing with rotate hint; no broken or cropped layout |

## 6. Performance Budgets (manual + profiler)

| ID | Test | Pass criteria |
|----|------|---------------|
| F1 | Mid-tier mobile, 40 balls + active effects | ≥ 60 fps sustained; no > 100 ms frame |
| F2 | Particle cap | Never exceeds configured cap; no leak after 10 min soak |
| F3 | Memory soak: 15 min continuous play (manual) | No visible growth in heap/body count after garbage-collectible run end |
| F4 | Ball pool reuse | Body/model counts return to baseline after each run |

## 7. Backend & Security (Phase 8+)

| ID | Test | Pass criteria |
|----|------|---------------|
| S1 | Direct INSERT to `runs` as anon user | Blocked by RLS |
| S2 | Submit via validated function: implausible score | Rejected |
| S3 | Submit twice within rate window | Second rejected |
| S4 | Leaderboard windows | Daily = current UTC day; weekly = ISO week; all-time = best per player; anonymous players isolated |
| S5 | Session restore on reload | Same anonymous identity; profile row reused |
| S6 | Offline/failed network run end | Game finishes; submission queued/retried; no crash |

## 8. Visual/Audio Regression (manual checklist)

- [ ] All 7 live tiers distinguishable at glance (including small sizes).
- [ ] Squash-and-stretch present on impact; never deforms physics behavior.
- [ ] Merge signature moment (lean → squash → pop → ring → popup) plays, incl. chains.
- [ ] Container stripes/glass/danger line per ART_DIRECTION §4.
- [ ] Faces: blink, happy, startled, worried states reachable in normal play.
- [ ] Mute toggle persists; music toggle works; SFX pitch scales with tier.
- [ ] UI readable at phone distance; touch targets ≥ 44 px.
- [ ] **Home screen**: one tap from load to playing; hero illustration reuses ball
      art pipeline; zero commercial/decorative clutter (R6).
- [ ] **Gameplay screen**: container is the visual focus; HUD compact; progression
      indicator shows tiers 1–7 reachable and 8–10 as dimmed locked slots only (R7).

## 9. Regression Discipline

- Every bug fix ships with a test capturing the failure (automated where feasible;
  manual checklist entry otherwise).
- Locked rules with dedicated tests: **danger line ≠ game over** (G2), **ball out
  of container = game over** (G1), **3 power-ups × 1 use/run**, **exactly 12 tiers**,
  **tiers 10–12 untouched until user specifies** (M8).
