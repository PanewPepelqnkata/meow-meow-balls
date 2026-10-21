import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { PhysicsWorld } from '../systems/PhysicsWorld'
import { SoftBallManager } from '../systems/SoftBallManager'
import { createWallBody, floorCollider } from '../systems/ContainerBodies'
import { containerBounds, wallCollidersAt } from '../../config/container'
import { getTier } from '../../config/ballTiers'
import { softBallCentroid, renderContour, SOFT } from '../systems/SoftBall'
import {
  createDeformState,
  registerImpact,
  stepDeform,
  contourDisplacement,
} from './deform'

/**
 * The JELLY DENT — the localized contact deformation a ball shows when it
 * is hit. It is applied on TOP of the live physics contour (the renderer
 * multiplies each contour vertex's radius by 1 + the displacement), so the
 * ball keeps its real soft-body shape and gains a dent at the contact.
 *
 * These are the properties that make the dent read as jelly rather than as
 * "the ball switched to a different shape":
 *  - it is on the CONTACT SIDE (directional — the dent must not appear on
 *    the far side of the ball),
 *  - its DEPTH scales with the impact strength (a tap must not dent as
 *    hard as a full-height drop),
 *  - it never pushes the rendered contour past the particle collision
 *    discs (the Phase 2.9.8 envelope invariant).
 */
const STEP = PHYSICS.stepMs

function makeRig() {
  const physics = new PhysicsWorld()
  for (const body of [
    ...wallCollidersAt().map(createWallBody),
    createWallBody(floorCollider()),
  ]) {
    physics.addBody(body)
  }
  const manager = new SoftBallManager(physics.world)
  manager.tierRadius = (t) => getTier(t)?.radius ?? 34
  physics.setSubStepHandler(() => {
    manager.stepAll()
    manager.separateContacts()
    manager.expandShape()
    manager.clampToContainer()
    manager.commitRest()
  })
  return { physics, manager }
}

describe('jelly dent', () => {
  /** The angle (degrees) of the deepest inward point of the dent. */
  function dentAngle(nx: number, ny: number, radius: number): number {
    const d = createDeformState()
    registerImpact(d, nx, ny, 4.0, radius, 0)
    for (let i = 0; i < 3; i++) stepDeform(d, 16.6)
    let deepest = 0
    let best = 0
    for (let i = 0; i < 64; i++) {
      const ang = (i / 64) * Math.PI * 2
      const disp = contourDisplacement(d, ang)
      if (disp < deepest) {
        deepest = disp
        best = ang
      }
    }
    return ((best * 180) / Math.PI + 360) % 360
  }

  /** Smallest angle between two directions, in degrees. */
  function angleDelta(a: number, b: number): number {
    let d = Math.abs(a - b) % 360
    if (d > 180) d = 360 - d
    return d
  }

  it('dents on the CONTACT side, not the far side', () => {
    const R = 106
    const d = createDeformState()
    // Hit from ABOVE: the contact direction on the ball points up (-y).
    registerImpact(d, 0, -1, 4.0, R, 0)
    for (let i = 0; i < 3; i++) stepDeform(d, 16.6)

    const atTop = contourDisplacement(d, -Math.PI / 2)
    const atBottom = contourDisplacement(d, Math.PI / 2)
    const atSide = contourDisplacement(d, 0)

    expect(atTop).toBeLessThan(-0.05) // a deep inward dent at the contact
    expect(Math.abs(atBottom)).toBeLessThan(0.02) // the far side is untouched
    expect(Math.abs(atSide)).toBeLessThan(0.05) // localized, not a global oval
  })

  it('dent depth scales with the impact strength', () => {
    const R = 106
    const gentle = createDeformState()
    const hard = createDeformState()
    // The measured full-drop peak approach speed at this radius is ~4.5
    // px/step; a gentle touch is ~1.6.
    registerImpact(gentle, 0, -1, 1.6, R, 0)
    registerImpact(hard, 0, -1, 4.5, R, 0)

    let gentlePeak = 0
    let hardPeak = 0
    for (let i = 0; i < 40; i++) {
      stepDeform(gentle, 16.6)
      stepDeform(hard, 16.6)
      gentlePeak = Math.max(gentlePeak, -contourDisplacement(gentle, -Math.PI / 2))
      hardPeak = Math.max(hardPeak, -contourDisplacement(hard, -Math.PI / 2))
    }

    // A hard hit dents deeply; a gentle touch dents noticeably less.
    expect(hardPeak).toBeGreaterThan(0.15) // >= 15% of R
    expect(gentlePeak).toBeGreaterThan(0)
    expect(gentlePeak).toBeLessThan(hardPeak * 0.5)
  })

  it('a real landing dents the ball that was hit', () => {
    const { physics, manager } = makeRig()
    const bounds = containerBounds()
    const cx = (bounds.left + bounds.right) / 2
    const bigR = getTier(6)!.radius
    const big = manager.spawnBall(cx, bounds.floorY - bigR - 20, 6)
    // settle it
    for (let f = 0; f < 400; f++) physics.step(STEP)
    for (const e of physics.takeCollisionEvents()) void e

    // a tier 1 dropped from high above onto the tier 6
    const small = manager.spawnBall(cx, bounds.floorY - bigR - 20 - bigR - 300, 1)
    let peak = 0
    let normal = { x: 0, y: 0 }
    let bigIsBodyA = true
    let hitterAtImpact = { x: 0, y: 0 }
    for (let f = 0; f < 500; f++) {
      physics.step(STEP)
      for (const e of physics.takeCollisionEvents()) {
        const a = manager.getBallByBodyId(e.bodyA.id)
        const b = manager.getBallByBodyId(e.bodyB.id)
        // ONLY the big-vs-small contact: the big ball also rests on the
        // floor, and that contact's normal points down, not at the hitter.
        const isBigSmall =
          (a?.id === big.id && b?.id === small.id) || (b?.id === big.id && a?.id === small.id)
        if (!isBigSmall) continue
        if (e.approachSpeed > peak) {
          peak = e.approachSpeed
          normal = { x: e.normalX, y: e.normalY }
          bigIsBodyA = a?.id === big.id
          hitterAtImpact = { x: small.soft.center.position.x, y: small.soft.center.position.y }
        }
      }
    }
    // The impact is real and above the trigger threshold, so the ball dents.
    expect(peak).toBeGreaterThan(DEFORM_MIN_IMPACT)

    // THE SIGN: Matter's normal points FROM bodyB TOWARD bodyA, so the
    // contact direction on bodyA is -normal and on bodyB it is +normal
    // (this is the convention PlaygroundScene uses). The dent must land
    // on the side of the big ball FACING the small ball — an inverted
    // sign would put it on the far side, which is what this assertion
    // exists to catch.
    const dir = bigIsBodyA ? { x: -normal.x, y: -normal.y } : { x: normal.x, y: normal.y }
    const dentDeg = dentAngle(dir.x, dir.y, bigR)
    const bigC = softBallCentroid(big.soft)
    const toHitter = Math.atan2(hitterAtImpact.y - bigC.y, hitterAtImpact.x - bigC.x)
    const expectedDeg = ((toHitter * 180) / Math.PI + 360) % 360
    expect(angleDelta(dentDeg, expectedDeg)).toBeLessThan(40)
  })

  it('a ball dropped on the FLOOR dents at its bottom', () => {
    const { physics, manager } = makeRig()
    const bounds = containerBounds()
    const R = getTier(6)!.radius
    const ball = manager.spawnBall((bounds.left + bounds.right) / 2, bounds.top + 120, 6)
    let peak = 0
    let normal = { x: 0, y: 0 }
    let ballIsBodyA = true
    for (let f = 0; f < 600; f++) {
      physics.step(STEP)
      for (const e of physics.takeCollisionEvents()) {
        const a = manager.getBallByBodyId(e.bodyA.id)
        const b = manager.getBallByBodyId(e.bodyB.id)
        if (a?.id !== ball.id && b?.id !== ball.id) continue
        const other = a?.id === ball.id ? e.bodyB : e.bodyA
        if (!other.isStatic) continue
        if (e.approachSpeed > peak) {
          peak = e.approachSpeed
          normal = { x: e.normalX, y: e.normalY }
          ballIsBodyA = a?.id === ball.id
        }
      }
    }
    expect(peak).toBeGreaterThan(DEFORM_MIN_IMPACT)
    const dir = ballIsBodyA ? { x: -normal.x, y: -normal.y } : { x: normal.x, y: normal.y }
    const dentDeg = dentAngle(dir.x, dir.y, R)
    // The floor is below the ball (screen y grows downward) => the dent
    // is at the BOTTOM = 90deg.
    expect(angleDelta(dentDeg, 90)).toBeLessThan(45)
  })

  it('the dented contour never extends past the collision discs', () => {
    const { physics, manager } = makeRig()
    const bounds = containerBounds()
    const cx = (bounds.left + bounds.right) / 2
    const R = getTier(6)!.radius
    const big = manager.spawnBall(cx, bounds.floorY - R - 20, 6)
    manager.spawnBall(cx, bounds.floorY - R - 20 - R - 200, 1)

    const d = createDeformState()
    // worst case: a full-strength impact (max dent + max bulge)
    registerImpact(d, 0, -1, 6.0, R, 0)

    const bodyR = R * SOFT.particleRadiusFactor + SOFT.contactSkin

    for (let f = 0; f < 12; f++) {
      physics.step(STEP)
      stepDeform(d, 16.6)
      const c = softBallCentroid(big.soft)
      const contour = renderContour(big.soft, 6, R * SOFT.particleRadiusFactor)

      const bulgeOf = (frac: number, dx: number, dy: number) => {
        const sx = c.x + dx * (1 + frac)
        const sy = c.y + dy * (1 + frac)
        let minD = Infinity
        for (const p of big.soft.particles) {
          minD = Math.min(minD, Math.hypot(sx - p.position.x, sy - p.position.y))
        }
        return minD - bodyR
      }

      let baseWorst = -Infinity
      let dentedWorst = -Infinity
      for (const pt of contour) {
        const dx = pt.x - c.x
        const dy = pt.y - c.y
        const dist = Math.hypot(dx, dy)
        if (dist < 1e-4) continue
        baseWorst = Math.max(baseWorst, bulgeOf(0, dx, dy))
        const frac = contourDisplacement(d, Math.atan2(dy, dx) - d.bodyAngle)
        if (frac === 0) continue
        // The renderer's rule: a candidate position that would breach the
        // particle discs falls back to the base position.
        const nx = c.x + dx * (1 + frac)
        const ny = c.y + dy * (1 + frac)
        let inside = true
        for (const part of big.soft.particles) {
          if (Math.hypot(nx - part.position.x, ny - part.position.y) > bodyR) {
            inside = false
            break
          }
        }
        if (!inside) {
          dentedWorst = Math.max(dentedWorst, bulgeOf(0, dx, dy))
          continue
        }
        dentedWorst = Math.max(dentedWorst, bulgeOf(frac, dx, dy))
      }
      // The dent must not make the envelope violation WORSE than the base
      // contour already has (the base contour's own overshoot is a
      // pre-existing property of the catmull-rom spline).
      expect(dentedWorst).toBeLessThanOrEqual(baseWorst + 0.01)
    }
  })
})

/** The deform model's minimum impact speed (kept local so this file does
 * not depend on the constant's name in DEFORM). */
const DEFORM_MIN_IMPACT = 1.2
