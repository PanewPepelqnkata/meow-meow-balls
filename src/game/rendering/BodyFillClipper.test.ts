import { describe, expect, it } from 'vitest'
import { BodyFillClipper, type FillClipPoint } from './BodyFillClipper'

class RecordedFill {
  readonly paths: FillClipPoint[][] = []
  readonly arcs: Array<{ cx: number; cy: number; r: number; start: number; end: number }> = []
  fills = 0

  beginPath(): void {
    this.paths.length = 0
  }

  moveTo(x: number, y: number): void {
    this.paths.push([{ x, y }])
  }

  lineTo(x: number, y: number): void {
    this.paths[this.paths.length - 1]!.push({ x, y })
  }

  arc(cx: number, cy: number, r: number, start: number, end: number): void {
    this.arcs.push({ cx, cy, r, start, end })
    for (let i = 0; i <= 100; i++) {
      const angle = start + (end - start) * i / 100
      this.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
    }
  }

  closePath(): void {
    const path = this.paths[this.paths.length - 1]!
    path.push({ ...path[0]! })
  }

  fillPath(): void {
    this.fills++
  }
}

function filledArea(paths: FillClipPoint[][]): number {
  let area = 0
  for (const path of paths) {
    let twice = 0
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!, q = path[(i + 1) % path.length]!
      twice += p.x * q.y - p.y * q.x
    }
    area += Math.abs(twice) / 2
  }
  return area
}

function rectangle(clipper: BodyFillClipper, x: number, y: number, w: number, h: number): void {
  clipper.beginPath()
  clipper.lineTo(x, y)
  clipper.lineTo(x + w, y)
  clipper.lineTo(x + w, y + h)
  clipper.lineTo(x, y + h)
}

const NOTCHED_BODY = [
  { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 4, y: 6 },
  { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 0, y: 6 },
]

describe('body-owned fill clipping', () => {
  it('keeps disconnected intersections out of a concave dent in either winding', () => {
    const clipper = new BodyFillClipper()
    for (const body of [NOTCHED_BODY, [...NOTCHED_BODY].reverse()]) {
      clipper.setBody(body, 3, 3, 3)
      rectangle(clipper, -1, 3, 8, 2)
      const g = new RecordedFill()
      clipper.fill(g)
      expect(g.fills).toBe(1)
      expect(g.paths).toHaveLength(2)
      expect(filledArea(g.paths)).toBeCloseTo(8, 10)
      for (const path of g.paths) {
        expect(path.every(p => p.x <= 2) || path.every(p => p.x >= 4)).toBe(true)
      }
    }
  })

  it('clips edges crossing a dent even when every subject vertex is inside', () => {
    const clipper = new BodyFillClipper()
    clipper.setBody(NOTCHED_BODY, 3, 3, 3)
    rectangle(clipper, 1, 3, 4, 2)
    const g = new RecordedFill()
    clipper.fill(g)
    expect(g.paths).toHaveLength(2)
    expect(filledArea(g.paths)).toBeCloseTo(4, 10)
  })

  it('handles coincident boundaries, repeated contour points and zero-area touches', () => {
    const clipper = new BodyFillClipper()
    clipper.setBody([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 },
      { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 },
    ], 2, 2, 2)
    rectangle(clipper, 0, 0, 4, 4)
    const coincident = new RecordedFill()
    clipper.fill(coincident)
    expect(filledArea(coincident.paths)).toBeCloseTo(16, 10)
    expect(coincident.paths.flat().every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    rectangle(clipper, 4, 1, 2, 2)
    const touching = new RecordedFill()
    clipper.fill(touching)
    expect(touching.fills).toBe(0)
  })

  it('preserves both nonzero-fill lobes of a crossing subject path', () => {
    const clipper = new BodyFillClipper()
    clipper.setBody([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], 2, 2, 2)
    clipper.beginPath()
    for (const p of [{ x: -1, y: -1 }, { x: 5, y: 5 }, { x: -1, y: 5 }, { x: 5, y: -1 }]) clipper.lineTo(p.x, p.y)
    const g = new RecordedFill()
    clipper.fill(g)
    expect(g.fills).toBe(1)
    expect(filledArea(g.paths)).toBeCloseTo(8, 10)
    clipper.beginPath()
    for (const p of [{ x: 1, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }, { x: 3, y: 1 }]) clipper.lineTo(p.x, p.y)
    const contained = new RecordedFill()
    clipper.fill(contained)
    expect(contained.paths).toHaveLength(2)
    expect(filledArea(contained.paths)).toBeCloseTo(2, 10)
  })

  it('uses native radius-r arcs for the circular fallback, not an inset polygon', () => {
    const clipper = new BodyFillClipper()
    for (const body of [undefined, [{ x: 0, y: 0 }, { x: 1, y: 0 }]]) {
      clipper.setBody(body, 10, 20, 5)
      rectangle(clipper, 0, 10, 20, 20)
      const g = new RecordedFill()
      clipper.fill(g)
      expect(g.fills).toBe(1)
      expect(g.arcs).toHaveLength(2)
      expect(g.arcs.every(arc => arc.cx === 10 && arc.cy === 20 && arc.r === 5)).toBe(true)
      expect(g.arcs.reduce((sum, arc) => sum + arc.end - arc.start, 0)).toBeCloseTo(Math.PI * 2, 10)
      expect(filledArea(g.paths)).toBeCloseTo(Math.PI * 25, 1)
    }
  })

  it('retains the original Robo shadow arcs while removing their exterior fill', () => {
    const r = 40
    const clipper = new BodyFillClipper()
    clipper.setBody(undefined, 0, 0, r)
    clipper.beginPath()
    clipper.arc(0, 0, r * 0.95, Math.PI * 0.1, Math.PI * 0.9)
    clipper.arc(0, r * 0.56, r * 0.72, Math.PI * 0.9, Math.PI * 0.1, true)
    const g = new RecordedFill()
    clipper.fill(g)
    expect(g.fills).toBe(1)
    expect(filledArea(g.paths)).toBeGreaterThan(0)
    expect(g.paths.flat().every(p => Math.hypot(p.x, p.y) <= r + 1e-8)).toBe(true)
  })
})
