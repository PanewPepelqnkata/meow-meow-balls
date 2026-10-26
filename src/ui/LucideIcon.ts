import Phaser from 'phaser'

/**
 * Lucide icon renderer for Phaser Graphics (https://lucide.dev, ISC).
 *
 * Lucide icons are 24×24 line icons (2px stroke, round caps/joins). The
 * `lucide-static` package ships `icon-nodes.json` — per-icon element lists
 * (path/rect/circle/line) in SVG form. This module parses that data once
 * at module load and replays each icon onto a Phaser Graphics object,
 * scaled and centered, so HUD/menu buttons get genuine Lucide glyphs.
 *
 * Only the subset of SVG elements Lucide actually uses is supported:
 * path (M/L/H/V/C/S/Q/T/A/Z), rect, circle, line. Everything Lucide ships
 * fits that set.
 */

import iconNodes from 'lucide-static/icon-nodes.json'

type Elem = [tag: string, attrs: Record<string, string>]

const NODES = iconNodes as unknown as Record<string, Elem[]>

/** Lucide's canonical viewBox — all geometry is authored in 24×24 units. */
const VIEW = 24
/** Lucide's stroke width, scaled with the icon. */
const STROKE = 2

/** A parsed path command after absolute conversion. */
interface Seg {
  cmd: 'M' | 'L' | 'C' | 'Q' | 'A' | 'Z'
  /** Flat parameter list: M(2) L(2) C(6) Q(4) A(7). */
  args: number[]
}

/** Parse one `rect` element's attrs into segment form. */
function rectSegs(a: Record<string, string>): Seg[] {
  const x = parseFloat(a.x ?? '0')
  const y = parseFloat(a.y ?? '0')
  const w = parseFloat(a.width ?? '0')
  const h = parseFloat(a.height ?? '0')
  const rx = Math.min(parseFloat(a.rx ?? a.ry ?? '0'), w / 2, h / 2)
  if (rx <= 0) {
    return [
      { cmd: 'M', args: [x, y] },
      { cmd: 'L', args: [x + w, y] },
      { cmd: 'L', args: [x + w, y + h] },
      { cmd: 'L', args: [x, y + h] },
      { cmd: 'Z', args: [] },
    ]
  }
  // Rounded rect: 4 lines + 4 quarter arcs (kappa = 0.5523).
  const k = rx * 0.5523
  return [
    { cmd: 'M', args: [x + rx, y] },
    { cmd: 'L', args: [x + w - rx, y] },
    { cmd: 'C', args: [x + w - rx + k, y, x + w, y + rx - k, x + w, y + rx] },
    { cmd: 'L', args: [x + w, y + h - rx] },
    { cmd: 'C', args: [x + w, y + h - rx + k, x + w - rx + k, y + h, x + w - rx, y + h] },
    { cmd: 'L', args: [x + rx, y + h] },
    { cmd: 'C', args: [x + rx - k, y + h, x, y + h - rx + k, x, y + h - rx] },
    { cmd: 'L', args: [x, y + rx] },
    { cmd: 'C', args: [x, y + rx - k, x + rx - k, y, x + rx, y] },
    { cmd: 'Z', args: [] },
  ]
}

/**
 * Parse an SVG path `d` string into absolute segments. Handles the full
 * Lucide vocabulary: M m L l H h V v C c S s Q q T t A a Z z, with implicit
 * repeat (a command letter followed by more coordinate groups repeats the
 * same command) — the SVG spec behaviour Lucide's paths rely on.
 */
function parsePath(d: string): Seg[] {
  const out: Seg[] = []
  const num = /-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g
  // Tokenize: commands and numbers in order.
  const tokens: Array<{ t: string; n?: number }> = []
  const cmdRe = /[MmLlHhVvCcSsQqTtAaZz]/g
  const matches: Array<{ i: number; c: string }> = []
  let m: RegExpExecArray | null
  while ((m = cmdRe.exec(d))) matches.push({ i: m.index, c: m[0] })
  for (let i = 0; i < matches.length; i++) {
    const seg = d.slice(matches[i]!.i, i + 1 < matches.length ? matches[i + 1]!.i : d.length)
    tokens.push({ t: matches[i]!.c })
    num.lastIndex = 0
    let n: RegExpExecArray | null
    while ((n = num.exec(seg))) tokens.push({ t: 'n', n: parseFloat(n[0]) })
  }
  // Walk tokens, converting to absolute commands.
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0 // current point, subpath start
  let i = 0
  const take = (k: number): number[] => {
    const arr: number[] = []
    for (let j = 0; j < k; j++) {
      const tk = tokens[i + 1 + j]
      if (!tk || tk.t !== 'n' || tk.n === undefined) throw new Error(`lucide: expected ${k} numbers at token ${i + 1 + j}`)
      arr.push(tk.n)
    }
    i += k
    return arr
  }
  const prevC: { x: number; y: number } = { x: 0, y: 0 }
  const prevQ: { x: number; y: number } = { x: 0, y: 0 }
  while (i < tokens.length) {
    const cmd = tokens[i]!.t
    if (cmd === 'n') throw new Error('lucide: number without command')
    const lower = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const rel = (v: number, o: number): number => (lower ? o + v : v)
    if (C === 'Z') {
      out.push({ cmd: 'Z', args: [] })
      cx = sx
      cy = sy
      i++
      continue
    }
    // Repeat count per command (in coordinate pairs/groups).
    const rep: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }
    const group = rep[C]!
    // Effective command inside the repeat loop: pairs following a moveto
    // are implicit LINETOs per the SVG spec, not more movetos.
    let cur = C
    for (;;) {
      const v = take(group)
      if (cur === 'M') {
        cx = rel(v[0]!, cx)
        cy = rel(v[1]!, cy)
        sx = cx
        sy = cy
        out.push({ cmd: 'M', args: [cx, cy] })
        cur = 'L'
      } else if (cur === 'L') {
        cx = rel(v[0]!, cx)
        cy = rel(v[1]!, cy)
        out.push({ cmd: 'L', args: [cx, cy] })
      } else if (cur === 'H') {
        cx = rel(v[0]!, cx)
        out.push({ cmd: 'L', args: [cx, cy] })
      } else if (cur === 'V') {
        cy = rel(v[0]!, cy)
        out.push({ cmd: 'L', args: [cx, cy] })
      } else if (cur === 'C') {
        const x1 = rel(v[0]!, cx)
        const y1 = rel(v[1]!, cy)
        const x2 = rel(v[2]!, cx)
        const y2 = rel(v[3]!, cy)
        cx = rel(v[4]!, cx)
        cy = rel(v[5]!, cy)
        out.push({ cmd: 'C', args: [x1, y1, x2, y2, cx, cy] })
        prevC.x = x2
        prevC.y = y2
      } else if (cur === 'S') {
        // Smooth cubic: reflect the previous control point.
        const x1 = 2 * cx - prevC.x
        const y1 = 2 * cy - prevC.y
        const x2 = rel(v[0]!, cx)
        const y2 = rel(v[1]!, cy)
        cx = rel(v[2]!, cx)
        cy = rel(v[3]!, cy)
        out.push({ cmd: 'C', args: [x1, y1, x2, y2, cx, cy] })
        prevC.x = x2
        prevC.y = y2
      } else if (cur === 'Q') {
        const qx = rel(v[0]!, cx)
        const qy = rel(v[1]!, cy)
        cx = rel(v[2]!, cx)
        cy = rel(v[3]!, cy)
        out.push({ cmd: 'Q', args: [qx, qy, cx, cy] })
        prevQ.x = qx
        prevQ.y = qy
      } else if (cur === 'T') {
        // Smooth quadratic: reflect the previous control point.
        const qx = 2 * cx - prevQ.x
        const qy = 2 * cy - prevQ.y
        cx = rel(v[0]!, cx)
        cy = rel(v[1]!, cy)
        out.push({ cmd: 'Q', args: [qx, qy, cx, cy] })
        prevQ.x = qx
        prevQ.y = qy
      } else if (cur === 'A') {
        // Arc: rx ry rot largeArc sweep x y — endpoint parameterization.
        const rx = Math.abs(v[0]!)
        const ry = Math.abs(v[1]!)
        const rot = (v[2]! * Math.PI) / 180
        const largeArc = v[3]! !== 0
        const sweep = v[4]! !== 0
        cx = rel(v[5]!, cx)
        cy = rel(v[6]!, cy)
        out.push({ cmd: 'A', args: [rx, ry, rot, largeArc ? 1 : 0, sweep ? 1 : 0, cx, cy] })
      }
      // After the first group, an implicit repeat continues the SAME
      // command while the next token is a number.
      if (tokens[i + 1] && tokens[i + 1]!.t === 'n') continue
      break
    }
    i++
  }
  return out
}

/** Parse one icon's element list into draw-able element plans. */
interface Plan {
  segs: Seg[]
}
function planFor(name: string): Plan[] {
  const elems = NODES[name]
  if (!elems) throw new Error(`lucide: unknown icon "${name}"`)
  const plans: Plan[] = []
  for (const [tag, attrs] of elems) {
    if (tag === 'path') {
      plans.push({ segs: parsePath(attrs.d ?? '') })
    } else if (tag === 'rect') {
      plans.push({ segs: rectSegs(attrs) })
    } else if (tag === 'circle') {
      const cx = parseFloat(attrs.cx ?? '0')
      const cy = parseFloat(attrs.cy ?? '0')
      const r = parseFloat(attrs.r ?? '0')
      // 4 cubic arcs approximate the circle (kappa).
      const k = r * 0.5523
      plans.push({
        segs: [
          { cmd: 'M', args: [cx - r, cy] },
          { cmd: 'C', args: [cx - r, cy - k, cx - k, cy - r, cx, cy - r] },
          { cmd: 'C', args: [cx + k, cy - r, cx + r, cy - k, cx + r, cy] },
          { cmd: 'C', args: [cx + r, cy + k, cx + k, cy + r, cx, cy + r] },
          { cmd: 'C', args: [cx - k, cy + r, cx - r, cy + k, cx - r, cy] },
          { cmd: 'Z', args: [] },
        ],
      })
    } else if (tag === 'line') {
      plans.push({
        segs: [
          { cmd: 'M', args: [parseFloat(attrs.x1 ?? '0'), parseFloat(attrs.y1 ?? '0')] },
          { cmd: 'L', args: [parseFloat(attrs.x2 ?? '0'), parseFloat(attrs.y2 ?? '0')] },
        ],

      })
    } else {
      throw new Error(`lucide: unsupported element <${tag}> in "${name}"`)
    }
  }
  return plans
}

const PLANS = new Map<string, Plan[]>()

function plansFor(name: string): Plan[] {
  let p = PLANS.get(name)
  if (!p) {
    p = planFor(name)
    PLANS.set(name, p)
  }
  return p
}

/**
 * Draw a Lucide icon onto a Phaser Graphics object.
 *
 * @param g           target graphics (stroked in `color`, white by default)
 * @param name        lucide-static icon key (e.g. 'arrow-right-left')
 * @param cx cy       centre in world space
 * @param size        rendered edge length in px (the icon fits a size×size box)
 * @param color       stroke colour (default white)
 * @param strokeWidth stroke width in Lucide's 24-unit space (default 2 —
 *                    Lucide's canonical weight; 2.6+ reads chunkier at
 *                    small HUD sizes)
 */
export function drawLucide(g: Phaser.GameObjects.Graphics, name: string, cx: number, cy: number, size: number, color = 0xffffff, strokeWidth = STROKE): void {
  const u = size / VIEW
  g.save()
  g.translateCanvas(cx - (VIEW / 2) * u, cy - (VIEW / 2) * u)
  g.lineStyle(strokeWidth * u, color, 1)
  for (const plan of plansFor(name)) {
    g.beginPath()
    let pen = { x: 0, y: 0 }
    let start = { x: 0, y: 0 }
    for (const seg of plan.segs) {
      const a = seg.args
      switch (seg.cmd) {
        case 'M':
          pen = { x: a[0]! * u, y: a[1]! * u }
          start = { ...pen }
          g.moveTo(pen.x, pen.y)
          break
        case 'L':
          pen = { x: a[0]! * u, y: a[1]! * u }
          g.lineTo(pen.x, pen.y)
          break
        case 'C': {
          // Cubic bezier → 12-segment polyline via De Casteljau sampling.
          const p0 = pen
          const p1 = { x: a[0]! * u, y: a[1]! * u }
          const p2 = { x: a[2]! * u, y: a[3]! * u }
          const p3 = { x: a[4]! * u, y: a[5]! * u }
          const N = 12
          for (let s = 1; s <= N; s++) {
            const t = s / N
            const mt = 1 - t
            const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x
            const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
            g.lineTo(x, y)
          }
          pen = p3
          break
        }
        case 'Q': {
          // Quadratic bezier → 8-segment polyline.
          const p0 = pen
          const p1 = { x: a[0]! * u, y: a[1]! * u }
          const p2 = { x: a[2]! * u, y: a[3]! * u }
          const N = 8
          for (let s = 1; s <= N; s++) {
            const t = s / N
            const mt = 1 - t
            const x = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x
            const y = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
            g.lineTo(x, y)
          }
          pen = p2
          break
        }
        case 'A': {
          // Endpoint-arc → centre-arc conversion (SVG spec F.6.5).
          const [rx, ry, rot, largeArc, sweep, x2, y2] = a as [number, number, number, number, number, number, number]
          const x1 = pen.x / u
          const y1 = pen.y / u
          const ex = x2
          const ey = y2
          // If the endpoints coincide, skip (degenerate arc).
          if (Math.abs(ex - x1) < 1e-9 && Math.abs(ey - y1) < 1e-9) break
          const cosr = Math.cos(rot)
          const sinr = Math.sin(rot)
          const dx = (x1 - ex) / 2
          const dy = (y1 - ey) / 2
          const x1p = cosr * dx + sinr * dy
          const y1p = -sinr * dx + cosr * dy
          const l = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
          const rco = l > 1 ? Math.sqrt(l) : 1
          const rxp = rx * rco
          const ryp = ry * rco
          const sign = largeArc !== sweep ? 1 : -1
          const denom = Math.sqrt(Math.max(0, (rxp * rxp * ryp * ryp - rxp * rxp * y1p * y1p - ryp * ryp * x1p * x1p) / (rxp * rxp * y1p * y1p + ryp * ryp * x1p * x1p)))
          const cxp = (sign * denom * rxp * y1p) / ryp
          const cyp = (-sign * denom * ryp * x1p) / rxp
          const ccx = cosr * cxp - sinr * cyp + (x1 + ex) / 2
          const ccy = sinr * cxp + cosr * cyp + (y1 + ey) / 2
          const ang = (ux: number, uy: number, vx: number, vy: number): number => {
            const dot = ux * vx + uy * vy
            const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
            let a = Math.acos(Math.min(1, Math.max(-1, dot / len)))
            if (ux * vy - uy * vx < 0) a = -a
            return a
          }
          const th1 = ang(1, 0, (x1p - cxp) / rxp, (y1p - cyp) / ryp)
          let dth = ang((x1p - cxp) / rxp, (y1p - cyp) / ryp, (-x1p - cxp) / rxp, (-y1p - cyp) / ryp)
          if (!sweep && dth > 0) dth -= 2 * Math.PI
          if (sweep && dth < 0) dth += 2 * Math.PI
          // Sample the arc in icon space; account for the ellipse axes and
          // the canvas-space scale.
          const N = Math.max(8, Math.ceil((Math.abs(dth) / (Math.PI / 2)) * 12))
          for (let s = 1; s <= N; s++) {
            const t = th1 + (dth * s) / N
            const px = ccx + rxp * Math.cos(t) * cosr - ryp * Math.sin(t) * sinr
            const py = ccy + rxp * Math.cos(t) * sinr + ryp * Math.sin(t) * cosr
            g.lineTo(px * u, py * u)
          }
          pen = { x: ex * u, y: ey * u }
          break
        }
        case 'Z':
          g.closePath()
          pen = { ...start }
          break
      }
    }
    g.strokePath()
  }
  g.restore()
}

/** Check an icon name exists (build-time safety for icon tables). */
export function hasLucide(name: string): boolean {
  return name in NODES
}
