import Phaser from 'phaser'
import { CONTAINER, interiorPolygon, tipCollidersAt, type Vec2 } from '../../config/container'
import { bakeCanvas } from './RoughArt'

/**
 * Glossy blue open-top arcade frame with one telescoping joint per wall.
 * The lower U and two narrow sleeves are baked at native texture resolution.
 * Raise Walls only translates sleeves behind the lower frame and moves the
 * flat caps from the shared collision polygons. No painting/uploads in motion.
 * The playable inner wall lines and floor stay invariant through the cycle.
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


/** Unit vector of (x, y). */
function unitV(x: number, y: number): Pt {
  const len = Math.hypot(x, y) || 1
  return { x: x / len, y: y / len }
}

/** Concentric U stroke with rounded floor fillets and flat wall ends. */
function uPath(inner: Pt[], dist: number, fillet: number, trim: number): Path2D {
  const [wall, floorSeg, wallR] = offsetSegs(inner, dist) as [
    { a: Pt; b: Pt },
    { a: Pt; b: Pt },
    { a: Pt; b: Pt },
  ]
  const mBL = lineIntersect(wall, floorSeg)
  const mBR = lineIntersect(floorSeg, wallR)
  const shift = (from: Pt, to: Pt): Pt => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1
    return { x: from.x + (to.x - from.x) * trim / len, y: from.y + (to.y - from.y) * trim / len }
  }
  const start = shift(wall.a, wall.b)
  const end = shift(wallR.b, wallR.a)
  const path = new Path2D()
  path.moveTo(start.x, start.y)
  path.arcTo(mBL.x, mBL.y, floorSeg.b.x, floorSeg.b.y, fillet)
  path.arcTo(mBR.x, mBR.y, wallR.b.x, wallR.b.y, fillet)
  path.lineTo(end.x, end.y)
  return path
}

export class ContainerView {
  private readonly frameImage: Phaser.GameObjects.Image
  private readonly sleeves: Array<{
    image: Phaser.GameObjects.Image
    homeX: number
    homeY: number
    side: -1 | 1
  }>
  private readonly caps: [Phaser.GameObjects.Graphics, Phaser.GameObjects.Graphics]
  private readonly sleeveG: Phaser.GameObjects.Graphics
  private readonly glowG: Phaser.GameObjects.Graphics
  private readonly normalCorners = interiorPolygon() as Pt[]
  private readonly slope = (this.normalCorners[3]!.x - this.normalCorners[0]!.x) / CONTAINER.height
  private readonly textureScale = window.devicePixelRatio > 1.5 ? 2 : 1
  private readonly hazardPattern: CanvasPattern
  private lastHeight = -1
  private readonly corners = this.normalCorners.map((p) => ({ ...p }))
  private glowPathDirty = true
  /** Combo glow sweep: elapsed ms, < 0 = inactive. */
  private glowT = -1
  private readonly glowDuration = 750
  private glowDepth = 1
  private glowPath: Pt[] = []
  private glowLen = 0

  setOpacity(alpha: number): void {
    this.frameImage.setAlpha(alpha)
    for (const sleeve of this.sleeves) sleeve.image.setAlpha(alpha)
    for (const cap of this.caps) cap.setAlpha(alpha)
    this.sleeveG.setAlpha(alpha)
    this.glowG.setAlpha(alpha)
  }

  constructor(scene: Phaser.Scene) {
    this.hazardPattern = this.createHazardPattern()
    const key = `container-frame:${CONTAINER.topWidth}:${CONTAINER.height}`
    bakeCanvas(scene, key, 720, 1280, (ctx) => this.paintFrame(ctx), this.textureScale)
    this.frameImage = scene.add.image(0, 0, key)
      .setOrigin(0, 0).setDisplaySize(720, 1280).setDepth(20)
    this.sleeves = [this.createSleeve(scene, -1), this.createSleeve(scene, 1)]
    this.sleeveG = scene.add.graphics().setDepth(22)
    this.caps = [scene.add.graphics().setDepth(23), scene.add.graphics().setDepth(23)]
    this.glowG = scene.add.graphics().setDepth(24).setBlendMode(Phaser.BlendModes.ADD)
    this.drawSleeveJoint()
    this.drawCaps(CONTAINER.height)
    this.redrawWalls(CONTAINER.height)
  }

  /** Sleeves slide behind the fixed lower U; no crop, stretch, or texture upload. */
  redrawWalls(height: number): void {
    const extension = Math.max(0, Math.min(CONTAINER.raisedHeight - CONTAINER.height, height - CONTAINER.height))
    const resolvedHeight = CONTAINER.height + extension
    if (resolvedHeight === this.lastHeight) return
    this.lastHeight = resolvedHeight
    for (let i = 0; i < this.sleeves.length; i++) {
      const sleeve = this.sleeves[i]!
      const dx = sleeve.side * this.slope * extension
      sleeve.image.setPosition(sleeve.homeX + dx, sleeve.homeY - extension)
      this.caps[i]!.setPosition(dx, -extension)
    }
    this.corners[0]!.x = this.normalCorners[0]!.x - this.slope * extension
    this.corners[1]!.x = this.normalCorners[1]!.x + this.slope * extension
    this.corners[0]!.y = this.corners[1]!.y = CONTAINER.topY - extension
    this.glowPathDirty = true
  }

  private createSleeve(scene: Phaser.Scene, side: -1 | 1) {
    // A narrower sliding beam nests inside the fixed 74-unit lower frame.
    // Its hidden tail stops before the lower frame's floor fillet at rest.
    const length = CONTAINER.raisedHeight - CONTAINER.height + 12
    const width = CONTAINER.visual.bandThickness * 0.88 * Math.hypot(1, this.slope)
    const x0 = side * 0
    const x1 = side * width
    const x2 = side * (width - this.slope * length)
    const x3 = side * (-this.slope * length)
    const minX = Math.min(x0, x1, x2, x3) - 4
    const maxX = Math.max(x0, x1, x2, x3) + 4
    const w = Math.ceil(maxX - minX)
    const h = Math.ceil(length + 4)
    const key = `container-sleeve:${side}:${CONTAINER.height}:${CONTAINER.raisedHeight}`
    bakeCanvas(scene, key, w, h, (ctx) => {
      ctx.translate(-minX, 0)
      const strip = (inner: number, outer: number): Path2D => {
        const path = new Path2D()
        path.moveTo(side * inner, 0)
        path.lineTo(side * outer, 0)
        path.lineTo(side * (outer - this.slope * length), length)
        path.lineTo(side * (inner - this.slope * length), length)
        path.closePath()
        return path
      }
      const body = strip(0, width)
      const shade = ctx.createLinearGradient(0, 0, side * width, 0)
      shade.addColorStop(0, '#36c9ff')
      shade.addColorStop(0.2, '#118cfb')
      shade.addColorStop(0.72, '#0764d7')
      shade.addColorStop(1, '#04367c')
      ctx.fillStyle = shade
      ctx.fill(body)
      ctx.lineWidth = 4
      ctx.strokeStyle = '#071a35'
      ctx.stroke(body)
      const panel = strip(width * 0.24, width * 0.7)
      ctx.fillStyle = this.hazardPattern
      ctx.fill(panel)
      ctx.lineWidth = 2
      ctx.strokeStyle = '#071c38'
      ctx.stroke(panel)
      ctx.fillStyle = '#5ce4ff'
      ctx.fill(strip(width * 0.04, width * 0.12))
      ctx.fillStyle = '#d3fbff'
      ctx.fill(strip(width * 0.04, width * 0.065))
      ctx.fillStyle = '#062959'
      ctx.fill(strip(width * 0.87, width * 0.98))
    }, this.textureScale)
    const top = this.normalCorners[side === -1 ? 0 : 1]!
    const homeX = top.x + minX
    const homeY = top.y
    const image = scene.add.image(homeX, homeY, key)
      .setOrigin(0, 0).setDisplaySize(w, h).setDepth(19)
    return { image, homeX, homeY, side }
  }

  /** Bake the stationary U once; only its two sleeves move during the ability. */
  private paintFrame(ctx: CanvasRenderingContext2D): void {
    const T = CONTAINER.visual.bandThickness
    const inner = this.normalCorners
    const R = T * 0.7
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, CONTAINER.topY, 720, 1280 - CONTAINER.topY)
    ctx.clip()
    const body = ctx.createLinearGradient(0, CONTAINER.topY - T, 0, inner[3]!.y + T)
    body.addColorStop(0, '#36adff')
    body.addColorStop(0.3, '#087cf7')
    body.addColorStop(0.72, '#075bd6')
    body.addColorStop(1, '#00358f')
    const strokeU = (dist: number, width: number, color: string | CanvasGradient | CanvasPattern, trim = -T * 0.2): void => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineJoin = 'round'
      ctx.lineCap = 'butt'
      ctx.stroke(uPath(inner, dist, R - T / 2 + dist, trim))
    }
    strokeU(T / 2, T + 10, '#071a35')
    strokeU(T / 2, T, body)
    strokeU(T * 0.075, T * 0.12, '#28d9ff')
    strokeU(T * 0.055, T * 0.035, '#c7fbff')
    const panelDepth = T * 0.44
    const panelWidth = T * 0.42
    strokeU(panelDepth, panelWidth + 3, '#071c38', panelWidth / 2)
    strokeU(panelDepth, panelWidth, this.hazardPattern, panelWidth / 2)
    strokeU(T * 0.9, T * 0.15, '#04285f')
    strokeU(T * 0.78, T * 0.05, '#328fff')
    this.paintGloss(ctx, inner)
    ctx.restore()
  }


  private drawSleeveJoint(): void {
    const normal = interiorPolygon(CONTAINER.height) as Pt[]
    const T = CONTAINER.visual.bandThickness
    for (const [corner, side] of [[normal[0]!, -1], [normal[1]!, 1]] as const) {
      const dir = side as -1 | 1
      const points = [
        new Phaser.Math.Vector2(corner.x, corner.y - 4),
        new Phaser.Math.Vector2(corner.x + dir * T, corner.y - 4),
        new Phaser.Math.Vector2(corner.x + dir * T, corner.y + 9),
        new Phaser.Math.Vector2(corner.x, corner.y + 9),
      ]
      this.sleeveG.fillGradientStyle(0x2b9cff, 0x0474e9, 0x0750bd, 0x06357e, 1)
      this.sleeveG.fillPoints(points, true)
      this.sleeveG.lineStyle(3, 0x061a3a, 1)
      this.sleeveG.strokePoints(points, true, true)
      this.sleeveG.lineStyle(1.5, 0x8aeaff, 0.95)
      this.sleeveG.lineBetween(corner.x + dir * 8, corner.y - 1, corner.x + dir * (T - 8), corner.y - 1)
      this.sleeveG.lineStyle(2, 0x00346f, 1)
      this.sleeveG.lineBetween(corner.x + dir * 3, corner.y + 6, corner.x + dir * (T - 3), corner.y + 6)
    }
  }

  private drawCaps(height: number): void {
    const caps = tipCollidersAt(height)
    for (const [index, cap] of caps.entries()) {
      const g = this.caps[index]!
      const points = cap.vertices
      g.fillStyle(0x003f9f, 1)
      g.beginPath()
      g.moveTo(points[0]!.x, points[0]!.y)
      for (let i = 1; i < points.length; i++) g.lineTo(points[i]!.x, points[i]!.y)
      g.closePath()
      g.fillPath()

      // All bevel facets remain inside the shared physical cap polygon.
      g.fillStyle(0x32a7ff, 1)
      g.beginPath()
      g.moveTo(points[1]!.x, points[1]!.y)
      g.lineTo(points[2]!.x, points[2]!.y)
      g.lineTo(points[3]!.x, points[3]!.y)
      g.lineTo(points[3]!.x, points[3]!.y + 2)
      g.lineTo(points[2]!.x, points[2]!.y + 2)
      g.lineTo(points[1]!.x, points[1]!.y + 5)
      g.closePath()
      g.fillPath()
      g.fillStyle(0x69dfff, 0.96)
      g.fillTriangle(
        points[1]!.x + (index === 0 ? -1 : 1) * 1.5, points[1]!.y + 2,
        points[2]!.x + (index === 0 ? -1 : 1) * 1.5, points[2]!.y + 1,
        points[2]!.x, points[2]!.y + 5,
      )
      g.fillStyle(0x042e72, 0.95)
      g.fillTriangle(
        points[3]!.x, points[3]!.y + 3,
        points[4]!.x, points[4]!.y + 2,
        points[3]!.x, points[3]!.y + 8,
      )
      g.lineStyle(3, 0x06162f, 1)
      g.beginPath()
      g.moveTo(points[0]!.x, points[0]!.y)
      for (let i = 1; i < points.length; i++) g.lineTo(points[i]!.x, points[i]!.y)
      g.strokePath()
      g.lineStyle(1.5, 0xc9f8ff, 0.92)
      g.lineBetween(
        points[2]!.x + (index === 0 ? -1 : 1) * 2, points[2]!.y + 1.2,
        points[3]!.x + (index === 0 ? 1 : -1) * 2, points[3]!.y + 1.2,
      )
    }
  }

  /** One crisp diagonal tile, shared by the fixed frame and sliding sleeves. */
  private createHazardPattern(): CanvasPattern {
    const canvas = document.createElement('canvas')
    const period = 84
    canvas.width = canvas.height = period * this.textureScale
    const ctx = canvas.getContext('2d')!
    ctx.scale(this.textureScale, this.textureScale)
    ctx.fillStyle = '#fff0c5'
    ctx.fillRect(0, 0, period, period)
    ctx.fillStyle = '#11131b'
    for (let x = -period; x <= period; x += period) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + period / 2, 0)
      ctx.lineTo(x + period * 1.5, period)
      ctx.lineTo(x + period, period)
      ctx.closePath()
      ctx.fill()
    }
    const pattern = ctx.createPattern(canvas, 'repeat')!
    pattern.setTransform(new DOMMatrix().scale(1 / this.textureScale))
    return pattern
  }

  /** Restrained glossy reflections on the wall bodies: two soft white
   * streaks per wall, anchored to the wall TOP regardless of run direction. */
  private paintGloss(ctx: CanvasRenderingContext2D, inner: Pt[]): void {
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
    if (this.glowPathDirty) {
      this.buildGlowPath(this.corners)
      this.glowPathDirty = false
    }
    if (this.glowPath.length < 2) return
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
