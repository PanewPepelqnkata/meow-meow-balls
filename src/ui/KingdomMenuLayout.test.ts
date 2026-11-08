import { describe, expect, it } from 'vitest'
import { resolveKingdomMenuLayout } from './KingdomMenuLayout'

const safe = { top: 0, right: 0, bottom: 0, left: 0 }

describe('Kingdom home throne vault compositions', () => {
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [393, 852], [430, 932], [768, 1024], [1280, 800], [1600, 900], [844, 390], [667, 375], [740, 360]] as const) {
    it(`keeps native controls and round table separate at ${width} × ${height}`, () => {
      const layout = resolveKingdomMenuLayout(width, height, safe, false)
      expect(layout.buttons.map((button) => button.label)).toEqual(['PLAY', 'LEADERBOARD', 'COLLECTION', 'STORE', 'SETTINGS', 'LOGIN'])
      for (const button of layout.buttons) {
        expect(button.w).toBeGreaterThanOrEqual(44)
        expect(button.h).toBeGreaterThanOrEqual(44)
        expect(button.x).toBeGreaterThanOrEqual(0)
        expect(button.y).toBeGreaterThanOrEqual(0)
        expect(button.x + button.w).toBeLessThanOrEqual(width)
        expect(button.y + button.h).toBeLessThanOrEqual(height)
      }
      const carousel = layout.carousel
      expect(carousel.x).toBeGreaterThanOrEqual(layout.hall.x)
      expect(carousel.y).toBeGreaterThanOrEqual(layout.hall.y)
      expect(carousel.x + carousel.w).toBeLessThanOrEqual(layout.hall.x + layout.hall.w)
      expect(carousel.y + carousel.h).toBeLessThanOrEqual(layout.hall.y + layout.hall.h)
      for (const button of layout.buttons) {
        expect(carousel.x + carousel.w <= button.x || button.x + button.w <= carousel.x || carousel.y + carousel.h <= button.y || button.y + button.h <= carousel.y).toBe(true)
      }
      for (const rect of [layout.logo, layout.stats, carousel, ...layout.buttons]) {
        expect(rect.x).toBeGreaterThanOrEqual(layout.hall.x)
        expect(rect.x + rect.w).toBeLessThanOrEqual(layout.hall.x + layout.hall.w)
        expect(rect.y).toBeGreaterThanOrEqual(layout.hall.y)
        expect(rect.y + rect.h).toBeLessThanOrEqual(layout.hall.y + layout.hall.h)
      }
      for (const [index, first] of [layout.logo, layout.stats, carousel, ...layout.buttons].entries()) {
        for (const second of [layout.logo, layout.stats, carousel, ...layout.buttons].slice(index + 1)) {
          expect(first.x + first.w <= second.x || second.x + second.w <= first.x || first.y + first.h <= second.y || second.y + second.h <= first.y).toBe(true)
        }
      }
    })
  }

  it('keeps portrait safe areas and auth changes out of decorative geometry', () => {
    const safeArea = { top: 47, bottom: 34, left: 0, right: 0 }
    const guest = resolveKingdomMenuLayout(393, 852, safeArea, false)
    const member = resolveKingdomMenuLayout(393, 852, safeArea, true)
    expect(guest.logo.y).toBeGreaterThanOrEqual(47)
    expect(guest.buttons.every((button) => button.y + button.h <= 852 - 34)).toBe(true)
    expect(member.logo).toEqual(guest.logo)
    expect(member.carousel).toEqual(guest.carousel)
    expect(member.stats).toEqual(guest.stats)
    expect(member.buttons.at(-1)?.action).toBe('account')
    expect(guest.buttons.at(-1)?.action).toBe('login')
    expect(member.hall).toEqual(guest.hall)
    expect(guest.hall.y).toBeGreaterThanOrEqual(47)
  })
})
