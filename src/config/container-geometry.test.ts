import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONTAINER,
  DESKTOP_CONTAINER,
  floorCollider,
  interiorCorners,
  resolveViewportContainer,
  tipCollidersAt,
  wallCollidersAt,
  wallTopYAt,
} from './container'

const FLOOR_Y = 1085
const SLOPE = (DESKTOP_CONTAINER.topWidth - DESKTOP_CONTAINER.bottomWidth) / 2 / DESKTOP_CONTAINER.height
const CENTER_X = 360

beforeEach(() => Object.assign(CONTAINER, DESKTOP_CONTAINER))
afterEach(() => Object.assign(CONTAINER, DESKTOP_CONTAINER))

function expectNormalGeometry(bottomWidth: number, height: number, topY: number, topWidth: number): void {
  expect(CONTAINER.bottomWidth).toBe(bottomWidth)
  expect(CONTAINER.height).toBe(height)
  expect(CONTAINER.topY).toBe(topY)
  expect(CONTAINER.topWidth).toBeCloseTo(topWidth, 9)

  const corners = interiorCorners()
  expect(corners.topLeft.x).toBeCloseTo(CENTER_X - topWidth / 2, 9)
  expect(corners.topLeft.y).toBe(topY)
  expect(corners.topRight.x).toBeCloseTo(CENTER_X + topWidth / 2, 9)
  expect(corners.topRight.y).toBe(topY)
  expect(corners.bottomLeft.x).toBeCloseTo(CENTER_X - bottomWidth / 2, 9)
  expect(corners.bottomLeft.y).toBe(FLOOR_Y)
  expect(corners.bottomRight.x).toBeCloseTo(CENTER_X + bottomWidth / 2, 9)
  expect(corners.bottomRight.y).toBe(FLOOR_Y)
  expect((corners.bottomLeft.x - corners.topLeft.x) / height).toBeCloseTo(SLOPE, 12)
  expect((corners.topRight.x - corners.bottomRight.x) / height).toBeCloseTo(SLOPE, 12)

  const [leftWall, rightWall] = wallCollidersAt()
  expect(leftWall!.vertices[0]).toEqual(corners.topLeft)
  expect(leftWall!.vertices[1]).toEqual(corners.bottomLeft)
  expect(rightWall!.vertices[0]).toEqual(corners.topRight)
  expect(rightWall!.vertices[1]).toEqual(corners.bottomRight)
  expect(floorCollider().vertices.slice(0, 2)).toEqual([corners.bottomLeft, corners.bottomRight])
}

function expectCapsAtHeights(heights: number[]): void {
  const T = CONTAINER.visual.bandThickness
  const capHeight = T * 0.22
  const chamfer = T * 0.08
  const local: Array<[number, number]> = [
    [0, 0],
    [0, -capHeight + chamfer],
    [chamfer, -capHeight],
    [T - chamfer, -capHeight],
    [T, -capHeight + chamfer],
    [T, 0],
  ]

  for (const h of heights) {
    const corners = interiorCorners(h)
    const [left, right] = tipCollidersAt(h)
    expect(left!.vertices).toHaveLength(6)
    expect(right!.vertices).toHaveLength(6)
    for (let i = 0; i < local.length; i++) {
      const [out, y] = local[i]!
      const l = left!.vertices[i]!
      const r = right!.vertices[i]!
      expect(l.x).toBeCloseTo(corners.topLeft.x - out, 9)
      expect(l.y).toBeCloseTo(corners.topLeft.y + y, 9)
      expect(r.x).toBeCloseTo(corners.topRight.x + out, 9)
      expect(r.y).toBeCloseTo(corners.topRight.y + y, 9)
      expect(r.x).toBeCloseTo(2 * CENTER_X - l.x, 9)
      expect(r.y).toBeCloseTo(l.y, 9)
      expect(l.x).toBeLessThanOrEqual(corners.topLeft.x)
      expect(r.x).toBeGreaterThanOrEqual(corners.topRight.x)
    }

    for (const vertices of [left!.vertices, right!.vertices]) {
      const crosses = vertices.map((a, i) => {
        const b = vertices[(i + 1) % vertices.length]!
        const c = vertices[(i + 2) % vertices.length]!
        return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
      })
      expect(crosses.every((cross) => cross < 0) || crosses.every((cross) => cross > 0)).toBe(true)
    }
  }
}

describe('container geometry for desktop and portrait phone', () => {
  it('keeps desktop normal dimensions and slope while raising to exactly 575', () => {
    expectNormalGeometry(405, 320, 765, 495.905)
    expect(CONTAINER.raisedHeight).toBe(575)
    expect(wallTopYAt(CONTAINER.raisedHeight)).toBe(510)
    expectCapsAtHeights([CONTAINER.height, (CONTAINER.height + CONTAINER.raisedHeight) / 2, CONTAINER.raisedHeight])
  })

  it('keeps portrait normal dimensions and slope while raising to exactly 520', () => {
    resolveViewportContainer(390, 844)
    const topWidth = 340 + 2 * SLOPE * 400
    expectNormalGeometry(340, 400, 685, topWidth)
    expect(CONTAINER.raisedHeight).toBe(520)
    expect(wallTopYAt(CONTAINER.raisedHeight)).toBe(565)
    expectCapsAtHeights([CONTAINER.height, (CONTAINER.height + CONTAINER.raisedHeight) / 2, CONTAINER.raisedHeight])
  })
})
