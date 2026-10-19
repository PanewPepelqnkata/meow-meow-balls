import { describe, expect, it } from 'vitest'
import { resolveLayout, WORLD_GEOM } from './ResponsiveLayout'
import type { UiLayout } from './ResponsiveLayout'
import { CONTAINER, wallTopYAt } from '../config/container'

/**
 * Phase 2.19 — phone-first reflow regressions plus preserved desktop rules.
 *
 * The portrait phone composition is a REFLOW: per-class real-px sizes with
 * hard touch-target floors, and a world camera that frames the live phone
 * funnel (GameRoot calls resolveViewportContainer at boot, so on portrait
 * phones CONTAINER describes the taller/narrower phone container).
 */

const PHONES: Array<[number, number]> = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [393, 852],
  [430, 932],
]

const SUPPORTED: Array<[number, number, 'mobile' | 'tablet' | 'desktop', 'portrait' | 'landscape']> = [
  ...PHONES.map(([w, h]): [number, number, 'mobile' | 'tablet' | 'desktop', 'portrait' | 'landscape'] => [w, h, 'mobile', 'portrait']),
  [768, 1024, 'tablet', 'portrait'],
  [1280, 720, 'desktop', 'landscape'],
  [1440, 900, 'desktop', 'landscape'],
  [1648, 936, 'desktop', 'landscape'],
  [1920, 1080, 'desktop', 'landscape'],
]

function stageToVpY(stageY: number, l: UiLayout, vh: number): number {
  return (stageY - l.world.centerY) * l.world.zoom + vh / 2
}

/** Gameplay region actually framed by the portrait camera (live funnel). */
function regionTopStage(): number {
  return wallTopYAt(CONTAINER.raisedHeight) - 76 - 50 - 8
}
function regionBotStage(): number {
  return CONTAINER.topY + CONTAINER.height + CONTAINER.visual.bandThickness + 10
}

describe('ResponsiveLayout', () => {
  it.each(SUPPORTED)('classifies %dx%d as %s/%s', (w, h, mode, composition) => {
    const l = resolveLayout(w, h)
    expect(l.mode).toBe(mode)
    expect(l.composition).toBe(composition)
  })

  describe('phone-first reflow composition', () => {
    it('touch targets never shrink below 44 CSS px on any phone', () => {
      for (const [w, h] of PHONES) {
        const l = resolveLayout(w, h)
        expect(l.abilities.size).toBeGreaterThanOrEqual(44)
        expect(l.abilities.size).toBeLessThanOrEqual(64)
        const rowW = 4 * l.abilities.size + 3 * l.abilities.gap
        expect(rowW).toBeLessThanOrEqual(w)
      }
    })

    it('reflow: block sizes are class-driven, not viewport-proportional', () => {
      // 320 and 430 must differ by exactly one class step, not scale linearly.
      const small = resolveLayout(320, 568)
      const large = resolveLayout(430, 932)
      expect(large.abilities.size - small.abilities.size).toBeLessThanOrEqual(14)
      expect(small.scoreSize).toBeGreaterThanOrEqual(27)
      expect(large.scoreSize).toBeLessThanOrEqual(33)
      // Both keep readable type.
      expect(small.fontScale).toBeGreaterThanOrEqual(0.9)
    })

    it('HUD stack: score hero centered, Best/Global row below, Next Ball compact under it', () => {
      for (const [w, h] of PHONES) {
        const l = resolveLayout(w, h)
        const scoreBottom = l.score.y + l.scoreSize * l.fontScale * WORLD_GEOM.SCORE_LINE
        expect(scoreBottom).toBeLessThanOrEqual(l.best.y)
        expect(l.global.x).toBeGreaterThan(l.best.x + 60)
        const nbTop = l.nextBall.pos.y - l.nextBall.diameter / 2
        expect(nbTop).toBeGreaterThanOrEqual(l.best.y)
        expect(l.nextBall.diameter).toBeLessThanOrEqual(58)
        expect(l.nextBall.labelAlign).toBe('left')
      }
    })

    it('the full gameplay region fits between the HUD and the control stack', () => {
      for (const [w, h] of PHONES) {
        const l = resolveLayout(w, h)
        const topVp = stageToVpY(regionTopStage(), l, h)
        const botVp = stageToVpY(regionBotStage(), l, h)
        expect(topVp).toBeGreaterThanOrEqual(l.stack.hudBottom - 0.5)
        expect(botVp).toBeLessThanOrEqual(l.stack.controlsTop + 0.5)
      }
    })

    it('container occupies the lower-middle of the slot (35–48%), not most of it', () => {
      for (const [w, h] of PHONES) {
        const l = resolveLayout(w, h)
        const slotH = l.stack.controlsTop - l.stack.hudBottom
        const contH = (CONTAINER.height + 2 * CONTAINER.visual.bandThickness) * l.world.zoom
        expect(contH / slotH).toBeGreaterThan(0.3)
        expect(contH / slotH).toBeLessThanOrEqual(0.5)
      }
    })

    it('walls never crop: outer container stays inside the viewport width', () => {
      for (const [w, h] of PHONES) {
        const l = resolveLayout(w, h)
        const outerW = (CONTAINER.topWidth + 2 * CONTAINER.visual.bandThickness) * l.world.zoom
        expect(outerW).toBeLessThanOrEqual(w)
        expect(outerW / w).toBeGreaterThanOrEqual(0.55)
      }
    })

    it('floating ball is clearly visible: fall distance is a real slice of the slot', () => {
      for (const [w, h] of PHONES) {
        const l = resolveLayout(w, h)
        const ballTopVp = stageToVpY(regionTopStage(), l, h)
        const rimVp = stageToVpY(CONTAINER.topY, l, h)
        const slotH = l.stack.controlsTop - l.stack.hudBottom
        const fall = rimVp - ballTopVp
        expect(ballTopVp).toBeGreaterThanOrEqual(l.stack.hudBottom - 0.5)
        expect(fall).toBeGreaterThan(slotH * 0.18)
        expect(fall).toBeLessThan(slotH * 0.9)
      }
    })

    it('tier row and ability bar stay separated and above the safe area', () => {
      for (const [w, h] of PHONES) {
        const l = resolveLayout(w, h)
        const tierBottom = (l.tiers.rowY ?? 0) + (l.tiers.nodeR ?? 0)
        expect(l.stack.controlsTop - tierBottom).toBeGreaterThanOrEqual(5)
        const abilityBottom = l.abilities.startY + l.abilities.size / 2
        expect(abilityBottom).toBeLessThanOrEqual(h)
        expect(l.tiers.nodeR).toBeGreaterThanOrEqual(7)
      }
    })

    it('safe-area insets shift blocks; sizes stay native', () => {
      const safe = { top: 47, right: 0, bottom: 34, left: 0 }
      const bare = resolveLayout(390, 844)
      const safeL = resolveLayout(390, 844, safe)
      expect(safeL.score.y).toBeGreaterThanOrEqual(safe.top)
      expect(safeL.abilities.startY + safeL.abilities.size / 2).toBeLessThanOrEqual(844 - safe.bottom)
      expect(safeL.abilities.size).toBe(bare.abilities.size)
      expect(safeL.scoreSize).toBe(bare.scoreSize)
      // The gameplay slot absorbed the insets.
      expect(safeL.stack.controlsTop - safeL.stack.hudBottom).toBeLessThan(
        bare.stack.controlsTop - bare.stack.hudBottom,
      )
    })

    it('all portrait UI anchors stay inside the viewport', () => {
      for (const [w, h] of PHONES) {
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
        inside({ x: w / 2, y: l.abilities.startY })
      }
    })

    it('portrait tablet reflows with more breathing room (no unbounded growth)', () => {
      const l = resolveLayout(768, 1024)
      expect(l.abilities.size).toBeLessThanOrEqual(64)
      expect(l.scoreSize).toBeLessThanOrEqual(34)
      const outerW = (CONTAINER.topWidth + 2 * CONTAINER.visual.bandThickness) * l.world.zoom
      expect(outerW / 768).toBeLessThanOrEqual(0.8)
    })
  })

  describe('desktop / landscape (must not regress)', () => {
    it('desktop: the claw ball never overlaps the top-center score (Phase 2.11.1 §4D)', () => {
      for (const [w, h, , composition] of SUPPORTED) {
        if (composition !== 'landscape') continue
        const l = resolveLayout(w, h)
        const scoreBottom = l.score.y + WORLD_GEOM.SCORE_DESIGN_SIZE * l.fontScale * WORLD_GEOM.SCORE_LINE
        const clawTopVp = (WORLD_GEOM.CLAW_TOP_WORST - l.world.centerY) * l.world.zoom + h / 2
        expect(clawTopVp).toBeGreaterThanOrEqual(scoreBottom + 3.5)
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
        const floorBottomVp = stageToVpY(WORLD_GEOM.FLOOR_BOTTOM, l, h)
        expect(floorBottomVp).toBeLessThanOrEqual(h + 0.001)
      }
    })

    it('desktop landscape positions match the reference composition (1648×936)', () => {
      const l = resolveLayout(1648, 936)
      expect(l.best.x).toBeCloseTo(38, 0)
      expect(l.best.y).toBeCloseTo(47, 0)
      expect(l.score.x).toBeCloseTo(824, 0)
      expect(l.tiers.kind).toBe('ring')
      expect(l.tiers.cx!).toBeLessThan(300)
      expect(l.tiers.cy!).toBeGreaterThan(600)
      expect(l.tiers.cx!).toBeGreaterThan(l.tiers.r!)
      expect(l.abilities.startX).toBeGreaterThan(1000)
      expect(l.abilities.startY).toBeGreaterThan(650)
      expect(l.nextBall.pos.x).toBeLessThan(300)
      expect(l.nextBall.pos.y).toBeGreaterThan(150)
      expect(l.nextBall.diameter).toBeGreaterThanOrEqual(70)
      expect(l.nextBall.diameter).toBeLessThanOrEqual(78)
      expect(l.nextBall.labelAlign).toBe('center')
      expect(l.grid.cell).toBeGreaterThanOrEqual(38)
      expect(l.grid.cell).toBeLessThanOrEqual(42)
    })
  })
})
