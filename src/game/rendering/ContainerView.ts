import Phaser from 'phaser'
import { CONTAINER, interiorPolygon, type Vec2 } from '../../config/container'

/**
 * Premium glossy blue arcade frame — ONE continuous U-shaped beam per
 * layer. Every visual layer is a stroke of the same U centerline path
 * (offset outward by its own depth, stroke width = its band width):
 *
 *   ink outline   depth T/2,   width T + 12   (outer silhouette, round cap)
 *   royal body    depth T/2,   width T        (inner edge = physics surface)
 *   cyan strip    depth 7.5%,  width 11%      (inner-edge highlight)
 *   stripe panel  depth 44%,   width 36%      (cream backing, stripes masked)
 *   navy bevel    depth 88.5%, width 17%      (outer-edge shade)
 *
 * TOP ENDS: the ink and body strokes use ROUND caps — each wall terminates
 * in a smooth blue dome (radius T/2) wrapped by the ink outline, i.e. the
 * beam's rounded end, tangent to both straight edges. The cyan highlight
 * and navy bevel TIP-WRAP into the dome: their centerlines arc over the
 * dome's shoulder, tangent to the wall and concentric with the dome, so
 * they follow the tip's curvature and end inside the solid-blue dome
 * (peeled down-wall, no abrupt endings, clean blue margin around each
 * end). The stripe panel uses a BUTT cap trimmed back along the
 * wall, so stripes terminate in a clean line perpendicular to the wall
 * below the dome — stripes never enter the cap, and the dome above
 * is solid blue. Both walls use the identical construction (the container
 * U is symmetric; offsets are computed from the shared geometry).
 *
 * Everything renders into a cached 720×1280 canvas texture, repainted only
 * when the wall height changes (Raise Walls). Collision geometry, floor
 * position and Raise Walls behavior are untouched — the inner edge of the
 * body stroke IS the physics surface.
 *
 * The COMBO GLOW (light sheet sweeping left → right) is clipped against
 * the band quads — walls and bottom only, never the interior. Chain ≥ 2
 * sweeps in container blue; chain ≥ 4 in rainbow RGB.
 */

type Pt = Vec2

/** Intersection of the infinite lines through segments s1 and s2. */
function lineIntersect(s1: { a: Pt; b: Pt }, s2: { a: Pt; b: Pt }): Pt {
  const d1x = s1.b.x - s1.a.x
  const d1y = s1.b.y - s1.a.y
  const d2x = s2.b.x - s2.a.x
  const d2y = s2.b.y - s2.a.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-9) return { ...s1.b }
  const t = ((s2.a.x - s1.a.x) * d2y - (s2.a.y - s1.a.y) * d2x) / denom
  return { x: s1.a.x + d1x * t, y: s1.a.y + d1y * t }
}

/** The three edges of the container U (open top): left wall, floor, right
 * wall. `inner` is the interior polygon [tl, tr, br, bl]. */
function uEdges(inner: Pt[]): Array<{ a: Pt; b: Pt }> {
  return [
    { a: inner[0]!, b: inner[3]! }, // left wall (top → bottom)
    { a: inner[3]!, b: inner[2]! }, // floor (left → right)
    { a: inner[2]!, b: inner[1]! }, // right wall (bottom → top)
  ]
}

/** Each U edge offset OUTWARD by `dist` (outward normal = (-dy, dx)). */
function offsetSegs(inner: Pt[], dist: number): Array<{ a: Pt; b: Pt }> {
  return uEdges(inner).map(({ a, b }) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * dist
    const ny = (dx / len) * dist
    return { a: { x: a.x + nx, y: a.y + ny }, b: { x: b.x + nx, y: b.y + ny } }
  })
}

/** Outward unit normal of segment a→b (away from the polygon interior). */
function segNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: -dy / len, y: dx / len }
}

/** Unit vector of (x, y). */
function unitV(x: number, y: number): Pt {
  const len = Math.hypot(x, y) || 1
  return { x: x / len, y: y / len }
}

/**
 * The stroked U centerline as ONE Path2D: rounded bottom corners (`arcTo`
 * fillets). Wall-top endpoints depend on the options:
 * - default: flush on the wall-top line (round cap = the dome).
 * - `trim`: pulled back DOWN along the wall (inset layers ending below
 *   the dome, butt-capped).
 * - `sweep`: the endpoint becomes a TIP ARC — tangent to the straight
 *   centerline and concentric with the body's dome (center = the wall-top
 *   corner pushed outward by T/2), wrapping `sweep` radians around the
 *   dome's shoulder so the layer follows the tip's curvature and ends
 *   inside the blue dome with a rounded cap. `peel` slides the arc center
 *   down-wall so the layer eases off the edge before the top, leaving
 *   solid blue between its end and the ink outline.
 * `dist` offsets the path outward from the physics polygon; `fillet`
 * scales with the offset so nested strokes stay concentric.
 */
function uPath(
  inner: Pt[],
  dist: number,
  fillet: number,
  o: { trim?: number; peel?: number; sweep?: number } = {},
): Path2D {
  const T = CONTAINER.visual.bandThickness
  const Rc = T / 2
  const trim = o.trim ?? 0
  const peel = o.peel ?? 0
  const sweep = o.sweep ?? 0
  // ALL three segments offset outward by `dist` — the whole centerline is
  // parallel to the physics polygon, so strokes stay concentric and the
  // floor band lands BELOW the floor line (never inside the interior).
  const [wall, floorSeg, wallR] = offsetSegs(inner, dist) as [
    { a: Pt; b: Pt },
    { a: Pt; b: Pt },
    { a: Pt; b: Pt },
  ]
  const mBL = lineIntersect(wall, floorSeg)
  const mBR = lineIntersect(floorSeg, wallR)
  const shift = (p: Pt, from: Pt, to: Pt, amt: number): Pt => {
    if (amt === 0) return p
    const ux = (to.x - from.x) / (Math.hypot(to.x - from.x, to.y - from.y) || 1)
    const uy = (to.y - from.y) / (Math.hypot(to.x - from.x, to.y - from.y) || 1)
    return { x: p.x + ux * amt, y: p.y + uy * amt }
  }
  // Tip wrap for one wall (top corner, bottom corner, outward normal):
  // returns the arc (center, radius, angles) tangent to the straight
  // centerline at t0, swept toward the dome's up-wall side.
  const wrap = (top: Pt, bottom: Pt, n: Pt) => {
    const dx = top.x - bottom.x
    const dy = top.y - bottom.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len // up-wall unit
    const c = { x: top.x + n.x * Rc - ux * peel, y: top.y + n.y * Rc - uy * peel }
    const rho = Math.abs(Rc - dist)
    const sgn = dist < Rc ? -1 : 1 // inner layers wrap from the inner pole
    const vh = { x: n.x * sgn, y: n.y * sgn }
    const s = vh.x * uy - vh.y * ux >= 0 ? 1 : -1
    const a0 = Math.atan2(vh.y, vh.x)
    const a1 = a0 + s * sweep
    return {
      c,
      rho,
      a0,
      a1,
      fwdCcw: s < 0,
      t0: { x: c.x + n.x * (dist - Rc), y: c.y + n.y * (dist - Rc) },
      end: { x: c.x + rho * Math.cos(a1), y: c.y + rho * Math.sin(a1) },
    }
  }
  const nL = segNormal(inner[0]!, inner[3]!)
  const nR = segNormal(inner[2]!, inner[1]!)
  const p = new Path2D()
  if (sweep > 0) {
    // Left tip: start at the arc's rounded end, draw the arc BACK to its
    // tangent point, then continue straight down the wall.
    const l = wrap(inner[0]!, inner[3]!, nL)
    p.moveTo(l.end.x, l.end.y)
    p.arc(l.c.x, l.c.y, l.rho, l.a1, l.a0, !l.fwdCcw)
  } else {
    const start = shift(wall.a!, wall.a!, wall.b!, trim)
    p.moveTo(start.x, start.y)
  }
  p.arcTo(mBL!.x, mBL!.y, floorSeg.b!.x, floorSeg.b!.y, fillet)
  p.arcTo(mBR!.x, mBR!.y, wallR.b!.x, wallR.b!.y, fillet)
  if (sweep > 0) {
    const r = wrap(inner[1]!, inner[2]!, nR)
    p.lineTo(r.t0.x, r.t0.y)
    p.arc(r.c.x, r.c.y, r.rho, r.a0, r.a1, r.fwdCcw)
  } else {
    const end = shift(wallR.b!, wallR.b!, wallR.a!, trim)
    p.lineTo(end.x, end.y)
  }
  return p
}

export class ContainerView {
  private readonly frameImage: Phaser.GameObjects.Image
  private readonly glowG: Phaser.GameObjects.Graphics
  private lastHeight = -1
  /** Interior corners at the current height: [tl, tr, br, bl]. */
  private corners: Pt[] | null = null
  /** Combo glow sweep: elapsed ms, < 0 = inactive. */
  private glowT = -1
  private readonly glowDuration = 750
  /** Chain depth of the running glow (scales intensity/width/bloom). */
  private glowDepth = 1
  /** Arc-length rail for the traveling glow (mid-band U centerline). */
  private glowPath: Pt[] = []
  private glowLen = 0

  constructor(scene: Phaser.Scene) {
    // Canvas texture: 720x1280 stage units, 1:1 — crisp at any zoom, and
    // repainted only when the wall height changes (never per frame).
    if (!scene.textures.exists('container-frame')) {
      scene.textures.addCanvas('container-frame', document.createElement('canvas'))
    }
    this.frameImage = scene.add
      .image(0, 0, 'container-frame')
      .setOrigin(0, 0)
      .setDisplaySize(720, 1280)
      .setDepth(20)
    // Additive light sheet — above the frame, below the balls' scene.
    this.glowG = scene.add.graphics().setDepth(21).setBlendMode(Phaser.BlendModes.ADD)
    this.redrawWalls(CONTAINER.height)
  }

  /** Redraw the whole frame texture at the given wall height (Raise Walls
   * keeps colliders and visuals in lockstep — only wall tops move). */
  redrawWalls(height: number): void {
    if (height === this.lastHeight) return
    this.lastHeight = height
    const T = CONTAINER.visual.bandThickness
    const inner = interiorPolygon(height) as Pt[]
    this.corners = inner
    this.buildGlowPath(inner)
    const canvas = (this.frameImage.texture.getSourceImage() as HTMLCanvasElement) ?? null
    if (!canvas) return
    // Phase 2.20: bake at devicePixelRatio resolution — the texture is
    // displayed at 720×1280 stage units but renders at zoom×dpr screen
    // pixels (up to ~1.6× texture px on a DPR-3 phone), so a 1× bake
    // softened the ink edges. The paint math is unchanged: scale the
    // context once, draw in stage units as before.
    // PERF (iOS): mid-animation repaints are the wall-raise lag —
    // each step uploads the full canvas. Fast mode: texScale 1 while
    // the height is BETWEEN the rest constants (mid-animation); the
    // endpoint redraws fire at the exact rest heights and rebake
    // crisp at dpr 2. Derived locally — no setter to keep in sync.
    const midAnimation = height !== CONTAINER.height && height !== CONTAINER.raisedHeight
    const fast = midAnimation
    const dpr = fast ? 1 : window.devicePixelRatio > 1.5 ? 2 : 1
    const texScale = dpr
    if (canvas.width !== 720 * texScale || canvas.height !== 1280 * texScale) {
      canvas.width = 720 * texScale
      canvas.height = 1280 * texScale
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(texScale, texScale)


    // Stroke layers on the concentric U paths (see uPath). Ink and body
    // use ROUND caps (the wall's rounded blue dome end). The cyan strip
    // and navy bevel TIP-WRAP: their centerlines arc over the dome's
    // shoulder, tangent to the wall, concentric with the dome — the layer
    // follows the tip's curvature and its round cap ends inside the blue
    // dome. Peel slides each arc's center down-wall so the layer eases
    // off the edge below the top; solid blue stays between the ends and
    // the ink outline (cyan peels further to clear the margin).
    const R = T * 0.7
    // Short tip wrap: a compact shoulder that follows the dome's contour
    // without curling past it (long sweeps read as loops at the tips).
    const sweep = 0.72
    // Gentle vertical body gradient — lighter where light falls (top),
    // deeper toward the floor. Canvas-space, so walls and floor share it.
    const bodyGrad = ctx.createLinearGradient(0, inner[0]!.y - T, 0, inner[3]!.y + T)
    bodyGrad.addColorStop(0, '#4b98f4')
    bodyGrad.addColorStop(0.55, '#3b8df2')
    bodyGrad.addColorStop(1, '#2f7de0')
    const strokeU = (
      dist: number,
      width: number,
      color: string | CanvasGradient,
      opts: { trim?: number; peel?: number; sweep?: number } = {},
    ): void => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke(uPath(inner, dist, R - T / 2 + dist, opts))
    }

    // 1. Bold black outline: ink stroke 6px wider than the body — its
    //    round cap wraps the whole rounded tip (one continuous silhouette).
    strokeU(T / 2, T + 12, '#111111')
    // 2. Royal-blue body — inner edge lands exactly on the physics polygon;
    //    its round cap is the visible blue rounded end. Gentle gradient.
    strokeU(T / 2, T, bodyGrad)
    // 3. Bright cyan strip along the inner (physics) edge: depths 2–13%,
    //    easing over the dome's inner shoulder with a compact, contour-
    //    following wrap; solid blue margin around its rounded end.
    strokeU(T * 0.075, T * 0.11, '#7ee5ff', { peel: T * 0.13, sweep })
    // 4. Inset hazard-stripe panel: depths 26–62%, drawn on an offscreen
    //    canvas (cream stroke + stripes masked with source-atop), then
    //    blitted. The panel is trimmed back by its cap radius, so stripes
    //    stop in a clean perpendicular line before the dome; the blue dome
    //    above closes the end.
    const PANEL_D = T * 0.44
    const PANEL_W = T * 0.36
    strokeU(PANEL_D, PANEL_W, '#f4ead0', { trim: PANEL_W / 2 })
    const off = document.createElement('canvas')
    off.width = 720
    off.height = 1280
    const octx = off.getContext('2d')!
    octx.strokeStyle = '#f4ead0'
    octx.lineWidth = PANEL_W
    octx.lineJoin = 'round'
    octx.lineCap = 'butt'
    octx.stroke(uPath(inner, PANEL_D, R - T / 2 + PANEL_D, { trim: PANEL_W / 2 }))
    octx.globalCompositeOperation = 'source-atop'
    this.paintStripes(octx)
    ctx.drawImage(off, 0, 0)
    // 5. Restrained dark shaded edge along the outer boundary: 80–97%,
    //    wrapping over the dome's outer shoulder (mirrors the cyan).
    strokeU(T * 0.885, T * 0.17, '#1e4fa8', { peel: T * 0.07, sweep })
    // 6. Glossy reflections on the wall bodies.
    this.paintGloss(ctx)
    ;(this.frameImage.texture as Phaser.Textures.CanvasTexture).update()
  }

  /**
   * World-space diagonal hazard stripes (45° in stage coordinates), drawn
   * full-canvas and masked by the caller (source-atop on the panel stroke).
   * One treatment across walls and floor. Stripe edges carry a subtle
   * deterministic micro-jitter (hand-drawn, not shaky).
   */
  private paintStripes(ctx: CanvasRenderingContext2D): void {
    const dx = Math.SQRT1_2
    const dy = Math.SQRT1_2
    const nx = Math.SQRT1_2
    const ny = -Math.SQRT1_2
    const spacing = 26
    const minP = -720 - spacing
    const maxP = 2000 + spacing
    const big = 720 + 1280 // any stripe fully crosses the stage
    let i = 0
    for (let p0 = minP; p0 < maxP; p0 += spacing, i++) {
      const isBlack = i % 2 === 0
      const half = spacing / 2 - 1 // 2px cream gap between stripe bodies
      const j = Math.sin(p0 * 0.83) * 0.6 // deterministic edge micro-jitter
      const cx = nx * p0
      const cy = ny * p0
      const stripe: Pt[] = [
        { x: cx - dx * big - nx * (half + j), y: cy - dy * big - ny * (half + j) },
        { x: cx + dx * big - nx * (half - j), y: cy + dy * big - ny * (half - j) },
        { x: cx + dx * big + nx * (half + j), y: cy + dy * big + ny * (half + j) },
        { x: cx - dx * big + nx * (half - j), y: cy - dy * big + ny * (half - j) },
      ]
      ctx.fillStyle = isBlack ? '#161616' : '#fcf4d5'
      const path = new Path2D()
      path.moveTo(stripe[0]!.x, stripe[0]!.y)
      for (let k = 1; k < 4; k++) path.lineTo(stripe[k]!.x, stripe[k]!.y)
      path.closePath()
      ctx.fill(path)
    }
  }

  /** Restrained glossy reflections on the wall bodies: two soft white
   * streaks per wall, anchored to the wall TOP regardless of run direction. */
  private paintGloss(ctx: CanvasRenderingContext2D): void {
    const inner = this.corners
    if (!inner) return
    const walls: Array<{ top: Pt; bottom: Pt }> = [
      { top: inner[0]!, bottom: inner[3]! }, // left wall
      { top: inner[1]!, bottom: inner[2]! }, // right wall
    ]
    const T = CONTAINER.visual.bandThickness
    // Interior centroid: the gloss normal must always point OUTWARD (into
    // the band), regardless of the wall's run direction.
    const cx = inner.reduce((s, p) => s + p.x, 0) / 4
    const cy = inner.reduce((s, p) => s + p.y, 0) / 4
    for (const { top, bottom } of walls) {
      const dx = bottom.x - top.x
      const dy = bottom.y - top.y
      const len = Math.hypot(dx, dy) || 1
      let nx = -dy / len
      let ny = dx / len
      const mx = (top.x + bottom.x) / 2 - cx
      const my = (top.y + bottom.y) / 2 - cy
      if (nx * mx + ny * my < 0) {
        nx = -nx
        ny = -ny
      }
      const streak = (s0: number, s1: number, d0: number, d1: number, alpha: number): void => {
        const pts: Pt[] = [
          { x: top.x + dx * s0 + nx * d0, y: top.y + dy * s0 + ny * d0 },
          { x: top.x + dx * s1 + nx * d0, y: top.y + dy * s1 + ny * d0 },
          { x: top.x + dx * s1 + nx * d1, y: top.y + dy * s1 + ny * d1 },
          { x: top.x + dx * s0 + nx * d1, y: top.y + dy * s0 + ny * d1 },
        ]
        const path = new Path2D()
        path.moveTo(pts[0]!.x, pts[0]!.y)
        for (let k = 1; k < 4; k++) path.lineTo(pts[k]!.x, pts[k]!.y)
        path.closePath()
        // Fade along the wall (bright near the top, gone by the end) —
        // reads as light falling from above instead of a hard-edged bar.
        const grad = ctx.createLinearGradient(
          top.x + dx * s0, top.y + dy * s0,
          top.x + dx * s1, top.y + dy * s1,
        )
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
        grad.addColorStop(0.7, `rgba(255, 255, 255, ${alpha * 0.35})`)
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = grad
        ctx.fill(path)
      }
      streak(0.05, 0.42, T * 0.12, T * 0.24, 0.18)
      streak(0.5, 0.62, T * 0.12, T * 0.24, 0.1)
    }
  }

  /** Trigger the combo glow, scaled by chain depth:
   * 1 — subtle white; 2-4 — blue, brighter/thicker with depth;
   * ≥ 5 — intense full-spectrum rainbow. Restarts cleanly if a sweep is
   * already running. */
  playGlow(chainDepth: number): void {
    this.glowDepth = Math.max(1, chainDepth)
    this.glowT = 0
  }

  /** Per-frame glow (called from PlaygroundScene.update): an energy pulse
   * traveling ALONG the container's U path — left wall down, around the
   * bottom fillets, up the right wall. Rendered by stroking sub-ranges of
   * the same concentric U centerline the frame itself uses (mid-band at
   * depth T/2), so the light sits inside the band geometry — it can never
   * wash over the interior or extend past the walls. Tail fades behind the
   * bright head; rainbow mode cycles hue along the tail. */
  update(delta: number): void {
    if (this.glowT < 0) return
    this.glowT += delta
    const g = this.glowG
    g.clear()
    const t = this.glowT / this.glowDuration
    if (t >= 1) {
      this.glowT = -1
      return
    }
    const inner = this.corners
    if (!inner || this.glowPath.length < 2) return
    const T = CONTAINER.visual.bandThickness
    const ease = t < 0.12 ? t / 0.12 : t > 0.85 ? (1 - t) / 0.15 : 1
    const depth = this.glowDepth
    // Combo scaling: intensity 0 (single merge) → 1 (5x+). White for a
    // single merge, blue for 2-4, rainbow at 5+.
    const intensity = Math.min(1, 0.28 + (depth - 1) * 0.18)
    const rainbow = depth >= 5
    // Head position along the path (0..1), tail length as a fraction.
    const head = t
    const tailLen = 0.34
    const from = Math.max(0, head - tailLen)
    const steps = 26
    // BLOOM: a wide, faint under-glow pass — stronger with depth, giving
    // the soft halo around the band without ever leaving the geometry
    // (same rail, ADD blend, wide stroke).
    if (depth >= 3) {
      const bloomW = T * (1.1 + 0.25 * Math.min(depth, 7))
      const bloomAlpha = 0.10 + 0.05 * Math.min(depth - 3, 4)
      let bp = this.glowPointAt(from)
      for (let i = 1; i <= steps; i++) {
        const f = from + ((head - from) * i) / steps
        const pt = this.glowPointAt(f)
        const k = i / steps
        const hue = rainbow ? (this.glowT * 0.0009 + f * 0.55 + 0.5) % 1 : 0.58
        const col = Phaser.Display.Color.HSVToRGB(hue, rainbow ? 0.85 : 0.6, 1).color
        g.lineStyle(bloomW * (0.5 + 0.5 * k), col, bloomAlpha * (0.3 + 0.7 * k) * ease)
        g.beginPath()
        g.moveTo(bp.x, bp.y)
        g.lineTo(pt.x, pt.y)
        g.strokePath()
        bp = pt
      }
    }
    let prev = this.glowPointAt(from)
    for (let i = 1; i <= steps; i++) {
      const f = from + ((head - from) * i) / steps
      const pt = this.glowPointAt(f)
      const k = i / steps // 0 tail → 1 head
      const alpha = (0.45 + 0.45 * intensity) * (0.25 + 0.75 * k) * ease
      const width = (T * (0.6 + 0.35 * intensity)) * (0.4 + 0.6 * k)
      const hue = rainbow
        ? (this.glowT * 0.0009 + f * 0.55) % 1
        : 0.56 - 0.08 * k // cyan → blue toward the head
      const sat = rainbow ? 0.85 : depth === 1 ? 0.08 : 0.72
      const col = Phaser.Display.Color.HSVToRGB(hue, sat, 1).color
      g.lineStyle(width, col, alpha)
      g.beginPath()
      g.moveTo(prev.x, prev.y)
      g.lineTo(pt.x, pt.y)
      g.strokePath()
      prev = pt
    }
    // Bright head: a short white-hot cap right at the pulse front.
    const h1 = this.glowPointAt(Math.max(0, head - 0.012))
    const h2 = this.glowPointAt(head)
    g.lineStyle(T * (0.42 + 0.12 * intensity), 0xffffff, (0.75 + 0.2 * intensity) * ease)
    g.beginPath()
    g.moveTo(h1.x, h1.y)
    g.lineTo(h2.x, h2.y)
    g.strokePath()
    // PARTICLE ACCENTS: bright sparks trailing the head — count and size
    // grow with the combo (none on a single merge).
    const sparks = Math.max(0, Math.min(14, (depth - 1) * 3))
    for (let i = 0; i < sparks; i++) {
      // Deterministic scatter: index-hash keeps each frame stable.
      const j = (i * 37) % 16
      const back = 0.02 + ((j / 16) * 0.22)
      const fp = this.glowPointAt(Math.max(0, head - back))
      const phase = this.glowT * 0.02 + i * 2.4
      const off = Math.sin(phase) * T * 0.28
      const perp = this.glowPerpAt(Math.max(0, head - back))
      const r = (0.9 + (j % 3)) * (0.7 + intensity)
      const hue = rainbow ? (this.glowT * 0.0009 + i * 0.13) % 1 : 0.55
      const col = Phaser.Display.Color.HSVToRGB(hue, rainbow ? 0.85 : 0.25, 1).color
      g.fillStyle(col, 0.75 * ease)
      g.fillCircle(fp.x + perp.x * off, fp.y + perp.y * off, r)
    }
  }

  /** Outward unit tangent-normal at arc position f (for spark scatter). */
  private glowPerpAt(f: number): Pt {
    const a = this.glowPointAt(Math.max(0, f - 0.004))
    const b = this.glowPointAt(Math.min(1, f + 0.004))
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    return { x: -dy / len, y: dx / len }
  }

  /** Point along the cached U glow path (arc-length parameterized, 0..1;
   * runs left-top → down → bottom → up → right-top). */
  private glowPointAt(f: number): Pt {
    const path = this.glowPath
    const target = Math.max(0, Math.min(1, f)) * this.glowLen
    let acc = 0
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!
      const b = path[i]!
      const segLen = Math.hypot(b.x - a.x, b.y - a.y)
      if (acc + segLen >= target) {
        const k = segLen > 1e-9 ? (target - acc) / segLen : 0
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
      }
      acc += segLen
    }
    return { ...path[path.length - 1]! }
  }

  /** Build the arc-length-parameterized U centerline polyline (mid-band
   * depth) with the same rounded corners as the frame — the glow's rail. */
  private buildGlowPath(inner: Pt[]): void {
    const T = CONTAINER.visual.bandThickness
    const R = T * 0.7
    const dist = T / 2
    const [wall, floorSeg, wallR] = offsetSegs(inner, dist) as [
      { a: Pt; b: Pt },
      { a: Pt; b: Pt },
      { a: Pt; b: Pt },
    ]
    const mBL = lineIntersect(wall, floorSeg)
    const mBR = lineIntersect(floorSeg, wallR)
    const fillet = R - T / 2 + dist
    const pts: Pt[] = [wall.a!]
    const arc = (corner: Pt, fromPt: Pt, toPt: Pt): void => {
      // Fillet arc tangent to segments corner→fromPt and corner→toPt:
      // tangent distance from the corner is d = r / tan(theta/2), center on
      // the angle bisector at cd = r / sin(theta/2).
      const u1 = unitV(fromPt.x - corner.x, fromPt.y - corner.y)
      const u2 = unitV(toPt.x - corner.x, toPt.y - corner.y)
      const cosA = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y))
      const half = Math.acos(cosA) / 2
      const tangent = fillet / Math.tan(half)
      const t1 = { x: corner.x + u1.x * tangent, y: corner.y + u1.y * tangent }
      const cd = fillet / Math.sin(half)
      const bis = unitV(u1.x + u2.x, u1.y + u2.y)
      const center = { x: corner.x + bis.x * cd, y: corner.y + bis.y * cd }
      const a0 = Math.atan2(t1.y - center.y, t1.x - center.x)
      const t2 = { x: corner.x + u2.x * tangent, y: corner.y + u2.y * tangent }
      const a1 = Math.atan2(t2.y - center.y, t2.x - center.x)
      let da = a1 - a0
      while (da > Math.PI) da -= 2 * Math.PI
      while (da < -Math.PI) da += 2 * Math.PI
      const n = 10
      for (let i = 1; i < n; i++) {
        const a = a0 + (da * i) / n
        pts.push({ x: center.x + Math.cos(a) * fillet, y: center.y + Math.sin(a) * fillet })
      }
      pts.push(t2)
    }
    arc(mBL!, wall.a!, floorSeg.b!)
    arc(mBR!, floorSeg.b!, wallR.b!)
    pts.push(wallR.b!)
    // Resample to uniform arc-length steps for the glow rail.
    let total = 0
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
    const step = 6
    const uniform: Pt[] = [pts[0]!]
    let acc = 0
    for (let i = 1; i < pts.length; i++) {
      let ax = pts[i - 1]!.x
      let ay = pts[i - 1]!.y
      const bx = pts[i]!.x
      const by = pts[i]!.y
      let seg = Math.hypot(bx - ax, by - ay)
      while (acc + seg >= step && seg > 1e-9) {
        const k = (step - acc) / seg
        ax = ax + (bx - ax) * k
        ay = ay + (by - ay) * k
        uniform.push({ x: ax, y: ay })
        seg = Math.hypot(bx - ax, by - ay)
        acc = 0
      }
      acc += seg
    }
    const last = pts[pts.length - 1]!
    if (Math.hypot(last.x - uniform[uniform.length - 1]!.x, last.y - uniform[uniform.length - 1]!.y) > 1) {
      uniform.push(last)
    }
    this.glowPath = uniform
    this.glowLen = total
  }
}
