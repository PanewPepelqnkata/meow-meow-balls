import type { Vec2 } from '../../config/container'

/** A circular keep-out region: another ball's collision envelope. */
export interface PlacementObstacle {
  x: number
  y: number
  /** Collision-envelope radius (visual radius + contact skin). */
  r: number
}

export interface PlacementBounds {
  top: number
  floorY: number
  innerLeftAt: (y: number) => number
  innerRightAt: (y: number) => number
}

export interface Displacement {
  obstacle: PlacementObstacle
  dx: number
  dy: number
}

export interface PlacementResult {
  x: number
  y: number
  /** Neighbors that must be pushed aside before the replacement spawns. */
  displaced: Displacement[]
  /** True when the chosen position needed neighbor displacement (dense pile). */
  squeezed: boolean
  /**
   * Phase 2.10.2: true when NO position with guaranteed envelope clearance
   * could be found in this pile state (every candidate needs a neighbor push
   * beyond MAX_PUSH even after shifting the spawn center) AND the
   * least-penetrating candidate's overlap exceeds the caller's budget. The
   * caller must NOT spawn in this state — it defers the replacement briefly
   * and retries as the pile relaxes. Guarantees: a replacement is never
   * created inside another ball ("ball inside a ball" defect).
   */
  deferred: boolean
  /**
   * Phase 2.14.0: worst envelope overlap (px) of the chosen candidate with
   * any obstacle. 0 for the clear and bounded-squeeze paths; > 0 marks an
   * overlap-commit (immediate crowded commit or aged emergency) that the
   * soft-body solver resolves over the next frames. On a deferred result it
   * reports the best candidate's overlap so callers can budget retries.
   */
  overlapPx: number
  /**
   * Phase 2.14.0: envelope radius of the obstacle that produced `overlapPx`
   * (0 when clear). Together they express the no-swallow rule: an overlap
   * commit is valid while `overlapPx <= min(rNew, overlapR) + 1`.
   */
  overlapR: number
}

export type OverlapPolicy = 'strict' | 'bounded' | 'always'

export interface PlacementOptions {
  /**
   * Phase 2.14.0 (spec §1 — MERGE DELAY): what may happen when the strict
   * paths (clear midpoint / clear ring / bounded squeeze) all fail.
   *
   *   'strict'  → always defer (Phase 2.10.2 behavior; used by tests)
   *   'bounded' → NO-SWALLOW immediate commit: return the least-penetrating
   *               clamped candidate when its worst overlap keeps both
   *               centers outside each other's envelopes
   *               (overlapPx <= min(rNew, overlapR) + 1). The soft-body
   *               contact solver separates the touching balls over a few
   *               frames — exactly what the aged guarantee produced, minus
   *               the wait. Normal crowded merges therefore NEVER wait for
   *               the emergency timeout.
   *   'always'  → aged-pending guarantee (Phase 2.13.2): commit at the
   *               least-penetrating local spot regardless of overlap — a
   *               jammed pile can never stall a replacement (merge loss).
   *
   * Every overlap commit stays strictly local (the candidate comes from the
   * bounded ring search — never a teleport) and pushes nothing.
   */
  overlap?: OverlapPolicy
}

const EPS = 0.5 // clearance epsilon between envelopes
/**
 * Hard cap on how far a single neighbor may be pushed (bounded, controlled
 * displacement — never an explosive impulse, never a teleport across the
 * container). Phase 2.13.1: this is now a HARD ceiling with NO age-based
 * loosening — the old `2 * MAX_PUSH` relaxation after 1s produced visible
 * 240px neighbor teleports and could bury a pushed ball inside a third ball.
 * A pile that cannot clear within this bound DEFERS instead (the merge
 * system wakes the area so the pile genuinely relaxes and the retry
 * succeeds a few frames later).
 */
export const MAX_PUSH = 60
/**
 * Phase 2.13.0 — LOCAL placement (anti-teleportation, spec §5):
 *
 * Ring radii are RELATIVE to the replacement radius (fractions of rNew) and
 * capped by an absolute ceiling, so a replacement never searches further than
 * about one replacement-diameter from the true merge point. The old absolute
 * rings (up to 290px for every tier) let a dense-pile search walk the result
 * to the other side of the container — the "merge on the left appears on the
 * right" defect.
 *
 * Angles are ordered UPWARD-FIRST (start at −π/2, alternate sides) so, where
 * space exists, the replacement prefers to rise out of the pile rather than
 * slide sideways; the previous scan started at angle 0 (due right) and broke
 * on the first clear hit — a systematic rightward bias.
 *
 * Phase 2.13.1: MAX_RING_PX is also the hard bound on the dense-pile
 * relaxation drift — the fallback center can never wander further than this
 * from the ORIGINAL clamped midpoint (the old loop could drift hundreds of
 * px across the container in 8 unbounded iterations).
 */
const RING_FRACTIONS = [0.3, 0.6, 1.0, 1.5, 2.1]
const MAX_RING_PX = 240
const RING_ANGLES = 24

function clearAt(x: number, y: number, r: number, obstacles: readonly PlacementObstacle[]): boolean {
  for (const o of obstacles) {
    const dx = o.x - x
    const dy = o.y - y
    if (dx * dx + dy * dy < (r + o.r + EPS) ** 2) return false
  }
  return true
}

/** Worst overlap of the candidate envelope with any obstacle (0 = clear). */
function penetrationAt(x: number, y: number, r: number, obstacles: readonly PlacementObstacle[]): number {
  let worst = 0
  for (const o of obstacles) {
    const d = Math.hypot(o.x - x, o.y - y)
    worst = Math.max(worst, r + o.r - d)
  }
  return worst
}

/**
 * Phase 2.14.0: the worst overlap AND the obstacle that caused it — the
 * no-swallow rule needs both (the overlap budget is min(rNew, worstR)).
 */
function worstOverlapAt(x: number, y: number, r: number, obstacles: readonly PlacementObstacle[]): { pen: number; r: number } {
  let worst = { pen: 0, r: 0 }
  for (const o of obstacles) {
    const pen = r + o.r - Math.hypot(o.x - x, o.y - y)
    if (pen > worst.pen) worst = { pen, r: o.r }
  }
  return worst
}

/**
 * Find a valid spawn position for a merged replacement ball of radius `rNew`
 * near the source midpoint (cx, cy), accounting for the replacement's FULL
 * collision envelope against every remaining ball, the floor and both
 * slanted walls.
 *
 * 1. Prefer the clamped midpoint itself when it is clear.
 * 2. Otherwise spiral outward on concentric rings and take the first clear
 *    position (closest ring wins; ties resolved by angle proximity).
 * 3. If the pile is too dense for any clear position, take the
 *    least-penetrating clamped candidate and produce a CONTROLLED, bounded
 *    displacement for each overlapped neighbor: each is pushed radially away
 *    from the spawn point exactly to envelope clearance (capped at
 *    MAX_PUSH). The caller applies displacements as velocity-preserving
 *    translations and re-clamps inside the container — never an explosive
 *    impulse, and the replacement never spawns inside another ball.
 */
export function placeMergedBall(
  cx: number,
  cy: number,
  rNew: number,
  obstacles: readonly PlacementObstacle[],
  bounds: PlacementBounds,
  /** Push bound override (Phase 2.10.2): long-deferred replacements may
   * loosen the per-neighbor push (still bounded, never explosive). */
  maxPush: number = MAX_PUSH,
  /** Phase 2.13.2: emergency mode for aged pendings (see PlacementOptions). */
  opts: PlacementOptions = {},
): PlacementResult {
  // Container clamp for a candidate center. Phase 2.15.0: the container is
  // OPEN at the top — the physics backstop (SoftBallManager.clampToContainer)
  // treats a centroid above the wall tops as legal open sky (clamp-exempt),
  // and balls legitimately rest above the rim on tall piles. The placement
  // clamp MUST agree: the old `max(y, top + rNew)` floor forced every rim
  // merge down below the rim (up to ~110px for a tier-6+ replacement) and
  // collapsed the whole ring search onto one dense horizontal line deep in
  // the pile — the "rim merges relocate into the container" defect. Now:
  //   - the FLOOR stays a hard limit (envelope clears it, always);
  //   - the slanted wall LINES still bound horizontally (extrapolated above
  //     the rim — same lines, same slope: a candidate above the rim stays
  //     over the funnel, so it can never be placed where it would fall
  //     outside a side wall);
  //   - above the rim is a valid temporary position, exactly like physics.
  const clamp = (x: number, y: number): Vec2 => {
    const yy = Math.min(y, bounds.floorY - rNew - 0.5)
    const left = bounds.innerLeftAt(yy) + rNew + 0.5
    const right = Math.max(left, bounds.innerRightAt(yy) - rNew - 0.5)
    return { x: Math.min(Math.max(x, left), right), y: yy }
  }

  const base = clamp(cx, cy)
  if (clearAt(base.x, base.y, rNew, obstacles)) {
    return { x: base.x, y: base.y, displaced: [], squeezed: false, deferred: false, overlapPx: 0, overlapR: 0 }
  }

  // Spiral search for a clear position near the midpoint. Ring 0 (the
  // midpoint) is already known blocked; rings step outward RELATIVE to the
  // replacement size (capped) — the search can never wander across the
  // container. Angles are tried upward-first with alternating sides, so a
  // clear pocket above the merge wins over an equally near sideways one.
  let best: { x: number; y: number; pen: number; d: number } | null = null
  for (let ri = 0; ri < RING_FRACTIONS.length; ri++) {
    const rad = Math.min(RING_FRACTIONS[ri]! * rNew, MAX_RING_PX)
    let clearHit: Vec2 | null = null
    let ringBest: { x: number; y: number; pen: number; d: number } | null = null
    for (let ai = 0; ai < RING_ANGLES; ai++) {
      // Upward-first, alternating sides: 0, +1, −1, +2, −2 … from −π/2.
      const side = ai % 2 === 0 ? 1 : -1
      const a = -Math.PI / 2 + side * Math.ceil(ai / 2) * ((Math.PI * 2) / RING_ANGLES)
      const c = clamp(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad)
      const pen = penetrationAt(c.x, c.y, rNew, obstacles)
      const d = Math.hypot(c.x - base.x, c.y - base.y)
      if (pen <= 0) {
        clearHit = c
        break
      }
      if (!ringBest || pen < ringBest.pen || (pen === ringBest.pen && d < ringBest.d)) {
        ringBest = { x: c.x, y: c.y, pen, d }
      }
    }
    if (clearHit) {
      return { x: clearHit.x, y: clearHit.y, displaced: [], squeezed: false, deferred: false, overlapPx: 0, overlapR: 0 }
    }
    if (ringBest && (!best || ringBest.pen < best.pen)) best = ringBest
  }

  // Dense-pile fallback: least-penetrating candidate + bounded displacement.
  // Phase 2.10.2 CORRECTNESS FIX: the old code capped each neighbor push at
  // MAX_PUSH and spawned anyway — a neighbor needing more than MAX_PUSH was
  // left BURIED inside the replacement (the "second ball inside the merged
  // ball" defect). Now the spawn center itself is shifted away from
  // still-violating obstacles (bounded relaxation), and every neighbor is
  // pushed EXACTLY to envelope clearance. If clearance cannot be guaranteed
  // within MAX_PUSH, the placement is DEFERRED (caller retries next frames)
  // instead of creating an overlapping ball.
  //
  // Phase 2.13.1 hard bounds:
  //  - the relaxation may drift at most MAX_RING_PX from the ORIGINAL
  //    clamped midpoint (base) — no unbounded walk across the container;
  //  - every push is validated against ALL OTHER obstacles: a neighbor is
  //    never shoved inside a third ball (tolerance = one contact skin —
  //    soft bodies are allowed to touch, not to be buried);
  //  - the squeeze is attempted from the MIDPOINT first (most local), then
  //    from the least-penetrating ring candidate — a penetration-optimized
  //    candidate is not necessarily pushable.
  const trySqueeze = (start: { x: number; y: number }): PlacementResult | null => {
    let chosen = { x: start.x, y: start.y }
    const pushes = new Map<PlacementObstacle, Vec2>()
    for (let iter = 0; iter < 8; iter++) {
      // Required push for every violating obstacle at the current center.
      pushes.clear()
      let worstResidual = 0
      let worstObstacle: PlacementObstacle | null = null
      for (const o of obstacles) {
        const dx = o.x - chosen.x
        const dy = o.y - chosen.y
        const d = Math.hypot(dx, dy)
        const need = rNew + o.r + EPS - d
        if (need <= 0) continue
        const ux = d > 1e-6 ? dx / d : 1
        const uy = d > 1e-6 ? dy / d : 0
        pushes.set(o, { x: ux * need, y: uy * need })
        if (need - maxPush > worstResidual) {
          worstResidual = need - maxPush
          worstObstacle = o
        }
      }
      if (!worstObstacle) {
        // Every push fits within MAX_PUSH. Validate no push buries a
        // neighbor inside a THIRD ball — if any would, this start point
        // fails (defer or fall through to the other candidate).
        const tolerance = 2 // px: soft bodies may touch, not interpenetrate
        for (const [o, v] of pushes.entries()) {
          const nx = o.x + v.x
          const ny = o.y + v.y
          for (const other of obstacles) {
            if (other === o) continue
            const overlap = (other.r + o.r + tolerance) - Math.hypot(other.x - nx, other.y - ny)
            if (overlap > 0) return null
          }
        }
        const displaced: Displacement[] = [...pushes.entries()].map(([obstacle, v]) => ({
          obstacle,
          dx: v.x,
          dy: v.y,
        }))
        return { x: chosen.x, y: chosen.y, displaced, squeezed: true, deferred: false, overlapPx: 0, overlapR: 0 }
      }
      // Shift the replacement center AWAY from the worst offender by the
      // residual, re-clamp, and re-evaluate (bounded relaxation) — but never
      // beyond MAX_RING_PX from the ORIGINAL midpoint: beyond that bound
      // this start point fails (bounded locality).
      const wo = worstObstacle
      const dx = chosen.x - wo.x
      const dy = chosen.y - wo.y
      const d = Math.hypot(dx, dy) || 1
      const next = clamp(chosen.x + (dx / d) * worstResidual, chosen.y + (dy / d) * worstResidual)
      if (Math.hypot(next.x - base.x, next.y - base.y) > MAX_RING_PX) {
        return null
      }
      chosen = { x: next.x, y: next.y }
    }
    return null
  }

  const fromBase = trySqueeze(base)
  if (fromBase) return fromBase
  if (best) {
    const fromBest = trySqueeze({ x: best.x, y: best.y })
    if (fromBest) return fromBest
  }

  // Phase 2.14.0 overlap-commit path: the strict guarantees above could not
  // be met, so evaluate the LEAST-PENETRATING local candidate (base or the
  // best ring hit — bounded locality, never a teleport) against the
  // caller's overlap policy.
  const policy: OverlapPolicy = opts.overlap ?? 'strict'
  const fallback = best ?? base
  const { pen: overlapPx, r: overlapR } = worstOverlapAt(fallback.x, fallback.y, rNew, obstacles)
  // NO-SWALLOW budget: the commit is valid while neither center enters the
  // other's envelope (overlapPx ≤ min(rNew, worstObstacle.r) + 1px float
  // kindness). 'always' (aged pendings) has no budget — the 2.13.2
  // merge-loss backstop. Either way: never deferred, nothing shoved — the
  // soft-body contact solver separates the touching balls over a few frames.
  const budget = policy === 'always' ? Infinity : policy === 'bounded' ? Math.min(rNew, overlapR) + 1 : 0
  if (overlapPx <= budget) {
    return { x: fallback.x, y: fallback.y, displaced: [], squeezed: false, deferred: false, overlapPx, overlapR }
  }

  // Could not guarantee clearance locally and the policy does not cover the
  // overlap: defer (caller retries as the pile moves — the merge system
  // wakes the area so it genuinely relaxes).
  return { x: fallback.x, y: fallback.y, displaced: [], squeezed: true, deferred: true, overlapPx, overlapR }
}
