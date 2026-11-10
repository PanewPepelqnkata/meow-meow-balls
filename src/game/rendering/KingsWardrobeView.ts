import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import {
  CONTAINER_SKIN_CATALOG,
  CONTAINER_SKIN_IDS,
  type ContainerSkinId,
} from '../../config/containerSkins'
import {
  WARDROBE_CHARACTERS,
  buildFallbackOverviewFromSave,
  formatPlaytime,
  getCharacterVariantFromSave,
  getTitleNameById,
  getWardrobeCharacter,
  isValidWardrobeCharacterId,
  validateRoyalUsername,
  type KingsWardrobeOverview,
  type PlayerAchievement,
  type WardrobeCharacter,
} from '../../config/kingsWardrobe'
import { authService } from '../../services/auth'
import { AuthModal } from '../../ui/AuthModal'
import { ChunkyButton, UI_COLORS } from '../../ui/DesignSystem'
import { readSafeArea } from '../../ui/ResponsiveLayout'
import { hudText } from '../../ui/Typography'
import { loadSave } from '../state/save'
import {
  INK,
  ballLookFor,
  ballOutlineWidth,
  drawBallFace,
  drawCollectibleBall,
  restContour,
} from './BallAppearance'
import { drawCoin, formatCoins } from './Coin'
import { bakeCanvas } from './RoughArt'
import { cycleColor } from './rgbCycle'
import { ledgerSectionLayout, trophySectionLayout } from './KingsWardrobeLayout'

export type WardrobeTab = 'mirror' | 'avatars' | 'trophies' | 'ledger'

const INK_HEX = '#111625'
const WOOD_DARK = 0x3d1c0a
const WOOD_MID = 0x6e3516
const PARCHMENT = 0xfff9ec
const PARCHMENT_CARD = 0xf8edd6
const PARCHMENT_DARK = 0xefe0c2
const PARCHMENT_EDGE = 0xc8b084
const VELVET_RED = 0x9e2434
const VELVET_PURPLE = 0x2d1d42
const ROYAL_GOLD = 0xffce42
const ROYAL_GOLD_DARK = 0xb58326
const BTN_EMERALD = 0x3ca72b
const BTN_EMERALD_SHADOW = 0x27741b
const BTN_EMERALD_HIGHLIGHT = 0x62cb49
const BODY_FONT = 'Nunito, ui-rounded, system-ui, sans-serif'

/**
 * Clean, high-contrast body text in Nunito ExtraBold (no heavy comic stroke)
 * for secondary labels, descriptions, and metadata.
 */
function bodyText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: {
    color: string
    size: number
    origin?: [number, number]
    weight?: '700' | '800'
    strokeThickness?: number
  },
): Phaser.GameObjects.Text {
  const t = hudText(scene, x, y, text, 1, {
    color: opts.color,
    size: opts.size,
    stroke: 0,
    pad: 2,
    origin: opts.origin ?? [0.5, 0.5],
    shadow: false,
  })
  return t
    .setFontFamily(BODY_FONT)
    .setFontStyle(opts.weight ?? '800')
    .setColor(opts.color)
    .setStroke(opts.color, opts.strokeThickness ?? 0.35)
}

/**
 * Bold display text in Lilita One with a crisp dark outline for headers,
 * hero numbers, and primary titles.
 */
function displayText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: {
    color: string
    size: number
    stroke?: number
    origin?: [number, number]
    shadow?: boolean
  },
): Phaser.GameObjects.Text {
  return hudText(scene, x, y, text, 1, {
    color: opts.color,
    size: opts.size,
    stroke: opts.stroke ?? 3,
    origin: opts.origin ?? [0.5, 0.5],
    shadow: opts.shadow ?? true,
  })
}

/**
 * Renders any canonical Ball Rush character (Tiers 1–10) at (cx, cy) with
 * proportional visual weight. Tier 9 (Shark/Pig/Drunko/Robo/Pirate) uses 0.84*r
 * and Tier 10 (Crab) uses 0.78*r so claws, fins, and hats fill the frame
 * proportionally alongside core slime balls.
 */
export function renderWardrobeBallCharacter(
  scene: Phaser.Scene,
  g: Phaser.GameObjects.Graphics,
  characterId: string,
  cx: number,
  cy: number,
  r: number,
  opts: {
    locked?: boolean
    blink?: boolean
    variant?: number
    layer?: Phaser.GameObjects.Container
  } = {},
): void {
  const char = getWardrobeCharacter(characterId)
  const tier = char.tier
  const seed = char.seed
  const t = getTier(tier)
  if (!t) return

  if (!opts.locked && char.theme && (tier === 9 || tier === 10)) {
    const iconR = r * (tier === 10 ? 0.78 : 0.84)
    drawCollectibleBall(
      g,
      cx,
      cy,
      iconR,
      tier,
      opts.variant ?? 0,
      undefined,
      0,
      undefined,
      seed,
      char.theme,
      0,
      undefined,
      true,
    )
    return
  }

  const look = ballLookFor(tier, seed)
  const poly = restContour(look, r, cx, cy, 32)
  const pts = poly.map((p) => new Phaser.Math.Vector2(p.x, p.y))

  if (opts.locked) {
    g.fillStyle(0x232433, 0.94)
    g.fillPoints(pts, true)
    g.lineStyle(ballOutlineWidth(r), INK, 1)
    g.strokePoints(pts, true, true)
    if (opts.layer) {
      const q = displayText(scene, cx, cy + 1, '?', {
        color: '#7c84a6',
        size: Math.max(13, Math.round(r * 1.08)),
        stroke: 2.5,
        origin: [0.5, 0.5],
        shadow: false,
      })
      opts.layer.add(q)
    }
    return
  }

  g.fillStyle(tier === 8 ? cycleColor(Date.now()) : t.color, 1)
  g.fillPoints(pts, true)
  g.lineStyle(ballOutlineWidth(r), INK, 1)
  g.strokePoints(pts, true, true)
  const faceLook = opts.blink ? { ...look, eyeH: look.eyeH * 0.12 } : look
  drawBallFace(g, faceLook, { x: cx, y: cy }, r, 1, undefined, true)
}

function drawPointedArch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x, y + w * 0.68)
  ctx.bezierCurveTo(x, y + w * 0.32, x + w * 0.3, y + w * 0.15, x + w / 2, y)
  ctx.bezierCurveTo(x + w * 0.7, y + w * 0.15, x + w, y + w * 0.32, x + w, y + w * 0.68)
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
}

/**
 * Full-bleed "Royal Archive & Trophy Hall" background scene matching the
 * Main Menu Throne Vault Hall art direction.
 */
function paintRoyalArchiveHall(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save()
  ctx.lineJoin = 'round'

  // 1. Deep royal stone & twilight vault gradient
  const wall = ctx.createLinearGradient(0, 0, 0, h)
  wall.addColorStop(0, '#161224')
  wall.addColorStop(0.45, '#3b2c4e')
  wall.addColorStop(0.75, '#2b223d')
  wall.addColorStop(1, '#181426')
  ctx.fillStyle = wall
  ctx.fillRect(0, 0, w, h)

  const horizon = Math.round(h * 0.72)

  // 2. Ashlar stone courses on the upper wall
  ctx.lineWidth = 1
  const courseCount = 9
  const courseH = (horizon - h * 0.08) / courseCount
  for (let row = 0; row < courseCount; row++) {
    const y = Math.round(h * 0.08 + row * courseH)
    ctx.strokeStyle = 'rgba(14, 11, 24, 0.42)'
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
    const blockW = Math.max(56, Math.round(w / 11))
    for (let x = (row % 2 ? -0.5 : 0) * blockW; x < w; x += blockW) {
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x, y + courseH)
      ctx.stroke()
    }
  }

  // 3. Hammerbeam timber ceiling rafters at top
  ctx.fillStyle = '#140f1f'
  ctx.fillRect(0, 0, w, h * 0.085)
  ctx.fillStyle = '#3d2820'
  ctx.fillRect(0, h * 0.075, w, Math.max(8, h * 0.014))
  ctx.fillStyle = '#c8963e'
  ctx.fillRect(0, h * 0.075, w, 2)

  // 4. Stained-glass lancet windows on left and right wings
  const desktop = w >= 720
  const winW = desktop ? Math.min(96, w * 0.09) : Math.min(62, w * 0.14)
  const winH = desktop ? Math.min(240, h * 0.34) : Math.min(170, h * 0.24)
  const winY = Math.max(68, h * 0.12)
  const winXs = desktop ? [w * 0.08, w * 0.92] : [w * 0.11, w * 0.89]
  const stainedPalette = ['#b8336a', '#3c2b59', '#e0a938', '#4a7c9b', '#9e2434', '#d4af37']

  winXs.forEach((cx, idx) => {
    const x = cx - winW / 2
    drawPointedArch(ctx, x - 6, winY - 6, winW + 12, winH + 14)
    ctx.fillStyle = '#231c30'
    ctx.fill()
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 3.5
    ctx.stroke()

    ctx.save()
    drawPointedArch(ctx, x, winY, winW, winH)
    ctx.clip()
    ctx.fillStyle = '#c88d48'
    ctx.fillRect(x, winY, winW, winH)
    const rows = 7
    const cols = 3
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = x + (c * winW) / cols
        const ty = winY + (r * winH) / rows
        ctx.fillStyle = stainedPalette[(r + c * 2 + idx) % stainedPalette.length]!
        ctx.fillRect(tx, ty, winW / cols + 0.5, winH / rows + 0.5)
        ctx.strokeStyle = INK_HEX
        ctx.lineWidth = 1.3
        ctx.strokeRect(tx, ty, winW / cols, winH / rows)
      }
    }
    const sheen = ctx.createLinearGradient(x, winY, x + winW, winY + winH)
    sheen.addColorStop(0, 'rgba(255, 245, 200, 0.38)')
    sheen.addColorStop(0.6, 'rgba(255, 225, 150, 0.12)')
    sheen.addColorStop(1, 'rgba(255, 210, 120, 0.02)')
    ctx.fillStyle = sheen
    ctx.fillRect(x, winY, winW, winH)
    ctx.restore()

    // Diagonal warm sunbeam shafts from stained-glass windows
    ctx.save()
    const beamGrad = ctx.createLinearGradient(
      cx,
      winY + winH * 0.3,
      w * 0.5,
      horizon + (h - horizon) * 0.5,
    )
    beamGrad.addColorStop(0, 'rgba(255, 232, 166, 0.16)')
    beamGrad.addColorStop(0.65, 'rgba(255, 214, 120, 0.05)')
    beamGrad.addColorStop(1, 'rgba(255, 214, 120, 0)')
    ctx.fillStyle = beamGrad
    ctx.beginPath()
    ctx.moveTo(x, winY + winH * 0.25)
    ctx.lineTo(x + winW, winY + winH * 0.15)
    ctx.lineTo(cx + (idx === 0 ? w * 0.28 : -w * 0.12), h)
    ctx.lineTo(cx + (idx === 0 ? w * 0.06 : -w * 0.32), h)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  })

  // 5. Perspective marble floor below horizon
  const floorGrad = ctx.createLinearGradient(0, horizon, 0, h)
  floorGrad.addColorStop(0, '#2a2238')
  floorGrad.addColorStop(1, '#191324')
  ctx.fillStyle = floorGrad
  ctx.fillRect(0, horizon, w, h - horizon)

  const tileRows = 7
  const nearScale = w * 0.11
  for (let r = 0; r < tileRows; r++) {
    const p0 = r / tileRows
    const p1 = (r + 1) / tileRows
    const d0 = 0.16 + p0 * p0 * 0.84
    const d1 = 0.16 + p1 * p1 * 0.84
    const y0 = horizon + (h - horizon) * p0 * p0
    const y1 = horizon + (h - horizon) * p1 * p1
    for (let col = -24; col < 24; col++) {
      const x0 = w / 2 + col * nearScale * d0
      const x1 = w / 2 + (col + 1) * nearScale * d0
      const x2 = w / 2 + (col + 1) * nearScale * d1
      const x3 = w / 2 + col * nearScale * d1
      if (Math.max(x1, x2) < 0 || Math.min(x0, x3) > w) continue
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y0)
      ctx.lineTo(x2, y1)
      ctx.lineTo(x3, y1)
      ctx.closePath()
      ctx.fillStyle = (r + col) % 2 === 0 ? 'rgba(158, 144, 172, 0.22)' : 'rgba(42, 35, 58, 0.36)'
      ctx.fill()
    }
  }

  // Royal crimson carpet runner down the center of the floor
  ctx.beginPath()
  ctx.moveTo(w * 0.34, horizon)
  ctx.lineTo(w * 0.66, horizon)
  ctx.lineTo(w * 0.82, h)
  ctx.lineTo(w * 0.18, h)
  ctx.closePath()
  ctx.fillStyle = 'rgba(138, 28, 48, 0.45)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(214, 173, 96, 0.55)'
  ctx.lineWidth = 2.5
  ctx.stroke()

  // Baseboard dado rail at horizon
  ctx.fillStyle = '#47364f'
  ctx.fillRect(0, horizon - 5, w, 8)
  ctx.fillStyle = '#c89a42'
  ctx.fillRect(0, horizon - 5, w, 2)

  // 6. Stone pillars & crimson-and-gold royal banners flanking the hall
  const pillarXs = desktop ? [w * 0.025, w * 0.975] : [w * 0.02, w * 0.98]
  const pillarW = desktop ? 36 : 20
  for (const px of pillarXs) {
    const x0 = px - pillarW / 2
    ctx.fillStyle = '#332842'
    ctx.fillRect(x0, h * 0.075, pillarW, horizon - h * 0.075)
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 2.5
    ctx.strokeRect(x0, h * 0.075, pillarW, horizon - h * 0.075)
  }

  const bannerXs = desktop ? [w * 0.2, w * 0.8] : [w * 0.24, w * 0.76]
  const bannerW = desktop ? 44 : 30
  const bannerH = desktop ? 118 : 82
  const bannerY = Math.round(h * 0.08)
  for (const bx of bannerXs) {
    const x0 = bx - bannerW / 2
    ctx.fillStyle = '#8d2236'
    ctx.beginPath()
    ctx.moveTo(x0, bannerY)
    ctx.lineTo(x0 + bannerW, bannerY)
    ctx.lineTo(x0 + bannerW, bannerY + bannerH - 18)
    ctx.lineTo(bx, bannerY + bannerH)
    ctx.lineTo(x0, bannerY + bannerH - 18)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#e5b84b'
    ctx.lineWidth = 2.2
    ctx.stroke()
    // Gold cross rod
    ctx.fillStyle = '#d6a640'
    ctx.fillRect(x0 - 5, bannerY - 3, bannerW + 10, 5)
  }

  // Soft radial vignette so the center cards pop with high contrast
  const vig = ctx.createRadialGradient(w / 2, h * 0.52, Math.min(w, h) * 0.2, w / 2, h * 0.52, Math.max(w, h) * 0.75)
  vig.addColorStop(0, 'rgba(18, 12, 28, 0.08)')
  vig.addColorStop(1, 'rgba(10, 8, 18, 0.58)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)

  ctx.restore()
}

export class KingsWardrobeView {
  private readonly root: Phaser.GameObjects.Container
  private readonly bgLayer: Phaser.GameObjects.Container
  private readonly dustLayer: Phaser.GameObjects.Graphics
  private readonly tabLayer: Phaser.GameObjects.Container
  private readonly contentLayer: Phaser.GameObjects.Container
  private readonly toastLayer: Phaser.GameObjects.Container
  private activeTab: WardrobeTab = 'mirror'
  private overview: KingsWardrobeOverview
  private inspectCharId: string = 'core:1'
  private trophyCategory: 'all' | 'gameplay' | 'merge' | 'collection' | 'score' | 'milestone' = 'all'
  private trophyPage = 0
  private titlePage = 0
  private destroyed = false
  private requestSeq = 0
  private animTimer: Phaser.Time.TimerEvent | null = null
  private liveRedraws: Array<(timeMs: number) => void> = []
  private domOverlay: HTMLDivElement | null = null
  private readonly dustMotes: Array<{ x: number; y: number; r: number }> = []

  constructor(
    private readonly scene: Phaser.Scene,
    parentContainer: Phaser.GameObjects.Container,
    private readonly vw: number,
    private readonly vh: number,
    private readonly topY: number,
    private readonly onAuthChanged?: () => void,
    initialTab: WardrobeTab = 'mirror',
  ) {
    this.activeTab = initialTab
    this.overview = buildFallbackOverviewFromSave(loadSave(), authService.getProfile())
    this.inspectCharId = this.overview.profile.selected_avatar_id || 'core:1'

    // Full-screen background layer inserted at index 0 of parentContainer
    // so the screen header (BACK + ACCOUNT) sits directly over the Royal Archive Hall.
    this.bgLayer = scene.add.container(0, 0).setName('account-hall-bg')
    parentContainer.addAt(this.bgLayer, 0)

    this.root = scene.add.container(0, 0).setName('kings-wardrobe')
    parentContainer.add(this.root)

    this.dustLayer = scene.add.graphics()
    this.bgLayer.add(this.dustLayer)

    this.tabLayer = scene.add.container(0, 0)
    this.contentLayer = scene.add.container(0, 0)
    this.toastLayer = scene.add.container(0, 0)
    this.root.add([this.tabLayer, this.contentLayer, this.toastLayer])

    for (let i = 0; i < 18; i++) {
      this.dustMotes.push({
        x: ((i * 137) % 100) / 100 * this.vw,
        y: ((i * 293) % 100) / 100 * this.vh,
        r: 1 + (i % 3) * 0.45,
      })
    }
    this.renderBackdrop()
    for (const mote of this.dustMotes) {
      this.dustLayer.fillStyle(0xffe9a6, 0.08)
      this.dustLayer.fillCircle(mote.x, mote.y, mote.r)
    }
    this.renderTabs()
    this.renderActiveTab()
    void this.refreshOverview()

    this.root.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.cleanup()
    })
  }

  public getActiveTab(): WardrobeTab {
    return this.activeTab
  }

  public setTab(tab: WardrobeTab): void {
    if (this.destroyed || this.activeTab === tab) return
    this.stopAnimationTimer()
    this.activeTab = tab
    this.renderTabs()
    this.renderActiveTab()
    this.startAnimationTimer()
  }

  public destroy(): void {
    if (this.destroyed) return
    this.cleanup()
    this.bgLayer.destroy()
    this.root.destroy()
  }

  private cleanup(): void {
    this.destroyed = true
    this.requestSeq++
    this.stopAnimationTimer()
    this.liveRedraws.length = 0
    this.closeDomModal()
  }

  private startAnimationTimer(): void {
    if (this.destroyed || this.activeTab !== 'mirror' || this.animTimer !== null || this.liveRedraws.length === 0) return
    this.animTimer = this.scene.time.addEvent({
      delay: 60,
      loop: true,
      callback: () => {
        if (this.destroyed || this.activeTab !== 'mirror') return
        const now = Date.now()
        for (const fn of this.liveRedraws) fn(now)
      },
    })
  }

  private stopAnimationTimer(): void {
    this.animTimer?.remove(false)
    this.animTimer = null
  }

  private async refreshOverview(): Promise<void> {
    const seq = ++this.requestSeq
    let data: KingsWardrobeOverview | null = null
    let loadError: Error | null = null
    try {
      const result = await authService.getKingsWardrobeOverview()
      data = result.data
      loadError = result.error
    } catch (error) {
      loadError = error instanceof Error ? error : new Error(String(error))
    }
    if (this.destroyed || seq !== this.requestSeq) return
    if (loadError) {
      this.showToast(`Could not load account data: ${loadError.message}`, 'error')
      return
    }
    if (!data) {
      this.showToast('Could not load account data: the server returned no overview.', 'error')
      return
    }
    this.overview = data
    if (!isValidWardrobeCharacterId(this.inspectCharId)) {
      this.inspectCharId = data.profile.selected_avatar_id || 'core:1'
    }
    this.renderTabs()
    this.renderActiveTab()
  }
  private async runAccountAction(action: () => Promise<{ error: Error | null }>, fallback: string): Promise<Error | null> {
    try {
      const result = await action()
      if (result.error) this.showToast(result.error.message, 'error')
      return result.error
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(fallback)
      this.showToast(failure.message || fallback, 'error')
      return failure
    }
  }


  private showToast(message: string, kind: 'success' | 'error' = 'success'): void {
    if (this.destroyed) return
    this.toastLayer.removeAll(true)
    const cx = this.vw / 2
    const y = this.topY + 26
    const w = Math.min(480, this.vw - 32)
    const h = 42
    const g = this.scene.add.graphics()
    g.fillStyle(kind === 'success' ? 0x1e6f3d : 0x9b2c2c, 0.98)
    g.fillRoundedRect(cx - w / 2, y - h / 2, w, h, 12)
    g.lineStyle(2.5, kind === 'success' ? 0x7ae582 : 0xff8a8a, 1)
    g.strokeRoundedRect(cx - w / 2, y - h / 2, w, h, 12)
    const t = displayText(this.scene, cx, y, message, {
      color: '#ffffff',
      size: 14,
      stroke: 2.5,
      origin: [0.5, 0.5],
    })
    t.setScale(Math.min(1, (w - 28) / Math.max(1, t.width)))
    this.toastLayer.add([g, t])
    this.scene.time.delayedCall(2600, () => {
      if (!this.destroyed) this.toastLayer.removeAll(true)
    })
  }

  private getLayoutBounds() {
    const safe = readSafeArea()
    const margin = this.vw < 600 ? 10 : 20
    const left = Math.max(margin, safe.left + 8)
    const right = Math.max(margin, safe.right + 8)
    const bottom = Math.max(margin, safe.bottom + 10)
    const maxW = Math.min(1100, this.vw - left - right)
    const panelX = Math.round(left + (this.vw - left - right - maxW) / 2)
    const panelY = Math.round(this.topY + 2)
    const panelH = Math.max(340, Math.round(this.vh - bottom - panelY))
    const tabBarH = this.vw < 520 ? 48 : 54
    const bodyY = panelY + tabBarH + 10
    const bodyH = panelH - tabBarH - 18
    return {
      panelX,
      panelY,
      panelW: maxW,
      panelH,
      tabBarH,
      bodyX: panelX + 12,
      bodyY,
      bodyW: maxW - 24,
      bodyH,
      compact: this.vw < 640 || this.vh < 720,
      wide: maxW >= 740 && this.vw > this.vh * 0.95,
    }
  }

  private renderBackdrop(): void {
    // Remove previous baked hall image if any (keep dustLayer)
    for (const child of [...this.bgLayer.list]) {
      if (child !== this.dustLayer) child.destroy()
    }
    const w = Math.max(1, Math.ceil(this.vw))
    const h = Math.max(1, Math.ceil(this.vh))
    const key = `br-account-archive-hall:${w}:${h}`
    bakeCanvas(this.scene, key, w, h, (ctx) => {
      paintRoyalArchiveHall(ctx, w, h)
    }, window.devicePixelRatio || 1)

    const hallImg = this.scene.add.image(0, 0, key).setOrigin(0, 0).setDisplaySize(w, h)
    this.bgLayer.addAt(hallImg, 0)

    // Subtle carved frame around the Account workspace area
    const b = this.getLayoutBounds()
    const frameG = this.scene.add.graphics()
    frameG.fillStyle(0x130d21, 0.58)
    frameG.fillRoundedRect(b.panelX, b.panelY, b.panelW, b.panelH, 18)
    frameG.lineStyle(3, INK, 0.95)
    frameG.strokeRoundedRect(b.panelX, b.panelY, b.panelW, b.panelH, 18)
    frameG.lineStyle(1.8, ROYAL_GOLD_DARK, 0.85)
    frameG.strokeRoundedRect(b.panelX + 3, b.panelY + 3, b.panelW - 6, b.panelH - 6, 15)
    this.bgLayer.add(frameG)
  }

  private renderTabs(): void {
    this.tabLayer.removeAll(true)
    const b = this.getLayoutBounds()
    const tabs: Array<{ id: WardrobeTab; label: string; shortLabel: string }> = [
      { id: 'mirror', label: 'PROFILE & CREST', shortLabel: 'PROFILE' },
      { id: 'avatars', label: 'AVATARS & FAVORITES', shortLabel: 'AVATARS' },
      { id: 'trophies', label: 'TROPHIES & TITLES', shortLabel: 'TROPHIES' },
      { id: 'ledger', label: 'STATS & ACCOUNT', shortLabel: 'STATS' },
    ]
    const gap = b.compact ? 6 : 10
    const tabW = Math.floor((b.bodyW - gap * (tabs.length - 1)) / tabs.length)
    const tabH = b.tabBarH - 8
    const y = b.panelY + 8 + tabH / 2

    tabs.forEach((t, idx) => {
      const x = b.bodyX + idx * (tabW + gap) + tabW / 2
      const active = this.activeTab === t.id
      const btn = new ChunkyButton({
        scene: this.scene,
        x,
        y,
        w: tabW,
        h: tabH,
        label: b.panelW < 640 ? t.shortLabel : t.label,
        fontSize: b.panelW < 430 ? 12 : b.panelW < 700 ? 13 : 14,
        fill: active ? UI_COLORS.BTN_GOLD : 0x3b2a54,
        shadowColor: active ? UI_COLORS.BTN_GOLD_SHADOW : 0x1e142d,
        highlightColor: active ? UI_COLORS.BTN_GOLD_HIGHLIGHT : 0x563f78,
        textColor: active ? '#fffdf5' : '#e2d6f5',
        onClick: () => this.setTab(t.id),
      })
      btn.container.setName(`wardrobe-tab-${t.id}`)
      this.tabLayer.add(btn.container)
    })
  }

  private renderActiveTab(): void {
    this.liveRedraws.length = 0
    this.contentLayer.removeAll(true)
    const b = this.getLayoutBounds()

    switch (this.activeTab) {
      case 'mirror':
        this.renderMirrorAndCardTab(b)
        break
      case 'avatars':
        this.renderAvatarsAndFavoritesTab(b)
        break
      case 'trophies':
        this.renderTrophiesAndTitlesTab(b)
        break
      case 'ledger':
        this.renderLedgerAndAccountTab(b)
        break
    }
    this.startAnimationTimer()
  }

  private drawRoyalCard(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    headerH = 36,
  ): void {
    // Deep drop shadow
    g.fillStyle(0x0c0814, 0.52)
    g.fillRoundedRect(x + 2, y + 5, w, h, 14)
    // Carved wood outer frame
    g.fillStyle(WOOD_MID, 1)
    g.fillRoundedRect(x, y, w, h, 14)
    g.lineStyle(2.5, INK, 1)
    g.strokeRoundedRect(x, y, w, h, 14)
    // Warm ivory parchment body
    g.fillStyle(PARCHMENT, 1)
    g.fillRoundedRect(x + 5, y + 5, w - 10, h - 10, 10)
    g.lineStyle(1.5, PARCHMENT_EDGE, 1)
    g.strokeRoundedRect(x + 5, y + 5, w - 10, h - 10, 10)
    if (headerH > 0) {
      g.fillStyle(WOOD_DARK, 1)
      g.fillRoundedRect(x + 5, y + 5, w - 10, headerH, { tl: 10, tr: 10, bl: 0, br: 0 })
      g.lineStyle(2, ROYAL_GOLD_DARK, 0.95)
      g.lineBetween(x + 6, y + 5 + headerH, x + w - 6, y + 5 + headerH)
    }
    // Corner brass studs
    g.fillStyle(ROYAL_GOLD, 0.9)
    for (const [cx, cy] of [
      [x + 11, y + 11],
      [x + w - 11, y + 11],
      [x + 11, y + h - 11],
      [x + w - 11, y + h - 11],
    ] as const) {
      g.fillCircle(cx, cy, 2.2)
    }
  }

  private drawProgressBar(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    ratio: number,
    fillColor = BTN_EMERALD,
  ): void {
    const clamped = Phaser.Math.Clamp(ratio, 0, 1)
    const r = Math.floor(h / 2)
    g.fillStyle(0x2a1d15, 0.9)
    g.fillRoundedRect(x, y, w, h, r)
    g.lineStyle(1.2, INK, 0.85)
    g.strokeRoundedRect(x, y, w, h, r)
    if (clamped > 0.01) {
      const fillW = Math.max(h, Math.round((w - 2) * clamped))
      g.fillStyle(fillColor, 1)
      g.fillRoundedRect(x + 1, y + 1, fillW, h - 2, Math.max(2, r - 1))
      g.fillStyle(0xffffff, 0.28)
      g.fillRoundedRect(x + 2, y + 2, Math.max(2, fillW - 4), Math.max(2, Math.floor((h - 4) * 0.45)), 2)
    }
  }

  // ===========================================================================
  // TAB 1: PROFILE & CREST (Identity, Username Decree & Favorite Showcase)
  // ===========================================================================
  private renderMirrorAndCardTab(b: ReturnType<KingsWardrobeView['getLayoutBounds']>): void {
    const g = this.scene.add.graphics()
    this.contentLayer.add(g)

    const isAuthed = authService.isRegisteredAccount()
    const prof = this.overview.profile
    const displayName = prof.display_name || prof.username || 'Royal Guest'
    const activeTitleName = getTitleNameById(prof.active_title_id) ?? 'Unheralded Adventurer'
    const selectedChar = getWardrobeCharacter(prof.selected_avatar_id)
    const save = loadSave()

    const gap = 12
    const leftW = b.wide ? Math.floor((b.bodyW - gap) * 0.46) : b.bodyW
    const rightW = b.wide ? b.bodyW - leftW - gap : b.bodyW
    const leftX = b.bodyX
    const rightX = b.wide ? b.bodyX + leftW + gap : b.bodyX
    const leftH = b.wide ? b.bodyH : Math.min(208, Math.floor((b.bodyH - gap) * 0.35))
    const rightH = b.wide ? b.bodyH : b.bodyH - leftH - gap
    const leftY = b.bodyY
    const rightY = b.wide ? b.bodyY : b.bodyY + leftH + gap

    // --- 1. PLAYER IDENTITY & USERNAME PANEL ---
    this.drawRoyalCard(g, leftX, leftY, leftW, leftH, 36)
    const mirrorHeader = displayText(this.scene, leftX + leftW / 2, leftY + 23, 'PLAYER IDENTITY', {
      color: '#ffe19a',
      size: 16,
      stroke: 3,
    })
    this.contentLayer.add(mirrorHeader)

    const mirrorCenterX = leftX + (b.wide ? leftW / 2 : Math.max(52, Math.min(72, leftW * 0.2)))
    const mirrorR = Math.max(26, Math.min(b.wide ? 46 : 32, (leftH - 70) * 0.24))
    const mirrorCenterY = leftY + (b.wide ? Math.min(118, 44 + mirrorR + 18) : 42 + (leftH - 42) * 0.48)
    g.fillStyle(ROYAL_GOLD_DARK, 1)
    g.fillCircle(mirrorCenterX, mirrorCenterY, mirrorR + 9)
    g.fillStyle(ROYAL_GOLD, 1)
    g.fillCircle(mirrorCenterX, mirrorCenterY, mirrorR + 6)
    g.lineStyle(2.5, INK, 1)
    g.strokeCircle(mirrorCenterX, mirrorCenterY, mirrorR + 8)
    g.fillStyle(VELVET_PURPLE, 1)
    g.fillCircle(mirrorCenterX, mirrorCenterY, mirrorR)
    g.lineStyle(2, 0xffe9a6, 0.9)
    g.strokeCircle(mirrorCenterX, mirrorCenterY, mirrorR)

    const mirrorAvatarContainer = this.scene.add.container(mirrorCenterX, mirrorCenterY)
    const mirrorAvatarG = this.scene.add.graphics()
    mirrorAvatarContainer.add(mirrorAvatarG)
    this.contentLayer.add(mirrorAvatarContainer)

    const avatarVariant = getCharacterVariantFromSave(save, selectedChar.id)
    const drawMirrorAvatar = (now: number) => {
      mirrorAvatarG.clear()
      const blink = Math.floor((now + selectedChar.seed * 37) / 140) % 24 === 0
      const breathe = 1 + Math.sin(now * 0.003) * 0.025
      mirrorAvatarContainer.setScale(breathe, 2 - breathe)
      renderWardrobeBallCharacter(this.scene, mirrorAvatarG, selectedChar.id, 0, 0, mirrorR * 0.78, {
        blink,
        variant: avatarVariant,
      })
    }
    drawMirrorAvatar(Date.now())
    this.liveRedraws.push(drawMirrorAvatar)

    // Identity details block
    const infoLeftX = mirrorCenterX + mirrorR + 16
    const infoRightPad = 14
    const infoMaxW = b.wide ? leftW - 36 : Math.max(120, leftX + leftW - infoRightPad - infoLeftX)
    const infoCenterX = b.wide ? leftX + leftW / 2 : infoLeftX + infoMaxW / 2
    const nameY = b.wide ? mirrorCenterY + mirrorR + 24 : leftY + 56

    const nameText = displayText(this.scene, infoCenterX, nameY, displayName, {
      color: '#fff6d6',
      size: b.compact ? 19 : 23,
      stroke: 3.5,
    })
    nameText.setScale(Math.min(1, infoMaxW / Math.max(1, nameText.width)))
    this.contentLayer.add(nameText)

    // Active Title Ribbon
    const ribbonW = Math.min(infoMaxW, 240)
    const ribbonH = b.compact ? 24 : 26
    const ribbonY = nameY + (b.compact ? 23 : 28)
    g.fillStyle(VELVET_RED, 1)
    g.fillRoundedRect(infoCenterX - ribbonW / 2, ribbonY - ribbonH / 2, ribbonW, ribbonH, 7)
    g.lineStyle(1.8, ROYAL_GOLD, 1)
    g.strokeRoundedRect(infoCenterX - ribbonW / 2, ribbonY - ribbonH / 2, ribbonW, ribbonH, 7)

    const titleBadge = displayText(this.scene, infoCenterX, ribbonY, activeTitleName.toUpperCase(), {
      color: '#ffe596',
      size: 12,
      stroke: 2.5,
      shadow: false,
    })
    titleBadge.setScale(Math.min(1, (ribbonW - 16) / Math.max(1, titleBadge.width)))
    this.contentLayer.add(titleBadge)

    // One-time username change status & CTA
    const hasChangedUsername = Boolean(prof.username_changed_at)
    const statusLabel = !isAuthed
      ? 'Guest Mode — Sign in to claim your name'
      : hasChangedUsername
        ? 'Username Change Used (1/1 Lifetime)'
        : '1 Free Lifetime Username Change Available'
    const statusY = ribbonY + (b.compact ? 20 : 25)
    const statusT = bodyText(this.scene, infoCenterX, statusY, statusLabel, {
      color: hasChangedUsername ? '#6e563d' : '#1f6e2c',
      size: 12,
    })
    statusT.setScale(Math.min(1, infoMaxW / Math.max(1, statusT.width)))
    this.contentLayer.add(statusT)

    const btnW = Math.min(infoMaxW, b.wide ? 240 : 210)
    const btnH = b.compact ? 38 : 42
    const btnY = b.wide
      ? statusY + 34
      : Math.min(leftY + leftH - btnH / 2 - 10, statusY + 26)
    if (!isAuthed) {
      const signInBtn = new ChunkyButton({
        scene: this.scene,
        x: infoCenterX,
        y: btnY,
        w: btnW,
        h: btnH,
        label: 'SIGN IN / REGISTER',
        fontSize: 13,
        fill: UI_COLORS.BTN_BLUE,
        shadowColor: UI_COLORS.BTN_BLUE_SHADOW,
        highlightColor: UI_COLORS.BTN_BLUE_HIGHLIGHT,
        onClick: () => {
          const modal = new AuthModal(document.body)
          modal.onSuccess(() => {
            this.onAuthChanged?.()
            void this.refreshOverview()
          })
          modal.open('login')
        },
      })
      this.contentLayer.add(signInBtn.container)
    } else {
      const renameBtn = new ChunkyButton({
        scene: this.scene,
        x: infoCenterX,
        y: btnY,
        w: btnW,
        h: btnH,
        label: hasChangedUsername ? 'USERNAME LOCKED' : 'CHANGE USERNAME',
        fontSize: 13,
        disabled: hasChangedUsername,
        fill: UI_COLORS.BTN_GOLD,
        shadowColor: UI_COLORS.BTN_GOLD_SHADOW,
        highlightColor: UI_COLORS.BTN_GOLD_HIGHLIGHT,
        onClick: () => this.openUsernameChangeModal(),
      })
      renameBtn.container.setName('wardrobe-change-username-btn')
      this.contentLayer.add(renameBtn.container)
    }

    // Desktop Account Highlights & Next Milestone ledger (fills lower half of left card)
    const ledgerTopY = btnY + btnH / 2 + 16
    const ledgerAvailH = leftY + leftH - 14 - ledgerTopY
    if (b.wide && ledgerAvailH >= 108) {
      const totalAch = Math.max(1, this.overview.achievements.length)
      const unlockedBalls = this.overview.unlocked_ball_ids.length
      const totalBalls = Math.max(1, this.overview.total_available_balls)
      const nextTrophy = this.overview.achievements.find((a) => !a.unlocked)
      const nextRatio = nextTrophy
        ? (nextTrophy.current_value ?? 0) / Math.max(1, nextTrophy.target_value)
        : 1
      const rows = [
        {
          label: 'EQUIPPED AVATAR',
          value: `${selectedChar.name} (Tier ${selectedChar.tier})`,
          ratio: unlockedBalls / totalBalls,
          color: ROYAL_GOLD_DARK,
        },
        {
          label: 'COLLECTION PROGRESS',
          value: `${unlockedBalls} / ${totalBalls} Characters Unlocked`,
          ratio: unlockedBalls / totalBalls,
          color: BTN_EMERALD,
        },
        {
          label: 'NEXT TROPHY GOAL',
          value: nextTrophy ? `${nextTrophy.name} (${Math.min(nextTrophy.current_value ?? 0, nextTrophy.target_value)}/${nextTrophy.target_value})` : `All ${totalAch} Trophies Earned!`,
          ratio: nextRatio,
          color: 0x3b82f6,
        },
      ]
      const rGap = 8
      const rowH = Math.min(48, Math.floor((ledgerAvailH - rGap * (rows.length - 1)) / rows.length))
      const rx = leftX + 16
      const rw = leftW - 32
      rows.forEach((rItem, idx) => {
        const ry = ledgerTopY + idx * (rowH + rGap)
        g.fillStyle(PARCHMENT_CARD, 1)
        g.fillRoundedRect(rx, ry, rw, rowH, 8)
        g.lineStyle(1.4, PARCHMENT_EDGE, 1)
        g.strokeRoundedRect(rx, ry, rw, rowH, 8)
        const kLbl = bodyText(this.scene, rx + 10, ry + 13, rItem.label, {
          color: '#6e5236',
          size: 9,
          origin: [0, 0.5],
        })
        const vLbl = bodyText(this.scene, rx + rw - 10, ry + 13, rItem.value, {
          color: INK_HEX,
          size: 11,
          origin: [1, 0.5],
        })
        vLbl.setScale(Math.min(1, (rw * 0.62) / Math.max(1, vLbl.width)))
        this.contentLayer.add([kLbl, vLbl])
        if (rowH >= 34) {
          this.drawProgressBar(g, rx + 10, ry + rowH - 11, rw - 20, 6, rItem.ratio, rItem.color)
        }
      })
    }

    // --- 2. PLAYER CARD & FAVORITE CHAMPIONS SHOWCASE ---
    this.drawRoyalCard(g, rightX, rightY, rightW, rightH, 36)
    const cardHeader = displayText(this.scene, rightX + rightW / 2, rightY + 23, 'PLAYER CARD & FAVORITES', {
      color: '#ffe19a',
      size: 16,
      stroke: 3,
    })
    this.contentLayer.add(cardHeader)

    // Crest banner inside the right card
    const crestX = rightX + 16
    const crestY = rightY + 48
    const crestW = rightW - 32
    const crestH = b.compact ? 60 : 72
    g.fillStyle(VELVET_PURPLE, 1)
    g.fillRoundedRect(crestX, crestY, crestW, crestH, 12)
    g.lineStyle(2.2, ROYAL_GOLD, 1)
    g.strokeRoundedRect(crestX, crestY, crestW, crestH, 12)

    const crestAvatarR = b.compact ? 21 : 25
    const crestAvatarX = crestX + 34
    const crestAvatarY = crestY + crestH / 2
    g.fillStyle(0x1b1129, 1)
    g.fillCircle(crestAvatarX, crestAvatarY, crestAvatarR + 4)
    g.lineStyle(2, ROYAL_GOLD, 1)
    g.strokeCircle(crestAvatarX, crestAvatarY, crestAvatarR + 4)

    const crestBallG = this.scene.add.graphics()
    this.contentLayer.add(crestBallG)
    renderWardrobeBallCharacter(this.scene, crestBallG, selectedChar.id, crestAvatarX, crestAvatarY, crestAvatarR * 0.8, {
      variant: avatarVariant,
    })

    const crestTextX = crestAvatarX + crestAvatarR + 14
    const crestTextMaxW = Math.max(90, crestW - (crestTextX - crestX) - 14)
    const crestName = displayText(this.scene, crestTextX, crestY + (b.compact ? 20 : 24), displayName, {
      color: '#fff8e9',
      size: b.compact ? 17 : 20,
      stroke: 3,
      origin: [0, 0.5],
    })
    crestName.setScale(Math.min(1, crestTextMaxW / Math.max(1, crestName.width)))
    const crestSub = displayText(this.scene, crestTextX, crestY + (b.compact ? 42 : 49), activeTitleName, {
      color: '#ffce42',
      size: 13,
      stroke: 2.5,
      origin: [0, 0.5],
      shadow: false,
    })
    crestSub.setScale(Math.min(1, crestTextMaxW / Math.max(1, crestSub.width)))
    this.contentLayer.add([crestName, crestSub])

    // Favorite Champions Pedestals (3 velvet pedestals)
    const favHeaderY = crestY + crestH + (b.compact ? 16 : 22)
    const favTitle = bodyText(this.scene, rightX + rightW / 2, favHeaderY, 'FAVORITE CHAMPIONS SHOWCASE (TAP TO CUSTOMIZE)', {
      color: '#5a3d20',
      size: 12,
    })
    favTitle.setScale(Math.min(1, (crestW - 8) / Math.max(1, favTitle.width)))
    this.contentLayer.add(favTitle)

    const favIds = prof.favorite_ball_ids ?? []
    const slotGap = 12
    const slotW = Math.min(144, Math.floor((crestW - slotGap * 2) / 3))
    const totalSlotsW = slotW * 3 + slotGap * 2
    const startSlotX = rightX + (rightW - totalSlotsW) / 2
    const slotY = favHeaderY + (b.compact ? 12 : 16)
    const slotH = b.compact ? 70 : Math.min(132, Math.max(96, Math.floor((rightY + rightH - slotY - 88) * 0.72)))
    for (let i = 0; i < 3; i++) {
      const sx = startSlotX + i * (slotW + slotGap)
      const favId = favIds[i]
      const cx = sx + slotW / 2
      const cy = slotY + slotH * 0.42

      g.fillStyle(PARCHMENT_CARD, 1)
      g.fillRoundedRect(sx, slotY, slotW, slotH, 10)
      g.lineStyle(2, favId ? ROYAL_GOLD_DARK : PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(sx, slotY, slotW, slotH, 10)

      // Velvet pedestal base
      g.fillStyle(VELVET_RED, 0.9)
      g.fillEllipse(cx, slotY + slotH - 22, slotW * 0.62, 11)
      g.lineStyle(1.4, ROYAL_GOLD, 0.95)
      g.strokeEllipse(cx, slotY + slotH - 22, slotW * 0.62, 11)

      if (favId && isValidWardrobeCharacterId(favId)) {
        const ch = getWardrobeCharacter(favId)
        const ballG = this.scene.add.graphics()
        this.contentLayer.add(ballG)
        const r = Math.min(25, slotH * 0.27)
        renderWardrobeBallCharacter(this.scene, ballG, ch.id, cx, cy, r, {
          variant: getCharacterVariantFromSave(save, ch.id),
        })
        const lbl = bodyText(this.scene, cx, slotY + slotH - 10, ch.name.toUpperCase(), {
          color: INK_HEX,
          size: 11,
        })
        lbl.setScale(Math.min(1, (slotW - 8) / Math.max(1, lbl.width)))
        this.contentLayer.add(lbl)
      } else {
        const emptyLbl = bodyText(this.scene, cx, cy, '+ SELECT\nCHAMPION', {
          color: '#7c654a',
          size: 11,
        }).setAlign('center')
        this.contentLayer.add(emptyLbl)
      }

      const hit = this.scene.add.zone(cx, slotY + slotH / 2, slotW, slotH).setInteractive({ useHandCursor: true })
      hit.on('pointerup', () => this.setTab('avatars'))
      this.contentLayer.add(hit)
    }

    // Summary stats footer on player card
    const statsY = slotY + slotH + (b.compact ? 12 : 18)
    const statsH = Math.max(44, rightY + rightH - statsY - 12)
    if (statsH >= 40) {
      const unlockedAchCount = this.overview.achievements.filter((a) => a.unlocked).length
      const totalAchCount = this.overview.achievements.length
      const unlockedBalls = this.overview.unlocked_ball_ids.length
      const totalBalls = this.overview.total_available_balls
      const pills = [
        { label: 'BEST SCORE', value: this.overview.statistics.best_score.toLocaleString('en-US') },
        { label: 'COLLECTION', value: `${unlockedBalls}/${totalBalls}` },
        { label: 'TROPHIES', value: `${unlockedAchCount}/${totalAchCount}` },
      ]
      const pillW = Math.floor((crestW - 16) / 3)
      const pillBoxH = Math.min(64, statsH)
      const pillsG = this.scene.add.graphics()
      this.contentLayer.add(pillsG)
      pills.forEach((p, idx) => {
        const px = crestX + idx * (pillW + 8)
        pillsG.fillStyle(WOOD_DARK, 0.96)
        pillsG.fillRoundedRect(px, statsY, pillW, pillBoxH, 9)
        pillsG.lineStyle(1.5, ROYAL_GOLD, 0.92)
        pillsG.strokeRoundedRect(px, statsY, pillW, pillBoxH, 9)
        const kText = bodyText(this.scene, px + pillW / 2, statsY + Math.round(pillBoxH * 0.28), p.label, {
          color: '#e5d4b3',
          size: 10,
        })
        const vText = displayText(this.scene, px + pillW / 2, statsY + Math.round(pillBoxH * 0.66), p.value, {
          color: '#ffe19a',
          size: pillBoxH >= 56 ? 18 : 16,
          stroke: 2.5,
        })
        kText.setScale(Math.min(1, (pillW - 8) / Math.max(1, kText.width)))
        vText.setScale(Math.min(1, (pillW - 10) / Math.max(1, vText.width)))
        this.contentLayer.add([kText, vText])
      })

      // Next Trophy Milestone strip below summary pills when vertical space permits (e.g. mobile portrait)
      const nextGoalY = statsY + pillBoxH + 10
      const nextGoalAvailH = rightY + rightH - 12 - nextGoalY
      if (nextGoalAvailH >= 48) {
        const goalH = Math.min(64, nextGoalAvailH)
        const nextTrophy = this.overview.achievements.find((a) => !a.unlocked)
        const curVal = nextTrophy ? (nextTrophy.current_value ?? 0) : totalAchCount
        const targetVal = nextTrophy ? nextTrophy.target_value : totalAchCount
        const ratio = nextTrophy ? curVal / Math.max(1, targetVal) : 1
        g.fillStyle(PARCHMENT_CARD, 1)
        g.fillRoundedRect(crestX, nextGoalY, crestW, goalH, 9)
        g.lineStyle(1.4, PARCHMENT_EDGE, 1)
        g.strokeRoundedRect(crestX, nextGoalY, crestW, goalH, 9)
        const gLabel = bodyText(this.scene, crestX + 12, nextGoalY + 15, 'NEXT TROPHY MILESTONE', {
          color: '#6e5236',
          size: 10,
          origin: [0, 0.5],
        })
        const gValText = nextTrophy
          ? `${nextTrophy.name} (${Math.min(curVal, targetVal)}/${targetVal})`
          : `All ${totalAchCount} Trophies Earned!`
        const gVal = bodyText(this.scene, crestX + crestW - 12, nextGoalY + 15, gValText, {
          color: INK_HEX,
          size: 11,
          origin: [1, 0.5],
        })
        gVal.setScale(Math.min(1, (crestW * 0.58) / Math.max(1, gVal.width)))
        this.contentLayer.add([gLabel, gVal])
        this.drawProgressBar(g, crestX + 12, nextGoalY + goalH - 14, crestW - 24, 7, ratio, BTN_EMERALD)
      }
      // CONTAINER SKINS showcase: preview + equip owned skins. Purchases
      // happen in the Store; this section equips what the account owns.
      const skinsBaseY = nextGoalAvailH >= 48 ? nextGoalY + Math.min(64, nextGoalAvailH) + 10 : statsY + pillBoxH + 10
      const skinsAvailH = rightY + rightH - 12 - skinsBaseY
      if (skinsAvailH >= 64) {
        const skinsH = Math.min(86, skinsAvailH)
        g.fillStyle(PARCHMENT_CARD, 1)
        g.fillRoundedRect(crestX, skinsBaseY, crestW, skinsH, 9)
        g.lineStyle(1.4, PARCHMENT_EDGE, 1)
        g.strokeRoundedRect(crestX, skinsBaseY, crestW, skinsH, 9)
        const skinLbl = bodyText(this.scene, crestX + 12, skinsBaseY + 15, 'CONTAINER SKINS', {
          color: '#6e5236',
          size: 10,
          origin: [0, 0.5],
        })
        this.contentLayer.add(skinLbl)
        const ownedSkins = this.overview.profile.owned_container_skins ?? ['royal_keep']
        const equippedSkin = this.overview.profile.equipped_container_skin ?? 'royal_keep'
        const skinSlotW = Math.min(120, Math.floor((crestW - 16 - 10 * (CONTAINER_SKIN_IDS.length - 1)) / CONTAINER_SKIN_IDS.length))
        const skinTotalW = skinSlotW * CONTAINER_SKIN_IDS.length + 10 * (CONTAINER_SKIN_IDS.length - 1)
        const skinStartX = crestX + (crestW - skinTotalW) / 2
        const skinSlotY = skinsBaseY + 26
        const skinSlotH = skinsH - 34
        for (const [idx, skinId] of CONTAINER_SKIN_IDS.entries()) {
          const def = CONTAINER_SKIN_CATALOG[skinId]
          const sx = skinStartX + idx * (skinSlotW + 10)
          const isOwned = ownedSkins.includes(skinId)
          const isEquipped = equippedSkin === skinId
          const cx = sx + skinSlotW / 2
          const cy = skinSlotY + skinSlotH * 0.5
          g.fillStyle(isEquipped ? 0xfdf3d3 : PARCHMENT_CARD, 1)
          g.fillRoundedRect(sx, skinSlotY, skinSlotW, skinSlotH, 8)
          g.lineStyle(isEquipped ? 2.4 : 1.4, isEquipped ? ROYAL_GOLD_DARK : PARCHMENT_EDGE, 1)
          g.strokeRoundedRect(sx, skinSlotY, skinSlotW, skinSlotH, 8)
          this.drawContainerSkinPreview(g, skinId, cx, cy - 6, Math.min(skinSlotW * 0.42, skinSlotH * 0.36))
          const skinTag = bodyText(this.scene, cx, skinSlotY + skinSlotH - 10, def.name.toUpperCase(), {
            color: INK_HEX,
            size: 10,
          })
          skinTag.setScale(Math.min(1, (skinSlotW - 6) / Math.max(1, skinTag.width)))
          this.contentLayer.add(skinTag)
          if (!isOwned) {
            const lockTxt = bodyText(this.scene, cx, skinSlotY + 10, 'STORE', {
              color: '#8a6d3b',
              size: 9,
              origin: [0.5, 0],
            })
            this.contentLayer.add(lockTxt)
          } else if (isEquipped) {
            const eqTxt = bodyText(this.scene, cx, skinSlotY + 10, 'EQUIPPED', {
              color: '#1f6e2c',
              size: 9,
              origin: [0.5, 0],
            })
            this.contentLayer.add(eqTxt)
          }
          if (isOwned && !isEquipped) {
            const hit = this.scene.add.zone(sx + skinSlotW / 2, skinSlotY + skinSlotH / 2, skinSlotW, skinSlotH)
              .setInteractive({ useHandCursor: true })
            hit.on('pointerup', () => {
              void this.equipContainerSkinAndRefresh(skinId)
            })
            this.contentLayer.add(hit)
          }
        }
      }
    }
  }

  /** Small U-container thumbnail for the CONTAINER SKINS showcase. */
  private drawContainerSkinPreview(g: Phaser.GameObjects.Graphics, skinId: ContainerSkinId, cx: number, cy: number, r: number): void {
    const w = r * 1.5
    const x = cx - w / 2
    const y = cy - r * 0.55
    const h = r * 1.3
    if (skinId === 'royal_keep') {
      // Dark-Luxury Royal Vessel preview: obsidian-onyx body with 24k gold trim
      g.fillStyle(0x131726, 1)
      g.fillRoundedRect(x, y, w, h, r * 0.28)
      g.lineStyle(2, INK, 1)
      g.strokeRoundedRect(x, y, w, h, r * 0.28)
      g.fillStyle(0x080a12, 1)
      g.fillRoundedRect(x + 4, y + 4, w - 8, h - 8, r * 0.18)
      g.lineStyle(Math.max(1.5, r * 0.16), 0xecc048, 1)
      g.strokeRoundedRect(x + 2.5, y + 2.5, w - 5, h - 5, r * 0.22)
      g.lineStyle(Math.max(1, r * 0.08), 0xfff6c4, 0.95)
      g.lineBetween(x + 5, y + 3, x + 5, y + h - 5)
    } else {
      g.fillStyle(0x087cf7, 1)
      g.fillRoundedRect(x, y, w, h, r * 0.28)
      g.lineStyle(2, INK, 1)
      g.strokeRoundedRect(x, y, w, h, r * 0.28)
      g.lineStyle(Math.max(1.5, r * 0.14), 0x28d9ff, 1)
      g.lineBetween(x + 3, y + 3, x + 3, y + h - 3)
      g.lineBetween(x + w - 3, y + 3, x + w - 3, y + h - 3)
      g.lineStyle(Math.max(1.2, r * 0.1), 0xfff0c5, 1)
      g.lineBetween(x + 5, y + h * 0.45, x + w * 0.42, y + h - 3)
      g.lineBetween(x + w * 0.5, y + h * 0.45, x + w - 5, y + h - 3)
      g.lineBetween(x + 5, y + h * 0.45, x + w * 0.5, y + h * 0.45)
      g.lineBetween(x + w * 0.42, y + h - 3, x + w - 5, y + h - 3)
    }
  }

  /** Equip an owned container skin then re-render the wardrobe tab. */
  private async equipContainerSkinAndRefresh(skinId: ContainerSkinId): Promise<void> {
    this.showToast('Equipping container skin...')
    const error = await this.runAccountAction(() => authService.equipContainerSkin(skinId), 'Could not equip container skin.')
    if (error) return
    this.overview = {
      ...this.overview,
      profile: {
        ...this.overview.profile,
        equipped_container_skin: skinId,
      },
    }
    this.showToast(`${CONTAINER_SKIN_CATALOG[skinId].name} equipped!`, 'success')
    this.renderActiveTab()
  }

  // ===========================================================================
  // TAB 2: AVATARS & FAVORITES (Character Grid & Champion Inspector)
  // ===========================================================================
  private renderAvatarsAndFavoritesTab(b: ReturnType<KingsWardrobeView['getLayoutBounds']>): void {
    const g = this.scene.add.graphics()
    this.contentLayer.add(g)

    const save = loadSave()
    const unlockedSet = new Set(this.overview.unlocked_ball_ids)
    const selectedAvatarId = this.overview.profile.selected_avatar_id
    const favoriteIds = this.overview.profile.favorite_ball_ids ?? []

    const gap = 12
    const gridW = b.wide ? Math.floor((b.bodyW - gap) * 0.63) : b.bodyW
    const inspectW = b.wide ? b.bodyW - gridW - gap : b.bodyW
    const gridH = b.wide ? b.bodyH : Math.floor((b.bodyH - gap) * 0.62)
    const inspectH = b.wide ? b.bodyH : b.bodyH - gridH - gap
    const gridX = b.bodyX
    const gridY = b.bodyY
    const inspectX = b.wide ? b.bodyX + gridW + gap : b.bodyX
    const inspectY = b.wide ? b.bodyY : b.bodyY + gridH + gap

    this.drawRoyalCard(g, gridX, gridY, gridW, gridH, 36)
    const gridTitle = displayText(
      this.scene,
      gridX + gridW / 2,
      gridY + 23,
      `CHARACTER COLLECTION (${unlockedSet.size}/${WARDROBE_CHARACTERS.length} UNLOCKED)`,
      { color: '#ffe19a', size: 15, stroke: 3 },
    )
    gridTitle.setScale(Math.min(1, (gridW - 24) / Math.max(1, gridTitle.width)))
    this.contentLayer.add(gridTitle)

    const cols = gridW >= 500 ? 5 : 4
    const rows = Math.ceil(WARDROBE_CHARACTERS.length / cols)
    const padX = 14
    const padTop = 48
    const cellGap = 8
    const cellW = Math.floor((gridW - padX * 2 - cellGap * (cols - 1)) / cols)
    const cellH = Math.floor((gridH - padTop - 12 - cellGap * (rows - 1)) / rows)

    WARDROBE_CHARACTERS.forEach((char, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const x0 = gridX + padX + col * (cellW + cellGap)
      const y0 = gridY + padTop + row * (cellH + cellGap)
      const cx = x0 + cellW / 2
      const cy = y0 + cellH * 0.42

      const isUnlocked = unlockedSet.has(char.id)
      const isSelected = this.inspectCharId === char.id
      const isAvatar = selectedAvatarId === char.id
      const isFav = favoriteIds.includes(char.id)

      g.fillStyle(isSelected ? 0xfff3cc : isUnlocked ? PARCHMENT_CARD : 0xe3d8c4, 1)
      g.fillRoundedRect(x0, y0, cellW, cellH, 10)
      g.lineStyle(isSelected ? 3 : 1.6, isSelected ? ROYAL_GOLD : isAvatar ? BTN_EMERALD : PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(x0, y0, cellW, cellH, 10)

      const ballLayer = this.scene.add.container(0, 0)
      const ballG = this.scene.add.graphics()
      ballLayer.add(ballG)
      this.contentLayer.add(ballLayer)
      const r = Math.min(24, Math.min(cellW, cellH) * 0.29)
      renderWardrobeBallCharacter(this.scene, ballG, char.id, cx, cy, r, {
        locked: !isUnlocked,
        variant: getCharacterVariantFromSave(save, char.id),
        layer: ballLayer,
      })

      const lbl = bodyText(this.scene, cx, y0 + cellH - 11, isUnlocked ? char.name : 'LOCKED', {
        color: isUnlocked ? INK_HEX : '#6b6257',
        size: 11,
      })
      lbl.setScale(Math.min(1, (cellW - 8) / Math.max(1, lbl.width)))
      this.contentLayer.add(lbl)

      if (isAvatar) {
        const badge = displayText(this.scene, x0 + 13, y0 + 11, 'AVATAR', {
          color: '#7ae582',
          size: 9,
          stroke: 2,
          origin: [0, 0.5],
          shadow: false,
        })
        this.contentLayer.add(badge)
      }
      if (isFav) {
        const star = displayText(this.scene, x0 + cellW - 11, y0 + 12, '★', {
          color: '#ffce42',
          size: 13,
          stroke: 2,
          origin: [0.5, 0.5],
          shadow: false,
        })
        this.contentLayer.add(star)
      }

      const zone = this.scene.add.zone(cx, y0 + cellH / 2, cellW, cellH).setInteractive({ useHandCursor: true })
      zone.setName(`wardrobe-char-${char.id}`)
      zone.on('pointerup', () => {
        this.inspectCharId = char.id
        this.renderActiveTab()
      })
      this.contentLayer.add(zone)
    })

    // --- CHAMPION STAND INSPECTOR ---
    this.drawRoyalCard(g, inspectX, inspectY, inspectW, inspectH, 36)
    const inspected: WardrobeCharacter = getWardrobeCharacter(this.inspectCharId)
    const isUnlocked = unlockedSet.has(inspected.id)
    const isCurrentAvatar = selectedAvatarId === inspected.id
    const isFavorite = favoriteIds.includes(inspected.id)

    const inspTitle = displayText(this.scene, inspectX + inspectW / 2, inspectY + 23, 'CHAMPION STAND', {
      color: '#ffe19a',
      size: 15,
      stroke: 3,
    })
    this.contentLayer.add(inspTitle)

    const previewX = b.wide ? inspectX + inspectW / 2 : inspectX + 64
    const previewY = b.wide ? inspectY + 96 : inspectY + 42 + (inspectH - 42) / 2
    const previewR = b.wide ? 38 : 28
    g.fillStyle(VELVET_PURPLE, 1)
    g.fillCircle(previewX, previewY, previewR + 8)
    g.lineStyle(2.5, ROYAL_GOLD, 1)
    g.strokeCircle(previewX, previewY, previewR + 8)

    const prevLayer = this.scene.add.container(0, 0)
    const prevG = this.scene.add.graphics()
    prevLayer.add(prevG)
    this.contentLayer.add(prevLayer)
    renderWardrobeBallCharacter(this.scene, prevG, inspected.id, previewX, previewY, previewR * 0.82, {
      locked: !isUnlocked,
      variant: getCharacterVariantFromSave(save, inspected.id),
      layer: prevLayer,
    })

    const textLeftX = previewX + previewR + 16
    const textMaxW = b.wide ? inspectW - 32 : Math.max(140, inspectX + inspectW - 14 - textLeftX)
    const textCenterX = b.wide ? inspectX + inspectW / 2 : textLeftX + textMaxW / 2
    const titleY = b.wide ? previewY + previewR + 28 : inspectY + 54

    const charTitle = displayText(
      this.scene,
      textCenterX,
      titleY,
      isUnlocked ? `${inspected.name} (Tier ${inspected.tier})` : `Locked (Tier ${inspected.tier})`,
      { color: '#fff6d6', size: 18, stroke: 3 },
    )
    charTitle.setScale(Math.min(1, textMaxW / Math.max(1, charTitle.width)))

    const reqText = bodyText(
      this.scene,
      textCenterX,
      titleY + 21,
      isUnlocked ? `${inspected.subtitle} • Unlocked` : `Unlock: ${inspected.requirement}`,
      { color: isUnlocked ? '#1f6e2c' : '#8f2424', size: 12 },
    )
    reqText.setScale(Math.min(1, textMaxW / Math.max(1, reqText.width)))
    this.contentLayer.add([charTitle, reqText])
    const btnW = b.wide ? inspectW - 32 : Math.floor((textMaxW - 8) / 2)
    const btnH = b.compact ? 38 : 42
    const btn1X = b.wide ? textCenterX : textCenterX - btnW / 2 - 4
    const btn2X = b.wide ? textCenterX : textCenterX + btnW / 2 + 4
    const btn1Y = b.wide ? inspectY + inspectH - btnH * 1.5 - 24 : inspectY + inspectH - btnH / 2 - 12
    const btn2Y = b.wide ? inspectY + inspectH - btnH / 2 - 14 : btn1Y

    // Champion Dossier details box on desktop, or compact status pill on mobile
    const dossierTopY = titleY + 36
    const dossierBottomY = btn1Y - btnH / 2 - 10
    if (b.wide && dossierBottomY - dossierTopY >= 74) {
      const dX = inspectX + 16
      const dW = inspectW - 32
      const dH = dossierBottomY - dossierTopY
      g.fillStyle(PARCHMENT_CARD, 1)
      g.fillRoundedRect(dX, dossierTopY, dW, dH, 10)
      g.lineStyle(1.5, PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(dX, dossierTopY, dW, dH, 10)
      const dRows = [
        { k: 'TIER CLASS', v: inspected.tier >= 9 ? `Tier ${inspected.tier} Collectible` : `Tier ${inspected.tier} Core Slime` },
        { k: 'COLLECTION STATUS', v: isUnlocked ? 'Discovered & Ready' : 'Undiscovered' },
        { k: 'SHOWCASE SLOT', v: isFavorite ? 'Pinned to Player Card (★)' : isCurrentAvatar ? 'Active Profile Avatar' : 'Available' },
      ]
      const dRowH = Math.floor((dH - 12) / dRows.length)
      dRows.forEach((dr, rIdx) => {
        const ry = dossierTopY + 6 + rIdx * dRowH + dRowH / 2
        const kl = bodyText(this.scene, dX + 12, ry, dr.k, { color: '#6e5236', size: 10, origin: [0, 0.5] })
        const vl = bodyText(this.scene, dX + dW - 12, ry, dr.v, { color: INK_HEX, size: 11, origin: [1, 0.5] })
        this.contentLayer.add([kl, vl])
      })
    } else if (!b.wide && dossierBottomY - dossierTopY >= 24) {
      const pillH = Math.min(28, dossierBottomY - dossierTopY)
      const pillY = dossierTopY + (dossierBottomY - dossierTopY - pillH) / 2
      g.fillStyle(PARCHMENT_CARD, 1)
      g.fillRoundedRect(textLeftX, pillY, textMaxW, pillH, 7)
      g.lineStyle(1.3, PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(textLeftX, pillY, textMaxW, pillH, 7)
      const classLabel = inspected.tier >= 9 ? `TIER ${inspected.tier} COLLECTIBLE` : `TIER ${inspected.tier} CORE SLIME`
      const slotLabel = isCurrentAvatar ? 'ACTIVE AVATAR' : isFavorite ? 'FAVORITE ★' : isUnlocked ? 'READY TO EQUIP' : 'LOCKED'
      const pTxt = bodyText(this.scene, textCenterX, pillY + pillH / 2, `${classLabel} • ${slotLabel}`, {
        color: '#5f4326',
        size: 10,
      })
      pTxt.setScale(Math.min(1, (textMaxW - 12) / Math.max(1, pTxt.width)))
      this.contentLayer.add(pTxt)
    }
    const equipAvatarBtn = new ChunkyButton({
      scene: this.scene,
      x: btn1X,
      y: btn1Y,
      w: btnW,
      h: btnH,
      label: !isUnlocked
        ? 'LOCKED'
        : isCurrentAvatar
          ? (b.wide ? 'ACTIVE AVATAR' : 'ACTIVE')
          : (b.wide ? 'SET AS AVATAR' : 'SET AVATAR'),
      fontSize: b.wide ? 13 : 11,
      disabled: !isUnlocked || isCurrentAvatar,
      fill: BTN_EMERALD,
      shadowColor: BTN_EMERALD_SHADOW,
      highlightColor: BTN_EMERALD_HIGHLIGHT,
      onClick: () => {
        void this.handleSelectAvatar(inspected.id)
      },
    })
    equipAvatarBtn.container.setName('wardrobe-equip-avatar-btn')

    const toggleFavBtn = new ChunkyButton({
      scene: this.scene,
      x: btn2X,
      y: btn2Y,
      w: btnW,
      h: btnH,
      label: !isUnlocked
        ? 'LOCKED'
        : isFavorite
          ? (b.wide ? 'REMOVE FAVORITE' : 'UNFAVORITE')
          : favoriteIds.length >= 3
            ? (b.wide ? '3/3 FAVORITES FULL' : '3/3 FULL')
            : (b.wide ? 'ADD TO FAVORITES' : 'FAVORITE'),
      fontSize: b.wide ? 13 : 11,
      disabled: !isUnlocked || (!isFavorite && favoriteIds.length >= 3),
      fill: isFavorite ? UI_COLORS.BTN_RED : UI_COLORS.BTN_GOLD,
      shadowColor: isFavorite ? UI_COLORS.BTN_RED_SHADOW : UI_COLORS.BTN_GOLD_SHADOW,
      highlightColor: isFavorite ? UI_COLORS.BTN_RED_HIGHLIGHT : UI_COLORS.BTN_GOLD_HIGHLIGHT,
      onClick: () => {
        void this.handleToggleFavorite(inspected.id)
      },
    })
    toggleFavBtn.container.setName('wardrobe-toggle-favorite-btn')
    this.contentLayer.add([equipAvatarBtn.container, toggleFavBtn.container])
  }

  private async handleSelectAvatar(characterId: string): Promise<void> {
    if (!authService.isRegisteredAccount()) {
      this.showToast('Sign in to save your Avatar to the leaderboard', 'error')
      return
    }
    const error = await this.runAccountAction(() => authService.setSelectedAvatar(characterId), 'Could not update avatar.')
    if (error) return
    this.overview.profile.selected_avatar_id = characterId
    this.showToast(`Avatar updated to ${getWardrobeCharacter(characterId).name}!`, 'success')
    this.renderActiveTab()
  }

  private async handleToggleFavorite(characterId: string): Promise<void> {
    if (!authService.isRegisteredAccount()) {
      this.showToast('Sign in to customize your Favorite Champions showcase', 'error')
      return
    }
    const current = [...(this.overview.profile.favorite_ball_ids ?? [])]
    const idx = current.indexOf(characterId)
    if (idx >= 0) {
      current.splice(idx, 1)
    } else {
      if (current.length >= 3) {
        this.showToast('You can showcase at most 3 Favorite Champions', 'error')
        return
      }
      current.push(characterId)
    }
    const error = await this.runAccountAction(() => authService.saveFavoriteBalls(current), 'Could not update favorite champions.')
    if (error) return
    this.overview.profile.favorite_ball_ids = current
    this.showToast('Favorite Champions updated!', 'success')
    this.renderActiveTab()
  }

  // ===========================================================================
  // TAB 3: TROPHIES & TITLES (Achievements with Progress Bars & Title Selector)
  // ===========================================================================
  private renderTrophiesAndTitlesTab(b: ReturnType<KingsWardrobeView['getLayoutBounds']>): void {
    const g = this.scene.add.graphics()
    this.contentLayer.add(g)

    const gap = 12
    const achW = b.wide ? Math.floor((b.bodyW - gap) * 0.62) : b.bodyW
    const titlesW = b.wide ? b.bodyW - achW - gap : b.bodyW
    const sections = trophySectionLayout(b.bodyH, b.compact, b.wide)
    const achH = sections.achievementHeight
    const titlesH = sections.titleHeight
    const achX = b.bodyX
    const achY = b.bodyY
    const titlesX = b.wide ? b.bodyX + achW + gap : b.bodyX
    const titlesY = b.wide ? b.bodyY : b.bodyY + achH + gap

    const unlockedCount = this.overview.achievements.filter((a) => a.unlocked).length
    this.drawRoyalCard(g, achX, achY, achW, achH, 36)
    const achHeader = displayText(
      this.scene,
      achX + achW / 2,
      achY + 23,
      `TROPHY CABINET (${unlockedCount}/${this.overview.achievements.length} UNLOCKED)`,
      { color: '#ffe19a', size: 15, stroke: 3 },
    )
    achHeader.setScale(Math.min(1, (achW - 24) / Math.max(1, achHeader.width)))
    this.contentLayer.add(achHeader)

    // Category filter buttons (proportional 32px height)
    const cats: Array<{ id: 'all' | 'gameplay' | 'merge' | 'collection' | 'score' | 'milestone'; label: string }> = [
      { id: 'all', label: 'ALL' },
      { id: 'gameplay', label: 'RUNS' },
      { id: 'merge', label: 'MERGES' },
      { id: 'collection', label: 'BALLS' },
      { id: 'score', label: 'SCORE' },
      { id: 'milestone', label: 'TIERS' },
    ]
    const catGap = 6
    const catW = Math.floor((achW - 24 - catGap * (cats.length - 1)) / cats.length)
    const catH = b.compact ? 28 : 32
    const catY = achY + 46 + catH / 2
    cats.forEach((c, i) => {
      const cx = achX + 12 + i * (catW + catGap) + catW / 2
      const active = this.trophyCategory === c.id
      const btn = new ChunkyButton({
        scene: this.scene,
        x: cx,
        y: catY,
        w: catW,
        h: catH,
        label: c.label,
        fontSize: b.compact ? 10 : 11,
        fill: active ? UI_COLORS.BTN_GOLD : 0x5c4228,
        shadowColor: active ? UI_COLORS.BTN_GOLD_SHADOW : 0x362413,
        highlightColor: active ? UI_COLORS.BTN_GOLD_HIGHLIGHT : 0x7c5a38,
        onClick: () => {
          this.trophyCategory = c.id
          this.trophyPage = 0
          this.renderActiveTab()
        },
      })
      this.contentLayer.add(btn.container)
    })

    const filtered: PlayerAchievement[] = this.overview.achievements.filter(
      (a) => this.trophyCategory === 'all' || a.category === this.trophyCategory,
    )
    const pageSize = sections.achievementPageSize
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    this.trophyPage = Phaser.Math.Clamp(this.trophyPage, 0, totalPages - 1)
    const visibleItems = filtered.slice(this.trophyPage * pageSize, (this.trophyPage + 1) * pageSize)

    const pagerBtnH = sections.pagerButtonHeight
    const listTopY = catY + catH / 2 + 8
    const rowGap = sections.titleRowGap
    const rowH = sections.achievementRowHeight

    visibleItems.forEach((ach, idx) => {
      const ry = listTopY + idx * (rowH + rowGap)
      const rx = achX + 12
      const rw = achW - 24
      g.fillStyle(ach.unlocked ? 0xfff4d2 : PARCHMENT_CARD, 1)
      g.fillRoundedRect(rx, ry, rw, rowH, 9)
      g.lineStyle(1.8, ach.unlocked ? ROYAL_GOLD_DARK : PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(rx, ry, rw, rowH, 9)

      // Medal emblem
      const medalX = rx + 24
      const medalY = ry + rowH / 2
      g.fillStyle(ach.unlocked ? ROYAL_GOLD : 0x8d8273, 1)
      g.fillCircle(medalX, medalY, 14)
      g.lineStyle(2, INK, 1)
      g.strokeCircle(medalX, medalY, 14)
      if (ach.unlocked) {
        const iconT = displayText(this.scene, medalX, medalY, '★', {
          color: '#fff9e6',
          size: 14,
          stroke: 2.2,
          shadow: false,
        })
        this.contentLayer.add(iconT)
      } else {
        // Vector padlock icon inside locked medal
        g.lineStyle(2, 0xe5dec9, 1)
        g.strokeCircle(medalX, medalY - 3, 4)
        g.fillStyle(0xe5dec9, 1)
        g.fillRoundedRect(medalX - 5, medalY - 1, 10, 8, 2)
      }

      const titleT = bodyText(this.scene, rx + 46, ry + Math.min(16, rowH * 0.28), ach.name, {
        color: INK_HEX,
        size: 13,
        origin: [0, 0.5],
      })
      const subText = ach.reward_title_name
        ? `${ach.unlock_condition} • Title: "${ach.reward_title_name}"`
        : ach.unlock_condition
      const descT = bodyText(this.scene, rx + 46, ry + rowH * 0.56, subText, {
        color: '#5f4326',
        size: 11,
        origin: [0, 0.5],
        weight: '700',
      })
      descT.setScale(Math.min(1, (rw - 125) / Math.max(1, descT.width)))

      // Progress bar for achievement
      const curVal = ach.current_value ?? (ach.unlocked ? ach.target_value : 0)
      const ratio = ach.unlocked ? 1 : curVal / Math.max(1, ach.target_value)
      if (rowH >= 44) {
        this.drawProgressBar(g, rx + 46, ry + rowH - 11, Math.min(180, rw - 140), 6, ratio, ach.unlocked ? ROYAL_GOLD_DARK : BTN_EMERALD)
      }

      const statusBadge = bodyText(
        this.scene,
        rx + rw - 10,
        ry + rowH / 2,
        ach.unlocked ? 'EARNED' : `${Math.min(curVal, ach.target_value)}/${ach.target_value}`,
        {
          color: ach.unlocked ? '#1f6e2c' : '#7a6c5d',
          size: 11,
          origin: [1, 0.5],
        },
      )
      this.contentLayer.add([titleT, descT, statusBadge])
    })

    // Pagination controls for Trophy Cabinet
    const pagerInset = sections.pagerInset
    const pagerY = achY + achH - pagerBtnH / 2 - pagerInset
    const prevBtn = new ChunkyButton({
      scene: this.scene,
      x: achX + 60,
      y: pagerY,
      w: 88,
      h: pagerBtnH,
      label: 'PREV',
      fontSize: 12,
      disabled: this.trophyPage <= 0,
      fill: UI_COLORS.BTN_BLUE,
      onClick: () => {
        this.trophyPage = Math.max(0, this.trophyPage - 1)
        this.renderActiveTab()
      },
    })
    const nextBtn = new ChunkyButton({
      scene: this.scene,
      x: achX + achW - 60,
      y: pagerY,
      w: 88,
      h: pagerBtnH,
      label: 'NEXT',
      fontSize: 12,
      disabled: this.trophyPage >= totalPages - 1,
      fill: UI_COLORS.BTN_BLUE,
      onClick: () => {
        this.trophyPage = Math.min(totalPages - 1, this.trophyPage + 1)
        this.renderActiveTab()
      },
    })
    const pageT = bodyText(this.scene, achX + achW / 2, pagerY, `PAGE ${this.trophyPage + 1} / ${totalPages}`, {
      color: INK_HEX,
      size: 12,
    })
    this.contentLayer.add([prevBtn.container, nextBtn.container, pageT])

    // --- PLAYER TITLES SELECTOR (with pagination so all 10 titles are reachable) ---
    this.drawRoyalCard(g, titlesX, titlesY, titlesW, titlesH, 36)
    const titlesHeader = displayText(this.scene, titlesX + titlesW / 2, titlesY + 23, 'PLAYER TITLES', {
      color: '#ffe19a',
      size: 15,
      stroke: 3,
    })
    this.contentLayer.add(titlesHeader)

    const activeTitleId = this.overview.profile.active_title_id
    const allTitleAchievements = this.overview.achievements.filter((a) => a.reward_title_id && a.reward_title_name)
    const titlePageSize = sections.titlePageSize
    const totalTitlePages = Math.max(1, Math.ceil(allTitleAchievements.length / titlePageSize))
    this.titlePage = Phaser.Math.Clamp(this.titlePage, 0, totalTitlePages - 1)
    const visibleTitles = allTitleAchievements.slice(this.titlePage * titlePageSize, (this.titlePage + 1) * titlePageSize)

    const tStartY = titlesY + sections.titleStartInset
    const tGap = sections.titleRowGap
    const tRowH = sections.titleRowHeight

    visibleTitles.forEach((ach, idx) => {
      const tid = ach.reward_title_id!
      const tname = ach.reward_title_name!
      const ty = tStartY + idx * (tRowH + tGap)
      const tx = titlesX + 12
      const tw = titlesW - 24
      const isEquipped = activeTitleId === tid

      g.fillStyle(isEquipped ? 0xfff0c2 : ach.unlocked ? PARCHMENT_CARD : 0xe2d8c5, 1)
      g.fillRoundedRect(tx, ty, tw, tRowH, 9)
      g.lineStyle(isEquipped ? 2.2 : 1.5, isEquipped ? ROYAL_GOLD_DARK : PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(tx, ty, tw, tRowH, 9)

      const actionBtnW = 86
      const actionBtnH = sections.titleActionHeight
      const textMaxW = tw - actionBtnW - 24

      const nameLbl = bodyText(this.scene, tx + 12, ty + tRowH * 0.36, tname, {
        color: ach.unlocked ? INK_HEX : '#6b6257',
        size: 13,
        origin: [0, 0.5],
      })
      nameLbl.setScale(Math.min(1, textMaxW / Math.max(1, nameLbl.width)))
      const srcLbl = bodyText(this.scene, tx + 12, ty + tRowH * 0.72, `From: ${ach.name}`, {
        color: '#5f4326',
        size: 10,
        origin: [0, 0.5],
        weight: '700',
      })
      srcLbl.setScale(Math.min(1, textMaxW / Math.max(1, srcLbl.width)))
      this.contentLayer.add([nameLbl, srcLbl])

      const eqBtn = new ChunkyButton({
        scene: this.scene,
        x: tx + tw - actionBtnW / 2 - 8,
        y: ty + tRowH / 2,
        w: actionBtnW,
        h: actionBtnH,
        label: !ach.unlocked ? 'LOCKED' : isEquipped ? 'UNEQUIP' : 'EQUIP',
        fontSize: 11,
        disabled: !ach.unlocked,
        fill: isEquipped ? UI_COLORS.BTN_RED : BTN_EMERALD,
        shadowColor: isEquipped ? UI_COLORS.BTN_RED_SHADOW : BTN_EMERALD_SHADOW,
        highlightColor: isEquipped ? UI_COLORS.BTN_RED_HIGHLIGHT : BTN_EMERALD_HIGHLIGHT,
        onClick: () => {
          void this.handleEquipTitle(isEquipped ? null : tid)
        },
      })
      this.contentLayer.add(eqBtn.container)
    })

    // Pagination controls for Player Titles
    const tPagerY = titlesY + titlesH - pagerBtnH / 2 - pagerInset
    const tPrevBtn = new ChunkyButton({
      scene: this.scene,
      x: titlesX + 54,
      y: tPagerY,
      w: 78,
      h: pagerBtnH,
      label: 'PREV',
      fontSize: 11,
      disabled: this.titlePage <= 0,
      fill: UI_COLORS.BTN_BLUE,
      onClick: () => {
        this.titlePage = Math.max(0, this.titlePage - 1)
        this.renderActiveTab()
      },
    })
    const tNextBtn = new ChunkyButton({
      scene: this.scene,
      x: titlesX + titlesW - 54,
      y: tPagerY,
      w: 78,
      h: pagerBtnH,
      label: 'NEXT',
      fontSize: 11,
      disabled: this.titlePage >= totalTitlePages - 1,
      fill: UI_COLORS.BTN_BLUE,
      onClick: () => {
        this.titlePage = Math.min(totalTitlePages - 1, this.titlePage + 1)
        this.renderActiveTab()
      },
    })
    const tPageLbl = bodyText(this.scene, titlesX + titlesW / 2, tPagerY, `${this.titlePage + 1} / ${totalTitlePages}`, {
      color: INK_HEX,
      size: 12,
    })
    this.contentLayer.add([tPrevBtn.container, tNextBtn.container, tPageLbl])
  }

  private async handleEquipTitle(titleId: string | null): Promise<void> {
    if (!authService.isRegisteredAccount()) {
      this.showToast('Sign in to equip a Player Title on your profile', 'error')
      return
    }
    const error = await this.runAccountAction(() => authService.setActiveTitle(titleId), 'Could not equip player title.')
    if (error) return
    this.overview.profile.active_title_id = titleId
    const label = titleId ? getTitleNameById(titleId) : 'None'
    this.showToast(titleId ? `Equipped title: ${label}` : 'Player title unequipped', 'success')
    this.renderActiveTab()
  }

  // ===========================================================================
  // TAB 4: STATS & ACCOUNT (Royal Passport + 2x4 Hero Stat Cards)
  // ===========================================================================
  private renderLedgerAndAccountTab(b: ReturnType<KingsWardrobeView['getLayoutBounds']>): void {
    const g = this.scene.add.graphics()
    this.contentLayer.add(g)

    const isAuthed = authService.isRegisteredAccount()
    const prof = this.overview.profile
    const st = this.overview.statistics
    const save = loadSave()

    const gap = 12
    const passW = b.wide ? Math.floor((b.bodyW - gap) * 0.37) : b.bodyW
    const statsW = b.wide ? b.bodyW - passW - gap : b.bodyW
    const ledger = ledgerSectionLayout(b.bodyH, b.compact, b.wide, isAuthed)
    const passH = ledger.passportHeight
    const statsH = ledger.statisticsHeight
    const passX = b.bodyX
    const passY = b.bodyY
    const statsX = b.wide ? b.bodyX + passW + gap : b.bodyX
    const statsY = b.wide ? b.bodyY : b.bodyY + passH + gap

    // --- 1. ROYAL PASSPORT CARD (Identity, Status, Account Controls) ---
    this.drawRoyalCard(g, passX, passY, passW, passH, 36)
    const passHeader = displayText(this.scene, passX + passW / 2, passY + 23, 'ROYAL PASSPORT', {
      color: '#ffe19a',
      size: 15,
      stroke: 3,
    })
    this.contentLayer.add(passHeader)

    const padX = 14
    const innerX = passX + padX
    const innerW = passW - padX * 2

    // Top passport crest banner
    const badgeBannerY = passY + 48
    const badgeBannerH = b.compact ? 54 : 64
    g.fillStyle(VELVET_PURPLE, 1)
    g.fillRoundedRect(innerX, badgeBannerY, innerW, badgeBannerH, 10)
    g.lineStyle(2, ROYAL_GOLD, 1)
    g.strokeRoundedRect(innerX, badgeBannerY, innerW, badgeBannerH, 10)

    const sealR = b.compact ? 19 : 22
    const sealX = innerX + 30
    const sealY = badgeBannerY + badgeBannerH / 2
    g.fillStyle(0x1b1129, 1)
    g.fillCircle(sealX, sealY, sealR + 3)
    g.lineStyle(1.8, ROYAL_GOLD, 1)
    g.strokeCircle(sealX, sealY, sealR + 3)

    const selectedChar = getWardrobeCharacter(prof.selected_avatar_id)
    const sealBallG = this.scene.add.graphics()
    this.contentLayer.add(sealBallG)
    renderWardrobeBallCharacter(this.scene, sealBallG, selectedChar.id, sealX, sealY, sealR * 0.8, {
      variant: getCharacterVariantFromSave(save, selectedChar.id),
    })

    const pNameX = sealX + sealR + 12
    const pNameMaxW = Math.max(80, innerW - (pNameX - innerX) - 10)
    const displayName = prof.display_name || prof.username || 'Royal Guest'
    const pNameT = displayText(this.scene, pNameX, badgeBannerY + (b.compact ? 18 : 22), displayName, {
      color: '#fff8e9',
      size: b.compact ? 16 : 18,
      stroke: 2.8,
      origin: [0, 0.5],
    })
    pNameT.setScale(Math.min(1, pNameMaxW / Math.max(1, pNameT.width)))

    const statusChipText = isAuthed ? '● CLOUD SYNCED ACCOUNT' : '○ LOCAL GUEST PROFILE'
    const pStatusT = bodyText(this.scene, pNameX, badgeBannerY + (b.compact ? 38 : 44), statusChipText, {
      color: isAuthed ? '#7ae582' : '#ffce42',
      size: 11,
      origin: [0, 0.5],
    })
    pStatusT.setScale(Math.min(1, pNameMaxW / Math.max(1, pStatusT.width)))
    this.contentLayer.add([pNameT, pStatusT])

    // Passport metadata pills
    const createdStr = prof.created_at
      ? new Date(prof.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : 'Current Session'
    const providers = (this.overview.auth_providers ?? []).length > 0
      ? this.overview.auth_providers.map((p: string) => p.toUpperCase()).join(', ')
      : isAuthed
        ? 'EMAIL'
        : 'GUEST'
    const shortId = isAuthed && prof.id ? `${prof.id.slice(0, 8).toUpperCase()}…` : 'LOCAL-SAVE'

    const metaRows: Array<{ label: string; value: string }> = b.wide
      ? [
          { label: 'ACCOUNT ID', value: shortId },
          { label: 'ENLISTED', value: createdStr },
          { label: 'SIGN-IN METHOD', value: providers },
          { label: 'VERIFIED RUNS', value: `${st.verified_runs_count.toLocaleString('en-US')} Recorded` },
          { label: 'NAME CHANGE', value: prof.username_changed_at ? 'Used (1/1)' : '1 Free Available' },
        ]
      : [
          { label: 'ENLISTED', value: createdStr },
          { label: 'SIGN-IN', value: providers },
        ]

    const btnH = b.compact ? 38 : 44
    const metaStartY = passY + ledger.metadataStartOffset
    const metaAvailH = ledger.metadataHeight

    if (b.wide) {
      const mGap = 7
      const mRowH = Math.min(38, Math.floor((metaAvailH - mGap * (metaRows.length - 1)) / metaRows.length))
      metaRows.forEach((m, idx) => {
        const ry = metaStartY + idx * (mRowH + mGap)
        g.fillStyle(PARCHMENT_CARD, 1)
        g.fillRoundedRect(innerX, ry, innerW, mRowH, 8)
        g.lineStyle(1.4, PARCHMENT_EDGE, 1)
        g.strokeRoundedRect(innerX, ry, innerW, mRowH, 8)
        const kLbl = bodyText(this.scene, innerX + 10, ry + mRowH / 2, m.label, {
          color: '#6e5236',
          size: 10,
          origin: [0, 0.5],
        })
        const vLbl = bodyText(this.scene, innerX + innerW - 10, ry + mRowH / 2, m.value, {
          color: INK_HEX,
          size: 11,
          origin: [1, 0.5],
        })
        this.contentLayer.add([kLbl, vLbl])
      })
    } else if (metaAvailH >= 26) {
      const mPillW = Math.floor((innerW - 8) / 2)
      const mPillH = Math.min(30, metaAvailH)
      metaRows.forEach((m, idx) => {
        const px = innerX + idx * (mPillW + 8)
        g.fillStyle(PARCHMENT_CARD, 1)
        g.fillRoundedRect(px, metaStartY, mPillW, mPillH, 7)
        g.lineStyle(1.3, PARCHMENT_EDGE, 1)
        g.strokeRoundedRect(px, metaStartY, mPillW, mPillH, 7)
        const txt = bodyText(this.scene, px + mPillW / 2, metaStartY + mPillH / 2, `${m.label}: ${m.value}`, {
          color: INK_HEX,
          size: 10,
        })
        txt.setScale(Math.min(1, (mPillW - 10) / Math.max(1, txt.width)))
        this.contentLayer.add(txt)
      })
    }

    // Account Action Buttons (44px tall ChunkyButtons)
    if (!isAuthed) {
      const loginBtn = new ChunkyButton({
        scene: this.scene,
        x: passX + passW / 2,
        y: passY + ledger.actionTopOffset + btnH / 2,
        w: innerW,
        h: btnH,
        label: 'SIGN IN / CREATE ACCOUNT',
        fontSize: 13,
        fill: UI_COLORS.BTN_BLUE,
        shadowColor: UI_COLORS.BTN_BLUE_SHADOW,
        highlightColor: UI_COLORS.BTN_BLUE_HIGHLIGHT,
        onClick: () => {
          const modal = new AuthModal(document.body)
          modal.onSuccess(() => {
            this.onAuthChanged?.()
            void this.refreshOverview()
          })
          modal.open('login')
        },
      })
      this.contentLayer.add(loginBtn.container)
    } else {
      const stackVertically = b.wide
      const halfW = Math.floor((innerW - 10) / 2)
      const logoutW = stackVertically ? innerW : halfW
      const deleteW = stackVertically ? innerW : halfW
      const logoutX = stackVertically ? passX + passW / 2 : innerX + halfW / 2
      const deleteX = stackVertically ? passX + passW / 2 : innerX + innerW - halfW / 2
      const deleteY = passY + ledger.actionTopOffset + btnH / 2
      const logoutY = stackVertically ? deleteY - btnH - 10 : deleteY

      const logoutBtn = new ChunkyButton({
        scene: this.scene,
        x: logoutX,
        y: logoutY,
        w: logoutW,
        h: btnH,
        label: 'SIGN OUT',
        fontSize: 13,
        fill: UI_COLORS.BTN_GOLD,
        shadowColor: UI_COLORS.BTN_GOLD_SHADOW,
        highlightColor: UI_COLORS.BTN_GOLD_HIGHLIGHT,
        onClick: () => {
          void authService.signOut().then(() => {
            this.onAuthChanged?.()
            this.overview = buildFallbackOverviewFromSave(loadSave(), null)
            this.showToast('Signed out cleanly. Local guest progress active.', 'success')
            this.renderActiveTab()
          })
        },
      })

      const deleteBtn = new ChunkyButton({
        scene: this.scene,
        x: deleteX,
        y: deleteY,
        w: deleteW,
        h: btnH,
        label: 'DELETE ACCOUNT',
        fontSize: 13,
        fill: UI_COLORS.BTN_RED,
        shadowColor: UI_COLORS.BTN_RED_SHADOW,
        highlightColor: UI_COLORS.BTN_RED_HIGHLIGHT,
        onClick: () => this.openDeleteAccountModal(),
      })
      deleteBtn.container.setName('wardrobe-delete-account-btn')
      this.contentLayer.add([logoutBtn.container, deleteBtn.container])
    }

    // --- 2. LIFETIME STATISTICS (Overall Mastery Bar + 2x4 Hero Stat Cards) ---
    this.drawRoyalCard(g, statsX, statsY, statsW, statsH, 36)
    const statsHeader = displayText(this.scene, statsX + statsW / 2, statsY + 23, 'LIFETIME STATISTICS', {
      color: '#ffe19a',
      size: 15,
      stroke: 3,
    })
    this.contentLayer.add(statsHeader)

    const unlockedBalls = this.overview.unlocked_ball_ids.length
    const totalBalls = Math.max(1, this.overview.total_available_balls)
    const unlockedTrophies = this.overview.achievements.filter((a) => a.unlocked).length
    const totalTrophies = Math.max(1, this.overview.achievements.length)
    const masteryRatio = (unlockedBalls + unlockedTrophies) / (totalBalls + totalTrophies)
    const masteryPct = Math.round(masteryRatio * 100)

    const barPadX = 14
    const barY = statsY + 48
    const barBlockH = b.compact ? 26 : 32
    g.fillStyle(PARCHMENT_DARK, 1)
    g.fillRoundedRect(statsX + barPadX, barY, statsW - barPadX * 2, barBlockH, 8)
    g.lineStyle(1.4, PARCHMENT_EDGE, 1)
    g.strokeRoundedRect(statsX + barPadX, barY, statsW - barPadX * 2, barBlockH, 8)

    const masteryLbl = bodyText(
      this.scene,
      statsX + barPadX + 10,
      barY + barBlockH / 2,
      `ACCOUNT MASTERY: ${masteryPct}%`,
      { color: INK_HEX, size: 11, origin: [0, 0.5] },
    )
    this.contentLayer.add(masteryLbl)

    const progX = statsX + barPadX + Math.min(176, (statsW - barPadX * 2) * 0.48)
    const progW = Math.max(60, statsX + statsW - barPadX - 12 - progX)
    this.drawProgressBar(g, progX, barY + barBlockH / 2 - 5, progW, 10, masteryRatio, ROYAL_GOLD_DARK)

    // 2x4 Hero Stat Cards Grid
    const coinDisplay = Number.isInteger(st.total_coins_earned)
      ? st.total_coins_earned.toLocaleString('en-US')
      : formatCoins(st.total_coins_earned)
    const heroStats: Array<{
      label: string
      value: string
      sub: string
      accent: number
      kind: 'crown' | 'runs' | 'merge' | 'tier' | 'coin' | 'avg' | 'time' | 'collection'
    }> = [
      { label: 'BEST SCORE', value: st.best_score.toLocaleString('en-US'), sub: 'Personal Record', accent: 0xe6a119, kind: 'crown' },
      { label: 'GAMES PLAYED', value: st.games_played.toLocaleString('en-US'), sub: 'Completed Runs', accent: 0x3b82f6, kind: 'runs' },
      { label: 'TOTAL MERGES', value: st.total_merges.toLocaleString('en-US'), sub: 'Slimes Combined', accent: 0x10b981, kind: 'merge' },
      { label: 'HIGHEST TIER', value: `TIER ${st.highest_tier}`, sub: 'Peak Evolution', accent: 0x9333ea, kind: 'tier' },
      { label: 'COINS EARNED', value: coinDisplay, sub: 'Royal Treasury', accent: 0xf59e0b, kind: 'coin' },
      { label: 'AVERAGE SCORE', value: st.average_score.toLocaleString('en-US'), sub: 'Per Completed Run', accent: 0x0ea5e9, kind: 'avg' },
      { label: 'PLAYTIME', value: formatPlaytime(st.total_playtime_ms), sub: 'Time in Arena', accent: 0xd97706, kind: 'time' },
      { label: 'COLLECTION', value: `${unlockedBalls} / ${totalBalls}`, sub: 'Characters Found', accent: 0xef4444, kind: 'collection' },
    ]

    const cols = statsW >= 500 ? 4 : 2
    const rows = Math.ceil(heroStats.length / cols)
    const gridTopY = barY + barBlockH + 10
    const gridAvailH = statsY + statsH - 14 - gridTopY
    const cGap = 8
    const cardW = Math.floor((statsW - barPadX * 2 - cGap * (cols - 1)) / cols)
    const cardH = Math.floor((gridAvailH - cGap * (rows - 1)) / rows)

    heroStats.forEach((item, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const cx = statsX + barPadX + col * (cardW + cGap)
      const cy = gridTopY + row * (cardH + cGap)

      // Hero stat card background with top colored accent bar
      g.fillStyle(PARCHMENT_CARD, 1)
      g.fillRoundedRect(cx, cy, cardW, cardH, 10)
      g.fillStyle(item.accent, 0.92)
      g.fillRoundedRect(cx + 1, cy + 1, cardW - 2, 5, { tl: 9, tr: 9, bl: 0, br: 0 })
      g.lineStyle(1.6, PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(cx, cy, cardW, cardH, 10)

      // Emblem icon
      const iconR = Math.min(12, Math.max(9, Math.floor(cardH * 0.15)))
      const iconX = cx + 20
      const iconY = cy + Math.min(24, Math.max(18, Math.round(cardH * 0.24)))

      if (item.kind === 'coin') {
        const coinG = this.scene.add.graphics()
        this.contentLayer.add(coinG)
        drawCoin(coinG, iconX, iconY, iconR)
      } else {
        g.fillStyle(item.accent, 0.22)
        g.fillCircle(iconX, iconY, iconR + 2)
        g.lineStyle(1.6, item.accent, 0.95)
        g.strokeCircle(iconX, iconY, iconR + 2)
        if (item.kind === 'time') {
          // Crisp vector clock hands instead of emoji
          g.lineStyle(2, INK, 1)
          g.strokeCircle(iconX, iconY, iconR * 0.72)
          g.lineBetween(iconX, iconY, iconX, iconY - iconR * 0.45)
          g.lineBetween(iconX, iconY, iconX + iconR * 0.38, iconY + iconR * 0.15)
        } else {
          const glyph =
            item.kind === 'crown'
              ? '#1'
              : item.kind === 'runs'
                ? 'GO'
                : item.kind === 'merge'
                  ? '2x'
                  : item.kind === 'tier'
                    ? '★'
                    : item.kind === 'avg'
                      ? 'AVG'
                      : '★'
          const glyphT = displayText(this.scene, iconX, iconY, glyph, {
            color: '#fff9e6',
            size: glyph.length > 2 ? 9 : 11,
            stroke: 2.2,
            shadow: false,
          })
          this.contentLayer.add(glyphT)
        }
      }

      // Clean Nunito category label
      const lblMaxW = cardW - 42
      const kText = bodyText(this.scene, cx + 36, iconY, item.label, {
        color: '#5f4326',
        size: 10,
        origin: [0, 0.5],
      })
      kText.setScale(Math.min(1, lblMaxW / Math.max(1, kText.width)))

      // Bold Lilita One hero number
      const showSub = cardH >= 88
      const valY = cy + Math.round(cardH * (showSub ? 0.56 : 0.66))
      const vText = displayText(this.scene, cx + cardW / 2, valY, item.value, {
        color: '#ffdb70',
        size: cardH >= 84 ? 24 : 18,
        stroke: 3.5,
      })
      vText.setScale(Math.min(1, (cardW - 14) / Math.max(1, vText.width)))
      this.contentLayer.add([kText, vText])

      if (showSub) {
        const subT = bodyText(this.scene, cx + cardW / 2, cy + cardH - 15, item.sub, {
          color: '#7a5c3d',
          size: 10,
        })
        subT.setScale(Math.min(1, (cardW - 14) / Math.max(1, subT.width)))
        this.contentLayer.add(subT)
      }
    })
  }

  // ===========================================================================
  // DOM MODALS FOR TEXT INPUT (One-Time Username Change & Delete Confirmation)
  // ===========================================================================
  private closeDomModal(): void {
    if (this.domOverlay) {
      this.domOverlay.remove()
      this.domOverlay = null
    }
  }

  private openUsernameChangeModal(): void {
    this.closeDomModal()
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10050;
      background: rgba(10, 8, 18, 0.78); backdrop-filter: blur(5px);
      display: flex; align-items: center; justify-content: center; padding: 16px;
      font-family: 'Lilita One', 'Nunito', sans-serif;
    `
    const card = document.createElement('div')
    card.style.cssText = `
      width: min(420px, 100%); background: #fff9ec; border: 4px solid #6e3516;
      border-radius: 18px; padding: 22px; box-shadow: 0 18px 44px rgba(0,0,0,0.65);
      color: #111625; text-align: center;
    `
    const current = this.overview.profile.username || this.overview.profile.display_name || ''
    card.innerHTML = `
      <h3 style="margin: 0 0 8px; font-size: 22px; color: #5b2c0e; letter-spacing: 0.5px;">CHANGE USERNAME</h3>
      <p style="margin: 0 0 14px; font-family: Nunito, sans-serif; font-size: 13px; color: #5a4631; font-weight: 700;">
        You may change your player username <strong>only once</strong> per account. Choose wisely! (3–20 letters, numbers, or underscores)
      </p>
      <input id="br-royal-username-input" type="text" maxlength="20" value="${current.replace(/"/g, '&quot;')}"
        placeholder="Enter new username"
        style="width: 100%; box-sizing: border-box; padding: 11px 14px; font-size: 16px; font-weight: 800;
        font-family: Nunito, sans-serif; border: 2px solid #b58326; border-radius: 10px; background: #ffffff; color: #111625; outline: none;" />
      <div id="br-royal-username-error" style="min-height: 20px; margin: 8px 0; font-family: Nunito, sans-serif; font-size: 12px; font-weight: 800; color: #b91c1c;"></div>
      <div style="display: flex; gap: 10px; justify-content: center; margin-top: 8px;">
        <button id="br-royal-username-cancel" type="button"
          style="flex: 1; padding: 11px; border-radius: 10px; border: 2px solid #111625; background: #cbd5e1; font-family: inherit; font-size: 14px; cursor: pointer;">
          CANCEL
        </button>
        <button id="br-royal-username-submit" type="button"
          style="flex: 1; padding: 11px; border-radius: 10px; border: 2px solid #111625; background: #ffce42; color: #111625; font-family: inherit; font-size: 14px; cursor: pointer;">
          CONFIRM (1/1)
        </button>
      </div>
    `
    overlay.appendChild(card)
    document.body.appendChild(overlay)
    this.domOverlay = overlay

    const input = card.querySelector<HTMLInputElement>('#br-royal-username-input')!
    const errEl = card.querySelector<HTMLDivElement>('#br-royal-username-error')!
    const cancelBtn = card.querySelector<HTMLButtonElement>('#br-royal-username-cancel')!
    const submitBtn = card.querySelector<HTMLButtonElement>('#br-royal-username-submit')!
    input.focus()

    cancelBtn.onclick = () => this.closeDomModal()
    overlay.onclick = (e) => {
      if (e.target === overlay) this.closeDomModal()
    }

    submitBtn.onclick = async () => {
      const candidate = input.value.trim()
      const v = validateRoyalUsername(candidate)
      if (!v.valid) {
        errEl.textContent = v.error ?? 'Invalid username.'
        return
      }
      submitBtn.disabled = true
      submitBtn.textContent = 'SAVING...'
      const { error } = await authService.changeUsernameOnce(v.normalized)
      if (error) {
        submitBtn.disabled = false
        submitBtn.textContent = 'CONFIRM (1/1)'
        errEl.textContent = error.message
        return
      }
      this.closeDomModal()
      this.onAuthChanged?.()
      this.showToast(`Username updated to ${candidate}!`, 'success')
      await this.refreshOverview()
    }
  }

  private openDeleteAccountModal(): void {
    this.closeDomModal()
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10050;
      background: rgba(10, 8, 18, 0.82); backdrop-filter: blur(5px);
      display: flex; align-items: center; justify-content: center; padding: 16px;
      font-family: 'Lilita One', 'Nunito', sans-serif;
    `
    const card = document.createElement('div')
    card.style.cssText = `
      width: min(430px, 100%); background: #fff5f5; border: 4px solid #991b1b;
      border-radius: 18px; padding: 22px; box-shadow: 0 18px 44px rgba(0,0,0,0.7);
      color: #111625; text-align: center;
    `
    card.innerHTML = `
      <h3 style="margin: 0 0 8px; font-size: 22px; color: #991b1b;">DELETE ACCOUNT PERMANENTLY?</h3>
      <p style="margin: 0 0 12px; font-family: Nunito, sans-serif; font-size: 13px; color: #451a1a; font-weight: 700;">
        This permanently deletes your cloud profile, leaderboard entries, achievements, titles, and saved progress. This action <strong>cannot be undone</strong>.
      </p>
      <p style="margin: 0 0 8px; font-family: Nunito, sans-serif; font-size: 12px; color: #7f1d1d; font-weight: 800;">
        Type <code>DELETE</code> below to confirm:
      </p>
      <input id="br-delete-confirm-input" type="text" placeholder="Type DELETE"
        style="width: 100%; box-sizing: border-box; padding: 10px 14px; font-size: 15px; font-weight: 800;
        font-family: Nunito, sans-serif; border: 2px solid #dc2626; border-radius: 10px; background: #ffffff; color: #111625; text-align: center;" />
      <div id="br-delete-error" style="min-height: 20px; margin: 8px 0; font-family: Nunito, sans-serif; font-size: 12px; font-weight: 800; color: #b91c1c;"></div>
      <div style="display: flex; gap: 10px; justify-content: center; margin-top: 8px;">
        <button id="br-delete-cancel" type="button"
          style="flex: 1; padding: 11px; border-radius: 10px; border: 2px solid #111625; background: #e2e8f0; font-family: inherit; font-size: 14px; cursor: pointer;">
          KEEP ACCOUNT
        </button>
        <button id="br-delete-submit" type="button"
          style="flex: 1; padding: 11px; border-radius: 10px; border: 2px solid #111625; background: #ef4444; color: #ffffff; font-family: inherit; font-size: 14px; cursor: pointer;">
          DELETE FOREVER
        </button>
      </div>
    `
    overlay.appendChild(card)
    document.body.appendChild(overlay)
    this.domOverlay = overlay

    const input = card.querySelector<HTMLInputElement>('#br-delete-confirm-input')!
    const errEl = card.querySelector<HTMLDivElement>('#br-delete-error')!
    const cancelBtn = card.querySelector<HTMLButtonElement>('#br-delete-cancel')!
    const submitBtn = card.querySelector<HTMLButtonElement>('#br-delete-submit')!
    input.focus()

    cancelBtn.onclick = () => this.closeDomModal()
    overlay.onclick = (e) => {
      if (e.target === overlay) this.closeDomModal()
    }

    submitBtn.onclick = async () => {
      if (input.value.trim() !== 'DELETE') {
        errEl.textContent = 'Please type DELETE in uppercase to confirm.'
        return
      }
      submitBtn.disabled = true
      submitBtn.textContent = 'DELETING...'
      const { error } = await authService.deleteOwnAccount('DELETE')
      if (error) {
        submitBtn.disabled = false
        submitBtn.textContent = 'DELETE FOREVER'
        errEl.textContent = error.message
        return
      }
      this.closeDomModal()
      this.onAuthChanged?.()
      this.overview = buildFallbackOverviewFromSave(loadSave(), null)
      this.showToast('Your account has been permanently deleted.', 'success')
      this.renderActiveTab()
    }
  }
}