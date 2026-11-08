import type { SafeArea } from './ResponsiveLayout'

export type KingdomNavAction = 'play' | 'leaderboard' | 'collection' | 'store' | 'settings' | 'login' | 'account'
export interface KingdomRect { x: number; y: number; w: number; h: number }
export interface KingdomNavItem extends KingdomRect {
  action: KingdomNavAction
  label: string
  compact: boolean
}
export interface KingdomMenuLayout {
  width: number
  height: number
  desktop: boolean
  /** Bounds of the painted Throne Vault Hall backdrop. */
  hall: KingdomRect
  logo: KingdomRect
  stats: KingdomRect
  carousel: KingdomRect
  buttons: KingdomNavItem[]
}

const bound = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const centered = (cx: number, y: number, w: number, h: number): KingdomRect => ({ x: Math.round(cx - w / 2), y: Math.round(y), w: Math.round(w), h: Math.round(h) })

/** Three quiet zones: vault title, a Round Table showcase, then native navigation. */
export function resolveKingdomMenuLayout(width: number, height: number, safe: SafeArea, authenticated: boolean): KingdomMenuLayout {
  const desktop = width >= 640 && width > height * 1.15
  const left = Math.max(8, safe.left + 6)
  const right = Math.max(8, safe.right + 6)
  const top = Math.max(8, safe.top + 4)
  const bottom = Math.max(12, safe.bottom + 8)
  const hallW = Math.min(width - left - right, 1380)
  const hall = centered(left + (width - left - right) / 2, top, hallW, height - top - bottom)
  const inset = Math.max(18, Math.min(hall.w * 0.035, 34))
  const innerLeft = hall.x + inset
  const innerRight = hall.x + hall.w - inset
  const innerW = innerRight - innerLeft
  const cx = (innerLeft + innerRight) / 2
  const items: Array<Pick<KingdomNavItem, 'action' | 'label'>> = [
    { action: 'leaderboard', label: 'LEADERBOARD' },
    { action: 'collection', label: 'COLLECTION' },
    { action: 'store', label: 'STORE' },
    { action: 'settings', label: 'SETTINGS' },
    { action: authenticated ? 'account' : 'login', label: authenticated ? 'ACCOUNT' : 'LOGIN' },
  ]
  const logoRatio = 156 / 360
  if (desktop) {
    const short = height < 540
    if (short) {
      // Ultra-short landscape phone fallback (e.g. 667×375, 844×390): compact two-column symmetrical stage
      const leftCX = innerLeft + innerW * 0.27
      const rightCX = innerLeft + innerW * 0.74
      const colW = Math.min(innerW * 0.46, 380)
      const logoW = Math.min(colW * 0.78, height * 0.38)
      const logo = centered(leftCX, hall.y + 6, logoW, logoW * logoRatio)
      const stats = centered(leftCX, logo.y + logo.h + 4, colW, 44)
      const navH = 44
      const playH = 48
      const gap = 6
      const startY = stats.y + stats.h + 6
      const cellW = Math.floor((colW - 8) / 2)
      const buttons: KingdomNavItem[] = [
        { ...centered(leftCX, startY, colW, playH), action: 'play', label: 'PLAY', compact: false },
      ]
      items.forEach((item, index) => {
        const row = Math.floor(index / 2)
        const isLast = index === 4
        const x = isLast ? leftCX : leftCX - colW / 2 + cellW / 2 + (index % 2) * (cellW + 8)
        const y = startY + playH + gap + row * (navH + gap)
        buttons.push({ ...centered(x, y, isLast ? Math.max(140, Math.round(colW * 0.62)) : cellW, navH), ...item, compact: true })
      })
      const maxCarouselH = Math.min(hall.h - 20, (innerW * 0.44) * 1.15, 340)
      const carouselW = Math.round(maxCarouselH / 1.15)
      const carousel = centered(rightCX, hall.y + (hall.h - maxCarouselH) / 2, carouselW, maxCarouselH)
      return { width, height, desktop, hall, logo, stats, carousel, buttons }
    }

    // 1. Royal Carpet Centerpiece (Symmetrical Stage) for Desktop:
    // Top-center Logo + Stats plaque -> Center-stage Round Table on the crimson carpet -> Hero PLAY button -> 5-button Royal Dock
    const topPad = Math.max(8, Math.round(hall.h * 0.018))
    const logoW = bound(Math.min(innerW * 0.3, height * 0.31), 210, 320)
    const logoH = Math.round(logoW * logoRatio)
    const logo = centered(cx, hall.y + topPad, logoW, logoH)

    const statsH = bound(Math.round(height * 0.064), 46, 54)
    const statsW = Math.min(innerW * 0.56, 480)
    const stats = centered(cx, logo.y + logo.h + 6, statsW, statsH)

    const dockGap = bound(Math.round(innerW * 0.012), 8, 14)
    const dockH = bound(Math.round(height * 0.066), 46, 56)
    const maxDockW = Math.min(innerW, 1080)
    const dockBtnW = Math.max(44, Math.floor((maxDockW - dockGap * 4) / 5))
    const totalDockW = dockBtnW * 5 + dockGap * 4
    const dockY = hall.y + hall.h - dockH - Math.max(8, Math.round(hall.h * 0.016))

    const playH = bound(Math.round(height * 0.082), 54, 68)
    const playW = bound(Math.round(totalDockW * 0.36), 260, 360)
    const playY = dockY - playH - Math.max(8, Math.round(hall.h * 0.016))

    const buttons: KingdomNavItem[] = [
      { ...centered(cx, playY, playW, playH), action: 'play', label: 'PLAY', compact: false },
    ]
    const dockStartLeft = Math.round(cx - totalDockW / 2)
    items.forEach((item, index) => {
      const bx = dockStartLeft + index * (dockBtnW + dockGap) + dockBtnW / 2
      buttons.push({ ...centered(bx, dockY, dockBtnW, dockH), ...item, compact: dockBtnW < 185 })
    })

    const stageTop = stats.y + stats.h + 8
    const stageBottom = playY - 8
    const availH = Math.max(120, stageBottom - stageTop)
    const carouselH = Math.min(availH, Math.round(innerW * 0.45), 420)
    const carouselW = Math.min(innerW - 20, Math.round(carouselH * 1.12))
    const carousel = centered(cx, stageTop + (availH - carouselH) / 2, carouselW, carouselH)
    return { width, height, desktop, hall, logo, stats, carousel, buttons }
  }

  // Portrait / Tablet Symmetrical Stage: Top Logo + Stats -> Center Round Table -> PLAY + 2×2 Grid + Account
  const short = height < 720
  const logoW = Math.min(innerW * 0.86, 296, height * (short ? 0.25 : 0.29))
  const logo = centered(cx, hall.y + Math.min(height * 0.025, 22), logoW, logoW * logoRatio)
  const stats = centered(cx, logo.y + logo.h + 6, Math.min(innerW, 410), short ? 46 : 50)
  const navW = Math.min(innerW, 400)
  const gap = short ? 6 : 8
  const navH = short ? 44 : 48
  const playH = short ? 54 : 60
  const accountH = 44
  const stackH = playH + 8 + navH * 2 + gap + 8 + accountH
  const startY = hall.y + hall.h - 6 - stackH
  const buttons: KingdomNavItem[] = [{ ...centered(cx, startY, navW, playH), action: 'play', label: 'PLAY', compact: false }]
  const cellW = Math.floor((navW - 10) / 2)
  items.slice(0, 4).forEach((item, index) => buttons.push({
    ...centered(cx - navW / 2 + cellW / 2 + (index % 2) * (cellW + 10), startY + playH + 8 + Math.floor(index / 2) * (navH + gap), cellW, navH),
    ...item,
    compact: true,
  }))
  buttons.push({ ...centered(cx, startY + stackH - accountH, Math.min(navW * 0.68, 244), accountH), ...items[4]!, compact: true })
  const carouselTop = stats.y + stats.h + 8
  const availH = Math.max(100, startY - carouselTop - 12)
  const carouselH = Math.max(1, Math.min(availH, innerW * 0.92, 420))
  const carouselW = Math.min(innerW, Math.round(carouselH * 1.06))
  const carousel = centered(cx, carouselTop + Math.max(0, (availH - carouselH) / 2), carouselW, carouselH)
  return { width, height, desktop, hall, logo, stats, carousel, buttons }
}
