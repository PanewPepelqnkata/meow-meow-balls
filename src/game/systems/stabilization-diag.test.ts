import { describe, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { PhysicsWorld, type CollisionPair } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { MergeSystem } from './MergeSystem'
import { ScoreSystem } from './ScoreSystem'
import { createWallBody, floorCollider } from './ContainerBodies'
import { containerBounds, wallCollidersAt } from '../../config/container'
import { getTier } from '../../config/ballTiers'
import { renderContour, softBallArea, softBallCentroid, softBallSpeed, SOFT } from './SoftBall'
import type { SoftBall } from './SoftBall'

/**
 * DIAGNOSTIC HARNESS (report-only — no pass/fail gates).
 * Runs the ACTUAL production stepping path:
 *   PhysicsWorld.step → Engine.update → clampSpeeds → subStepHandler
 *   (stepAll → separateContacts ×2 → clampToContainer)
 * and records per-logical-ball metrics for the seven required scenarios.
 * Reports are written to qa/softbody/ for before/after comparison.
 */

const OUT_DIR = 'qa/softbody'

interface PairSample {
  rawBodyPen: number // max overlap of actual collision bodies (prA+prB - d)
  prodContactPen: number // production contact metric (includes collisionOutset)
  minCenterDist: number
}

interface StepSample {
  step: number
  balls: Array<{
    id: number
    tier: number
    cx: number
    cy: number
    centroidSpeed: number
    maxParticleSpeed: number
    velVariance: number
    areaRatio: number
    aspect: number
    constraintResidual: number
    separationMoved: number
    sleeping: number
  }>
  pairs: Record<string, PairSample>
  contourMinDist: Record<string, number>
  contourCross: Record<string, boolean>
}

function polygonArea(pts: Matter.Vector[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % pts.length]!
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

function pointInPoly(pt: Matter.Vector, poly: Matter.Vector[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x
    const yi = poly[i]!.y
    const xj = poly[j]!.x
    const yj = poly[j]!.y
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function segDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2
}

function segsIntersect(
  p1: Matter.Vector, p2: Matter.Vector, p3: Matter.Vector, p4: Matter.Vector,
): boolean {
  const d = (a: Matter.Vector, b: Matter.Vector, c: Matter.Vector) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

/** Min distance between two closed contours (sampling dense polylines). */
function contourMinDistance(a: Matter.Vector[], b: Matter.Vector[]): number {
  let min = Infinity
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!
    const a2 = a[(i + 1) % a.length]!
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j]!
      const b2 = b[(j + 1) % b.length]!
      const d = Math.min(
        segDist2(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y),
        segDist2(b1.x, b1.y, b2.x, b2.y, a1.x, a1.y),
      )
      if (d < min) min = d
    }
  }
  return Math.sqrt(min)
}

function contoursCross(a: Matter.Vector[], b: Matter.Vector[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!
    const a2 = a[(i + 1) % a.length]!
    for (let j = 0; j < b.length; j++) {
      if (segsIntersect(a1, a2, b[j]!, b[(j + 1) % b.length]!)) return true
    }
  }
  // one contour fully inside the other (no edge crossings) also counts
  if (pointInPoly(a[0]!, b) || pointInPoly(b[0]!, a)) return true
  return false
}

function constraintResidual(soft: SoftBall): number {
  const cons = Matter.Composite.allConstraints(soft.composite)
  let worst = 0
  for (const c of cons) {
    if (c.bodyA == null || c.bodyB == null) continue
    const d = Math.hypot(
      c.bodyA.position.x - c.bodyB.position.x,
      c.bodyA.position.y - c.bodyB.position.y,
    )
    worst = Math.max(worst, Math.abs(d - c.length))
  }
  return worst
}

function sampleStep(step: number, manager: SoftBallManager, prePositions: Map<number, Matter.Vector> | null): StepSample {
  const b = containerBounds()
  const balls = manager.getBalls()
  const sample: StepSample = { step, balls: [], pairs: {}, contourMinDist: {}, contourCross: {} }
  for (const e of balls) {
    const soft = e.soft
    const c = softBallCentroid(soft)
    const vels = [...soft.particles, soft.center].map((p) => p.velocity)
    const speeds = vels.map((v) => Math.hypot(v.x, v.y))
    const meanVx = vels.reduce((s, v) => s + v.x, 0) / vels.length
    const meanVy = vels.reduce((s, v) => s + v.y, 0) / vels.length
    const variance = vels.reduce((s, v) => s + (v.x - meanVx) ** 2 + (v.y - meanVy) ** 2, 0) / vels.length
    const xs = soft.particles.map((p) => p.position.x)
    const ys = soft.particles.map((p) => p.position.y)
    const sx = Math.max(...xs) - Math.min(...xs)
    const sy = Math.max(...ys) - Math.min(...ys)
    let moved = 0
    if (prePositions) {
      for (const p of soft.particles) {
        const pre = prePositions.get(p.id)
        if (pre) moved = Math.max(moved, Math.hypot(p.position.x - pre.x, p.position.y - pre.y))
      }
    }
    sample.balls.push({
      id: e.id,
      tier: e.tier,
      cx: +c.x.toFixed(1),
      cy: +c.y.toFixed(1),
      centroidSpeed: +softBallSpeed(soft).toFixed(3),
      maxParticleSpeed: +Math.max(...speeds).toFixed(3),
      velVariance: +variance.toFixed(3),
      areaRatio: +(softBallArea(soft) / soft.restArea).toFixed(3),
      aspect: +(sx / (sy || 1)).toFixed(3),
      constraintResidual: +constraintResidual(soft).toFixed(2),
      separationMoved: +moved.toFixed(2),
      sleeping: soft.particles.filter((p) => p.isSleeping).length,
    })
  }
  // cross-ball particle overlap (both definitions)
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const A = balls[i]!
      const B = balls[j]!
      const prA = A.soft.radius * SOFT.particleRadiusFactor
      const prB = B.soft.radius * SOFT.particleRadiusFactor
      let worstRaw = -Infinity
      let worstProd = -Infinity
      let minD = Infinity
      for (const pa of A.soft.particles) {
        for (const pb of B.soft.particles) {
          const d = Math.hypot(pa.position.x - pb.position.x, pa.position.y - pb.position.y)
          minD = Math.min(minD, d)
          // bodyR includes the contact skin (the actual collision discs)
          worstRaw = Math.max(worstRaw, prA + SOFT.contactSkin + (prB + SOFT.contactSkin) - d)
          worstProd = Math.max(
            worstProd,
            prA + prB + 2 * SOFT.contactSkin + 2 - d,
          )
        }
      }
      const key = `${A.id}-${B.id}`
      sample.pairs[key] = {
        rawBodyPen: +worstRaw.toFixed(2),
        prodContactPen: +worstProd.toFixed(2),
        minCenterDist: +minD.toFixed(2),
      }
      // rendered contour relation (only when near)
      const reach = A.soft.radius + B.soft.radius + 30
      const ca = A.soft.center.position
      const cb = B.soft.center.position
      if ((ca.x - cb.x) ** 2 + (ca.y - cb.y) ** 2 < reach * reach) {
        const polyA = renderContour(A.soft, 6, A.soft.radius * SOFT.particleRadiusFactor)
        const polyB = renderContour(B.soft, 6, B.soft.radius * SOFT.particleRadiusFactor)
        sample.contourMinDist[key] = +contourMinDistance(polyA, polyB).toFixed(2)
        sample.contourCross[key] = contoursCross(polyA, polyB)
      }
    }
  }
  // wall escape check: contour points outside the trapezoid interior BELOW
  // the rim (the top is open). Record max penetration depth in px.
  for (const e of balls) {
    const poly = renderContour(e.soft, 6, e.soft.radius * SOFT.particleRadiusFactor)
    let worst = 0
    for (const p of poly) {
      if (p.y <= b.top + 1) continue // open top
      const y = Math.min(p.y, b.floorY)
      const outL = b.innerLeftAt(y) - p.x
      const outR = p.x - b.innerRightAt(y)
      const outF = p.y - b.floorY
      worst = Math.max(worst, outL, outR, outF)
    }
    if (worst > 0) (sample as unknown as Record<string, unknown>)[`wallOut-${e.id}`] = +worst.toFixed(2)
  }
  return sample
}

function summarize(steps: StepSample[]): Record<string, unknown> {
  const sum: Record<string, unknown> = {}
  const maxRaw = Math.max(...steps.flatMap((s) => Object.values(s.pairs).map((p) => p.rawBodyPen)))
  const maxProd = Math.max(...steps.flatMap((s) => Object.values(s.pairs).map((p) => p.prodContactPen)))
  sum.maxRawBodyPen = +maxRaw.toFixed(2)
  sum.maxProdContactPen = +maxProd.toFixed(2)
  const dists = Object.values(samplePairs(steps))
  sum.contourMinDistMin = +Math.min(...dists.map((d) => d.min)).toFixed(2)
  sum.contourCrossSteps = dists.filter((d) => d.cross).length
  const lastHalf = steps.slice(Math.floor(steps.length / 2))
  sum.settledMaxCentroidSpeed = +Math.max(...lastHalf.flatMap((s) => s.balls.map((b) => b.centroidSpeed))).toFixed(3)
  sum.settledMaxParticleSpeed = +Math.max(...lastHalf.flatMap((s) => s.balls.map((b) => b.maxParticleSpeed))).toFixed(3)
  sum.settledMaxVelVariance = +Math.max(...lastHalf.flatMap((s) => s.balls.map((b) => b.velVariance))).toFixed(3)
  sum.settledMaxSepMoved = +Math.max(...lastHalf.flatMap((s) => s.balls.map((b) => b.separationMoved))).toFixed(2)
  sum.settledAreaRange = [
    +Math.min(...lastHalf.flatMap((s) => s.balls.map((b) => b.areaRatio))).toFixed(3),
    +Math.max(...lastHalf.flatMap((s) => s.balls.map((b) => b.areaRatio))).toFixed(3),
  ]
  sum.settledConstraintResidual = +Math.max(...lastHalf.flatMap((s) => s.balls.map((b) => b.constraintResidual))).toFixed(2)
  const wallOuts = steps.flatMap((s) => Object.entries(s).filter(([k]) => k.startsWith('wallOut-')).map(([, v]) => v as number))
  sum.maxWallOutPoints = wallOuts.length ? Math.max(...wallOuts) : 0
  sum.minAspect = +Math.min(...steps.flatMap((s) => s.balls.map((b) => b.aspect))).toFixed(3)
  sum.maxAspect = +Math.max(...steps.flatMap((s) => s.balls.map((b) => b.aspect))).toFixed(3)
  return sum
}

function samplePairs(steps: StepSample[]): Record<string, { min: number; cross: boolean }> {
  const acc: Record<string, { min: number; cross: boolean }> = {}
  for (const s of steps) {
    for (const [k, v] of Object.entries(s.contourMinDist)) {
      if (!acc[k]) acc[k] = { min: Infinity, cross: false }
      acc[k]!.min = Math.min(acc[k]!.min, v)
      acc[k]!.cross = acc[k]!.cross || (s.contourCross[k] ?? false)
    }
  }
  return acc
}

function makeProductionRig() {
  const physics = new PhysicsWorld()
  for (const body of [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]) {
    physics.addBody(body)
  }
  const manager = new SoftBallManager(physics.world)
  manager.tierRadius = (t) => getTier(t)?.radius ?? 34
  // exactly the PlaygroundScene substep handler
  physics.setSubStepHandler(() => {
    manager.stepAll()
    manager.separateContacts()
    manager.expandShape()
    manager.clampToContainer()
    manager.commitRest()
  })
  return { physics, manager }
}

/** Scene-equivalent per-frame event drain (markTouched like the scene). */
function drainEvents(physics: PhysicsWorld, manager: SoftBallManager): CollisionPair[] {
  const events = physics.takeCollisionEvents()
  if (events.length) {
    manager.markTouched(events.flatMap(({ bodyA, bodyB }) => [bodyA.id, bodyB.id]))
  }
  return events
}

/** Run a scenario; `script` receives (physics, manager, helpers). */
function runScenario(
  name: string,
  script: (
    physics: PhysicsWorld,
    manager: SoftBallManager,
    helpers: {
      step: (n: number, sampleEvery?: number) => void
      samples: StepSample[]
      prePositions: Map<number, Matter.Vector> | null
      setPreCapture: (on: boolean) => void
      lastEvents: CollisionPair[]
    },
  ) => void,
): Record<string, unknown> {
  const { physics, manager } = makeProductionRig()
  const samples: StepSample[] = []
  let stepCount = 0
  let capture = false
  let prePositions: Map<number, Matter.Vector> | null = null
  const helpers = {
    lastEvents: [] as CollisionPair[],
    step(n: number, sampleEvery = 1) {
      for (let i = 0; i < n; i++) {
        prePositions = capture
          ? new Map(manager.getBalls().flatMap((e) => e.soft.particles.map((p) => [p.id, { ...p.position }] as const)))
          : null
        physics.step(PHYSICS.stepMs)
        helpers.lastEvents = drainEvents(physics, manager)
        stepCount++
        if (capture && stepCount % sampleEvery === 0) {
          samples.push(sampleStep(stepCount, manager, prePositions))
        }
      }
    },
    samples,
    prePositions: null as Map<number, Matter.Vector> | null,
    setPreCapture(on: boolean) {
      capture = on
    },
  }
  script(physics, manager, helpers)
  const summary = summarize(samples)
  const report = { scenario: name, summary }
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(`${OUT_DIR}/${name}.summary.json`, JSON.stringify(report, null, 2))
  writeFileSync(`${OUT_DIR}/${name}.steps.json`, JSON.stringify(samples, null, 2))
  console.log(`DIAG ${name}:`, JSON.stringify(summary))
  return report
}

describe('stabilization diagnostics (report-only)', () => {
  it('S1: small ball trapped between two larger balls', { timeout: 180000 }, () => {
    runScenario('s1-small-between-large', (_physics, manager, h) => {
      const b = containerBounds()
      const r5 = getTier(5)!.radius
      // two tier-5 balls side by side on the floor, touching
      manager.spawnBall(360 - r5 - 1, b.floorY - r5, 5)
      manager.spawnBall(360 + r5 + 1, b.floorY - r5, 5)
      h.step(420) // settle
      h.setPreCapture(true)
      // drop a tier-1 straight into the gap
      manager.spawnBall(360, b.top + 60, 1)
      h.step(420, 1)
    })
  })

  it('S2: ball dropped into a narrow gap between touching balls', { timeout: 180000 }, () => {
    runScenario('s2-narrow-gap-drop', (_physics, manager, h) => {
      const b = containerBounds()
      const r4 = getTier(4)!.radius
      manager.spawnBall(360 - r4 - 0.5, b.floorY - r4, 4)
      manager.spawnBall(360 + r4 + 0.5, b.floorY - r4, 4)
      h.step(420)
      h.setPreCapture(true)
      manager.spawnBall(360, b.top + 60, 2)
      h.step(360, 1)
    })
  })

  it('S3: rapid drops into an existing pile', { timeout: 180000 }, () => {
    runScenario('s3-rapid-drops', (_physics, manager, h) => {
      const b = containerBounds()
      for (let k = 0; k < 10; k++) {
        const tier = (k % 3) + 1
        manager.spawnBall(240 + (k % 5) * 60, b.top + 60, tier)
        h.step(30)
      }
      h.setPreCapture(true)
      h.step(600, 2)
    })
  })

  it('S4: heavy ball landing on a settled stack', { timeout: 180000 }, () => {
    runScenario('s4-heavy-on-stack', (_physics, manager, h) => {
      const b = containerBounds()
      manager.spawnBall(320, b.floorY - 38, 1)
      manager.spawnBall(400, b.floorY - 38, 1)
      manager.spawnBall(360, b.floorY - 38 - 92, 3)
      manager.spawnBall(360, b.floorY - 38 - 92 - 110, 3)
      h.step(420) // settle the stack
      h.setPreCapture(true)
      manager.spawnBall(360, b.top + 110, 5)
      h.step(420, 1)
    })
  })

  it('S5: dense pile under sustained pressure', { timeout: 180000 }, () => {
    runScenario('s5-dense-pile', (_physics, manager, h) => {
      const b = containerBounds()
      let k = 0
      for (const [tier, x] of [
        [1, 260], [2, 340], [1, 420], [3, 300], [2, 400],
        [1, 460], [3, 360], [2, 280], [1, 360], [3, 430],
        [2, 320], [1, 400], [3, 380], [1, 300],
      ] as Array<[number, number]>) {
        void k
        manager.spawnBall(x, b.top + 40 + (k % 3) * 40, tier)
        k++
        h.step(24)
      }
      h.setPreCapture(true)
      h.step(900, 3)
    })
  })

  it('S6: balls resting against slanted walls and floor', { timeout: 180000 }, () => {
    runScenario('s6-walls-floor', (_physics, manager, h) => {
      const b = containerBounds()
      // balls funnelled against the left wall, right wall, and floor corners
      manager.spawnBall(b.innerLeftAt(b.floorY - 40) + 40, b.floorY - 40, 2)
      manager.spawnBall(b.innerRightAt(b.floorY - 40) - 40, b.floorY - 40, 2)
      manager.spawnBall(b.innerLeftAt(b.floorY - 130) + 50, b.floorY - 130, 3)
      manager.spawnBall(b.innerRightAt(b.floorY - 130) - 50, b.floorY - 130, 3)
      manager.spawnBall(360, b.top + 50, 4)
      h.setPreCapture(true)
      h.step(720, 2)
    })
  })

  it('S7: settle after all impacts stop', { timeout: 180000 }, () => {
    runScenario('s7-settle', (_physics, manager, h) => {
      const b = containerBounds()
      for (let k = 0; k < 8; k++) {
        manager.spawnBall(260 + (k % 4) * 65, b.top + 50, (k % 3) + 1)
        h.step(40)
      }
      h.step(300) // impacts stop
      const before = manager.getBalls().map((e) => softBallCentroid(e.soft))
      h.setPreCapture(true)
      h.step(600, 2)
      const after = manager.getBalls().map((e) => softBallCentroid(e.soft))
      const drift = after.map((c, i) => Math.hypot(c.x - before[i]!.x, c.y - before[i]!.y))
      writeFileSync(
        `${OUT_DIR}/s7-drift.json`,
        JSON.stringify(manager.getBalls().map((e, i) => ({ id: e.id, drift: +drift[i]!.toFixed(2), speed: +softBallSpeed(e.soft).toFixed(3) })), null, 2),
      )
      console.log('DIAG s7 centroid drift px:', drift.map((d) => +d.toFixed(2)).join(', '))
    })
  })

  it('S8: free-fall acceleration (production spawn path)', { timeout: 180000 }, () => {
    runScenario('s8-freefall', (_physics, manager, h) => {
      const b = containerBounds()
      const ball = manager.spawnBall(360, b.top + 60, 3)
      let maxSpeed = 0
      let v0 = 0
      const trace: Array<{ step: number; vy: number }> = []
      h.setPreCapture(false)
      for (let i = 0; i < 60; i++) {
        h.step(1)
        const vy = ball.soft.center.velocity.y
        trace.push({ step: i, vy: +vy.toFixed(3) })
        maxSpeed = Math.max(maxSpeed, Math.abs(vy))
        if (i === 5) v0 = vy
      }
      const gainPerStep = (maxSpeed - v0) / 54
      console.log(`DIAG freefall: vy gain/step ≈ ${gainPerStep.toFixed(3)} (gravity ≈ 0.444), maxSpeed ${maxSpeed.toFixed(2)}`)
      writeFileSync(`${OUT_DIR}/s8-freefall.json`, JSON.stringify({ gainPerStep: +gainPerStep.toFixed(4), maxSpeed: +maxSpeed.toFixed(3), trace }, null, 2))
    })
  })

  it('S9: merge still works after fixes (tier1+tier1 → tier2)', { timeout: 180000 }, () => {
    runScenario('s9-merge', (physics, manager, h) => {
      const b = containerBounds()
      const a = manager.spawnBall(340, b.floorY - 40, 1)
      const c = manager.spawnBall(384, b.floorY - 40, 1)
      void a
      void c
      const score = new ScoreSystem()
      const merges = new MergeSystem(manager, physics, score)
      let merged = false
      for (let i = 0; i < 400; i++) {
        h.step(1)
        merges.processMerges(h.lastEvents)
        if (!manager.getBallById(a.id) && !manager.getBallById(c.id)) {
          merged = manager.getBalls().some((e) => e.tier === 2)
          break
        }
      }
      console.log(`DIAG merge: merged=${merged} balls=${manager.count} tiers=${manager.getBalls().map((e) => e.tier).join(',')}`)
      writeFileSync(`${OUT_DIR}/s9-merge.json`, JSON.stringify({ merged, count: manager.count }))
    })
  })
})

// keep tree-shaking honest
void polygonArea
