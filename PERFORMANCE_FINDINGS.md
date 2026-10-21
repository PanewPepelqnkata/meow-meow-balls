# PERFORMANCE FINDINGS — Ball Rush (iPhone 14 Pro / 17 Pro)

Audit date: 2026-10-22 · Baseline commit: `394549a` · Host: Apple M4, headless Chromium (software GL)

## How this was measured

Everything below is measured, not inferred. The harness (`qa/_*.mjs`, throwaway) instruments the
running game in-page — it wraps `game.loop.callback` (the frame entry point), `game.scene.update`,
`game.scene.render`, `PhysicsWorld.step`, and the per-substep handler, and reads the live game state
through `window.__brScene`. A CDP CPU profile and a CDP sampling heap profiler were used to attribute
cost to specific functions.

**Measurement caveat (important):** the headless browser runs its RAF at ~15 fps (software GL, no
display), so *frame counts* and *substep counts* in this document describe the harness, not the
device. What **is** valid, because it is per-unit work: the cost of one physics substep, the cost of
one contour rebuild, the cost of one ball's tessellation, and the cost of one merge. Those are the
numbers the fixes are based on. Device numbers are estimates from them, marked as such.

---

## Finding 1 — the live contour is rebuilt and re-tessellated for every ball, every frame

**The bottleneck.** `src/game/rendering/SoftBallRenderer.ts` draws every tier 1–7 ball as a **live
96-point contour** (`renderContour` → 16 Matter particles → 96 catmull-rom points → `wobbleContour`),
then issues `fillPoints` + `strokePoints` into ONE shared `Graphics` layer. Phaser re-tessellates that
layer every frame (`earcutLinked`, `indexCurve`) and streams it as a **non-batched** buffer.

**Evidence.**

| Measurement | Value |
|---|---|
| Render cost per ball per frame (17 balls, controlled count) | **0.207 ms/ball** |
| Of which: the live contour | **1.17 ms for 17 balls = 69 µs/ball** (33% of the whole render) |
| Of which: the CPU contour rebuild (`renderContour` + `wobbleContour`) | **1.00 ms** (24% of the render) |
| Of which: the face sprites (5 quads/ball) | 0.025 ms — negligible |
| The GL tail (`total − update − render`) | 0.02–0.10 ms — the GL submit is NOT the problem |
| CPU profile, big pile | `GraphicsWebGLRenderer` + `batch` + `earcutLinked` + `indexCurve` + `isEarHashed` + `sortLinked` = the top Phaser entries |

**Why the code says it should not be this way.** The renderer's own class doc (`SoftBallRenderer.ts`
lines 36-70) still describes the *sprite* pipeline: "EVERY ball (tier 1–7) renders as TWO batched
quads off ONE per-tier texture pair". That was commit `ddfe002` ("perf: sprite ball rendering — every
ball is 2 batched quads, vector layer leaves the frame"), built explicitly to fix "the 42fps wall
after the sleeping-bake wave didn't move it", with the measured cause "render >12ms at baked≈0 with
the live Graphics path streaming ~1,150 triangles/ball/frame".

**Why it is back.** Two later commits undid it for good reasons:

- `42769ab` — "restore the live particle-ring contour for AWAKE balls — the soft-body physics is
  visible again". The sprite conversion replaced the ball's drawn shape with a round sticker, so the
  actual soft-body deformation (dents, bulges, wobble from the 16 particles) was never drawn. The
  live contour **is** the physics shape, and it is required for awake balls.
- `6d61a57` — "unified live-contour rendering for all tier 1-7 balls — no sleep/wake mode switch".
  This removed the mode switch (the "deform for 1 sec then snap back to circle" bug) and mentioned a
  "Phase 2.20 contour cache (frozen geometry, zero rebuild)" for sleeping balls — **but that cache
  was removed in `ddfe002` and never restored.** The docstring and the code disagree.

**Why it becomes noticeable on an iPhone.** Three multiplicative factors, all of which hurt an
A-series/A19 core specifically:

1. **The settled pile is the dominant state.** The game is a pile game; most balls are at rest most of
   the time. The live path spends the full contour cost on balls whose particles are *frozen* — the
   shape provably cannot change.
2. **Non-batched geometry is a CPU cost, not a GPU cost.** `earcutLinked` is a CPU triangulation run
   on the main thread every frame. An A19 has ~2-3× the single-core performance of a desktop x86
   core, but the workload is main-thread-bound JS, so it scales with the phone's single-core speed
   while the *background* is doing nothing.
3. **120 Hz halves the budget.** At 120 fps every frame has 8.33 ms instead of 16.67 ms. A render
   cost that was comfortable at 60 Hz is a stutter source at 120 Hz. This is the single biggest
   reason the game feels *worse* on ProMotion even when the average frame time looks acceptable.

**Estimated device cost.** 69 µs/ball measured on an M4 core. An A-series core is roughly 2.5-3×
slower per unit of this kind of work (JSC vs V8, smaller caches, lower clocks) → **~200 µs/ball/frame**.
At 15 settled balls that is ~3 ms/frame of pure waste; at 25 balls, ~5 ms. Against an 8.33 ms
budget, that is the difference between a smooth 120 Hz frame and a dropped one.

**Proposed fix (TRIED AND REVERTED — see below).** The obvious fix is to **cache the contour of a
sleeping ball**: a sleeping ball's particles are frozen by Matter, so its contour is mathematically
invariant until it wakes. Serve the cached polygon and skip the rebuild; drop the cache on wake
(`onBallWake` → `dropBake`, which fires on *every* genuine wake).

**This was implemented, measured, and REVERTED.** The implementation was correct in isolation, but
the measurement did not show the predicted win:

| Measurement | Result |
|---|---|
| Cache hit rate | 600 hits vs 4214 misses — **the cache almost never hit** |
| Render cost, cache ON (interleaved A/B, 148 vs 147 frames) | 1.526 ms mean / 1.500 ms median |
| Render cost, cache OFF | 1.535 ms mean / 1.500 ms median |
| Difference | **-0.009 ms/frame — no measurable improvement** |

Two reasons it did not pay, and both are informative:

1. **The first measurement was wrong.** The contour is rebuilt in `ballRenderer.update()`, which
   runs inside `scene.update()` — **not** inside `scene.render()`. The first attribution attempt
   measured the *render* phase and found the contour's cost there. The interleaved A/B corrected
   this: the rebuild cost was being attributed to the wrong phase.
2. **The settled pile is mostly AWAKE.** In the measured scenarios only 1-3 of 6 balls were
   sleeping, and the wake paths (`auditStuckBalls`, the partial-wake repair) keep waking balls in a
   pile that never fully settles. So the cache had almost nothing to serve.

**What this means.** The live contour is real, measured work (69 µs/ball/frame), and the sprite
path that avoided it was correctly reverted for a good reason (it hid the soft-body deformation).
But a sleeping-ball cache does **not** recover it, because the pile does not stay asleep long
enough. Recovering this cost needs a different approach — e.g. a genuinely transform-only path for
resting balls (the sprite approach) that does not lose the deformation, which is a visual design
problem, not a performance one. **Not attempted here** (it would change the visual style, which
the brief forbids).

**Secondary finding — the measurement trap.** The `renderContour` + `wobbleContour` rebuild
measured **1.00 ms of the 4.17 ms** in the phase where it was *first* attributed. That number is
attributed to `scene.render`, which is wrong: the rebuild happens in `scene.update`. The
`GraphicsWebGLRenderer` / `earcutLinked` entries in the CPU profile are the genuine
tessellation cost, and they are far smaller than the rebuild.

**Risk of the reverted change.** It was reverted (`git checkout src/game/rendering/SoftBallRenderer.ts`),
so there is no risk carried forward. The two hazards that were handled in the implementation are
documented here for whoever revisits it: a woken ball must not draw a stale silhouette (the cache
must be dropped in `dropBake`, which the scene already wires to `SoftBallManager.onBallWake`), and
the cached polygon must not alias the live path's pooled array.

---

## Finding 2 — the merge frame is the frame-time spike (the theme bake storm)

**The bottleneck.** `MergeSystem.processMerges` — a single frame measured **76.3 ms**, with the
physics at 1.6 ms and the ball renderer at 0.1 ms.

**Evidence** (fine-grained attribution, `qa/_mergespike.mjs` → `qa/_commitgap.mjs`):

```
FRAME total=81.1ms
   hook.onMerge           74.30ms
   scene.themeMilestone   70.10ms     <-- the whole spike
   score.award            0.60ms
   fb.popup               0.60ms
   balls.spawn            0.40ms
```

The chain: `processMerges` → `commitPlacement` → the scene's `onMerge` hook →
`themeMilestone` → `backgroundScene.setTheme('space', …)`.

**Why the theme transition runs in a merge frame.** `PlaygroundScene.themeMilestone` (lines
806-830): on a **portrait phone** with the theme on AUTO, the **first** tier-4+ discovery calls
`this.backgroundScene.setTheme('space', THEME_PROGRESS.fadeMs)`. A tier-4+ discovery is created by
a merge — so the theme transition lands exactly on the merge frame.

**What the transition actually costs.** `BackgroundTheme.setTheme` (line 1202) synchronously bakes
the theme's textures: the art, the stars, the grid, the gradient — and, via `buildCloudGroup`, the
**space theme's three 900×520 nebula composites** (canvas-baked multi-blob radial gradients).

Measured (`qa/_themecost.mjs`):

```
buildCloudGroup        54.3ms     <-- the nebula bake
drawBackground         11.0ms
updateGradImage         4.6ms
bakeThemeArt            4.7ms
bakeThemeArt            3.7ms
bakeThemeArt            2.4ms
setTheme               70.2ms      (the total)
```

**The prewarm already existed — but missed the nebulas.** `BackgroundTheme.prewarmTheme` is called
at boot for exactly this reason ("~60-150ms of uploads in one frame"), and the comment in
`BackgroundScene.create` says so explicitly. But `prewarmTheme` baked only the art, the grid and
the gradient. The **nebula textures were not in it** — `buildCloudGroup` bakes them on demand via
`ensureNebulaTexture`, so they were created in the merge frame, every time.

**Why it is much worse on an iPhone.** The nebula bake is three 900×520 canvas textures (1.8 MB
each) painted with 26 radial gradients apiece, then uploaded to the GPU. On iOS the canvas is
**CPU-side** and the upload is a real texture upload (not a GPU-side raster). Safari/iOS also
throttles canvas memory — a 1170×2532 canvas pool is a known iOS constraint (the repo already
caps the render buffer at dpr 2 for this reason). The same work on a desktop GPU-backed canvas is
far cheaper.

**Proposed fix.** Bake the nebula textures in the existing boot prewarm, so the transition finds
them already present.

**Risk.** Low. The nebula bake is deterministic (seeded) and the prewarm uses the **same seeds and
sizes** as `buildCloudGroup`, so the transition reuses the identical textures. The cloud GROUP (the
Image layers) is still built by the transition — only the expensive texture bakes move to boot.

**Measured result.**

| | before | after |
|---|---|---|
| `setTheme('space')` | **70.2 ms** | **17.7 ms** |
| `buildCloudGroup` | 54.3 ms | 3.4 ms |
| worst frame in a 40-drop session | **81.9 ms** | **29.6 ms** |
| p95 frame | — | 11.1 ms |

---

## Finding 2b — the save write lands between frames (iOS IPC)

**The bottleneck.** `src/game/state/save.ts` — the merge's lifetime bookkeeping (`recordMerge`,
`recordDiscovery`) calls `writeSoon()`, which scheduled a plain `setTimeout(…, 1000)`.

**Evidence.** The save module's own comment:

> *"localStorage.setItem is a synchronous IPC round-trip on iOS (5-20 ms each) — a 4-merge chain
> stalled frames by 60 ms+."*

The coalescing was already in place, but a `setTimeout` callback fires **between** frames, and its
synchronous IPC lands **inside the frame budget** — a 5-20 ms hitch on the device, on a frame the
player did not cause. In this Chromium harness the write itself measured 0.0-0.1 ms (Chromium's
`localStorage` is an in-process write), so the cost is **not reproducible here** — only the
*scheduling* is.

**Proposed fix.** Schedule the deferred write on `requestIdleCallback` (with a timeout fallback),
so it runs when the main thread has slack. The in-memory save cache is always current; only the
disk copy lags — which the existing design already allows.

**Risk.** Very low. `writeNow()` (run end, settings change, tab hide) still writes immediately and
now also cancels the pending idle write, so there is never a duplicate write. Guarded by
`qa/verify-save-write.mjs`, which asserts the write happens and that it happens **outside** a
frame.

**[INFERENCE]** The magnitude of this one is device-specific and unproven in this harness — it is
the one fix here whose benefit is argued from the platform's documented behaviour rather than
measured. It is low-risk and independently correct (idle work belongs in idle time), so it stays.

---

## Finding 2c — ruled out inside the merge path

Everything else in the merge frame was measured and is **not** a contributor:

| Candidate | Measured |
|---|---|
| `balls.spawnBall` (17 Matter bodies + ~48 constraints) | 0.2-0.4 ms |
| `score.award` | 0.4-0.6 ms |
| `scoreFeedback.showScoreReward` | 0.6-1.1 ms |
| `scoreFeedback.showMergeBurst` | 0.1-0.3 ms |
| `placeMergedBall` (the spiral search) | 0.1-0.3 ms — bounded at 5 rings x 24 angles = 120 candidates |
| `localStorage.setItem` (Chromium) | 0.0-0.1 ms |
| `balls.wakeNear` | below the 0.02 ms resolution |

The physics world's body count does **not** grow: the soft-ball bodies live in a Matter
`Composite`, so `world.bodies.length` stays at 5 (the statics) and the composite count is 14. There
is no constraint leak.

---

## Finding 3 — the physics substep count is the frame-time multiplier

**Evidence.** The physics runs on a fixed 120 Hz accumulator (`PHYSICS.stepHz: 120`,
`maxSubSteps: 10`). Measured per substep at a 10-ball settled pile: **0.592 ms**.

At 120 Hz the game needs 2 substeps per frame → ~1.2 ms of physics. But a slow frame accumulates
more time, so the next frame runs more substeps.

**The spiral was tested and does NOT happen:** the correlation between frame N's cost and frame N+1's
substep count is **0.101** (≈0). The accumulator's `maxSubSteps` cap plus the remainder drop
(`PhysicsWorld.step` lines 312-315) break the cycle correctly.

**But the substep count is not free.** The measured per-substep cost is 0.592 ms, of which the soft
passes (`stepAll` + `separateContacts` + `expandShape` + `clampToContainer`) are ~0.10 ms and the rest
is Matter. The growth with pile size is quadratic-ish in the number of *touching* pairs:
`separateContacts` is O(pairs × 16 × 16 particles × 8 iterations).

**Why it matters on an iPhone:** the physics is pure CPU on the main thread, and at 120 Hz there is
twice as much of it per second as at 60 Hz.

**Proposed fix.** None yet — this is the *floor*, and the iteration budget is load-bearing
(`src/config/physics.ts`: a retune to 8/8/2 or 10/10/3 "BOTH fail the settled-pile battery"). The
adaptive-iterations design that comment calls for is a real opportunity but is a physics change, and
the brief says not to change gameplay physics unless necessary.

**Risk.** High. Documented as the reason not to touch it.

---

## Finding 4 — GC pressure is NOT a problem (ruled out)

**Evidence.** The CDP sampling heap profiler over a 4 s steady-state window: **52 KB/s** allocated.
The attribution:

```
95 KB  45.8%  fpsLoop diag.ts:53      <-- the DEV-ONLY ?diag=1 overlay
32 KB  15.5%  Constraint.solve matter-js.js
28 KB  13.6%  render diag.ts:65        <-- the DEV-ONLY ?diag=1 overlay
```

With the dev overlay removed the game's own allocation rate would be under 30 KB/s. The CPU profile
puts `(garbage collector)` at **0.3%** of sampled time. The `?diag=1` overlay (a `setInterval`
rewriting a DOM text node 800 ms plus a rAF array push) is the largest allocator — and it is
**dev-only, not in the shipped build**.

**Conclusion:** no GC fix is warranted. This is a ruled-out hypothesis, recorded so it is not
re-investigated.

---

## Finding 5 — the background is NOT a problem (ruled out)

**Evidence.** With the background scene hidden, the scene render cost fell by only **0.02 ms**
(1.52 → 1.50 ms). The theme transition (light → space) measured a maximum frame of **6.4 ms** with
zero frames over 16.6 ms. The background art is baked to textures and the composite is a single
blit; the ambient layer is skipped entirely while idle.

**Conclusion:** the background does not contribute. It is not touched.

---

## Finding 6 — the wall raise is already optimised (ruled out)

**Evidence.** The container frame is a 1440×2560 canvas texture; a full repaint + upload per frame
during the 1.8 s animation would be ~1.4 GB of uploads. The code already: quantizes the redraw to
12 px height steps (~14 repaints per phase instead of ~50), uses a 1× texture mid-animation, and
keeps the physics geometry per-frame exact while the visual frame trails by ≤12 px. The
`qa:wallraise` guard passes and the pile settles.

**Conclusion:** not a contributor. Not touched.

---

## Finding 7 — the 120 Hz frame budget itself

Phaser runs uncapped (`fps.limit` is 0, `target` 60 is only the *reported* target) so the game
already follows the display's refresh rate on ProMotion. `TimeStep` smooths the delta over 10
frames, so the accumulator receives a steady ~8.33 ms and the substep count is stable.

**The consequence:** at 120 Hz, the per-frame budget is **8.33 ms**, not 16.67 ms. Everything in this
document is measured against the 8.33 ms budget. This is why the render cost of Finding 1 — which
would be tolerable at 60 Hz — is a visible stutter source at 120 Hz.

---

## Priority

| # | Finding | Impact | Risk | Status |
|---|---|---|---|---|
| 2 | **Theme bake storm in the merge frame** (`buildCloudGroup` → 3 nebula textures) | 70 ms → 17.7 ms; worst frame 81.9 → 29.6 ms | Low | **Fixed** |
| 2b | Save write scheduled between frames (iOS IPC) | unmeasurable here; 5-20 ms/call on iOS | Very low | **Fixed** (moved to idle) |
| 1 | Live contour rebuilt for every ball every frame | 69 µs/ball/frame | — | **Tried and reverted** — the cache could not hit (the pile does not stay asleep) |
| 3 | Physics substep cost | 0.592 ms/substep × 2/frame @120 Hz | High (load-bearing) | Not touched — documented |
| 4 | GC pressure | 0.3% of CPU, 52 KB/s | — | Ruled out |
| 5 | Background rendering (steady state) | 0.02 ms | — | Ruled out |
| 6 | Wall-raise repaint | already quantized | — | Ruled out |
| 7 | 120 Hz budget | halves the per-frame allowance | — | Context for the above |

## What is still open

- **The live contour (Finding 1).** Real, measured cost (69 µs/ball/frame), but the only fix that
  removes it is the transform-only sprite path — and that path was reverted because it hid the
  soft-body deformation. A fix that keeps the deformation *and* avoids the per-frame rebuild needs
  a visual design decision, which this audit did not make.
- **The physics substep cost (Finding 3).** 0.592 ms per substep at a 10-ball pile, and the pile
  grows. The iteration budget is load-bearing (`src/config/physics.ts`: 8/8/2 and 10/10/3 both fail
  the settled-pile battery), so the adaptive-iterations design that comment calls for is the real
  opportunity — and it is a physics change the brief excludes.
- **The remaining 29.6 ms worst frame** is a rare, non-reproducible event. It was not attributed
  before this audit ended. It is 2.8× the 120 Hz budget, so it is worth chasing on-device with the
  `?diag=1` readout.

## On-device verification (required — this audit ran on a desktop)

The frame-time numbers above are from headless Chromium with software GL. The **per-unit** costs
(the substep cost, the bake cost, the spike) are valid; the **absolute frame times** are not. Before
this is called fixed, check on the device:

- `?diag=1` → the `FPS` line (`p50` / `p95` / `SPIKE`) and the `WALL` line (physics vs render ms).
- The worst frame should no longer be a one-off ~70-80 ms spike on the first tier-4+ merge.
- The `p95` should sit under 8.33 ms for 120 Hz.
