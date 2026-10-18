import Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { containerColliders, wallCollidersAt, floorCollider } from '../../config/container'
import type { ColliderSpec } from '../../config/container'
export { floorCollider }

/**
 * Matter-ready static bodies for the trapezoid container, built exclusively
 * from the config geometry (src/config/container.ts).
 *
 * EXACT ALIGNMENT (Phase 2.10.0): `Bodies.fromVertices` re-positions the
 * body so its CENTER OF MASS lands on the (x, y) argument, and it may prune
 * collinear/duplicate vertices first — either way the created vertices end
 * up a small rigid offset away from the spec (measured 0.04–0.8px: the
 * floor used to sit 0.6px ABOVE the visible floor line, an invisible step).
 * We close that gap: after creation, the body is translated by the residual
 * bounds offset so its collision vertices sit EXACTLY on the config
 * geometry — the collision inner edges coincide with the visible striped
 * frame, with no invisible step between them.
 *
 * NOTE: Matter's `Body.setStatic` forces friction=1 / restitution=0 on
 * static bodies and ignores the options passed to `fromVertices`. We
 * therefore assign our configured wall friction/restitution AFTER creation.
 */

function createSpecBody(spec: ColliderSpec): Matter.Body {
  const centre = Matter.Vertices.centre(spec.vertices as Matter.Vector[])
  const body = Matter.Bodies.fromVertices(
    centre.x,
    centre.y,
    [spec.vertices],
    { isStatic: true, label: spec.label },
    true,
  )
  // Residual rigid offset from fromVertices' re-centering/pruning: align the
  // bounds (a pure translation shifts min and max identically — assert that
  // so a rotation/degenerate case can never slip through silently).
  const specMinX = Math.min(...spec.vertices.map((v) => v.x))
  const specMinY = Math.min(...spec.vertices.map((v) => v.y))
  const dx = specMinX - body.bounds.min.x
  const dy = specMinY - body.bounds.min.y
  const dxMax = Math.max(...spec.vertices.map((v) => v.x)) - body.bounds.max.x
  const dyMax = Math.max(...spec.vertices.map((v) => v.y)) - body.bounds.max.y
  if (Math.abs(dx - dxMax) > 1e-6 || Math.abs(dy - dyMax) > 1e-6) {
    throw new Error(`createWallBody: non-translational offset for ${spec.label} — collider spec not rigidly placeable`)
  }
  if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
    Matter.Body.translate(body, { x: dx, y: dy })
  }
  body.friction = PHYSICS.wall.friction
  body.frictionStatic = PHYSICS.wall.friction
  body.restitution = PHYSICS.wall.restitution
  return body
}

/** Create a single static body from a collider spec (walls + floor). */
export function createWallBody(spec: { vertices: { x: number; y: number }[]; label: string }): Matter.Body {
  return createSpecBody(spec as ColliderSpec)
}

/** Create the complete default container (walls at normal height + floor). */
export function createDefaultContainer(): Matter.Body[] {
  return [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]
}

export function createContainerBodies(): Matter.Body[] {
  return containerColliders().map((spec) => createSpecBody(spec))
}
