export interface TrophySectionLayout {
  achievementHeight: number
  titleHeight: number
  achievementPageSize: number
  titlePageSize: number
  pagerButtonHeight: number
  pagerInset: number
  achievementRowHeight: number
  titleRowHeight: number
  titleActionHeight: number
  titleStartInset: number
  titleBottomInset: number
  titleRowGap: number
}

export function trophySectionLayout(bodyHeight: number, compact: boolean, wide: boolean): TrophySectionLayout {
  const sectionGap = 12
  const shortCompact = compact && !wide && bodyHeight < 420
  const usableHeight = Math.max(0, bodyHeight - sectionGap)
  const achievementHeight = wide
    ? bodyHeight
    : Math.floor(usableHeight * (shortCompact ? 0.62 : bodyHeight < 560 ? 0.52 : 0.58))
  const titleHeight = wide ? bodyHeight : Math.max(0, bodyHeight - achievementHeight - sectionGap)
  const pagerButtonHeight = shortCompact ? 28 : compact ? 32 : 36
  const pagerInset = shortCompact ? 4 : 10
  const achievementPageSize = wide ? 4 : shortCompact ? (bodyHeight < 300 ? 1 : 2) : 3
  const titlePageSize = wide ? 5 : shortCompact ? 1 : bodyHeight < 560 ? 2 : 3
  const categoryButtonHeight = compact ? 28 : 32
  const achievementListTop = 46 + categoryButtonHeight + 8
  const achievementListBottom = Math.max(achievementListTop, achievementHeight - pagerButtonHeight - pagerInset - 6)
  const achievementRowGap = shortCompact ? 4 : 6
  const achievementRowHeight = Math.max(0, Math.floor(
    (achievementListBottom - achievementListTop - achievementRowGap * (achievementPageSize - 1)) / achievementPageSize,
  ))
  const titleStartInset = shortCompact ? 28 : 46
  const titleBottomInset = pagerInset + 6
  const titleRowGap = shortCompact ? 4 : 6
  const titleRowHeight = Math.max(0, Math.floor(
    (titleHeight - titleStartInset - pagerButtonHeight - titleBottomInset - titleRowGap * (titlePageSize - 1)) / titlePageSize,
  ))
  return {
    achievementHeight,
    titleHeight,
    achievementPageSize,
    titlePageSize,
    pagerButtonHeight,
    pagerInset,
    achievementRowHeight,
    titleRowHeight,
    titleActionHeight: Math.min(34, Math.max(0, titleRowHeight - 8)),
    titleStartInset,
    titleBottomInset,
    titleRowGap,
  }
}

export interface LedgerSectionLayout {
  passportHeight: number
  statisticsHeight: number
  metadataStartOffset: number
  metadataHeight: number
  actionTopOffset: number
}

export function ledgerSectionLayout(
  bodyHeight: number,
  compact: boolean,
  wide: boolean,
  registered: boolean,
): LedgerSectionLayout {
  const gap = 12
  const shortCompact = compact && !wide && bodyHeight < 420
  const buttonHeight = compact ? 38 : 44
  const actionBlockHeight = wide && registered ? buttonHeight * 2 + 10 : buttonHeight
  const actionBottomInset = shortCompact ? 8 : 14
  const metadataStartOffset = 48 + (compact ? 54 : 64) + (compact ? 8 : 12)
  const requiredPassportHeight = metadataStartOffset + 31 + actionBlockHeight + actionBottomInset
  const passportHeight = Math.max(
    wide ? bodyHeight : Math.min(226, bodyHeight - gap - 81, Math.floor((bodyHeight - gap) * (compact ? 0.46 : 0.37))),
    requiredPassportHeight,
  )
  const statisticsHeight = wide ? bodyHeight : Math.max(0, bodyHeight - passportHeight - gap)
  const actionTopOffset = passportHeight - actionBlockHeight - actionBottomInset
  const metadataHeight = Math.max(0, actionTopOffset - metadataStartOffset)
  return { passportHeight, statisticsHeight, metadataStartOffset, metadataHeight, actionTopOffset }
}
