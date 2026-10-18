import { describe, expect, it } from 'vitest'
import { containerBounds, clampBallInside } from '../../config/container'
import { getTier } from '../../config/ballTiers'
import { SOFT } from './SoftBall'
import { placeMergedBall } from './mergePlacement'
import type { PlacementObstacle } from './mergePlacement'

/**
 * Phase 2.10.0 merge-placement regressions (the anti-trap algorithm).
 *
 * The production bug: a merge replacement spawned at the clamped source
 * midpoint could sit INSIDE a neighboring smaller ball — the neighbor ended
 * up buried in the new, larger body (unresolvable interpenetration). These
 * tests pin the placement contract: never spawn inside any remaining ball's
 * collision envelope, stay inside the trapezoid, prefer the midpoint, and
 * produce bounded displacements only when the pile is genuinely packed.
 */

const bounds = containerBounds()
const skin = SOFT.contactSkin
const env = (tier: number) => getTier(tier)!.radius + skin

function obstacleAt(x: number, y: number, tier: number): PlacementObstacle {
  return { x, y, r: env(tier) }
}

/** All positions on a ring of candidates the searcher may return must be
 * container-legal — helper asserting the result is clamped. */
function expectInsideBounds(p: { x: number; y: number }, rNew: number): void {
  const c = clampBallInside(p.x, p.y, rNew)
  expect(p.x).toBeCloseTo(c.x, 6)
  expect(p.y).toBeCloseTo(c.y, 6)
}

describe('merge placement: clear midpoint is preferred', () => {
  it('returns the midpoint untouched when nothing is near', () => {
    const p = placeMergedBall(360, 900, env(4), [], bounds)
    expect(p.x).toBeCloseTo(360, 6)
    expect(p.y).toBeCloseTo(900, 6)
    expect(p.displaced).toHaveLength(0)
    expect(p.squeezed).toBe(false)
  })

  it('the result always fits the trapezoid (walls + floor), even near corners', () => {
    // Merge right at the bottom-right corner: the midpoint clamps inside
    const obstacles = [obstacleAt(430, 1000, 4)]
    const p = placeMergedBall(460, 1030, env(4), obstacles, bounds)
    expectInsideBounds(p, env(4))
  })
})

describe('merge placement: LOCALITY (Phase 2.13.0, spec §5 — no teleportation)', () => {
  // The 2.12-era defect: absolute search rings (up to 290px for every tier,
  // scanned rightward-first) let a dense-pile merge on the LEFT produce a
  // replacement on the RIGHT side of the container. The Phase 2.13.0 search
  // is rNew-relative (≤ ~2 replacement radii + hard 240px cap) and
  // upward-first, so the result can never leave the merge neighborhood.
  const MAX_RING_PX = 240

  it('a wall-blocked merge near the left wall stays in the left region', () => {
    // Merge of two tier-2s at (250, 1000) with a dense wall of obstacles
    // directly above — every nearby candidate blocked except below-right.
    const obstacles = [
      obstacleAt(250, 940, 2),
      obstacleAt(310, 930, 2),
      obstacleAt(190, 935, 2),
      obstacleAt(250, 880, 3),
    ]
    const p = placeMergedBall(250, 1000, env(3), obstacles, bounds)
    // The replacement must remain within a local radius of the midpoint...
    expect(Math.hypot(p.x - 250, p.y - 1000)).toBeLessThanOrEqual(MAX_RING_PX + env(3))
    // ...and on the same (left) side of the container — no teleport across.
    expect(p.x).toBeLessThan(bounds.innerRightAt(p.y) - env(3) - 40)
  })

  it('the same guarantee holds near the right wall (mirror case)', () => {
    const obstacles = [
      obstacleAt(470, 940, 2),
      obstacleAt(410, 930, 2),
      obstacleAt(530, 935, 2),
      obstacleAt(470, 880, 3),
    ]
    const p = placeMergedBall(470, 1000, env(3), obstacles, bounds)
    expect(Math.hypot(p.x - 470, p.y - 1000)).toBeLessThanOrEqual(MAX_RING_PX + env(3))
    expect(p.x).toBeGreaterThan(bounds.innerLeftAt(p.y) + env(3) + 40)
  })

  it('large replacements (tier 8) never search beyond ~2 replacement radii', () => {
    // Fully blocked neighborhood: the searcher still cannot wander far.
    const obstacles: PlacementObstacle[] = []
    for (let a = 0; a < 12; a++) {
      const r = 300
      obstacles.push(obstacleAt(300 + Math.cos((a / 12) * Math.PI * 2) * r, 900 + Math.sin((a / 12) * Math.PI * 2) * r, 5))
    }
    const p = placeMergedBall(300, 900, env(8), obstacles, bounds)
    expect(Math.hypot(p.x - 300, p.y - 900)).toBeLessThanOrEqual(MAX_RING_PX + env(8))
  })
})

describe('merge placement: never spawns inside a smaller or same-tier ball', () => {
  it('REGRESSION (beside a small blue ball): the replacement clears a tier-1 neighbor', () => {
    // Two tier-3 balls merged at (360, 900); a tier-1 sits just beside the
    // midpoint — the old clamped-midpoint spawn buried it.
    const small = obstacleAt(392, 900, 1)
    const p = placeMergedBall(370, 900, env(3), [small], bounds)
    const d = Math.hypot(small.x - p.x, small.y - p.y)
    expect(d).toBeGreaterThanOrEqual(env(3) + small.r - 0.5)
    expectInsideBounds(p, env(3))
  })

  it('REGRESSION (beside a green/pink ball): the replacement clears a tier-2 neighbor', () => {
    const neighbor = obstacleAt(300, 950, 2)
    const p = placeMergedBall(330, 950, env(3), [neighbor], bounds)
    const d = Math.hypot(neighbor.x - p.x, neighbor.y - p.y)
    expect(d).toBeGreaterThanOrEqual(env(3) + neighbor.r - 0.5)
    expectInsideBounds(p, env(3))
  })

  it('next to the container wall: the replacement stays inside AND clear', () => {
    // A merge hard against the right wall with a neighbor on the other side:
    // the search must find the gap toward the container interior.
    const neighbor = obstacleAt(300, 980, 2)
    const p = placeMergedBall(380, 980, env(3), [neighbor], bounds)
    expect(p.x).toBeLessThanOrEqual(bounds.innerRightAt(p.y) - env(3) - 0.4)
    expect(p.x).toBeGreaterThanOrEqual(bounds.innerLeftAt(p.y) + env(3) + 0.4)
    const d = Math.hypot(neighbor.x - p.x, neighbor.y - p.y)
    expect(d).toBeGreaterThanOrEqual(env(3) + neighbor.r - 0.5)
  })

  it('above the floor: the replacement never spawns into the floor band', () => {
    const p = placeMergedBall(360, bounds.floorY - 10, env(4), [], bounds)
    expect(p.y).toBeLessThanOrEqual(bounds.floorY - env(4) - 0.4)
  })
})

describe('merge placement: dense pile fallback is bounded and controlled', () => {
  it('a fully packed neighborhood DEFERS (Phase 2.13.1: never bury a pushed neighbor)', () => {
    // A complete ring of tier-3 balls around the merge point (every angle
    // blocked — including diagonals), plus a second ring: no clear position
    // exists anywhere within the search radius, AND any neighbor push would
    // shove that neighbor into the next ring member. The Phase 2.13.1
    // contract: defer (the caller wakes the pile and retries) — the old
    // code pushed through, teleporting neighbors and burying them.
    const obstacles: PlacementObstacle[] = []
    for (let ring = 1; ring <= 3; ring++) {
      const rad = env(3) * 2 * ring
      const count = Math.ceil((2 * Math.PI * rad) / (env(3) * 1.8))
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2
        obstacles.push(obstacleAt(360 + Math.cos(a) * rad, 900 + Math.sin(a) * rad, 3))
      }
    }
    const p = placeMergedBall(360, 900, env(3), obstacles, bounds)
    expect(p.deferred).toBe(true)
    expect(p.displaced).toHaveLength(0)
  })

  it('AGED GUARANTEE (Phase 2.13.2, overlap=always): the same jam never defers — least-penetrating LOCAL spot, no pushes', () => {
    // The exact jam that defers in strict mode (previous test) must RESOLVE
    // with an unbounded budget: a pending replacement aged past
    // MERGE.pendingEmergencyMs can never be lost. Contract: not deferred,
    // zero pushes (nothing is shoved), strictly local (within the bounded
    // ring search of the clamped midpoint), inside the container.
    const obstacles: PlacementObstacle[] = []
    for (let ring = 1; ring <= 3; ring++) {
      const rad = env(3) * 2 * ring
      const count = Math.ceil((2 * Math.PI * rad) / (env(3) * 1.8))
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2
        obstacles.push(obstacleAt(360 + Math.cos(a) * rad, 900 + Math.sin(a) * rad, 3))
      }
    }
    const p = placeMergedBall(360, 900, env(3), obstacles, bounds, 60, { overlap: 'always' })
    expect(p.deferred).toBe(false)
    expect(p.displaced).toHaveLength(0)
    // Strictly local: never a teleport across the container.
    const drift = Math.hypot(p.x - 360, p.y - 900)
    expect(drift).toBeLessThanOrEqual(240 + 1e-9)
    expectInsideBounds(p, env(3))
  })

  it('AGED GUARANTEE (Phase 2.13.2, overlap=always): resolves near BOTH walls, staying local and inside', () => {
    for (const cx of [236, 484]) {
      const obstacles: PlacementObstacle[] = []
      for (let ring = 1; ring <= 3; ring++) {
        const rad = env(3) * 2 * ring
        const count = Math.ceil((2 * Math.PI * rad) / (env(3) * 1.8))
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2
          obstacles.push(obstacleAt(cx + Math.cos(a) * rad, 900 + Math.sin(a) * rad, 3))
        }
      }
      const p = placeMergedBall(cx, 900, env(3), obstacles, bounds, 60, { overlap: 'always' })
      expect(p.deferred).toBe(false)
      expect(p.displaced).toHaveLength(0)
      expect(Math.hypot(p.x - cx, p.y - 900)).toBeLessThanOrEqual(240 + 1e-9)
      expectInsideBounds(p, env(3))
    }
  })

  it('NO-SWALLOW POLICY (Phase 2.14.0, overlap=bounded): immediate commits never swallow, deeper overlaps defer', () => {
    // The merge-delay contract: with the 'bounded' policy an overlap commit
    // happens IMMEDIATELY whenever the least-penetrating candidate keeps
    // both centers outside each other's envelopes (overlapPx ≤ min(rNew,
    // overlapR) + 1); anything deeper defers for the caller to retry.
    // Whatever comes back must satisfy the invariant exactly — and strict
    // (no policy) still defers, preserving the 2.10.2 behavior.
    const jam = (): PlacementObstacle[] => {
      const obstacles: PlacementObstacle[] = []
      for (let ring = 1; ring <= 3; ring++) {
        const rad = env(3) * 2 * ring
        const count = Math.ceil((2 * Math.PI * rad) / (env(3) * 1.8))
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2
          obstacles.push(obstacleAt(360 + Math.cos(a) * rad, 900 + Math.sin(a) * rad, 3))
        }
      }
      return obstacles
    }
    // Strict (default): deferred — the 2.10.2 behavior.
    const strict = placeMergedBall(360, 900, env(3), jam(), bounds)
    expect(strict.deferred).toBe(true)
    expect(strict.overlapPx).toBeGreaterThan(0)
    expect(strict.overlapR).toBeGreaterThan(0)
    // Bounded: the no-swallow rule decides. For THIS jam the least-penetrating
    // candidate overlaps 17px — far inside min(rNew, overlapR)+1 — so the
    // 2.10.2 "impossible" jam is now an IMMEDIATE commit (the entire point of
    // Phase 2.14.0: nothing here comes close to swallowing a center).
    const bounded = placeMergedBall(360, 900, env(3), jam(), bounds, 60, { overlap: 'bounded' })
    expect(bounded.deferred).toBe(false)
    expect(bounded.overlapPx).toBeGreaterThan(0)
    expect(bounded.overlapR).toBeGreaterThan(0)
    expect(bounded.overlapPx).toBeLessThanOrEqual(Math.min(env(3), bounded.overlapR) + 1)
    expect(bounded.displaced).toHaveLength(0)
    expectInsideBounds(bounded, env(3))
    // The least-penetrating local candidate — never a teleport.
    expect(Math.hypot(bounded.x - 360, bounded.y - 900)).toBeLessThanOrEqual(240 + 1e-9)
  })

  it('a locally blocked but sparse neighborhood squeezes with bounded pushes', () => {
    // Four tier-3 blockers flank the midpoint at ~0.6× the touching distance
    // (needs fit within MAX_PUSH) with clear space BEHIND each (pushes never
    // bury a blocker into a third ball). Every ring candidate in every
    // direction is blocked by one of the four, so the squeeze path applies
    // four small bounded pushes and achieves full clearance.
    const e = env(3) // ≈ 64: radius + contact skin
    const sum = 2 * e
    const left = obstacleAt(360 - 0.59 * sum, 900, 3)
    const right = obstacleAt(360 + 0.59 * sum, 900, 3)
    const top = obstacleAt(360, 900 - 0.61 * sum, 3)
    const bottom = obstacleAt(360, 900 + 0.71 * sum, 3)
    const p = placeMergedBall(360, 900, e, [left, right, top, bottom], bounds)
    expect(p.squeezed).toBe(true)
    expect(p.deferred).toBe(false)
    expect(p.displaced.length).toBeGreaterThan(0)
    for (const d of p.displaced) {
      const push = Math.hypot(d.dx, d.dy)
      expect(push).toBeLessThanOrEqual(60 + 1e-9)
    }
    // Applying the displacements clears the spawn envelope
    const all = [left, right, top, bottom]
    const moved = all.map((o) => {
      const disp = p.displaced.find((x) => x.obstacle === o)
      return disp ? { x: o.x + disp.dx, y: o.y + disp.dy, r: o.r } : o
    })
    const worst = Math.max(...moved.map((o) => e + o.r - Math.hypot(o.x - p.x, o.y - p.y)))
    expect(worst).toBeLessThanOrEqual(0.5 + 1e-9)
  })

  it('the squeezed fallback still respects the container (never escapes the walls)', () => {
    const obstacles: PlacementObstacle[] = []
    // Fill the whole bottom band with touching tier-3s
    for (let x = 180; x <= 540; x += env(3) * 2) {
      obstacles.push(obstacleAt(x, bounds.floorY - env(3), 3))
    }
    const p = placeMergedBall(360, bounds.floorY - env(3), env(4), obstacles, bounds)
    expectInsideBounds(p, env(4))
  })
})

describe('merge placement: chain-merge geometry', () => {
  it('a chain result (tier 3 from chained tier-2 merges) has a valid position too', () => {
    // Chain merges re-run the same algorithm for the new pair — the placement
    // contract is identical for any tier, including the reserved large ones.
    const p = placeMergedBall(360, 800, env(6), [], bounds)
    expectInsideBounds(p, env(6))
    expect(p.squeezed).toBe(false)
  })
})

describe('merge placement: OPEN TOP (Phase 2.15.0 — the rim is not a wall)', () => {
  /**
   * The reported defect: merges at/near the open rim teleported their
   * replacements DOWN into the container (or deferred). Root cause: the
   * placement clamp floored every candidate at `top + rNew` while the
   * physics clamp (clampToContainer) correctly treats a centroid above the
   * wall tops as legal open sky — balls resting above the rim on a tall
   * pile are in a VALID temporary position. For a tier-6 replacement
   * (envelope 108) the old floor dragged rim merges up to ~175px down and
   * collapsed the whole ring search onto one dense horizontal line.
   *
   * Contract: above the rim is a valid temporary position — merges near the
   * rim stay LOCAL (never dragged below the rim), the slanted wall LINES
   * still bound horizontally (extrapolated above the rim, so a replacement
   * can never be placed where it would fall outside a side wall), and the
   * floor stays a hard limit.
   */
  const rim = bounds.top // wall-top y (765 at normal height)

  it('a clear midpoint above the rim stays exactly where the sources merged', () => {
    // Old behavior: clamped down to (360, rim + 108.5) — a ~175px teleport.
    const p = placeMergedBall(360, rim - 65, env(6), [], bounds)
    expect(p.x).toBeCloseTo(360, 6)
    expect(p.y).toBeCloseTo(rim - 65, 6)
    expect(p.deferred).toBe(false)
    expect(p.squeezed).toBe(false)
  })

  it('a rim merge over a pile commits LOCALLY in the open sky — never dragged into the container', () => {
    // Sources merging just above the rim; the pile shelf starts at the rim.
    const obstacles = [
      obstacleAt(320, rim - 5, 4),
      obstacleAt(400, rim - 5, 4),
      obstacleAt(280, rim + 75, 4),
      obstacleAt(360, rim + 75, 4),
      obstacleAt(440, rim + 75, 4),
    ]
    const p = placeMergedBall(360, rim - 35, env(6), obstacles, bounds, 60, { overlap: 'bounded' })
    expect(p.deferred).toBe(false)
    // Local: within the bounded ring of the merge point...
    expect(Math.hypot(p.x - 360, p.y - (rim - 35))).toBeLessThanOrEqual(240 + env(6))
    // ...and NOT dragged below the rim (the old y-floor is gone).
    expect(p.y).toBeLessThan(rim)
    // Whatever spot was chosen, the replacement is not spawned inside the
    // pile (clear or within the no-swallow budget).
    if (p.overlapPx > 0) expect(p.overlapPx).toBeLessThanOrEqual(Math.min(env(6), p.overlapR) + 1)
  })

  it('the slanted wall LINES still bound candidates above the rim', () => {
    // Midpoint above the rim but outside the extrapolated left line: the
    // candidate must be pulled back over the funnel (it would otherwise
    // fall down OUTSIDE the left wall) — but its y must stay above the rim.
    const p = placeMergedBall(40, rim - 100, env(6), [], bounds)
    expect(p.y).toBeLessThan(rim)
    expect(p.x).toBeGreaterThanOrEqual(bounds.innerLeftAt(p.y) + env(6) - 0.5)
    expect(p.x).toBeLessThanOrEqual(bounds.innerRightAt(p.y) - env(6) + 0.5)
    // And it moved the shortest possible distance: straight to the line.
    expect(p.x).toBeCloseTo(bounds.innerLeftAt(p.y) + env(6) + 0.5, 4)
  })

  it('the floor remains a hard limit below (unchanged)', () => {
    const p = placeMergedBall(360, bounds.floorY + 200, env(4), [], bounds)
    expect(p.y).toBeCloseTo(bounds.floorY - env(4) - 0.5, 4)
  })

  it('clampBallInside agrees: open top, wall lines, floor', () => {
    // Above the rim stays above the rim (translateBall re-clamps displaced
    // neighbors with this — a pushed neighbor must not be dragged down).
    const sky = clampBallInside(360, rim - 120, 78)
    expect(sky.y).toBeCloseTo(rim - 120, 6)
    // ...but horizontally it is still kept over the funnel...
    const overhang = clampBallInside(30, rim - 120, 78)
    expect(overhang.y).toBeCloseTo(rim - 120, 6)
    expect(overhang.x).toBeCloseTo(containerBounds().innerLeftAt(rim - 120) + 78.5, 4)
    // ...and the floor still clamps.
    const floor = clampBallInside(360, bounds.floorY + 100, 78)
    expect(floor.y).toBeCloseTo(bounds.floorY - 78.5, 4)
  })
})
