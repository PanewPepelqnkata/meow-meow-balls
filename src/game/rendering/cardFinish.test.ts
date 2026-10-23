import { describe, expect, it } from 'vitest'
import {
  buildCardGloss,
  buildCardSheen,
  buildRarityEdge,
  buildRarityGlint,
  clipPolygon,
  hueColor,
  leafPolygon,
  mixColor,
  roundedRectPolygon,
  type CardRect,
} from './cardFinish'

/**
 * THE COLLECTIBLE CARD'S FINISH — the holographic sheen, the paper gloss
 * and the rarity flourish.
 *
 * The finish is the card's FOIL: a rainbow band that sweeps across the
 * card, a soft gloss on the paper, and a rarity flourish. These are the
 * invariants that matter:
 *
 *  1. The foil NEVER leaves the card — every slice is clipped to the
 *     card's own rounded outline (a band that spilled onto the dark
 *     background would not read as foil).
 *  2. The band really MOVES — the sweep is what sells the finish, so
 *     the geometry at one phase must differ from the geometry at
 *     another.
 *  3. The band is TINTED by the tier's colour, so each card's foil
 *     matches its ball.
 *  4. The rarity flourish is earned, not given: the edge ribbon only
 *     appears on the top rungs, and the glint grows with the rarity.
 */
const CARD: CardRect = { x: -170, y: -220, w: 340, h: 450, r: 26 }

/** The bounds of every point in a set of slices. */
function bounds(slices: { points: { x: number; y: number }[] }[]): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const slice of slices) {
    for (const p of slice.points) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  return { minX, maxX, minY, maxY }
}

describe('the card finish', () => {
  it('every slice of the finish stays on the card', () => {
    // The card's own bounds, with a hair of slack for the clip inset.
    const slack = 0.5
    const sheen = buildCardSheen(CARD, 0.5, 0xff9800, 2)
    const all = [
      ...buildCardGloss(CARD, 0xff9800),
      ...sheen.band,
      ...sheen.specular,
      ...buildRarityEdge(CARD, 0xff9800, 4),
    ]
    expect(all.length).toBeGreaterThan(0)
    for (const slice of all) {
      for (const p of slice.points) {
        expect(p.x).toBeGreaterThanOrEqual(CARD.x - slack)
        expect(p.x).toBeLessThanOrEqual(CARD.x + CARD.w + slack)
        expect(p.y).toBeGreaterThanOrEqual(CARD.y - slack)
        expect(p.y).toBeLessThanOrEqual(CARD.y + CARD.h + slack)
      }
    }
  })

  it('the sheen band moves across the card', () => {
    const early = buildCardSheen(CARD, 0.15, 0xff9800, 2).band
    const late = buildCardSheen(CARD, 0.85, 0xff9800, 2).band
    expect(early.length).toBeGreaterThan(0)
    expect(late.length).toBeGreaterThan(0)
    // The band is in a different place — it has swept.
    const earlyBounds = bounds(early)
    const lateBounds = bounds(late)
    const moved = Math.abs(earlyBounds.minX - lateBounds.minX) + Math.abs(earlyBounds.minY - lateBounds.minY)
    expect(moved).toBeGreaterThan(20)
  })

  it('the band is clear of the card at the start and the end of the sweep', () => {
    // Phase 0 and 1 put the band completely off the card, so the loop
    // is seamless (the band never pops into existence).
    for (const phase of [0, 1]) {
      const sheen = buildCardSheen(CARD, phase, 0xff9800, 2)
      expect(sheen.band.length).toBe(0)
      expect(sheen.specular.length).toBe(0)
    }
  })

  it('the sweep wraps seamlessly — phase 1 is phase 0', () => {
    const a = buildCardSheen(CARD, 0, 0xff9800, 2).band
    const b = buildCardSheen(CARD, 1, 0xff9800, 2).band
    expect(a.length).toBe(b.length)
  })

  it('the band is tinted by the tier colour', () => {
    // The same card, two different tiers: the foil's colours must
    // differ, because each card's foil matches its ball.
    const orange = buildCardSheen(CARD, 0.5, 0xff9800, 2).band
    const violet = buildCardSheen(CARD, 0.5, 0x8f2bff, 2).band
    expect(orange.length).toBe(violet.length)
    const orangeColors = orange.map((s) => s.color).sort((a, b) => a - b)
    const violetColors = violet.map((s) => s.color).sort((a, b) => a - b)
    expect(orangeColors).not.toEqual(violetColors)
  })

  it('a rarer card gets stronger foil', () => {
    const common = buildCardSheen(CARD, 0.5, 0xff9800, 0).band
    const legendary = buildCardSheen(CARD, 0.5, 0xff9800, 4).band
    const peak = (slices: { alpha: number }[]): number =>
      slices.reduce((max, s) => Math.max(max, s.alpha), 0)
    expect(peak(legendary)).toBeGreaterThan(peak(common))
  })

  it('the rainbow band is a real rainbow — the slices differ in hue', () => {
    const band = buildCardSheen(CARD, 0.5, 0xff9800, 2).band
    expect(band.length).toBeGreaterThan(3)
    // The band's colours are not all the same — that is the foil.
    const colors = new Set(band.map((s) => s.color))
    expect(colors.size).toBeGreaterThan(3)
  })

  it('the band stays visible on cream paper', () => {
    // The card's paper is near-white (0xfff3d6). An ADDITIVE rainbow
    // would clip back to white, so the band is drawn normally — and a
    // normally-blended band must actually darken/tint the paper where
    // it lands, or the foil is invisible.
    const band = buildCardSheen(CARD, 0.5, 0xff9800, 2).band
    const peak = band.reduce((max, s) => Math.max(max, s.alpha), 0)
    expect(peak).toBeGreaterThan(0.25)
  })

  it('the gloss is a soft, static highlight on the paper', () => {
    const gloss = buildCardGloss(CARD, 0xff9800)
    expect(gloss.length).toBeGreaterThan(0)
    // It is a wash and a shadow line, not a slab — every slice is soft.
    for (const slice of gloss) {
      expect(slice.alpha).toBeGreaterThan(0)
      expect(slice.alpha).toBeLessThan(0.4)
    }
  })

  it('the rarity edge ribbon is earned, not given', () => {
    // The common rungs have no ribbon; the top rungs do.
    expect(buildRarityEdge(CARD, 0xff9800, 0).length).toBe(0)
    expect(buildRarityEdge(CARD, 0xff9800, 2).length).toBe(0)
    expect(buildRarityEdge(CARD, 0xff9800, 3).length).toBeGreaterThan(0)
    expect(buildRarityEdge(CARD, 0xff9800, 4).length).toBeGreaterThan(0)
  })

  it('the glint grows with the rarity', () => {
    const common = buildRarityGlint(CARD, 0xff9800, 0).length
    const epic = buildRarityGlint(CARD, 0xff9800, 3).length
    const legendary = buildRarityGlint(CARD, 0xff9800, 4).length
    expect(common).toBeGreaterThan(0)
    expect(epic).toBeGreaterThan(common)
    expect(legendary).toBeGreaterThan(epic)
  })

  it('the clip keeps a subject inside the card', () => {
    const clip = roundedRectPolygon(CARD)
    // A band that covers the whole world.
    const huge = [
      { x: -5000, y: -5000 },
      { x: 5000, y: -5000 },
      { x: 5000, y: 5000 },
      { x: -5000, y: 5000 },
    ]
    const clipped = clipPolygon(huge, clip)
    expect(clipped.length).toBeGreaterThan(2)
    for (const p of clipped) {
      expect(p.x).toBeGreaterThanOrEqual(CARD.x - 0.001)
      expect(p.x).toBeLessThanOrEqual(CARD.x + CARD.w + 0.001)
      expect(p.y).toBeGreaterThanOrEqual(CARD.y - 0.001)
      expect(p.y).toBeLessThanOrEqual(CARD.y + CARD.h + 0.001)
    }
  })

  it('the card outline is convex and closed', () => {
    const poly = roundedRectPolygon(CARD)
    expect(poly.length).toBeGreaterThan(8)
    // Convex: every point is on the same side of every edge.
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    let sign = 0
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!
      const b = poly[(i + 1) % poly.length]!
      const c = poly[(i + 2) % poly.length]!
      const s = Math.sign(cross(a, b, c))
      if (s === 0) continue
      if (sign === 0) sign = s
      else expect(s).toBe(sign)
    }
  })

  it('a leaf tapers at both ends', () => {
    const leaf = leafPolygon({ x: 0, y: 0 }, { x: 100, y: 0 }, 20)
    expect(leaf.length).toBeGreaterThan(8)
    // The first and last points are the tips, on the centre line.
    expect(leaf[0]!.y).toBeCloseTo(0, 6)
    expect(leaf[leaf.length - 1]!.y).toBeCloseTo(0, 6)
    // The widest point is in the middle.
    const maxY = Math.max(...leaf.map((p) => Math.abs(p.y)))
    expect(maxY).toBeGreaterThan(19)
  })

  it('the colour helpers are well behaved', () => {
    expect(mixColor(0x000000, 0xffffff, 0)).toBe(0x000000)
    expect(mixColor(0x000000, 0xffffff, 1)).toBe(0xffffff)
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080)
    // A hue is a colour, and it wraps.
    expect(hueColor(0, 1, 0.5)).toBe(0xff0000)
    expect(hueColor(1 / 3, 1, 0.5)).toBe(0x00ff00)
    expect(hueColor(2 / 3, 1, 0.5)).toBe(0x0000ff)
    expect(hueColor(1.25, 1, 0.5)).toBe(hueColor(0.25, 1, 0.5))
  })
})
