import { describe, expect, it } from 'vitest'
import Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { CONTAINER, interiorCorners, interiorPolygon, framePolygon, wallCollidersAt, floorCollider } from '../../config/container'
import { createWallBody } from './ContainerBodies'
import { WallAnimator } from './WallAnimator'
import { SoftBallManager } from './SoftBallManager'
import { getTier } from '../../config/ballTiers'

/**
 * Phase 2.9.9 Raise Walls geometry regressions. These test the ACTUAL
 * world-space geometry — the vertices of the live Matter wall/floor bodies
 * driven by WallAnimator through a full ability cycle — not animation state
 * variables or config numbers:
 *  1. the floor never moves (before / during / after),
 *  2. wall footpoints stay fixed,
 *  3. wall tops move UP when raising starts,
 *  4. raised height > normal height,
 *  5. geometry returns exactly to normal after the ability expires,
 *  6. rendered bands (interiorPolygon/framePolygon — what ContainerView draws)
 *     agree with the collider vertices at every sampled height.
 */

const STEP = PHYSICS.stepMs
const FLOOR_Y = CONTAINER.topY + CONTAINER.height // fixed design floor (1085)

/** Sort vertex sets so bodies rebuilt by setVertices can be compared set-wise. */
function vertexKey(vs: Matter.Vector[]): string {
  return vs
    .map((v) => `${v.x.toFixed(4)},${v.y.toFixed(4)}`)
    .sort()
    .join('|')
}

function makeRig() {
  const engine = Matter.Engine.create({
    gravity: { ...PHYSICS.gravity },
    positionIterations: PHYSICS.engine.positionIterations,
    velocityIterations: PHYSICS.engine.velocityIterations,
    constraintIterations: PHYSICS.engine.constraintIterations,
    enableSleeping: PHYSICS.engine.enableSleeping,
  })
  const wallSpecs = wallCollidersAt()
  const wallBodies = wallSpecs.map(createWallBody)
  const floorBody = createWallBody(floorCollider())
  Matter.Composite.add(engine.world, [...wallBodies, floorBody])
  const manager = new SoftBallManager(engine.world)
  manager.tierRadius = (t) => getTier(t)?.radius ?? 34
  const walls = new WallAnimator()
  let fakeTime = 0
  walls.setClock(() => fakeTime)
  walls.bind(wallBodies, () => undefined, manager)
  return {
    engine,
    walls,
    manager,
    wallBodies,
    floorBody,
    /** One animated frame: advance the animator clock and the physics. */
    tick(ms: number, steps = Math.round(ms / STEP)) {
      for (let i = 0; i < steps; i++) {
        fakeTime += STEP
        walls.update(fakeTime)
        Matter.Engine.update(engine, STEP)
        manager.stepAll()
        manager.separateContacts()
        manager.expandShape()
        manager.clampToContainer()
        manager.commitRest()
      }
    },
  }
}

describe('Phase 2.9.9: Raise Walls world-space geometry', () => {
  it('floor never moves; footpoints fixed; tops rise and return (full cycle on live bodies)', () => {
    const rig = makeRig()
    const initialWallKeys = rig.wallBodies.map((b) => vertexKey(b.vertices as unknown as Matter.Vector[]))
    const initialFloorKey = vertexKey(rig.floorBody.vertices as unknown as Matter.Vector[])

    // -- before: normal geometry --
    const corners = interiorCorners(rig.walls.height)
    expect(corners.bottomLeft.y).toBeCloseTo(FLOOR_Y, 6)
    expect(corners.topLeft.y).toBeCloseTo(CONTAINER.topY, 6)

    // -- activate: mid-raise and fully raised --
    expect(rig.walls.activate()).toBe(true)
    rig.tick(450) // mid-animation (900ms ease)
    const mid = rig.wallBodies.map((b) => vertexKey(b.vertices as unknown as Matter.Vector[]))
    expect(mid).not.toEqual(initialWallKeys) // tops actually moved
    const midCorners = interiorCorners(rig.walls.height)
    expect(midCorners.topLeft.y).toBeLessThan(CONTAINER.topY) // top is UP mid-raise
    expect(midCorners.bottomLeft.y).toBeCloseTo(FLOOR_Y, 6) // floor pinned mid-raise
    rig.tick(450)
    expect(rig.walls.phaseNow).toBe('raised')
    const raisedCorners = interiorCorners(rig.walls.height)
    expect(rig.walls.height).toBeCloseTo(CONTAINER.raisedHeight, 3)
    expect(raisedCorners.topLeft.y).toBeCloseTo(FLOOR_Y - CONTAINER.raisedHeight, 3) // ≈ 425
    expect(CONTAINER.raisedHeight).toBeGreaterThan(CONTAINER.height) // raised > normal
    expect(raisedCorners.bottomLeft.y).toBeCloseTo(FLOOR_Y, 6)
    // raised tops strictly above normal tops
    expect(raisedCorners.topLeft.y).toBeLessThan(corners.topLeft.y)

    // -- expiry: hold ends, lowering runs, geometry returns exactly --
    rig.tick(25_000 + 450)
    expect(rig.walls.phaseNow).toBe('lowering')
    const lowerCorners = interiorCorners(rig.walls.height)
    expect(lowerCorners.topLeft.y).toBeGreaterThan(raisedCorners.topLeft.y) // coming back down
    expect(lowerCorners.bottomLeft.y).toBeCloseTo(FLOOR_Y, 6)
    // complete the lowering (poll with slack — the easing ends within 900ms)
    for (let i = 0; i < 200 && rig.walls.phaseNow !== 'normal'; i++) rig.tick(STEP)
    expect(rig.walls.phaseNow).toBe('normal')
    expect(rig.wallBodies.map((b) => vertexKey(b.vertices as unknown as Matter.Vector[]))).toEqual(initialWallKeys)
    expect(vertexKey(rig.floorBody.vertices as unknown as Matter.Vector[])).toEqual(initialFloorKey)
  }, 30000)

  it('wall colliders at every height share footpoints, angles, and the fixed floor line', () => {
    for (const h of [CONTAINER.height, 500, 560, 620, CONTAINER.raisedHeight]) {
      const specs = wallCollidersAt(h)
      expect(specs).toHaveLength(2)
      const c = interiorCorners(h)
      // footpoints: the inner-bottom vertices are the SAME points for every h
      expect(specs[0]!.vertices[1]).toEqual(c.bottomLeft)
      expect(specs[1]!.vertices[1]).toEqual(c.bottomRight)
      // floor line pinned at the design coordinate for any animated height
      expect(c.bottomLeft.y).toBeCloseTo(FLOOR_Y, 6)
      expect(c.bottomRight.y).toBeCloseTo(FLOOR_Y, 6)
      // wall angle preserved: (top → bottom) direction equals the normal
      // geometry direction for both walls
      const n0 = interiorCorners()
      const dirL = (a: typeof c.bottomLeft, b: typeof c.topLeft) =>
        Math.atan2(b.x - a.x, b.y - a.y)
      expect(dirL(c.bottomLeft, c.topLeft)).toBeCloseTo(dirL(n0.bottomLeft, n0.topLeft), 9)
      expect(dirL(c.bottomRight, c.topRight)).toBeCloseTo(dirL(n0.bottomRight, n0.topRight), 9)
    }
  })

  it('rendered bands and collider vertices agree during the animation', () => {
    // ContainerView draws interiorPolygon(h)/framePolygon(h); the physics walls
    // are wallCollidersAt(h). Both derive from interiorCorners — pin them to
    // each other at sampled heights through the raise/lower range.
    for (let h = CONTAINER.height; h <= CONTAINER.raisedHeight; h += 37) {
      const inner = interiorPolygon(h) // [TL, TR, BR, BL]
      const frame = framePolygon(h) // [oTL, oBL, oBR, oTR]
      const specs = wallCollidersAt(h)
      const left = specs[0]!.vertices
      const right = specs[1]!.vertices
      // wall colliders' inner edge == interior polygon's side edges
      expect(left[0]).toEqual(inner[0])
      expect(left[1]).toEqual(inner[3])
      expect(right[0]).toEqual(inner[1])
      expect(right[1]).toEqual(inner[2])
      // wall colliders' outer edge == frame polygon's outer side corners
      expect(left[3]!.x).toBeCloseTo(frame[0]!.x, 6)
      expect(left[2]).toEqual(frame[1])
      expect(right[3]).toEqual(frame[3])
      expect(right[2]!.x).toBeCloseTo(frame[2]!.x, 6)
    }
  })

  it('a ball resting on the floor stays put through a full raise/lower cycle (floor does not launch or shift it)', () => {
    const rig = makeRig()
    const b = interiorCorners()
    const ball = rig.manager.spawnBall(360, b.bottomLeft.y - 60, 2)
    rig.tick(3000) // settle onto the floor
    const settled = { ...rig.manager.centroid(ball.id) }
    expect(settled.y).toBeLessThan(b.bottomLeft.y) // actually resting above the floor

    rig.walls.activate()
    rig.tick(900) // raise
    expect(rig.walls.phaseNow).toBe('raised')
    rig.tick(25_000) // hold
    for (let i = 0; i < 200 && rig.walls.phaseNow !== 'normal'; i++) rig.tick(STEP) // lower
    expect(rig.walls.phaseNow).toBe('normal')

    const after = rig.manager.centroid(ball.id)
    // the floor never moved, so the resting ball's centroid must not have been
    // dragged down or launched by the wall animation
    expect(Math.abs(after.y - settled.y)).toBeLessThan(4)
    expect(after.y).toBeLessThan(b.bottomLeft.y + 1)
    for (const p of ball.soft.particles) {
      expect(p.position.y).toBeLessThan(b.bottomLeft.y + 1)
    }
  }, 30000)
})
