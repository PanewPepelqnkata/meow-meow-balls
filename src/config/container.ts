
/**
 * Container geometry — an OPEN-TOP TRAPEZOID (Phase 2.1):
 * wider at the top, inward-sloping side walls converging toward a horizontal
 * floor. This module is the SINGLE SOURCE of geometry: Matter colliders and
 * ContainerView visuals both derive from it. No geometry constants elsewhere.
 *
 * Units are logical stage units (docs/STAGE_SIZE.md: 720x1280 stage).
 * Bottom band below the floor (floorY..1280) is reserved for the future HUD.
 * Extend Walls (future power-up) stays compatible: geometry is derived from
 * this config, so extension = shifting `topY` up / increasing `height`.
 */
export const CONTAINER = {
  /**
   * Interior trapezoid dimensions.
   * Phase 2.11.2: normal wall height 400 → 320 (spec §2) — the container
   * reads as a wide, SHALLOW open-top trapezoid on the desktop reference
   * (wall tops render at y≈576, floor top at y≈845 at 1648×936). The slope
   * is PRESERVED exactly (0.142105 px/y — Phase 2.10.1 invariant): topWidth
   * = 405 + 2·0.142105·320 = 495.905, so the WALL LINES and footpoints
   * (±202.5 at the floor) are unchanged — only the wall TOPS moved down
   * along the same lines. Raised top width (592.6) is likewise unchanged
   * (extrapolated from the slope). Raise Walls animates height back to
   * RAISED_HEIGHT (660) for 25s. The floor stays at y=1085; the RIM moves
   * down to y=765.
   * - mouth 495.9 at the normal rim, bottom 405: tier-6 diameter 212 = 52%
   *   of floor width, still well inside
   */
  topWidth: 495.905,
  bottomWidth: 405,
  /** Normal (default) wall height in stage units. */
  height: 320,
  /** Interior top edge y in stage units (container horizontally centered at 360). */
  topY: 765,
  /** Raised wall height used by the Raise Walls ability (pre-2.9.6 height). */
  raisedHeight: 660,
  /**
   * Perpendicular thickness of the striped frame band — the COLLIDER outer
   * edge (physics). Interior surfaces are unchanged by construction; never
   * fatten this for looks — the VISUAL band thickness lives in
   * `visual.bandThickness` so decoration can never perturb the simulation.
   */
  frameThickness: 22,
  /**
   * Extra collision depth beyond the visible band (invisible): soft-body
   * particles moving ≤14 px/step need a slab thicker than the per-step travel
   * to make tunneling impossible under pile pressure. Inner surfaces — the
   * ones aligned with the visible frame — are unchanged.
   */
  colliderDepth: 60,

  visual: {
    /**
     * The VISIBLE band is a chunky arcade frame (74): bold ink outlines on
     * BOTH edges, bright inner highlight, blue body, dark outer bevel, and
     * an inset black/cream hazard-stripe panel. The interior edge and every
     * collider are untouched (the collider band stays at `frameThickness`
     * 22); the extra band is purely decorative.
     */
    bandThickness: 74,
  },
} as const

export interface Vec2 {
  x: number
  y: number
}

export interface InteriorCorners {
  topLeft: Vec2
  topRight: Vec2
  bottomRight: Vec2
  bottomLeft: Vec2
}

/** Inner surface corners of the trapezoid (collision inner edges == visible edges).
 * `heightOverride` supports the Raise Walls animation: the FLOOR stays at its
 * fixed design position (topY + normal height = y=1085) and only the wall TOPS
 * move, along the same wall lines (footpoints and wall angles are invariant —
 * Phase 2.9.9). The top width is extrapolated from the fixed bottom width along
 * the normal-geometry wall slope, so raising extends the existing sloped walls
 * upward instead of dragging the floor down. */
export function interiorCorners(heightOverride?: number): InteriorCorners {
  const stageCenter = 360
  const { topWidth, bottomWidth, topY } = CONTAINER
  const height = heightOverride ?? CONTAINER.height
  // Fixed floor line: the normal-geometry interior bottom (y = 1085).
  const floorY = topY + CONTAINER.height
  // Wall slope (horizontal run per unit y) from the NORMAL geometry — the
  // raised walls are the SAME lines extended upward.
  const slopePerY = (topWidth - bottomWidth) / 2 / CONTAINER.height
  const topHalfWidth = bottomWidth / 2 + slopePerY * height
  const topYAtHeight = floorY - height
  return {
    topLeft: { x: stageCenter - topHalfWidth, y: topYAtHeight },
    topRight: { x: stageCenter + topHalfWidth, y: topYAtHeight },
    bottomRight: { x: stageCenter + bottomWidth / 2, y: floorY },
    bottomLeft: { x: stageCenter - bottomWidth / 2, y: floorY },
  }
}

export interface TrapezoidBounds {
  left: number
  right: number
  top: number
  floorY: number
  /** Horizontal inner-edge x at a given y (walls slope inward). */
  innerLeftAt: (y: number) => number
  innerRightAt: (y: number) => number
}

export function containerBounds(): TrapezoidBounds {
  const c = interiorCorners()
  const slopeL = (c.bottomLeft.x - c.topLeft.x) / (c.bottomLeft.y - c.topLeft.y)
  const slopeR = (c.bottomRight.x - c.topRight.x) / (c.bottomRight.y - c.topRight.y)
  return {
    left: c.topLeft.x,
    right: c.topRight.x,
    top: c.topLeft.y,
    floorY: c.bottomLeft.y,
    innerLeftAt: (y: number) => c.topLeft.x + slopeL * (y - c.topLeft.y),
    innerRightAt: (y: number) => c.topRight.x + slopeR * (y - c.topRight.y),
  }
}

/** Inner trapezoid polygon: [topLeft, topRight, bottomRight, bottomLeft]. */
export function interiorPolygon(heightOverride?: number): Vec2[] {
  const c = interiorCorners(heightOverride)
  return [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft]
}

/** Y of the wall TOPS for a given wall height (fixed floor line − height).
 * With no override this is the NORMAL rim; the Raise Walls spawn anchor is
 * `wallTopYAt(CONTAINER.raisedHeight)`. Phase 2.10.1: the spawn point is
 * derived from the raised-wall tops (see config/spawn.ts). */
export function wallTopYAt(height: number = CONTAINER.height): number {
  return interiorCorners().bottomLeft.y - height
}

/** Outward unit normal of edge a→b (points away from the polygon centroid). */
function outwardNormal(a: Vec2, b: Vec2, centroidPt: Vec2): Vec2 {
  const ex = b.x - a.x
  const ey = b.y - a.y
  const len = Math.hypot(ex, ey) || 1
  let nx = ey / len
  let ny = -ex / len
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const away = (mx + nx * 5 - centroidPt.x) ** 2 + (my + ny * 5 - centroidPt.y) ** 2
  const toward = (mx - nx * 5 - centroidPt.x) ** 2 + (my - ny * 5 - centroidPt.y) ** 2
  if (away < toward) {
    nx = -nx
    ny = -ny
  }
  return { x: nx, y: ny }
}

/**
 * Frame band outer corners (miter joins) for the three closed edges:
 * left wall, floor, right wall. Top edge remains open.
 * Returns [outerTopLeft, outerBottomLeft, outerBottomRight, outerTopRight].
 * `thickness` defaults to the collider band; ContainerView passes the fatter
 * VISUAL band thickness (`CONTAINER.visual.bandThickness`).
 */
export function framePolygon(
  heightOverride?: number,
  thickness: number = CONTAINER.frameThickness,
): Vec2[] {
  const inner = interiorPolygon(heightOverride)
  const t = thickness
  const centroidPt = {
    x: inner.reduce((s, p) => s + p.x, 0) / inner.length,
    y: inner.reduce((s, p) => s + p.y, 0) / inner.length,
  }
  const edges: Array<[Vec2, Vec2]> = [
    [inner[0]!, inner[3]!], // left wall (topLeft → bottomLeft)
    [inner[3]!, inner[2]!], // floor (bottomLeft → bottomRight)
    [inner[2]!, inner[1]!], // right wall (bottomRight → topRight)
  ]
  const lines = edges.map(([a, b]) => {
    const n = outwardNormal(a, b, centroidPt)
    return { ax: a.x + n.x * t, ay: a.y + n.y * t, bx: b.x + n.x * t, by: b.y + n.y * t }
  })

  const intersect = (
    l1: { ax: number; ay: number; bx: number; by: number },
    l2: { ax: number; ay: number; bx: number; by: number },
  ): Vec2 => {
    const d1x = l1.bx - l1.ax
    const d1y = l1.by - l1.ay
    const d2x = l2.bx - l2.ax
    const d2y = l2.by - l2.ay
    const denom = d1x * d2y - d1y * d2x
    if (Math.abs(denom) < 1e-9) return { x: l1.bx, y: l1.by }
    const s = ((l2.ax - l1.ax) * d2y - (l2.ay - l1.ay) * d2x) / denom
    return { x: l1.ax + d1x * s, y: l1.ay + d1y * s }
  }

  const bottomLeft = intersect(lines[0]!, lines[1]!)
  const bottomRight = intersect(lines[1]!, lines[2]!)
  // Top corners: push the inner top corners horizontally by the wall band's
  // horizontal extent. Perpendicular thickness t on a wall with vertical rise
  // R and horizontal run D corresponds to horizontal dx = t·hypot(R,D)/R.
  const dxLeft = bandRun((inner[3]!.y - inner[0]!.y), Math.abs(inner[0]!.x - inner[3]!.x), t)
  const dxRight = bandRun((inner[2]!.y - inner[1]!.y), Math.abs(inner[2]!.x - inner[1]!.x), t)
  return [
    { x: inner[0]!.x - dxLeft, y: inner[0]!.y },
    bottomLeft,
    bottomRight,
    { x: inner[1]!.x + dxRight, y: inner[1]!.y },
  ]
}

/** Horizontal offset dx so a sloped wall band (rise, run) has perpendicular thickness t. */
function bandRun(rise: number, run: number, t: number): number {
  return (t * Math.hypot(rise, run)) / rise
}

/**
 * The three visual band quads for a given wall height, each as
 * [innerA, innerB, outerB, outerA] (a ring: inner edge a→b, outer edge back
 * b→a). Left wall, floor, right wall — the same order as the colliders.
 * `thickness` is the VISUAL band thickness; the caller (ContainerView) passes
 * `CONTAINER.visual.bandThickness`. Junctions share corner points via
 * `framePolygon`, so wall/floor seams are gapless by construction.
 */
export function bandQuads(heightOverride?: number, thickness: number = CONTAINER.visual.bandThickness): Vec2[][] {
  const inner = interiorPolygon(heightOverride)
  const [tl, tr, br, bl] = [inner[0]!, inner[1]!, inner[2]!, inner[3]!]
  const outer = framePolygon(heightOverride, thickness)
  const [oTL, oBL, oBR, oTR] = [outer[0]!, outer[1]!, outer[2]!, outer[3]!]
  return [
    [tl, bl, oBL, oTL], // left wall (top → bottom)
    [bl, br, oBR, oBL], // floor (left → right)
    [br, tr, oTR, oBR], // right wall (bottom → top)
  ]
}

export interface ColliderSpec {
  vertices: Vec2[]
  label: string
}

/**
 * Static collision colliders for the trapezoid frame. Wall bands are
 * parallelograms offset perpendicular from the inner edges; the floor band
 * spans between the two outer wall corners, so wall/floor junctions are
 * gapless (shared corner points by construction).
 */
/** Wall colliders only (animatable by the Raise Walls ability). */
export function wallCollidersAt(heightOverride?: number): ColliderSpec[] {
  const c = interiorCorners(heightOverride)
  const t = CONTAINER.frameThickness
  const frame = framePolygon(heightOverride) // [outerTL, outerBL, outerBR, outerTR]

  const dxLeft = bandRun(c.bottomLeft.y - c.topLeft.y, Math.abs(c.topLeft.x - c.bottomLeft.x), t)
  const dxRight = bandRun(c.bottomRight.y - c.topRight.y, Math.abs(c.bottomRight.x - c.topRight.x), t)

  return [
    {
      label: 'wall-left',
      vertices: [
        { x: c.topLeft.x, y: c.topLeft.y },
        { x: c.bottomLeft.x, y: c.bottomLeft.y },
        { x: frame[1]!.x, y: frame[1]!.y },
        { x: c.topLeft.x - dxLeft, y: c.topLeft.y },
      ],
    },
    {
      label: 'wall-right',
      vertices: [
        { x: c.topRight.x, y: c.topRight.y },
        { x: c.bottomRight.x, y: c.bottomRight.y },
        { x: frame[2]!.x, y: frame[2]!.y },
        { x: c.topRight.x + dxRight, y: c.topRight.y },
      ],
    },
  ]
}

/** Floor collider (fixed; independent of wall height). */
export function floorCollider(): ColliderSpec {
  const c = interiorCorners()
  const frame = framePolygon()
  return {
    label: 'floor',
    vertices: [
      { x: c.bottomLeft.x, y: c.bottomLeft.y },
      { x: c.bottomRight.x, y: c.bottomRight.y },
      { x: frame[2]!.x, y: frame[2]!.y + CONTAINER.colliderDepth },
      { x: frame[1]!.x, y: frame[1]!.y + CONTAINER.colliderDepth },
    ],
  }
}

/**
 * Collision geometry for the two ROUNDED WALL TIPS. The visible tips are
 * half-disc caps (radius = half the VISUAL band, centered on the wall-top
 * line at depth band/2 — see ContainerView's dome). The flat-topped wall
 * parallelograms stop at the wall-top line, so balls could pass through
 * the caps. Each tip is a chord fan: the dome center plus the arc from the
 * INNER wall-top corner to the OUTER wall-top corner (diametrically
 * opposite through the center — exactly a 180° half-disc). The fan is
 * convex and shares corner points with the wall colliders (the inner
 * corner IS the wall's inner-top vertex; the outer corner lies on the
 * wall's outer-top edge), so wall and cap collide surfaces are seamless.
 * Raise Walls moves the cap by rebuilding from wallCollidersAt-style
 * geometry at each height (see WallAnimator.applyHeight).
 */
const TIP_SEGMENTS = 8

export function tipCollidersAt(heightOverride?: number): ColliderSpec[] {
  const c = interiorCorners(heightOverride)
  const T = CONTAINER.visual.bandThickness
  const Rc = T / 2
  const make = (innerCorner: Vec2, outward: Vec2, label: string): ColliderSpec => {
    // Dome center: midway between the diametrically opposite corners. The
    // outer corner is the inner corner pushed outward by exactly T along
    // the wall-top edge (the mitered framePolygon corner is 0.3px wider on
    // a sloped wall — the cap must match the VISUAL dome, not the miter).
    const ex = outward.x - innerCorner.x
    const ey = outward.y - innerCorner.y
    const elen = Math.hypot(ex, ey) || 1
    const outerCorner: Vec2 = {
      x: innerCorner.x + (ex / elen) * T,
      y: innerCorner.y + (ey / elen) * T,
    }
    const cxp = (innerCorner.x + outerCorner.x) / 2
    const cyp = (innerCorner.y + outerCorner.y) / 2
    const a0 = Math.atan2(innerCorner.y - cyp, innerCorner.x - cxp)
    const a1 = Math.atan2(outerCorner.y - cyp, outerCorner.x - cxp)
    let da = a1 - a0
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    // Sweep the OUTWARD half (away from the interior center) of the circle.
    const mid = a0 + da / 2
    const mx = cxp + Math.cos(mid) * Rc
    const my = cyp + Math.sin(mid) * Rc
    const centroidPt = centroid([c.topLeft, c.topRight, c.bottomRight, c.bottomLeft])
    if ((mx - centroidPt.x) ** 2 + (my - centroidPt.y) ** 2 <
        (2 * cxp - mx - centroidPt.x) ** 2 + (2 * cyp - my - centroidPt.y) ** 2) {
      // Midpoint landed toward the interior — flip sweep direction.
      da = -da
    }
    // Fan: center → inner corner → arc → outer corner. Convex half-disc.
    const segs: Vec2[] = [{ x: cxp, y: cyp }, { ...innerCorner }]
    for (let i = 1; i < TIP_SEGMENTS; i++) {
      const a = a0 + (da * i) / TIP_SEGMENTS
      segs.push({ x: cxp + Math.cos(a) * Rc, y: cyp + Math.sin(a) * Rc })
    }
    segs.push({ ...outerCorner })
    return { label, vertices: segs }
  }
  // Left tip: inner corner = wall inner top; the outer dome pole is the
  // inner corner pushed horizontally outward by exactly T (the visual dome
  // spans [inner, inner − T] on the wall-top line).
  const outwardL = { x: c.topLeft.x - 1, y: c.topLeft.y }
  const outwardR = { x: c.topRight.x + 1, y: c.topRight.y }
  return [
    make(c.topLeft, outwardL, 'tip-left'),
    make(c.topRight, outwardR, 'tip-right'),
  ]
}

export function containerColliders(): ColliderSpec[] {
  return [...wallCollidersAt(), ...tipCollidersAt(), floorCollider()]
}

export function centroid(points: Vec2[]): Vec2 {
  const x = points.reduce((s, p) => s + p.x, 0) / points.length
  const y = points.reduce((s, p) => s + p.y, 0) / points.length
  return { x, y }
}

/** Clamp a ball center so a ball of radius r clears the floor and both
 * slanted wall lines (extrapolated above the rim, matching the funnel the
 * physics backstop enforces). Phase 2.15.0: the container is OPEN at the top
 * — there is deliberately NO top clamp. The physics clamp
 * (SoftBallManager.clampToContainer) treats a centroid above the wall tops
 * as legal open sky, and balls rest above the rim on tall piles; the old
 * `max(y, top + r)` floor here dragged rim-positioned balls (merge
 * replacements AND displaced neighbors) down into the pile. Used by
 * merge-result spawns and push re-clamping. */
export function clampBallInside(x: number, y: number, r: number): Vec2 {
  const b = containerBounds()
  const yy = Math.min(y, b.floorY - r - 0.5)
  const left = b.innerLeftAt(yy) + r + 0.5
  const right = b.innerRightAt(yy) - r - 0.5
  const xx = Math.min(Math.max(x, left), Math.max(left, right))
  return { x: xx, y: yy }
}
