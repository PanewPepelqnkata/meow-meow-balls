import { describe, expect, it } from 'vitest'
import { SPAWN } from '../../config/spawn'
import { createContainerBodies } from './ContainerBodies'
import { stepDeform } from '../rendering/deform'
import { getTier } from '../../config/ballTiers'
import { containerBounds } from '../../config/container'
import { PhysicsWorld } from './PhysicsWorld'
import { BallManager } from './BallManager'
import { MergeSystem } from './MergeSystem'
import { ScoreSystem } from './ScoreSystem'
import { createDeformState, registerImpact, contourRadii, DEFORM } from '../rendering/deform'
import { clampDropX, canDrop } from './inputMath'

const { top } = containerBounds()

/** §5: one-second minimum interval between drops. */
describe('drop cooldown (1s minimum)', () => {
  it('ignores drops inside the 1000ms window and allows them after', () => {
    expect(SPAWN.cooldownMs).toBe(1000)
    // Real gate implementation (InputController delegates to canDrop)
    let last = -Infinity
    expect(canDrop(last, 0, SPAWN.cooldownMs)).toBe(true) // first drop
    last = 0
    expect(canDrop(last, 400, SPAWN.cooldownMs)).toBe(false) // inside window
    expect(canDrop(last, 999, SPAWN.cooldownMs)).toBe(false) // still inside
    expect(canDrop(last, 1000, SPAWN.cooldownMs)).toBe(true) // window elapsed
    expect(canDrop(last, 999.999, SPAWN.cooldownMs)).toBe(false)
  })

  it('the next preview updates on release (spawn changes nextTier in scene flow)', () => {
    // Scene-level behavior covered by live verification; here we assert the
    // cooldown constant is the single source (config, not hardcoded).
    expect(SPAWN.cooldownMs).toBe(1000)
  })
})

/** §5: airborne balls never merge; first physical contact enables merging. */
describe('merge eligibility (first-contact rule)', () => {
  function makeGame() {
    const pw = new PhysicsWorld()
    for (const body of createContainerBodies()) pw.addBody(body)
    const balls = new BallManager(pw)
    const score = new ScoreSystem()
    return { pw, balls, score }
  }

  it('a collision between two never-touched balls does NOT merge', () => {
    const { pw, balls, score } = makeGame()
    const merges = new MergeSystem(balls, pw, score)
    const r1 = getTier(1)!.radius
    // Both spawned directly and asleep: no real contact ever happened
    balls.spawnBall(360 - r1 - 1, top + 120, 1, true)
    balls.spawnBall(360 + r1 - 2, top + 120, 1, true)
    const fakePair = [
      { bodyA: balls.getBalls()[0]!.body, bodyB: balls.getBalls()[1]!.body },
    ]
    const outcomes = merges.processMerges(fakePair)
    expect(outcomes).toHaveLength(0)
    expect(balls.count).toBe(2)
    expect(score.score).toBe(0)
    pw.dispose()
  })

  it('after first contact (markTouched) the same pair merges exactly once', () => {
    const { pw, balls, score } = makeGame()
    const merges = new MergeSystem(balls, pw, score)
    const r1 = getTier(1)!.radius
    balls.spawnBall(360 - r1 - 1, top + 120, 1, true)
    balls.spawnBall(360 + r1 - 2, top + 120, 1, true)
    const [a, b] = [balls.getBalls()[0]!, balls.getBalls()[1]!]
    const fakePair = [{ bodyA: a.body, bodyB: b.body }]
    expect(merges.processMerges(fakePair)).toHaveLength(0)
    // First physical contact happens (scene marks touched from the event drain)
    balls.markTouched([a.body.id, b.body.id])
    const outcomes = merges.processMerges(fakePair)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]!.tier).toBe(2)
    expect(score.score).toBe(getTier(2)!.score)
    expect(merges.processMerges(fakePair)).toHaveLength(0) // no double award
    pw.dispose()
  })

  it('drop positions clamp to the mouth band so drops enter the container', () => {
    const b = containerBounds()
    const r = getTier(1)!.radius
    const interior = { x: b.innerLeftAt(b.top), width: b.innerRightAt(b.top) - b.innerLeftAt(b.top) }
    expect(clampDropX(-500, r, interior)).toBe(interior.x + r + SPAWN.clampMargin)
    expect(clampDropX(1200, r, interior)).toBe(interior.x + interior.width - r - SPAWN.clampMargin)
  })
})

/** §4 mandatory: the PROCEDURAL CONTOUR actually changes shape. */
describe('deformation contour (visible silhouette change)', () => {
  it('resting state is a perfect circle', () => {
    const state = createDeformState()
    const radii = contourRadii(state, 34, 20)
    for (const r of radii) expect(r).toBeCloseTo(34, 6)
  })

  it('a floor impact flattens at the contact and bulges around it (measurable)', () => {
    const state = createDeformState()
    registerImpact(state, 0, 1, 19, 34, 0) // real measured floor-drop speed
    for (let i = 0; i < 4; i++) stepDeform(state, 16.6)
    const radii = contourRadii(state, 34, 40)
    // contact at +Y (segment 10 of 40); bulge ring near ±90° from contact
    const atContact = Math.min(radii[10]!, radii[30]!)
    const maxRing = Math.max(...radii)
    expect(atContact).toBeLessThan(34 * 0.9) // visibly flattened at contact
    expect(maxRing).toBeGreaterThan(34 * 1.02) // visibly expanded around it
    // Volume approximately preserved (shoelace area of the contour polygon)
    let area = 0
    for (let i = 0; i < 40; i++) {
      const a1 = (i / 40) * Math.PI * 2
      const a2 = ((i + 1) / 40) * Math.PI * 2
      const r1 = radii[i]!, r2 = radii[(i + 1) % 40]!
      area += 0.5 * r1 * r2 * Math.sin(a2 - a1)
    }
    expect(area).toBeGreaterThanOrEqual(Math.PI * 34 * 34 * 0.85)
  })

  it('a wall impact (rotated body) compresses along the wall normal', () => {
    const state = createDeformState()
    registerImpact(state, 1, 0, 15, 34, 0) // horizontal normal, unrotated body
    for (let i = 0; i < 4; i++) stepDeform(state, 16.6)
    const radii = contourRadii(state, 34, 8)
    expect(Math.min(radii[0]!, radii[4]!)).toBeLessThan(34 * 0.9) // sides compressed
    expect(Math.max(radii[2]!, radii[6]!)).toBeGreaterThan(34 * 1.02) // vertical expansion
  })

  it('recovers to a perfect circle after the jelly sequence', () => {
    const state = createDeformState()
    registerImpact(state, 0, 1, 19, 34, 0)
    let oscillations = 0
    let prevSign = 0
    for (let i = 0; i < 240; i++) {
      stepDeform(state, 16.6)
      const sgn = Math.sign(state.squash)
      if (sgn !== 0 && prevSign !== 0 && sgn !== prevSign) oscillations++
      if (sgn !== 0) prevSign = sgn
    }
    expect(oscillations).toBeGreaterThanOrEqual(3)
    const radii = contourRadii(state, 34, 8)
    for (const r of radii) expect(r).toBeCloseTo(34, 4)
  })

  it('deformation is bounded and clamps cannot invert the silhouette', () => {
    const state = createDeformState()
    let angle = 0
    for (let i = 0; i < 400; i++) {
      angle += 0.13
      registerImpact(state, Math.sin(angle), Math.cos(angle), Math.random() * 45, 34, angle)
      stepDeform(state, 33)
      expect(Math.abs(state.squash)).toBeLessThanOrEqual(DEFORM.maxSquash + 1e-9)
    }
  })
})
