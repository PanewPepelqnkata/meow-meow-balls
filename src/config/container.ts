
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
 *
 * Phase 2.19 — PORTRAIT PHONES get a dedicated container proportion: the
 * desktop funnel (645 outer, shallow 320 walls) reads as a desktop object
 * when framed for a phone. `resolveViewportContainer()` detects a portrait
 * phone viewport ONCE at boot and overrides the exported values so every
 * consumer (physics colliders, ContainerView texture, spawn anchors, Raise
 * Walls animation) derives the phone container — same wall-slope rules, but
 * a TALLER, NARROWER funnel that fills the lower-middle of a portrait
 * screen. Landscape/desktop keeps the reference geometry untouched.
 *
 * The exported object is intentionally mutable-once: geometry consumers
 * capture `CONTAINER.height` in fields at construction (WallAnimator), so
 * the override must happen before any scene constructs. GameRoot calls
 * `resolveViewportContainer()` first thing in createGame().
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
   * along the same lines. Raise Walls adds 255 to the desktop height,
   * reaching 575 for 25s. The floor stays at y=1085; the normal rim is
   * y=765 and the raised rim is y=510.
   * - mouth 495.9 at the normal rim, bottom 405: tier-6 diameter 212 = 52%
   *   of floor width, still well inside
   *
   * Phase 2.19: `resolveViewportContainer()` rewrites these (once, at boot)
   * for portrait phones — see its doc for the phone funnel design.
   */
  topWidth: 495.905,
  bottomWidth: 405,
  /** Normal (default) wall height in stage units. */
  height: 320,
  /** Interior top edge y in stage units (container horizontally centered at 360). */
  topY: 765,
  /** Raised wall height: normal 320 plus a 255-unit extension. */
  raisedHeight: 575,
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
     * an inset black/cream hazard-stripe panel. Side/floor colliders retain
     * `frameThickness` 22; the wall-end caps alone share the full visual
     * width so their rendered and collision silhouettes agree.
     */
    bandThickness: 74,
  },
}

/**
 * Desktop reference geometry snapshot — the values above before a portrait
 * override. Kept for tests and for any code that must compare against the
 * canonical desktop proportions.
 */
export const DESKTOP_CONTAINER: Readonly<typeof CONTAINER> = { ...CONTAINER }

/**
 * Phase 2.19 — detect a portrait phone viewport and, if found, rewrite the
 * CONTAINER values in place so the whole game (physics, rendering, spawn)
 * uses the phone funnel. Call ONCE, before any scene/geometry consumer
 * constructs. Landscape and desktop viewports leave the reference geometry.
 *
 * Phone funnel design (same slope-invariant construction as Phase 2.11.2):
 *  - interior bottom 340 (desktop 405): a narrower floor reads as a phone
 *    object and leaves symmetric sky margins at equal zoom
 *  - interior height 400 (desktop 320): a TALLER funnel = real gameplay
 *    depth in the lower-middle of the portrait screen; top width derived
 *    from the SAME 0.142105 slope → 340 + 2·0.142105·400 = 453.7
 *  - the floor stays at stage 1085; the rim moves UP to 1085 − 400 = 685.
 *    Raise Walls adds 120: raised rim = 685 − 120 = 565 (raisedHeight 520).
 */
export function resolveViewportContainer(vw: number, vh: number): void {
  // Any portrait viewport is the mobile composition (space theme, phone
  // funnel) — matching BackgroundScene's theme pin rule.
  const isPortrait = vh > vw
  if (!isPortrait) return

  const bottomWidth = 340
  const height = 400
  const slopePerY = (DESKTOP_CONTAINER.topWidth - DESKTOP_CONTAINER.bottomWidth) / 2 / DESKTOP_CONTAINER.height
  const topWidth = bottomWidth + 2 * slopePerY * height

  CONTAINER.topWidth = topWidth
  CONTAINER.bottomWidth = bottomWidth
  CONTAINER.height = height
  CONTAINER.topY = DESKTOP_CONTAINER.topY + DESKTOP_CONTAINER.height - height
  CONTAINER.raisedHeight = height + 120
}

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

let cachedBounds: TrapezoidBounds | null = null
let cachedBoundsKey = ''

/** PERF: containerBounds() allocated ~7 objects (corners + bounds + 2
 * closures) per call and was called 1-3x per SUBSTEP from the physics
 * passes — ~500-800 allocs/s. The geometry only changes when the
 * viewport container resolves (resize), so cache by the current
 * resolved signature. resolveViewportContainer clears the cache. */
export function containerBounds(): TrapezoidBounds {
  const key = `${CONTAINER.topWidth}x${CONTAINER.height}`
  if (cachedBounds && cachedBoundsKey === key) return cachedBounds
  const c = interiorCorners()
  const slopeL = (c.bottomLeft.x - c.topLeft.x) / (c.bottomLeft.y - c.topLeft.y)
  const slopeR = (c.bottomRight.x - c.topRight.x) / (c.bottomRight.y - c.topRight.y)
  const b: TrapezoidBounds = {
    left: c.topLeft.x,
    right: c.topRight.x,
    top: c.topLeft.y,
    floorY: c.bottomLeft.y,
    innerLeftAt: (y: number) => c.topLeft.x + slopeL * (y - c.topLeft.y),
    innerRightAt: (y: number) => c.topRight.x + slopeR * (y - c.topRight.y),
  }
  cachedBounds = b
  cachedBoundsKey = key
  return b
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
 * Flat-ended chamfer caps shared by collision and rendering. Each underside
 * lies on the live horizontal rim, spanning from the inner wall-top corner
 * outward by the visual band width T. The convex cap rises 0.22T, with short
 * 0.08T bevels at its top corners; no vertex extends inward of the wall top.
 * Rebuilding at an animated height translates the whole cap with the rim
 * while preserving the normal wall lines and fixed floor geometry.
 */
export function tipCollidersAt(heightOverride?: number): ColliderSpec[] {
  const c = interiorCorners(heightOverride)
  const T = CONTAINER.visual.bandThickness
  const height = T * 0.22
  const chamfer = T * 0.08
  const make = (inner: Vec2, direction: number, label: string): ColliderSpec => ({
    label,
    vertices: [
      { x: inner.x, y: inner.y },
      { x: inner.x, y: inner.y - height + chamfer },
      { x: inner.x + direction * chamfer, y: inner.y - height },
      { x: inner.x + direction * (T - chamfer), y: inner.y - height },
      { x: inner.x + direction * T, y: inner.y - height + chamfer },
      { x: inner.x + direction * T, y: inner.y },
    ],
  })
  return [
    make(c.topLeft, -1, 'tip-left'),
    make(c.topRight, 1, 'tip-right'),
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
