import { describe, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { PHYSICS } from '../../config/physics'
import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { createWallBody, floorCollider } from './ContainerBodies'
import { containerBounds, wallCollidersAt } from '../../config/container'
import { getTier } from '../../config/ballTiers'
import { SOFT, renderContour, softBallCentroid, softBallArea } from './SoftBall'

/** Renders the settled s5 dense pile (production stepping path) to an SVG —
 * a kept artifact for eyeballing shape quality and packing. */
describe('stabilization visual artifact', () => {
  it('renders the dense-pile end state', () => {
    const physics = new PhysicsWorld()
    for (const body of [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]) {
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
    const b = containerBounds()
    const spawns: Array<[number, number]> = [
      [260, 1], [340, 2], [420, 1], [300, 3], [400, 2],
      [460, 1], [360, 3], [280, 2], [360, 1], [430, 3],
      [320, 2], [400, 1], [380, 3], [300, 1],
    ]
    let k = 0
    for (const [x, tier] of spawns) {
      manager.spawnBall(x, b.top + 40 + (k % 3) * 40, tier)
      k++
      for (let i = 0; i < 48; i++) {
        physics.step(PHYSICS.stepMs)
        const events = physics.takeCollisionEvents()
        if (events.length) manager.markTouched(events.flatMap(({ bodyA, bodyB }) => [bodyA.id, bodyB.id]))
      }
    }
    for (let i = 0; i < 2400; i++) {
      physics.step(PHYSICS.stepMs)
      const events = physics.takeCollisionEvents()
      if (events.length) manager.markTouched(events.flatMap(({ bodyA, bodyB }) => [bodyA.id, bodyB.id]))
    }
    const colors = ['#4fc3f7', '#5fd437', '#f96ec0', '#f44336']
    const parts: string[] = []
    parts.push(`<rect x="90" y="1085" width="540" height="8" fill="#1a1a1a"/>`)
    parts.push(`<line x1="90" y1="610" x2="157.5" y2="1085" stroke="#1a1a1a" stroke-width="4"/>`)
    parts.push(`<line x1="630" y1="610" x2="562.5" y2="1085" stroke="#1a1a1a" stroke-width="4"/>`)
    const areas: number[] = []
    for (const e of manager.getBalls()) {
      const col = colors[(e.tier - 1) % colors.length]!
      for (const p of e.soft.particles) {
        parts.push(`<circle cx="${p.position.x.toFixed(1)}" cy="${p.position.y.toFixed(1)}" r="${(e.soft.radius * SOFT.particleRadiusFactor + SOFT.contactSkin).toFixed(1)}" fill="${col}22" stroke="${col}" stroke-width="0.6"/>`)
      }
      const contour = renderContour(e.soft, 6, e.soft.radius * SOFT.particleRadiusFactor)
      const path = contour.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ') + ' Z'
      parts.push(`<path d="${path}" fill="none" stroke="#1a1a1a" stroke-width="2"/>`)
      const c = softBallCentroid(e.soft)
      areas.push(+(softBallArea(e.soft) / e.soft.restArea).toFixed(2))
      parts.push(`<text x="${c.x.toFixed(0)}" y="${c.y.toFixed(0)}" font-size="10" text-anchor="middle">${e.id}</text>`)
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="540" viewBox="30 580 660 540">${parts.join('')}</svg>`
    mkdirSync('qa/softbody', { recursive: true })
    writeFileSync('qa/softbody/s5-pile-final.svg', svg)
    writeFileSync('qa/softbody/s5-areas-final.json', JSON.stringify(areas))
  }, 180000)
})
