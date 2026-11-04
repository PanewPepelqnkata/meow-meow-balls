export interface FillClipPoint {
  x: number
  y: number
}

/** The common path operations supported by Phaser Graphics and canvas adapters. */
interface FillPathTarget {
  beginPath(): unknown
  moveTo(x: number, y: number): unknown
  lineTo(x: number, y: number): unknown
  arc(cx: number, cy: number, r: number, start: number, end: number, anticlockwise?: boolean): unknown
  closePath(): unknown
  fillPath(): unknown
}

interface Crossing {
  edge: number
  x: number
  winding: number
}

interface Span {
  left: number
  right: number
  leftX: number
  rightX: number
}

const TAU = Math.PI * 2
const ARC_STEP = Math.PI / 64

/**
 * Geometry-only intersection of one filled path with a simple body contour.
 * Unlike the card finish's convex clipper, this preserves concave dents and
 * disconnected intersections. The subject uses the normal nonzero fill rule,
 * including crossing arc connectors in Robo's original lower shadow.
 *
 * A horizontal sweep splits at vertices and edge intersections. Between those
 * events the intersection consists of convex trapezoids, so both renderers
 * avoid interpreting a concave clip path. The circular fallback retains native
 * radius-r arcs at its boundary rather than substituting an inset polygon.
 * All pieces share ONE fillPath: canvas must not alpha-blend their shared edges.
 * Scratch arrays/records grow only to their high-water marks and are reused.
 */
export class BodyFillClipper {
  private readonly body: number[] = []
  private bodyCount = 0
  private readonly subject: number[] = []
  private subjectCount = 0
  private readonly events: number[] = []
  private eventCount = 0
  private readonly bodyCrossings: Crossing[] = []
  private readonly subjectCrossings: Crossing[] = []
  private readonly bodySpans: Span[] = []
  private readonly subjectSpans: Span[] = []
  private minX = 0
  private maxX = 0
  private minY = 0
  private maxY = 0
  private circular = false
  private circleCx = 0
  private circleCy = 0
  private circleR = 0

  setBody(poly: readonly FillClipPoint[] | undefined, cx: number, cy: number, r: number): void {
    this.circular = !poly || poly.length < 3
    this.circleCx = cx
    this.circleCy = cy
    this.circleR = r
    if (!poly || poly.length < 3) {
      this.bodyCount = 0
      this.minX = cx - r
      this.maxX = cx + r
      this.minY = cy - r
      this.maxY = cy + r
      return
    }
    this.bodyCount = poly.length
    this.minX = this.minY = Infinity
    this.maxX = this.maxY = -Infinity
    for (let i = 0; i < this.bodyCount; i++) {
      const x = poly[i]!.x
      const y = poly[i]!.y
      this.body[i * 2] = x
      this.body[i * 2 + 1] = y
      this.minX = Math.min(this.minX, x)
      this.maxX = Math.max(this.maxX, x)
      this.minY = Math.min(this.minY, y)
      this.maxY = Math.max(this.maxY, y)
    }
  }

  beginPath(): void {
    this.subjectCount = 0
  }

  lineTo(x: number, y: number): void {
    const i = this.subjectCount * 2
    if (i > 0 && this.subject[i - 2] === x && this.subject[i - 1] === y) return
    this.subject[i] = x
    this.subject[i + 1] = y
    this.subjectCount++
  }

  arc(cx: number, cy: number, r: number, start: number, end: number, anticlockwise = false): void {
    let sweep = end - start
    if (anticlockwise) {
      if (sweep < -TAU) sweep = -TAU
      else if (sweep > 0) sweep = sweep % TAU - TAU
    } else {
      if (sweep > TAU) sweep = TAU
      else if (sweep < 0) sweep = sweep % TAU + TAU
    }
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_STEP))
    for (let i = 0; i <= steps; i++) {
      const angle = start + sweep * i / steps
      this.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
    }
  }

  roundedRect(x: number, y: number, w: number, h: number, radius: number): void {
    this.beginPath()
    const r = Math.min(radius, w / 2, h / 2)
    this.arc(x + w - r, y + r, r, -Math.PI / 2, 0)
    this.arc(x + w - r, y + h - r, r, 0, Math.PI / 2)
    this.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
    this.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5)
  }

  circle(x: number, y: number, r: number): void {
    this.beginPath()
    this.arc(x, y, r, 0, TAU)
  }

  fill(g: FillPathTarget): void {
    if (this.subjectCount < 3) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let i = 0; i < this.subjectCount; i++) {
      minX = Math.min(minX, this.subject[i * 2]!)
      maxX = Math.max(maxX, this.subject[i * 2]!)
      minY = Math.min(minY, this.subject[i * 2 + 1]!)
      maxY = Math.max(maxY, this.subject[i * 2 + 1]!)
    }
    const low = Math.max(minY, this.minY)
    const high = Math.min(maxY, this.maxY)
    if (low >= high || minX >= this.maxX || maxX <= this.minX) return

    this.eventCount = 0
    this.events[this.eventCount++] = low
    this.events[this.eventCount++] = high
    let contained = minX >= this.minX && maxX <= this.maxX && minY >= this.minY && maxY <= this.maxY
    for (let i = 0; i < this.bodyCount; i++) this.addEvent(this.body[i * 2 + 1]!, low, high)
    for (let i = 0; i < this.subjectCount; i++) {
      this.addEvent(this.subject[i * 2 + 1]!, low, high)
      if (contained && !this.contains(this.subject[i * 2]!, this.subject[i * 2 + 1]!)) contained = false
      for (let j = 0; j < this.bodyCount; j++) {
        if (this.addIntersection(this.subject, this.subjectCount, i, this.body, this.bodyCount, j, low, high)) contained = false
      }
      if (this.circular && this.addCircleIntersections(i, low, high)) contained = false
    }
    // Self-intersections are also sweep events: the original two-arc shadow
    // crosses its straight connectors near the sides of the casing.
    for (let i = 0; i < this.subjectCount; i++) {
      for (let j = i + 2; j < this.subjectCount; j++) {
        if (i === 0 && j === this.subjectCount - 1) continue
        if (this.addIntersection(this.subject, this.subjectCount, i, this.subject, this.subjectCount, j, low, high)) contained = false
      }
    }
    if (contained) {
      g.beginPath()
      g.moveTo(this.subject[0]!, this.subject[1]!)
      for (let i = 1; i < this.subjectCount; i++) g.lineTo(this.subject[i * 2]!, this.subject[i * 2 + 1]!)
      g.closePath()
      g.fillPath()
      return
    }
    // In-place Shell sort uses only the live prefix of the retained buffer.
    for (let gap = Math.floor(this.eventCount / 2); gap > 0; gap = Math.floor(gap / 2)) {
      for (let i = gap; i < this.eventCount; i++) {
        const y = this.events[i]!
        let j = i
        for (; j >= gap && this.events[j - gap]! > y; j -= gap) this.events[j] = this.events[j - gap]!
        this.events[j] = y
      }
    }
    let painted = false
    for (let i = 1; i < this.eventCount; i++) {
      const y0 = this.events[i - 1]!, y1 = this.events[i]!
      if (y0 === y1) continue
      const mid = (y0 + y1) / 2
      const bodyCount = this.circular ? this.circleSpanAt(mid) : this.spansAt(this.body, this.bodyCount, mid, this.bodyCrossings, this.bodySpans)
      const subjectCount = this.spansAt(this.subject, this.subjectCount, mid, this.subjectCrossings, this.subjectSpans)
      let b = 0, s = 0
      while (b < bodyCount && s < subjectCount) {
        const body = this.bodySpans[b]!, subject = this.subjectSpans[s]!
        if (Math.max(body.leftX, subject.leftX) < Math.min(body.rightX, subject.rightX)) {
          const leftBody = body.leftX >= subject.leftX
          const rightBody = body.rightX <= subject.rightX
          const left = leftBody ? body.left : subject.left
          const right = rightBody ? body.right : subject.right
          const left0 = this.boundaryX(leftBody, left, y0, true)
          const left1 = this.boundaryX(leftBody, left, y1, true)
          const right0 = this.boundaryX(rightBody, right, y0, false)
          const right1 = this.boundaryX(rightBody, right, y1, false)
          if (!painted) g.beginPath()
          painted = true
          g.moveTo(left0, y0)
          g.lineTo(right0, y0)
          if (rightBody && this.circular) {
            g.arc(this.circleCx, this.circleCy, this.circleR, this.circleAngle(y0), this.circleAngle(y1), false)
          } else {
            g.lineTo(right1, y1)
          }
          g.lineTo(left1, y1)
          if (leftBody && this.circular) {
            g.arc(this.circleCx, this.circleCy, this.circleR, Math.PI - this.circleAngle(y1), Math.PI - this.circleAngle(y0), false)
          } else {
            g.lineTo(left0, y0)
          }
          g.closePath()
        }
        if (body.rightX <= subject.rightX) b++
        else s++
      }
    }
    if (painted) g.fillPath()
  }

  private contains(x: number, y: number): boolean {
    if (this.circular) return (x - this.circleCx) ** 2 + (y - this.circleCy) ** 2 <= this.circleR ** 2
    let inside = false
    for (let i = 0, j = this.bodyCount - 1; i < this.bodyCount; j = i++) {
      const ax = this.body[j * 2]!, ay = this.body[j * 2 + 1]!
      const bx = this.body[i * 2]!, by = this.body[i * 2 + 1]!
      if ((bx - ax) * (y - ay) === (by - ay) * (x - ax)
        && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true
      if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside
    }
    return inside
  }

  private addEvent(y: number, low: number, high: number): void {
    if (y > low && y < high) this.events[this.eventCount++] = y
  }

  private addCircleIntersections(edge: number, low: number, high: number): boolean {
    const next = (edge + 1) % this.subjectCount
    const x = this.subject[edge * 2]! - this.circleCx, y = this.subject[edge * 2 + 1]! - this.circleCy
    const dx = this.subject[next * 2]! - this.subject[edge * 2]!
    const dy = this.subject[next * 2 + 1]! - this.subject[edge * 2 + 1]!
    const length2 = dx * dx + dy * dy
    if (length2 === 0) return false
    const dot = x * dx + y * dy
    const discriminant = dot * dot - length2 * (x * x + y * y - this.circleR * this.circleR)
    if (discriminant < 0) return false
    const root = Math.sqrt(discriminant)
    const t0 = (-dot - root) / length2, t1 = (-dot + root) / length2
    const hit0 = t0 >= 0 && t0 <= 1, hit1 = t1 >= 0 && t1 <= 1
    if (hit0) this.addEvent(this.circleCy + y + t0 * dy, low, high)
    if (hit1) this.addEvent(this.circleCy + y + t1 * dy, low, high)
    return hit0 || hit1
  }

  private circleSpanAt(y: number): number {
    const span = this.bodySpans[0] ?? (this.bodySpans[0] = { left: 0, right: 0, leftX: 0, rightX: 0 })
    const dx = Math.sqrt(Math.max(0, this.circleR * this.circleR - (y - this.circleCy) ** 2))
    span.leftX = this.circleCx - dx
    span.rightX = this.circleCx + dx
    return 1
  }

  private circleAngle(y: number): number {
    return Math.asin(Math.max(-1, Math.min(1, (y - this.circleCy) / this.circleR)))
  }

  private boundaryX(body: boolean, edge: number, y: number, left: boolean): number {
    if (body && this.circular) {
      const dx = Math.sqrt(Math.max(0, this.circleR * this.circleR - (y - this.circleCy) ** 2))
      return this.circleCx + (left ? -dx : dx)
    }
    return this.edgeX(body ? this.body : this.subject, body ? this.bodyCount : this.subjectCount, edge, y)
  }

  private addIntersection(a: number[], an: number, ai: number, b: number[], bn: number, bi: number, low: number, high: number): boolean {
    const aj = (ai + 1) % an, bj = (bi + 1) % bn
    const ax = a[ai * 2]!, ay = a[ai * 2 + 1]!, bx = b[bi * 2]!, by = b[bi * 2 + 1]!
    const dx = a[aj * 2]! - ax, dy = a[aj * 2 + 1]! - ay
    const ex = b[bj * 2]! - bx, ey = b[bj * 2 + 1]! - by
    if (Math.max(ax, ax + dx) < Math.min(bx, bx + ex) || Math.min(ax, ax + dx) > Math.max(bx, bx + ex)
      || Math.max(ay, ay + dy) < Math.min(by, by + ey) || Math.min(ay, ay + dy) > Math.max(by, by + ey)) return false
    const cross = dx * ey - dy * ex
    if (cross === 0) return false
    const t = ((bx - ax) * ey - (by - ay) * ex) / cross
    const u = ((bx - ax) * dy - (by - ay) * dx) / cross
    if (t < 0 || t > 1 || u < 0 || u > 1) return false
    this.addEvent(ay + t * dy, low, high)
    return true
  }

  private edgeX(points: number[], count: number, edge: number, y: number): number {
    const next = (edge + 1) % count
    const x0 = points[edge * 2]!, y0 = points[edge * 2 + 1]!
    return x0 + (y - y0) * (points[next * 2]! - x0) / (points[next * 2 + 1]! - y0)
  }

  private spansAt(points: number[], count: number, y: number, crossings: Crossing[], spans: Span[]): number {
    let n = 0
    for (let i = 0; i < count; i++) {
      const y0 = points[i * 2 + 1]!, y1 = points[((i + 1) % count) * 2 + 1]!
      if ((y0 > y) === (y1 > y)) continue
      const crossing = crossings[n] ?? (crossings[n] = { edge: 0, x: 0, winding: 0 })
      crossing.edge = i
      crossing.x = this.edgeX(points, count, i, y)
      crossing.winding = y1 > y0 ? 1 : -1
      n++
    }
    for (let i = 1; i < n; i++) {
      const crossing = crossings[i]!
      let j = i
      for (; j > 0 && crossings[j - 1]!.x > crossing.x; j--) crossings[j] = crossings[j - 1]!
      crossings[j] = crossing
    }
    let winding = 0, left = 0, spanCount = 0
    for (let i = 0; i < n; i++) {
      const crossing = crossings[i]!
      const previous = winding
      winding += crossing.winding
      if (previous === 0 && winding !== 0) left = i
      if (previous !== 0 && winding === 0 && crossings[left]!.x < crossing.x) {
        const span = spans[spanCount] ?? (spans[spanCount] = { left: 0, right: 0, leftX: 0, rightX: 0 })
        span.left = crossings[left]!.edge
        span.right = crossing.edge
        span.leftX = crossings[left]!.x
        span.rightX = crossing.x
        spanCount++
      }
    }
    return spanCount
  }
}
