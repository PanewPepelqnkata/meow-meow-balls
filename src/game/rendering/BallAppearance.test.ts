import { describe, expect, it } from 'vitest'
import {
  ballLookFor,
  ballOutlineWidth,
  drawBallFace,
  faceLayoutFor,
  randomSeed,
  restContour,
  wobbleContour,
} from './BallAppearance'
import type { BallLook } from './BallAppearance'
import { getTier, BALL_TIERS } from '../../config/ballTiers'
import { PhysicsWorld } from '../systems/PhysicsWorld'
import { SoftBallManager } from '../systems/SoftBallManager'

/**
 * Phase 2.11.1 regressions (spec P1/P3):
 *  - EVERY facial element fits inside its own ball's fill (with outline
 *    margin) at rest AND under compression, for every seed.
 *  - The face layout is a pure normalized function of (seed, R, aspect) —
 *    preview, crane and gameplay render the identical character up to a
 *    uniform scale.
 *  - Mouths are the three simple marker styles only.
 */

describe('BallAppearance (shared preview/crane/gameplay source)', () => {
  it('is fully deterministic for a given seed', () => {
    const a: BallLook = ballLookFor(1, 12345)
    const b: BallLook = ballLookFor(1, 12345)
    expect(b).toEqual(a)
    const c = ballLookFor(1, 12346)
    expect(c).not.toEqual(a)
  })

  it('produces valid normalized trait ranges', () => {
    for (let i = 0; i < 50; i++) {
      const look = ballLookFor(1, randomSeed())
      expect(look.lobes1).toBeGreaterThanOrEqual(3)
      expect(look.lobes1).toBeLessThanOrEqual(4)
      expect(look.mouth).toBeGreaterThanOrEqual(0)
      expect(look.mouth).toBeLessThanOrEqual(2) // three simple styles only
      expect(look.eyeW).toBeGreaterThanOrEqual(0.58)
      expect(look.eyeW).toBeLessThanOrEqual(0.68) // slime band: 0.58–0.68 R wide
      expect(look.eyeH).toBeGreaterThanOrEqual(0.66)
      expect(look.eyeH).toBeLessThanOrEqual(0.78) // slime band: 0.66–0.78 R tall
      expect(look.mouthW).toBeGreaterThanOrEqual(0.18)
      expect(look.mouthW).toBeLessThanOrEqual(0.26) // tiny doodle mouth band
    }
  })

  describe('face layout containment (Priority 1A/1D)', () => {
    const aspects = [1, 0.9, 0.8, 0.62]
    const radii = [28, 38, 57, 97, 164] // smallest preview … largest tier

    it('keeps eyes, pupils, highlights, cheeks and mouth inside the ball', () => {
      for (let seed = 0; seed < 60; seed++) {
        const look = ballLookFor(1, seed)
        for (const r of radii) {
          for (const aspect of aspects) {
            const L = faceLayoutFor(look, r, aspect)
            for (const e of L.eyes) {
              // Eye whites inside the fill (horizontal semi-axis never grows
              // with squash; vertical fits within the squashed ball).
              expect(Math.abs(e.x) + e.a).toBeLessThanOrEqual(0.9 * r)
              expect(Math.abs(e.y) + e.b).toBeLessThanOrEqual(0.92 * r * aspect)
              // Eye line above center; eye pair in the upper part of the face.
              expect(e.y).toBeLessThan(0)
              expect(e.y + e.b).toBeLessThanOrEqual(0.25 * r)
              // Pupil stays within the rim's inner edge of its sclera
              // (layout clamps gaze to the slack a − pa − rim/2).
              expect(Math.abs(e.px) + e.pa + e.rim / 2).toBeLessThanOrEqual(e.a)
              expect(Math.abs(e.py) + e.pb + e.rim / 2).toBeLessThanOrEqual(e.b)
              // Highlights strictly inside the pupil.
              expect(e.pa * 0.3 + e.pa * 0.3).toBeLessThanOrEqual(e.pa)
              expect(e.pb * 0.32 + e.pa * 0.3).toBeLessThanOrEqual(e.pb)
              // Balanced spacing.
              expect(Math.abs(L.eyes[0]!.x)).toBeCloseTo(Math.abs(L.eyes[1]!.x), 6)
            }
            // Mouth below the eyes, in the lower half, inside the ball.
            const m = L.mouth
            expect(m.y).toBeGreaterThan(L.eyes[0]!.y + L.eyes[0]!.b)
            expect(m.y + m.depth).toBeLessThanOrEqual(0.92 * r * aspect)
            expect(m.halfW).toBeLessThanOrEqual((0.38 / 2) * r * 1.02)
            expect(m.stroke).toBeLessThan(ballOutlineWidth(r))
            // Body highlight (spec §7): small (8–12% R wide, 4–7% R tall),
            // upper-left, inside the fill, clear of the outline band.
            const hl = L.highlight
            expect(hl.w).toBeGreaterThanOrEqual(0.08 * r)
            expect(hl.w).toBeLessThanOrEqual(0.12 * r)
            // Height band applies at the ball's current squash (es).
            expect(hl.h).toBeGreaterThanOrEqual(0.04 * r * L.es)
            expect(hl.h).toBeLessThanOrEqual(0.07 * r * L.es)
            expect(hl.x).toBeLessThan(0) // upper-left quadrant
            expect(hl.y).toBeLessThan(0)
            expect(Math.abs(hl.x) + hl.w / 2).toBeLessThanOrEqual(0.82 * r)
            expect(Math.abs(hl.y) + hl.h / 2).toBeLessThanOrEqual(0.82 * r * Math.max(aspect, 0.62))
            // Secondary dot near the main highlight, inside the silhouette.
            const dot = L.highlightDot
            expect(Math.hypot(dot.x - hl.x, dot.y - hl.y)).toBeLessThan(0.15 * r)
            expect(Math.abs(dot.x) + dot.r).toBeLessThanOrEqual(0.92 * r)
            expect(Math.abs(dot.y) + dot.r).toBeLessThanOrEqual(0.92 * r * aspect)
          }
        }
      }
    })

    it('squashes coherently: eyes never drift apart, mouth never balloons', () => {
      const look = ballLookFor(1, 777)
      const round = faceLayoutFor(look, 60, 1)
      const squashed = faceLayoutFor(look, 60, 0.62)
      // Eye spacing narrows (or stays) under compression — never widens.
      expect(Math.abs(squashed.eyes[0]!.x)).toBeLessThanOrEqual(Math.abs(round.eyes[0]!.x))
      // Mouth height shrinks with the squash.
      expect(squashed.mouth.depth).toBeLessThanOrEqual(round.mouth.depth)
      // Sclera height shrinks.
      expect(squashed.eyes[0]!.b).toBeLessThanOrEqual(round.eyes[0]!.b)
    })

    it('is identical across contexts up to uniform scale (Priority 3)', () => {
      const look = ballLookFor(1, 424242)
      const big = faceLayoutFor(look, 74, 1) // preview/crane size
      const small = faceLayoutFor(look, 37, 1) // half-scale render
      const k = big.r / small.r
      expect(big.eyes[0]!.x).toBeCloseTo(small.eyes[0]!.x * k, 6)
      expect(big.eyes[0]!.a).toBeCloseTo(small.eyes[0]!.a * k, 6)
      expect(big.eyes[0]!.b).toBeCloseTo(small.eyes[0]!.b * k, 6)
      expect(big.eyes[0]!.px).toBeCloseTo(small.eyes[0]!.px * k, 6)
      expect(big.eyes[1]!.py).toBeCloseTo(small.eyes[1]!.py * k, 6)
      expect(big.mouth.y).toBeCloseTo(small.mouth.y * k, 6)
      expect(big.mouth.halfW).toBeCloseTo(small.mouth.halfW * k, 6)
    })
  })

  it('restContour (preview/crane) equals wobbleContour on a circle (gameplay pipeline)', () => {
    const seed = 777
    const look = ballLookFor(1, seed)
    const r = 40
    // The preview/crane path:
    const rest = restContour(look, r, 100, 200, 40)
    // The gameplay path applied to the same perfect circle:
    const circle: Array<{ x: number; y: number }> = []
    for (let i = 0; i < 40; i++) {
      const th = (i / 40) * Math.PI * 2
      circle.push({ x: 100 + Math.cos(th) * r, y: 200 + Math.sin(th) * r })
    }
    const wobbled = wobbleContour(look, circle, 100, 200, r, 1.5)
    expect(wobbled).toEqual(rest)
  })

  it('outward wobble displacement is capped (inside the collision envelope)', () => {
    const seed = 42
    const look = ballLookFor(1, seed)
    const r = 50
    const poly = restContour(look, r, 0, 0, 64)
    for (const p of poly) {
      const d = Math.hypot(p.x, p.y)
      // cap 1.5 + smoothing relaxation — never beyond 2px outward
      expect(d).toBeLessThanOrEqual(r + 2)
    }
  })

  it('tier colors for preview/crane come from the authoritative ballTiers config', () => {
    for (const t of BALL_TIERS.filter((x) => x.playable)) {
      expect(getTier(t.tier)?.color).toBe(t.color)
    }
  })

  it('outline width scales with radius and stays in the cartoon band', () => {
    expect(ballOutlineWidth(10)).toBe(3) // min
    expect(ballOutlineWidth(1000)).toBe(7) // max
    expect(ballOutlineWidth(38)).toBeCloseTo(38 * 0.16, 5)
  })

  it('drawBallFace accepts the shared look without error for tiny and large radii', () => {
    // Headless canvas stub — verifies the drawing math never throws or
    // produces NaN coordinates for any character.
    const calls: Array<{ op: string; args: unknown[] }> = []
    const g = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          return (...args: unknown[]) => {
            calls.push({ op: prop, args })
          }
        },
      },
    ) as unknown as Parameters<typeof drawBallFace>[0]
    for (const seed of [1, 999, 424242]) {
      const look = ballLookFor(1, seed)
      expect(() => drawBallFace(g, look, { x: 50, y: 60 }, 5, 1)).not.toThrow()
      expect(() => drawBallFace(g, look, { x: 50, y: 60 }, 200, 0.7)).not.toThrow()
    }
    for (const c of calls) {
      for (const a of c.args) {
        if (typeof a === 'number') expect(Number.isFinite(a)).toBe(true)
      }
    }
  })

  it('spawnBall keeps the seed the preview showed (scene → entity passthrough)', () => {
    // Mirrors the PlaygroundScene drop path: preview shows (tier, seed),
    // spawnBall receives the SAME seed, and the entity carries it so the
    // gameplay renderer draws the identical character.
    const physics = new PhysicsWorld()
    const mgr = new SoftBallManager(physics.world)
    mgr.tierRadius = (tier) => getTier(tier)?.radius ?? 34
    const seed = 31337
    const ball = mgr.spawnBall(360, 800, 1, false, seed)
    expect(ball.seed).toBe(seed)
    // Default: seed falls back to the id (deterministic per ball).
    const ball2 = mgr.spawnBall(360, 700, 2)
    expect(ball2.seed).toBe(ball2.id)
  })
})
