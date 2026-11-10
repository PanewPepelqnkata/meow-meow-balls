import { describe, expect, it } from 'vitest'
import { ledgerSectionLayout, trophySectionLayout } from './KingsWardrobeLayout'

describe('compact Account section geometry', () => {
  it.each([280, 340, 390, 480, 640])('keeps trophy rows and pagers inside a %spx body', (bodyHeight) => {
    const layout = trophySectionLayout(bodyHeight, true, false)
    const short = bodyHeight < 420
    const achievementBottom = layout.achievementHeight
    const titleTop = achievementBottom + 12
    const titleBottom = titleTop + layout.titleHeight
    const achievementPagerTop = achievementBottom - layout.pagerInset - layout.pagerButtonHeight
    const titlePagerTop = titleBottom - layout.pagerInset - layout.pagerButtonHeight
    const lastAchievementRowBottom = 46 + (short ? 28 : 32) + 8
      + layout.achievementPageSize * layout.achievementRowHeight
      + (layout.achievementPageSize - 1) * (short ? 4 : 6)
    const lastTitleRowBottom = titleTop + layout.titleStartInset
      + layout.titlePageSize * layout.titleRowHeight
      + (layout.titlePageSize - 1) * layout.titleRowGap

    expect(layout.achievementHeight).toBeGreaterThan(0)
    expect(layout.titleHeight).toBeGreaterThan(0)
    expect(titleBottom).toBe(bodyHeight)
    expect(layout.achievementRowHeight).toBeGreaterThanOrEqual(28)
    expect(layout.titleRowHeight).toBeGreaterThanOrEqual(36)
    expect(layout.titleActionHeight).toBeGreaterThanOrEqual(28)
    expect(lastAchievementRowBottom).toBeLessThanOrEqual(achievementPagerTop)
    expect(lastTitleRowBottom).toBeLessThanOrEqual(titlePagerTop)
    expect(titlePagerTop + layout.pagerButtonHeight).toBeLessThanOrEqual(titleBottom)
  })

  it.each([
    [280, false],
    [340, true],
    [390, false],
    [520, true],
  ] as const)('keeps passport metadata and actions inside a %spx body', (bodyHeight, registered) => {
    const layout = ledgerSectionLayout(bodyHeight, true, false, registered)
    const buttonHeight = 38
    const actionBottom = layout.actionTopOffset + buttonHeight
    const metadataBottom = layout.metadataStartOffset + 30

    expect(layout.passportHeight + 12 + layout.statisticsHeight).toBe(bodyHeight)
    expect(layout.actionTopOffset - layout.metadataStartOffset).toBeGreaterThanOrEqual(31)
    expect(metadataBottom).toBeLessThanOrEqual(layout.actionTopOffset)
    expect(actionBottom).toBeLessThanOrEqual(layout.passportHeight)
    expect(layout.statisticsHeight).toBeGreaterThan(80)
  })

  it('preserves the wide side-by-side section heights', () => {
    expect(trophySectionLayout(700, false, true)).toEqual(expect.objectContaining({
      achievementHeight: 700,
      titleHeight: 700,
      achievementPageSize: 4,
      titlePageSize: 5,
    }))
    expect(ledgerSectionLayout(700, false, true, true).passportHeight).toBe(700)
    expect(ledgerSectionLayout(700, false, true, true).statisticsHeight).toBe(700)
  })
})
