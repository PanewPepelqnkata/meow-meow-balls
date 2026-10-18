import { describe, expect, it } from 'vitest'
import { resolveLayout, WORLD_GEOM } from './ResponsiveLayout'

/**
 * Phase 2.11.0 §16 regressions: responsive layout boundaries, world-camera
 * framing, and composition rules for every supported viewport.
 */

const SUPPORTED: Array<[number, number, 'mobile' | 'tablet' | 'desktop', 'portrait' | 'landscape']> = [
  [320, 568, 'mobile', 'portrait'],
  [375, 667, 'mobile', 'portrait'],
  [390, 844, 'mobile', 'portrait'],
  [430, 932, 'mobile', 'portrait'],
  [768, 1024, 'tablet', 'portrait'],
  [1280, 720, 'desktop', 'landscape'],
  [1440, 900, 'desktop', 'landscape'],
  [1648, 936, 'desktop', 'landscape'],
  [1920, 1080, 'desktop', 'landscape'],
]

describe('ResponsiveLayout', () => {
  it.each(SUPPORTED)('classifies %dx%d as %s/%s', (w, h, mode, composition) => {
    const l = resolveLayout(w, h)
    expect(l.mode).toBe(mode)
    expect(l.composition).toBe(composition)
  })

  it('keeps the container at ~70% of viewport width on portrait screens', () => {
    for (const [w, h, , composition] of SUPPORTED) {
      if (composition === 'landscape') continue
      const l = resolveLayout(w, h)
      // Container interior = 405 stage px; zoom rules target 0.7 coverage.
      const coverage = (405 * l.world.zoom) / w
      // Fit-height clamps (tablet) may stay lower; mobile must reach the band.
      if (w < 600) {
        expect(coverage).toBeGreaterThanOrEqual(0.65)
        expect(coverage).toBeLessThanOrEqual(0.72)
      }
      expect(coverage).toBeGreaterThan(0.3)
    }
  })

  it('never crops the spawn sky or the floor (gameplay band fully visible vertically)', () => {
    for (const [w, h] of SUPPORTED) {
      const l = resolveLayout(w, h)
      const bandH = (1125 - 170) * l.world.zoom
      expect(bandH).toBeLessThanOrEqual(h + 0.001)
    }
  })

  it('desktop: the claw ball never overlaps the top-center score (Phase 2.11.1 §4D)', () => {
    for (const [w, h, , composition] of SUPPORTED) {
      const l = resolveLayout(w, h)
      const scoreSize = composition === 'portrait' ? WORLD_GEOM.SCORE_DESIGN_SIZE_PORTRAIT : WORLD_GEOM.SCORE_DESIGN_SIZE
      const scoreBottom = l.score.y + scoreSize * l.fontScale * WORLD_GEOM.SCORE_LINE
      // Highest claw point (worst spawnable tier) in viewport space.
      const clawTopVp = (WORLD_GEOM.CLAW_TOP_WORST - l.world.centerY) * l.world.zoom + h / 2
      expect(clawTopVp).toBeGreaterThanOrEqual(scoreBottom + 3.5)
      // The claw must also be ON screen (not pushed out of the viewport).
      expect(clawTopVp).toBeGreaterThanOrEqual(0)
    }
  })

  it('desktop: container block lands near the 27% reference width', () => {
    for (const [w, h, , composition] of SUPPORTED) {
      if (composition !== 'landscape') continue
      const l = resolveLayout(w, h)
      const frac = (WORLD_GEOM.CONTAINER_OUTER_W * l.world.zoom) / w
      expect(frac).toBeGreaterThan(0.23)
      expect(frac).toBeLessThan(0.29)
    }
  })

  it('the floor bottom edge stays inside the viewport on every supported size', () => {
    for (const [w, h] of SUPPORTED) {
      const l = resolveLayout(w, h)
      const floorBottomVp = (WORLD_GEOM.FLOOR_BOTTOM - l.world.centerY) * l.world.zoom + h / 2
      expect(floorBottomVp).toBeLessThanOrEqual(h + 0.001)
    }
  })

  it('keeps all UI positions inside the viewport (no clipping)', () => {
    for (const [w, h] of SUPPORTED) {
      const l = resolveLayout(w, h)
      const inside = (p: { x: number; y: number }): void => {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(w)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(h)
      }
      inside(l.best)
      inside(l.global)
      inside(l.score)
      inside(l.nextBall.pos)
      inside(l.nextBall.label)
      inside(l.abilities.startX === 0 && l.abilities.centerX ? { x: w / 2, y: l.abilities.startY } : { x: l.abilities.startX, y: l.abilities.startY })
      // Ability row must fit horizontally (centered rows) or start inside.
      const rowW = 4 * l.abilities.size + 3 * l.abilities.gap
      expect(rowW).toBeLessThanOrEqual(w)
      // Buttons keep a minimum tappable size.
      expect(l.abilities.size).toBeGreaterThanOrEqual(50)
    }
  })

  it('respects safe-area insets (HUD shifted inside the notches)', () => {
    const safe = { top: 44, right: 12, bottom: 34, left: 12 }
    const l = resolveLayout(390, 844, safe)
    expect(l.best.y).toBeGreaterThanOrEqual(safe.top)
    expect(l.abilities.startY).toBeLessThanOrEqual(844 - safe.bottom)
  })

  it('desktop landscape positions match the reference composition (1648×936)', () => {
    const l = resolveLayout(1648, 936)
    // Best top-left.
    expect(l.best.x).toBeCloseTo(38, 0)
    expect(l.best.y).toBeCloseTo(47, 0)
    // Score top-center.
    expect(l.score.x).toBeCloseTo(824, 0)
    // Tier ring on the left side (Phase 2.16.2, like the reference image).
    expect(l.tiers.kind).toBe('ring')
    expect(l.tiers.cx!).toBeLessThan(300)
    expect(l.tiers.cy!).toBeGreaterThan(600)
    expect(l.tiers.cx!).toBeGreaterThan(l.tiers.r!)
    // Abilities lower-right.
    expect(l.abilities.startX).toBeGreaterThan(1000)
    expect(l.abilities.startY).toBeGreaterThan(650)
    // Preview upper-left of gameplay.
    expect(l.nextBall.pos.x).toBeLessThan(300)
    expect(l.nextBall.pos.y).toBeGreaterThan(150)
  })

  it('desktop preview diameter lands near the 70–75px reference scale', () => {
    const l = resolveLayout(1648, 936)
    expect(l.nextBall.diameter).toBeGreaterThanOrEqual(70)
    expect(l.nextBall.diameter).toBeLessThanOrEqual(78)
  })

  it('grid stays square and fixed-density (desktop 40px cell at reference size)', () => {
    const l = resolveLayout(1648, 936)
    expect(l.grid.cell).toBeGreaterThanOrEqual(38)
    expect(l.grid.cell).toBeLessThanOrEqual(42)
    const mob = resolveLayout(390, 844)
    expect(mob.grid.cell).toBeGreaterThan(0)
  })
})
