import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
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

export type WardrobeTab = 'mirror' | 'avatars' | 'trophies' | 'ledger'

const INK_HEX = '#111625'
const WOOD_DARK = 0x4e230f
const WOOD_MID = 0x82441d
const PARCHMENT = 0xfff9ec
const PARCHMENT_DARK = 0xf3e5c8
const PARCHMENT_EDGE = 0xcab58e
const VELVET_RED = 0x9e2424
const ROYAL_GOLD = 0xffce42
const ROYAL_GOLD_DARK = 0xa77a32
const ROYAL_PURPLE = 0x39284d
const BTN_EMERALD = 0x3ca72b
const BTN_EMERALD_SHADOW = 0x27741b
const BTN_EMERALD_HIGHLIGHT = 0x62cb49
const BODY_FONT = 'Nunito, ui-rounded, system-ui, sans-serif'

function cleanText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: {
    color: string
    size: number
    origin?: [number, number]
    weight?: '700' | '800'
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
    .setStroke(opts.color, 0.35)
}

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
    const iconR = r / (tier === 10 ? 2.45 : 1.42)
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
    g.fillStyle(0x23242e, 0.92)
    g.fillPoints(pts, true)
    g.lineStyle(ballOutlineWidth(r), INK, 1)
    g.strokePoints(pts, true, true)
    if (opts.layer) {
      const q = hudText(scene, cx, cy + 1, '?', 1, {
        color: '#6e7390',
        size: Math.max(12, Math.round(r * 1.05)),
        stroke: 2,
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

export class KingsWardrobeView {
  private readonly root: Phaser.GameObjects.Container
  private readonly bgLayer: Phaser.GameObjects.Container
  private readonly tabLayer: Phaser.GameObjects.Container
  private readonly contentLayer: Phaser.GameObjects.Container
  private readonly toastLayer: Phaser.GameObjects.Container
  private activeTab: WardrobeTab = 'mirror'
  private overview: KingsWardrobeOverview
  private inspectCharId: string = 'core:1'
  private trophyCategory: 'all' | 'gameplay' | 'merge' | 'collection' | 'score' | 'milestone' = 'all'
  private trophyPage = 0
  private destroyed = false
  private requestSeq = 0
  private animTimer: Phaser.Time.TimerEvent | null = null
  private liveRedraws: Array<(timeMs: number) => void> = []
  private domOverlay: HTMLDivElement | null = null

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

    this.root = scene.add.container(0, 0).setName('kings-wardrobe')
    parentContainer.add(this.root)

    this.bgLayer = scene.add.container(0, 0)
    this.tabLayer = scene.add.container(0, 0)
    this.contentLayer = scene.add.container(0, 0)
    this.toastLayer = scene.add.container(0, 0)
    this.root.add([this.bgLayer, this.tabLayer, this.contentLayer, this.toastLayer])

    this.renderBackdrop()
    this.renderTabs()
    this.renderActiveTab()
    void this.refreshOverview()

    this.animTimer = scene.time.addEvent({
      delay: 60,
      loop: true,
      callback: () => {
        if (this.destroyed) return
        const now = Date.now()
        for (const fn of this.liveRedraws) fn(now)
      },
    })

    this.root.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.cleanup()
    })
  }

  public getActiveTab(): WardrobeTab {
    return this.activeTab
  }

  public setTab(tab: WardrobeTab): void {
    if (this.destroyed || this.activeTab === tab) return
    this.activeTab = tab
    this.renderTabs()
    this.renderActiveTab()
  }

  public destroy(): void {
    if (this.destroyed) return
    this.cleanup()
    this.root.destroy()
  }

  private cleanup(): void {
    this.destroyed = true
    this.requestSeq++
    this.animTimer?.remove(false)
    this.animTimer = null
    this.liveRedraws.length = 0
    this.closeDomModal()
  }

  private async refreshOverview(): Promise<void> {
    const seq = ++this.requestSeq
    const { data } = await authService.getKingsWardrobeOverview()
    if (this.destroyed || seq !== this.requestSeq) return
    this.overview = data
    if (!isValidWardrobeCharacterId(this.inspectCharId)) {
      this.inspectCharId = data.profile.selected_avatar_id || 'core:1'
    }
    this.renderTabs()
    this.renderActiveTab()
  }

  private showToast(message: string, kind: 'success' | 'error' = 'success'): void {
    if (this.destroyed) return
    this.toastLayer.removeAll(true)
    const cx = this.vw / 2
    const y = this.topY + 26
    const w = Math.min(440, this.vw - 32)
    const h = 38
    const g = this.scene.add.graphics()
    g.fillStyle(kind === 'success' ? 0x1f6f3d : 0x9b2c2c, 0.96)
    g.fillRoundedRect(cx - w / 2, y - h / 2, w, h, 10)
    g.lineStyle(2.5, kind === 'success' ? 0x7ae582 : 0xff8a8a, 1)
    g.strokeRoundedRect(cx - w / 2, y - h / 2, w, h, 10)
    const t = hudText(this.scene, cx, y, message, 1, {
      color: '#ffffff',
      size: 13,
      stroke: 2,
      origin: [0.5, 0.5],
    })
    t.setScale(Math.min(1, (w - 24) / Math.max(1, t.width)))
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
    const maxW = Math.min(1080, this.vw - left - right)
    const panelX = Math.round(left + (this.vw - left - right - maxW) / 2)
    const panelY = Math.round(this.topY + 4)
    const panelH = Math.max(320, Math.round(this.vh - bottom - panelY))
    const tabBarH = this.vw < 520 ? 44 : 48
    const bodyY = panelY + tabBarH + 8
    const bodyH = panelH - tabBarH - 16
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
      compact: this.vw < 640 || this.vh < 700,
      wide: maxW >= 760 && this.vw > this.vh * 0.95,
    }
  }

  private renderBackdrop(): void {
    this.bgLayer.removeAll(true)
    const b = this.getLayoutBounds()
    const key = `br-kings-wardrobe-hall:${b.panelW}:${b.panelH}`
    bakeCanvas(this.scene, key, b.panelW, b.panelH, (ctx) => {
      // Royal velvet chamber frame
      const grad = ctx.createLinearGradient(0, 0, 0, b.panelH)
      grad.addColorStop(0, '#3e2956')
      grad.addColorStop(0.5, '#2b1b3d')
      grad.addColorStop(1, '#1d122b')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.roundRect(0, 0, b.panelW, b.panelH, 18)
      ctx.fill()

      // Carved oak moulding & brass trim
      ctx.lineWidth = 5
      ctx.strokeStyle = '#111625'
      ctx.stroke()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#d6a640'
      ctx.beginPath()
      ctx.roundRect(5, 5, b.panelW - 10, b.panelH - 10, 14)
      ctx.stroke()

      // Subtle royal tapestry vertical stripes
      ctx.fillStyle = 'rgba(255, 206, 66, 0.035)'
      for (let x = 24; x < b.panelW - 24; x += 48) {
        ctx.fillRect(x, 12, 18, b.panelH - 24)
      }
    }, window.devicePixelRatio || 1)

    const bgImg = this.scene.add.image(b.panelX, b.panelY, key).setOrigin(0, 0).setDisplaySize(b.panelW, b.panelH)
    this.bgLayer.add(bgImg)
  }

  private renderTabs(): void {
    this.tabLayer.removeAll(true)
    const b = this.getLayoutBounds()
    const tabs: Array<{ id: WardrobeTab; label: string; shortLabel: string }> = [
      { id: 'mirror', label: 'ROYAL MIRROR', shortLabel: 'MIRROR' },
      { id: 'avatars', label: 'WARDROBE & FAVORITES', shortLabel: 'WARDROBE' },
      { id: 'trophies', label: 'TROPHIES & TITLES', shortLabel: 'TROPHIES' },
      { id: 'ledger', label: 'LEDGER & ACCOUNT', shortLabel: 'ACCOUNT' },
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
        label: b.panelW < 620 ? t.shortLabel : t.label,
        fontSize: b.panelW < 420 ? 10 : b.panelW < 680 ? 11 : 13,
        fill: active ? UI_COLORS.BTN_GOLD : 0x3b2a54,
        shadowColor: active ? UI_COLORS.BTN_GOLD_SHADOW : 0x1e142d,
        highlightColor: active ? UI_COLORS.BTN_GOLD_HIGHLIGHT : 0x563f78,
        textColor: active ? '#fffdf5' : '#d5c7ea',
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
  }

  private drawParchmentCard(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    headerH = 34,
  ): void {
    // Drop shadow
    g.fillStyle(0x110b1a, 0.45)
    g.fillRoundedRect(x + 2, y + 4, w, h, 14)
    // Wood outer border
    g.fillStyle(WOOD_MID, 1)
    g.fillRoundedRect(x, y, w, h, 14)
    g.lineStyle(2.5, INK, 1)
    g.strokeRoundedRect(x, y, w, h, 14)
    // Warm parchment interior
    g.fillStyle(PARCHMENT, 1)
    g.fillRoundedRect(x + 5, y + 5, w - 10, h - 10, 10)
    g.lineStyle(1.5, PARCHMENT_EDGE, 1)
    g.strokeRoundedRect(x + 5, y + 5, w - 10, h - 10, 10)
    if (headerH > 0) {
      g.fillStyle(WOOD_DARK, 1)
      g.fillRoundedRect(x + 5, y + 5, w - 10, headerH, { tl: 10, tr: 10, bl: 0, br: 0 })
      g.lineStyle(1.5, ROYAL_GOLD_DARK, 0.9)
      g.lineBetween(x + 6, y + 5 + headerH, x + w - 6, y + 5 + headerH)
    }
  }

  // ===========================================================================
  // TAB 1: ROYAL MIRROR (Identity) & PERSONAL PLAYER CARD
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
    const leftW = b.wide ? Math.floor((b.bodyW - gap) * 0.48) : b.bodyW
    const rightW = b.wide ? b.bodyW - leftW - gap : b.bodyW
    const leftX = b.bodyX
    const rightX = b.wide ? b.bodyX + leftW + gap : b.bodyX
    const leftH = b.wide ? b.bodyH : Math.floor((b.bodyH - gap) * 0.44)
    const rightH = b.wide ? b.bodyH : b.bodyH - leftH - gap
    const leftY = b.bodyY
    const rightY = b.wide ? b.bodyY : b.bodyY + leftH + gap

    // --- 1. ROYAL MIRROR PANEL ---
    this.drawParchmentCard(g, leftX, leftY, leftW, leftH, 32)
    const mirrorTitle = hudText(this.scene, leftX + leftW / 2, leftY + 21, 'THE ROYAL MIRROR', 1, {
      color: '#ffe19a',
      size: 14,
      stroke: 2.5,
      origin: [0.5, 0.5],
    })
    this.contentLayer.add(mirrorTitle)

    const mirrorCenterX = leftX + (b.wide ? leftW / 2 : Math.max(54, Math.min(76, leftW * 0.22)))
    const mirrorCenterY = leftY + (b.wide ? Math.min(144, 38 + (leftH - 38) * 0.34) : 38 + (leftH - 38) * 0.5)
    const mirrorR = Math.max(26, Math.min(b.wide ? 52 : 36, (leftH - 64) * 0.32))
    // Ornate golden mirror frame
    g.fillStyle(ROYAL_GOLD_DARK, 1)
    g.fillCircle(mirrorCenterX, mirrorCenterY, mirrorR + 9)
    g.fillStyle(ROYAL_GOLD, 1)
    g.fillCircle(mirrorCenterX, mirrorCenterY, mirrorR + 6)
    g.lineStyle(2.5, INK, 1)
    g.strokeCircle(mirrorCenterX, mirrorCenterY, mirrorR + 8)
    g.fillStyle(0x231734, 1)
    g.fillCircle(mirrorCenterX, mirrorCenterY, mirrorR)
    g.lineStyle(2, 0xffe9a6, 0.85)
    g.strokeCircle(mirrorCenterX, mirrorCenterY, mirrorR)

    // Animated avatar inside the Royal Mirror
    const mirrorBallLayer = this.scene.add.container(mirrorCenterX, mirrorCenterY)
    const mirrorBallG = this.scene.add.graphics()
    mirrorBallLayer.add(mirrorBallG)
    this.contentLayer.add(mirrorBallLayer)

    const avatarVariant = getCharacterVariantFromSave(save, selectedChar.id)
    const drawMirrorAvatar = (now: number) => {
      mirrorBallG.clear()
      const blink = now % 3800 < 130
      const bob = Math.sin(now * 0.0035) * 2
      renderWardrobeBallCharacter(this.scene, mirrorBallG, selectedChar.id, 0, bob, mirrorR * 0.72, {
        blink,
        variant: avatarVariant,
      })
    }
    drawMirrorAvatar(Date.now())
    this.liveRedraws.push(drawMirrorAvatar)

    // Identity details block
    const infoLeftX = mirrorCenterX + mirrorR + 18
    const infoRightPad = 14
    const infoMaxW = b.wide ? leftW - 32 : Math.max(120, leftX + leftW - infoRightPad - infoLeftX)
    const infoCenterX = b.wide ? leftX + leftW / 2 : infoLeftX + infoMaxW / 2
    const nameY = b.wide ? mirrorCenterY + mirrorR + 24 : mirrorCenterY - (b.compact ? 42 : 46)

    const nameText = cleanText(this.scene, infoCenterX, nameY, displayName, {
      color: INK_HEX,
      size: b.compact ? 17 : 21,
      origin: [0.5, 0.5],
    })
    nameText.setScale(Math.min(1, infoMaxW / Math.max(1, nameText.width)))
    this.contentLayer.add(nameText)

    // Active Royal Title Ribbon
    const ribbonW = Math.min(infoMaxW, 220)
    const ribbonH = 22
    const ribbonY = nameY + (b.compact ? 21 : 25)
    g.fillStyle(VELVET_RED, 1)
    g.fillRoundedRect(infoCenterX - ribbonW / 2, ribbonY - ribbonH / 2, ribbonW, ribbonH, 6)
    g.lineStyle(1.5, ROYAL_GOLD, 1)
    g.strokeRoundedRect(infoCenterX - ribbonW / 2, ribbonY - ribbonH / 2, ribbonW, ribbonH, 6)

    const titleBadge = hudText(this.scene, infoCenterX, ribbonY, activeTitleName.toUpperCase(), 1, {
      color: '#ffe596',
      size: 10,
      stroke: 2,
      origin: [0.5, 0.5],
    })
    titleBadge.setScale(Math.min(1, (ribbonW - 14) / Math.max(1, titleBadge.width)))
    this.contentLayer.add(titleBadge)

    // One-time username change status & CTA
    const hasChangedUsername = Boolean(prof.username_changed_at)
    const statusLabel = !isAuthed
      ? 'Guest Adventurer — Sign in to claim name'
      : hasChangedUsername
        ? 'Royal Decree: Name change used (1/1)'
        : '1 Free Lifetime Username Change Ready'
    const statusY = ribbonY + (b.compact ? 19 : 24)
    const statusT = cleanText(this.scene, infoCenterX, statusY, statusLabel, {
      color: hasChangedUsername ? '#7c6248' : '#266d30',
      size: 11,
      origin: [0.5, 0.5],
    })
    statusT.setScale(Math.min(1, infoMaxW / Math.max(1, statusT.width)))
    this.contentLayer.add(statusT)

    const btnW = Math.min(infoMaxW, 200)
    const btnH = b.compact ? 32 : 38
    const btnY = b.wide ? leftY + leftH - btnH / 2 - 16 : Math.min(leftY + leftH - btnH / 2 - 12, statusY + (b.compact ? 25 : 28))
    if (!isAuthed) {
      const signInBtn = new ChunkyButton({
        scene: this.scene,
        x: infoCenterX,
        y: btnY,
        w: btnW,
        h: btnH,
        label: 'SIGN IN / REGISTER',
        fontSize: 12,
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
        label: hasChangedUsername ? 'NAME LOCKED' : 'CHANGE USERNAME',
        fontSize: 12,
        disabled: hasChangedUsername,
        fill: UI_COLORS.BTN_GOLD,
        shadowColor: UI_COLORS.BTN_GOLD_SHADOW,
        highlightColor: UI_COLORS.BTN_GOLD_HIGHLIGHT,
        onClick: () => this.openUsernameChangeModal(),
      })
      renameBtn.container.setName('wardrobe-change-username-btn')
      this.contentLayer.add(renameBtn.container)
    }

    // --- 2. PERSONAL ROYAL HERALDIC PLAYER CARD ---
    this.drawParchmentCard(g, rightX, rightY, rightW, rightH, 32)
    const cardHeader = hudText(this.scene, rightX + rightW / 2, rightY + 21, 'ROYAL PLAYER CREST & FAVORITES', 1, {
      color: '#ffe19a',
      size: 14,
      stroke: 2.5,
      origin: [0.5, 0.5],
    })
    this.contentLayer.add(cardHeader)

    // Crest banner inside the right card
    const crestX = rightX + 16
    const crestY = rightY + 46
    const crestW = rightW - 32
    const crestH = b.compact ? 58 : 68
    g.fillStyle(ROYAL_PURPLE, 1)
    g.fillRoundedRect(crestX, crestY, crestW, crestH, 10)
    g.lineStyle(2, ROYAL_GOLD, 1)
    g.strokeRoundedRect(crestX, crestY, crestW, crestH, 10)

    const crestAvatarR = b.compact ? 20 : 23
    const crestAvatarX = crestX + 32
    const crestAvatarY = crestY + crestH / 2
    g.fillStyle(0x201530, 1)
    g.fillCircle(crestAvatarX, crestAvatarY, crestAvatarR + 4)
    g.lineStyle(2, ROYAL_GOLD, 1)
    g.strokeCircle(crestAvatarX, crestAvatarY, crestAvatarR + 4)

    const crestBallG = this.scene.add.graphics()
    this.contentLayer.add(crestBallG)
    renderWardrobeBallCharacter(this.scene, crestBallG, selectedChar.id, crestAvatarX, crestAvatarY, crestAvatarR * 0.78, {
      variant: avatarVariant,
    })

    const crestName = hudText(this.scene, crestAvatarX + crestAvatarR + 14, crestY + (b.compact ? 18 : 22), displayName, 1, {
      color: '#fff8e9',
      size: b.compact ? 15 : 17,
      stroke: 2.5,
      origin: [0, 0.5],
    })
    crestName.setScale(Math.min(1, (crestW - 95) / Math.max(1, crestName.width)))
    const crestSub = hudText(this.scene, crestAvatarX + crestAvatarR + 14, crestY + (b.compact ? 38 : 44), activeTitleName, 1, {
      color: '#ffce42',
      size: 11,
      stroke: 2,
      origin: [0, 0.5],
    })
    crestSub.setScale(Math.min(1, (crestW - 95) / Math.max(1, crestSub.width)))
    this.contentLayer.add([crestName, crestSub])

    // Favorite Champions Pedestals (3 velvet pedestals)
    const favHeaderY = crestY + crestH + (b.compact ? 16 : 22)
    const favTitle = cleanText(this.scene, rightX + rightW / 2, favHeaderY, 'FAVORITE CHAMPIONS SHOWCASE (UP TO 3)', {
      color: '#5f4326',
      size: 11,
      origin: [0.5, 0.5],
    })
    this.contentLayer.add(favTitle)

    const favIds = prof.favorite_ball_ids ?? []
    const slotGap = 12
    const slotW = Math.min(130, Math.floor((crestW - slotGap * 2) / 3))
    const totalSlotsW = slotW * 3 + slotGap * 2
    const startSlotX = rightX + (rightW - totalSlotsW) / 2
    const slotY = favHeaderY + (b.compact ? 12 : 16)
    const slotH = b.compact ? 62 : 90

    for (let i = 0; i < 3; i++) {
      const sx = startSlotX + i * (slotW + slotGap)
      const cx = sx + slotW / 2
      const cy = slotY + slotH * 0.44
      const favId = favIds[i]

      g.fillStyle(PARCHMENT_DARK, 1)
      g.fillRoundedRect(sx, slotY, slotW, slotH, 10)
      g.lineStyle(1.8, favId ? ROYAL_GOLD_DARK : PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(sx, slotY, slotW, slotH, 10)

      // Velvet cushion base
      g.fillStyle(VELVET_RED, 1)
      g.fillEllipse(cx, slotY + slotH - 18, slotW * 0.66, 12)
      g.lineStyle(1.5, ROYAL_GOLD, 1)
      g.strokeEllipse(cx, slotY + slotH - 18, slotW * 0.66, 12)

      if (favId && isValidWardrobeCharacterId(favId)) {
        const ch = getWardrobeCharacter(favId)
        const ballG = this.scene.add.graphics()
        this.contentLayer.add(ballG)
        const r = Math.min(22, slotH * 0.25)
        renderWardrobeBallCharacter(this.scene, ballG, ch.id, cx, cy, r, {
          variant: getCharacterVariantFromSave(save, ch.id),
        })
        const lbl = cleanText(this.scene, cx, slotY + slotH - 8, ch.name.toUpperCase(), {
          color: INK_HEX,
          size: 10,
          origin: [0.5, 0.5],
        })
        lbl.setScale(Math.min(1, (slotW - 8) / Math.max(1, lbl.width)))
        this.contentLayer.add(lbl)
      } else {
        const emptyLbl = cleanText(this.scene, cx, cy - 4, 'EMPTY\nPEDESTAL', {
          color: '#7c6850',
          size: 10,
          origin: [0.5, 0.5],
        }).setAlign('center')
        this.contentLayer.add(emptyLbl)
      }

      const hit = this.scene.add.zone(cx, slotY + slotH / 2, slotW, slotH).setInteractive({ useHandCursor: true })
      hit.on('pointerup', () => this.setTab('avatars'))
      this.contentLayer.add(hit)
    }

    // Summary stats footer on player card
    const statsY = slotY + slotH + (b.compact ? 14 : 20)
    const statsH = Math.max(42, rightY + rightH - statsY - 12)
    if (statsH >= 38) {
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
      const pillsG = this.scene.add.graphics()
      this.contentLayer.add(pillsG)
      pills.forEach((p, idx) => {
        const px = crestX + idx * (pillW + 8)
        pillsG.fillStyle(WOOD_DARK, 0.96)
        pillsG.fillRoundedRect(px, statsY, pillW, Math.min(48, statsH), 8)
        pillsG.lineStyle(1.4, ROYAL_GOLD, 0.92)
        pillsG.strokeRoundedRect(px, statsY, pillW, Math.min(48, statsH), 8)
        const kText = cleanText(this.scene, px + pillW / 2, statsY + 13, p.label, {
          color: '#e5d4b3',
          size: 9,
          origin: [0.5, 0.5],
        })
        const vText = hudText(this.scene, px + pillW / 2, statsY + 31, p.value, 1, {
          color: '#ffe19a',
          size: 14,
          stroke: 2.5,
          origin: [0.5, 0.5],
        })
        kText.setScale(Math.min(1, (pillW - 8) / Math.max(1, kText.width)))
        vText.setScale(Math.min(1, (pillW - 10) / Math.max(1, vText.width)))
        this.contentLayer.add([kText, vText])
      })
    }
  }

  // ===========================================================================
  // TAB 2: WARDROBE CABINET (Avatar Selection) & FAVORITE CHAMPIONS (3 Slots)
  // ===========================================================================
  private renderAvatarsAndFavoritesTab(b: ReturnType<KingsWardrobeView['getLayoutBounds']>): void {
    const g = this.scene.add.graphics()
    this.contentLayer.add(g)
    const save = loadSave()
    const unlockedSet = new Set(this.overview.unlocked_ball_ids)
    const selectedAvatarId = this.overview.profile.selected_avatar_id || 'core:1'
    const favoriteIds = [...(this.overview.profile.favorite_ball_ids ?? [])]

    const gap = 12
    const gridW = b.wide ? Math.floor((b.bodyW - gap) * 0.64) : b.bodyW
    const inspectW = b.wide ? b.bodyW - gridW - gap : b.bodyW
    const gridH = b.wide ? b.bodyH : Math.floor((b.bodyH - gap) * 0.62)
    const inspectH = b.wide ? b.bodyH : b.bodyH - gridH - gap
    const gridX = b.bodyX
    const gridY = b.bodyY
    const inspectX = b.wide ? b.bodyX + gridW + gap : b.bodyX
    const inspectY = b.wide ? b.bodyY : b.bodyY + gridH + gap

    this.drawParchmentCard(g, gridX, gridY, gridW, gridH, 32)
    const cabTitle = hudText(
      this.scene,
      gridX + gridW / 2,
      gridY + 21,
      `ROYAL WARDROBE CABINET (${unlockedSet.size}/${WARDROBE_CHARACTERS.length} UNLOCKED)`,
      1,
      { color: '#ffe19a', size: 13, stroke: 2.5, origin: [0.5, 0.5] },
    )
    this.contentLayer.add(cabTitle)

    // 14 canonical Ball Rush characters in a clean grid
    const cols = gridW >= 520 ? 5 : 4
    const rows = Math.ceil(WARDROBE_CHARACTERS.length / cols)
    const padX = 14
    const padY = 42
    const cellGap = 8
    const availW = gridW - padX * 2
    const availH = gridH - padY - 12
    const cellW = Math.floor((availW - cellGap * (cols - 1)) / cols)
    const cellH = Math.floor((availH - cellGap * (rows - 1)) / rows)

    WARDROBE_CHARACTERS.forEach((char, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const cx = gridX + padX + col * (cellW + cellGap) + cellW / 2
      const cy = gridY + padY + row * (cellH + cellGap) + cellH / 2
      const x0 = cx - cellW / 2
      const y0 = cy - cellH / 2
      const isUnlocked = unlockedSet.has(char.id)
      const isSelectedAvatar = selectedAvatarId === char.id
      const favIdx = favoriteIds.indexOf(char.id)
      const isInspected = this.inspectCharId === char.id

      g.fillStyle(isInspected ? 0xfff3cf : isUnlocked ? PARCHMENT_DARK : 0xdad0be, 1)
      g.fillRoundedRect(x0, y0, cellW, cellH, 10)
      g.lineStyle(
        isInspected || isSelectedAvatar ? 2.8 : 1.5,
        isSelectedAvatar ? 0x2e8540 : isInspected ? ROYAL_GOLD_DARK : PARCHMENT_EDGE,
        1,
      )
      g.strokeRoundedRect(x0, y0, cellW, cellH, 10)

      const ballLayer = this.scene.add.container(0, 0)
      const ballG = this.scene.add.graphics()
      ballLayer.add(ballG)
      this.contentLayer.add(ballLayer)
      const r = Math.max(12, Math.min(cellW * 0.27, cellH * 0.28))
      renderWardrobeBallCharacter(this.scene, ballG, char.id, cx, cy - 6, r, {
        locked: !isUnlocked,
        variant: getCharacterVariantFromSave(save, char.id),
        layer: ballLayer,
      })

      const lbl = cleanText(this.scene, cx, y0 + cellH - 10, isUnlocked ? char.name : 'LOCKED', {
        color: isUnlocked ? INK_HEX : '#6b6257',
        size: 11,
        origin: [0.5, 0.5],
      })
      lbl.setScale(Math.min(1, (cellW - 8) / Math.max(1, lbl.width)))
      this.contentLayer.add(lbl)

      if (isSelectedAvatar) {
        const badge = hudText(this.scene, x0 + 8, y0 + 9, 'AVATAR', 1, {
          color: '#ffffff',
          size: 8,
          stroke: 2,
          origin: [0, 0.5],
        })
        this.contentLayer.add(badge)
      }
      if (favIdx !== -1) {
        const favBadge = hudText(this.scene, x0 + cellW - 8, y0 + 9, `★${favIdx + 1}`, 1, {
          color: '#ffce42',
          size: 10,
          stroke: 2,
          origin: [1, 0.5],
        })
        this.contentLayer.add(favBadge)
      }

      const zone = this.scene.add.zone(cx, cy, cellW, cellH).setInteractive({ useHandCursor: true })
      zone.setName(`wardrobe-char-${char.id}`)
      zone.on('pointerup', () => {
        this.inspectCharId = char.id
        this.renderActiveTab()
      })
      this.contentLayer.add(zone)
    })

    // --- INSPECTOR & ACTION PANEL ---
    this.drawParchmentCard(g, inspectX, inspectY, inspectW, inspectH, 32)
    const inspected: WardrobeCharacter = getWardrobeCharacter(this.inspectCharId)
    const isUnlocked = unlockedSet.has(inspected.id)
    const isCurrentAvatar = selectedAvatarId === inspected.id
    const isFavorite = favoriteIds.includes(inspected.id)

    const inspTitle = hudText(this.scene, inspectX + inspectW / 2, inspectY + 21, 'CHAMPION STAND', 1, {
      color: '#ffe19a',
      size: 13,
      stroke: 2.5,
      origin: [0.5, 0.5],
    })
    this.contentLayer.add(inspTitle)

    const previewX = b.wide ? inspectX + inspectW / 2 : inspectX + 68
    const previewY = b.wide ? inspectY + 86 : inspectY + 40 + (inspectH - 40) / 2
    const previewR = b.wide ? 34 : 26
    g.fillStyle(0x231734, 1)
    g.fillCircle(previewX, previewY, previewR + 8)
    g.lineStyle(2.5, ROYAL_GOLD, 1)
    g.strokeCircle(previewX, previewY, previewR + 8)

    const prevLayer = this.scene.add.container(0, 0)
    const prevG = this.scene.add.graphics()
    prevLayer.add(prevG)
    this.contentLayer.add(prevLayer)
    renderWardrobeBallCharacter(this.scene, prevG, inspected.id, previewX, previewY, previewR * 0.78, {
      locked: !isUnlocked,
      variant: getCharacterVariantFromSave(save, inspected.id),
      layer: prevLayer,
    })

    const textCenterX = b.wide ? inspectX + inspectW / 2 : inspectX + 124 + (inspectW - 136) / 2
    const textMaxW = b.wide ? inspectW - 28 : Math.max(140, inspectW - 140)
    const titleY = b.wide ? previewY + previewR + 24 : inspectY + 50

    const charTitle = cleanText(
      this.scene,
      textCenterX,
      titleY,
      isUnlocked ? `${inspected.name} (Tier ${inspected.tier})` : `Locked Character (Tier ${inspected.tier})`,
      { color: INK_HEX, size: 15, origin: [0.5, 0.5] },
    )
    charTitle.setScale(Math.min(1, textMaxW / Math.max(1, charTitle.width)))
    const reqText = cleanText(
      this.scene,
      textCenterX,
      titleY + 19,
      isUnlocked ? inspected.subtitle : `Unlock: ${inspected.requirement}`,
      { color: isUnlocked ? '#256b2a' : '#8f2424', size: 11, origin: [0.5, 0.5] },
    )
    reqText.setScale(Math.min(1, textMaxW / Math.max(1, reqText.width)))
    this.contentLayer.add([charTitle, reqText])

    const btnW = b.wide ? inspectW - 32 : Math.floor((textMaxW - 8) / 2)
    const btnH = b.compact ? 32 : 38
    const btn1X = b.wide ? textCenterX : textCenterX - btnW / 2 - 4
    const btn2X = b.wide ? textCenterX : textCenterX + btnW / 2 + 4
    const btn1Y = b.wide ? titleY + 54 : inspectY + inspectH - btnH / 2 - 12
    const btn2Y = b.wide ? btn1Y + btnH + 10 : btn1Y

    const equipAvatarBtn = new ChunkyButton({
      scene: this.scene,
      x: btn1X,
      y: btn1Y,
      w: btnW,
      h: btnH,
      label: !isUnlocked ? 'LOCKED' : isCurrentAvatar ? (b.wide ? 'ACTIVE AVATAR' : 'ACTIVE') : (b.wide ? 'SET AS AVATAR' : 'EQUIP'),
      fontSize: b.wide ? 11 : 10,
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
      fontSize: b.wide ? 11 : 10,
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
      this.showToast('Sign in to save your Royal Avatar to the leaderboard', 'error')
      return
    }
    const { error } = await authService.setSelectedAvatar(characterId)
    if (error) {
      this.showToast(error.message, 'error')
      return
    }
    this.overview.profile.selected_avatar_id = characterId
    this.showToast(`Royal Avatar updated to ${getWardrobeCharacter(characterId).name}!`, 'success')
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
    const { error } = await authService.saveFavoriteBalls(current)
    if (error) {
      this.showToast(error.message, 'error')
      return
    }
    this.overview.profile.favorite_ball_ids = current
    this.showToast('Favorite Champions updated!', 'success')
    this.renderActiveTab()
  }

  // ===========================================================================
  // TAB 3: ROYAL TROPHY CABINET (Achievements) & ROYAL TITLES
  // ===========================================================================
  private renderTrophiesAndTitlesTab(b: ReturnType<KingsWardrobeView['getLayoutBounds']>): void {
    const g = this.scene.add.graphics()
    this.contentLayer.add(g)

    const gap = 12
    const achW = b.wide ? Math.floor((b.bodyW - gap) * 0.64) : b.bodyW
    const titlesW = b.wide ? b.bodyW - achW - gap : b.bodyW
    const achH = b.wide ? b.bodyH : Math.floor((b.bodyH - gap) * 0.62)
    const titlesH = b.wide ? b.bodyH : b.bodyH - achH - gap
    const achX = b.bodyX
    const achY = b.bodyY
    const titlesX = b.wide ? b.bodyX + achW + gap : b.bodyX
    const titlesY = b.wide ? b.bodyY : b.bodyY + achH + gap

    const unlockedCount = this.overview.achievements.filter((a) => a.unlocked).length
    this.drawParchmentCard(g, achX, achY, achW, achH, 32)
    const achHeader = hudText(
      this.scene,
      achX + achW / 2,
      achY + 21,
      `ROYAL TROPHY CABINET (${unlockedCount}/${this.overview.achievements.length} EARNED)`,
      1,
      { color: '#ffe19a', size: 13, stroke: 2.5, origin: [0.5, 0.5] },
    )
    this.contentLayer.add(achHeader)

    // Category filter pills
    const cats: Array<{ id: 'all' | 'gameplay' | 'merge' | 'collection' | 'score' | 'milestone'; label: string }> = [
      { id: 'all', label: 'ALL' },
      { id: 'gameplay', label: 'RUNS' },
      { id: 'merge', label: 'MERGES' },
      { id: 'collection', label: 'COLLECTION' },
      { id: 'score', label: 'SCORE' },
      { id: 'milestone', label: 'TIERS' },
    ]
    const catGap = 5
    const catW = Math.floor((achW - 24 - catGap * (cats.length - 1)) / cats.length)
    const catY = achY + 52
    cats.forEach((c, i) => {
      const cx = achX + 12 + i * (catW + catGap) + catW / 2
      const active = this.trophyCategory === c.id
      const btn = new ChunkyButton({
        scene: this.scene,
        x: cx,
        y: catY,
        w: catW,
        h: 24,
        label: c.label,
        fontSize: 9,
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
    const pageSize = b.wide ? 4 : 3
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    this.trophyPage = Phaser.Math.Clamp(this.trophyPage, 0, totalPages - 1)
    const visibleItems = filtered.slice(this.trophyPage * pageSize, (this.trophyPage + 1) * pageSize)

    const listTopY = catY + 18
    const listBottomY = achY + achH - 38
    const rowGap = 6
    const rowH = Math.floor((listBottomY - listTopY - rowGap * (pageSize - 1)) / pageSize)

    visibleItems.forEach((ach, idx) => {
      const ry = listTopY + idx * (rowH + rowGap)
      const rx = achX + 12
      const rw = achW - 24
      g.fillStyle(ach.unlocked ? 0xfff5d6 : PARCHMENT_DARK, 1)
      g.fillRoundedRect(rx, ry, rw, rowH, 8)
      g.lineStyle(1.6, ach.unlocked ? ROYAL_GOLD_DARK : PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(rx, ry, rw, rowH, 8)

      // Medal emblem
      const medalX = rx + 24
      const medalY = ry + rowH / 2
      g.fillStyle(ach.unlocked ? ROYAL_GOLD : 0x8d8273, 1)
      g.fillCircle(medalX, medalY, 13)
      g.lineStyle(2, INK, 1)
      g.strokeCircle(medalX, medalY, 13)
      const iconT = hudText(this.scene, medalX, medalY, ach.unlocked ? '★' : '🔒', 1, {
        color: ach.unlocked ? INK_HEX : '#e5dec9',
        size: 12,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      })
      this.contentLayer.add(iconT)

      const titleT = cleanText(this.scene, rx + 46, ry + Math.min(18, rowH * 0.34), ach.name, {
        color: INK_HEX,
        size: 13,
        origin: [0, 0.5],
      })
      const subText = ach.reward_title_name
        ? `${ach.unlock_condition} • Grants Title: "${ach.reward_title_name}"`
        : ach.unlock_condition
      const descT = cleanText(this.scene, rx + 46, ry + Math.max(28, rowH * 0.68), subText, {
        color: '#5f4326',
        size: 11,
        origin: [0, 0.5],
        weight: '700',
      })
      descT.setScale(Math.min(1, (rw - 115) / Math.max(1, descT.width)))
      const statusBadge = cleanText(
        this.scene,
        rx + rw - 10,
        ry + rowH / 2,
        ach.unlocked ? 'UNLOCKED' : 'LOCKED',
        {
          color: ach.unlocked ? '#256b2a' : '#7a6c5d',
          size: 10,
          origin: [1, 0.5],
        },
      )
      this.contentLayer.add([titleT, descT, statusBadge])
    })

    // Pagination controls for Trophy Cabinet
    const pagerY = achY + achH - 20
    const prevBtn = new ChunkyButton({
      scene: this.scene,
      x: achX + 54,
      y: pagerY,
      w: 72,
      h: 26,
      label: 'PREV',
      fontSize: 10,
      disabled: this.trophyPage <= 0,
      fill: UI_COLORS.BTN_BLUE,
      onClick: () => {
        this.trophyPage = Math.max(0, this.trophyPage - 1)
        this.renderActiveTab()
      },
    })
    const nextBtn = new ChunkyButton({
      scene: this.scene,
      x: achX + achW - 54,
      y: pagerY,
      w: 72,
      h: 26,
      label: 'NEXT',
      fontSize: 10,
      disabled: this.trophyPage >= totalPages - 1,
      fill: UI_COLORS.BTN_BLUE,
      onClick: () => {
        this.trophyPage = Math.min(totalPages - 1, this.trophyPage + 1)
        this.renderActiveTab()
      },
    })
    const pageT = cleanText(this.scene, achX + achW / 2, pagerY, `PAGE ${this.trophyPage + 1} / ${totalPages}`, {
      color: INK_HEX,
      size: 11,
      origin: [0.5, 0.5],
    })
    this.contentLayer.add([prevBtn.container, nextBtn.container, pageT])

    // --- ROYAL TITLES SELECTOR ---
    this.drawParchmentCard(g, titlesX, titlesY, titlesW, titlesH, 32)
    const titlesHeader = hudText(this.scene, titlesX + titlesW / 2, titlesY + 21, 'ROYAL TITLES & HONORS', 1, {
      color: '#ffe19a',
      size: 13,
      stroke: 2.5,
      origin: [0.5, 0.5],
    })
    this.contentLayer.add(titlesHeader)

    const activeTitleId = this.overview.profile.active_title_id
    const allTitleAchievements = this.overview.achievements.filter((a) => a.reward_title_id && a.reward_title_name)
    const tStartY = titlesY + 42
    const tAvailH = titlesH - 52
    const maxTitlesShown = Math.min(allTitleAchievements.length, b.wide ? 6 : 4)
    const tGap = 5
    const tRowH = Math.floor((tAvailH - tGap * (maxTitlesShown - 1)) / maxTitlesShown)

    allTitleAchievements.slice(0, maxTitlesShown).forEach((ach, idx) => {
      const tid = ach.reward_title_id!
      const tname = ach.reward_title_name!
      const ty = tStartY + idx * (tRowH + tGap)
      const tx = titlesX + 12
      const tw = titlesW - 24
      const isEquipped = activeTitleId === tid

      g.fillStyle(isEquipped ? 0xfff0c2 : ach.unlocked ? PARCHMENT_DARK : 0xe2d8c5, 1)
      g.fillRoundedRect(tx, ty, tw, tRowH, 8)
      g.lineStyle(isEquipped ? 2.2 : 1.3, isEquipped ? ROYAL_GOLD_DARK : PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(tx, ty, tw, tRowH, 8)

      const nameLbl = cleanText(this.scene, tx + 10, ty + tRowH * 0.36, tname, {
        color: ach.unlocked ? INK_HEX : '#6b6257',
        size: 12,
        origin: [0, 0.5],
      })
      const srcLbl = cleanText(this.scene, tx + 10, ty + tRowH * 0.72, `From: ${ach.name}`, {
        color: '#5f4326',
        size: 10,
        origin: [0, 0.5],
        weight: '700',
      })
      this.contentLayer.add([nameLbl, srcLbl])

      const actionBtnW = 74
      const actionBtnH = Math.min(26, tRowH - 6)
      const eqBtn = new ChunkyButton({
        scene: this.scene,
        x: tx + tw - actionBtnW / 2 - 6,
        y: ty + tRowH / 2,
        w: actionBtnW,
        h: actionBtnH,
        label: !ach.unlocked ? 'LOCKED' : isEquipped ? 'UNEQUIP' : 'EQUIP',
        fontSize: 9,
        disabled: !ach.unlocked,
        fill: isEquipped ? UI_COLORS.BTN_GOLD : BTN_EMERALD,
        shadowColor: isEquipped ? UI_COLORS.BTN_GOLD_SHADOW : BTN_EMERALD_SHADOW,
        highlightColor: isEquipped ? UI_COLORS.BTN_GOLD_HIGHLIGHT : BTN_EMERALD_HIGHLIGHT,
        onClick: () => {
          void this.handleSelectTitle(isEquipped ? null : tid)
        },
      })
      eqBtn.container.setName(`wardrobe-title-${tid}`)
      this.contentLayer.add(eqBtn.container)
    })
  }

  private async handleSelectTitle(titleId: string | null): Promise<void> {
    if (!authService.isRegisteredAccount()) {
      this.showToast('Sign in to equip a Royal Title', 'error')
      return
    }
    const { error } = await authService.setActiveTitle(titleId)
    if (error) {
      this.showToast(error.message, 'error')
      return
    }
    this.overview.profile.active_title_id = titleId
    this.showToast(titleId ? `Equipped title: ${getTitleNameById(titleId)}!` : 'Royal Title cleared', 'success')
    this.renderActiveTab()
  }

  // ===========================================================================
  // TAB 4: THE ROYAL LEDGER (Lifetime Stats) & ROYAL ACCOUNT DESK
  // ===========================================================================
  private renderLedgerAndAccountTab(b: ReturnType<KingsWardrobeView['getLayoutBounds']>): void {
    const g = this.scene.add.graphics()
    this.contentLayer.add(g)

    const gap = 12
    const ledgerW = b.wide ? Math.floor((b.bodyW - gap) * 0.56) : b.bodyW
    const deskW = b.wide ? b.bodyW - ledgerW - gap : b.bodyW
    const ledgerH = b.wide ? b.bodyH : Math.floor((b.bodyH - gap) * 0.54)
    const deskH = b.wide ? b.bodyH : b.bodyH - ledgerH - gap
    const ledgerX = b.bodyX
    const ledgerY = b.bodyY
    const deskX = b.wide ? b.bodyX + ledgerW + gap : b.bodyX
    const deskY = b.wide ? b.bodyY : b.bodyY + ledgerH + gap

    // --- 1. THE ROYAL LEDGER (Lifetime Statistics) ---
    this.drawParchmentCard(g, ledgerX, ledgerY, ledgerW, ledgerH, 32)
    const ledgerHeader = hudText(this.scene, ledgerX + ledgerW / 2, ledgerY + 21, 'THE ROYAL LEDGER (LIFETIME STATS)', 1, {
      color: '#ffe19a',
      size: 13,
      stroke: 2.5,
      origin: [0.5, 0.5],
    })
    this.contentLayer.add(ledgerHeader)

    const st = this.overview.statistics
    const unlockedBalls = this.overview.unlocked_ball_ids.length
    const totalBalls = this.overview.total_available_balls
    const completionPct = Math.round((unlockedBalls / Math.max(1, totalBalls)) * 100)
    const unlockedAch = this.overview.achievements.filter((a) => a.unlocked).length

    const statItems: Array<{ label: string; value: string; isCoin?: boolean }> = [
      { label: 'TOTAL GAMES PLAYED', value: st.games_played.toLocaleString('en-US') },
      { label: 'TOTAL BALLS MERGED', value: st.total_merges.toLocaleString('en-US') },
      { label: 'HIGHEST BALL TIER', value: `Tier ${st.highest_tier}` },
      { label: 'BEST SCORE RECORD', value: st.best_score.toLocaleString('en-US') },
      { label: 'AVERAGE RUN SCORE', value: st.average_score.toLocaleString('en-US') },
      { label: 'TOTAL PLAYTIME', value: formatPlaytime(st.total_playtime_ms) },
      { label: 'TOTAL COINS EARNED', value: formatCoins(st.total_coins_earned), isCoin: true },
      { label: 'COLLECTION PROGRESS', value: `${unlockedBalls}/${totalBalls} (${completionPct}%)` },
      { label: 'ACHIEVEMENTS UNLOCKED', value: `${unlockedAch}/${this.overview.achievements.length}` },
    ]

    const cols = 3
    const rows = 3
    const padX = 12
    const padTop = 42
    const cellGap = 8
    const cellW = Math.floor((ledgerW - padX * 2 - cellGap * (cols - 1)) / cols)
    const cellH = Math.floor((ledgerH - padTop - 12 - cellGap * (rows - 1)) / rows)

    statItems.forEach((item, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const cx = ledgerX + padX + col * (cellW + cellGap)
      const cy = ledgerY + padTop + row * (cellH + cellGap)

      g.fillStyle(PARCHMENT_DARK, 1)
      g.fillRoundedRect(cx, cy, cellW, cellH, 8)
      g.lineStyle(1.4, PARCHMENT_EDGE, 1)
      g.strokeRoundedRect(cx, cy, cellW, cellH, 8)

      const kLbl = cleanText(this.scene, cx + cellW / 2, cy + Math.min(15, cellH * 0.3), item.label, {
        color: '#5f4326',
        size: 9,
        origin: [0.5, 0.5],
      })
      kLbl.setScale(Math.min(1, (cellW - 8) / Math.max(1, kLbl.width)))

      const valY = cy + Math.max(26, cellH * 0.66)
      if (item.isCoin) {
        const coinG = this.scene.add.graphics()
        this.contentLayer.add(coinG)
        const coinR = 9
        drawCoin(coinG, cx + cellW / 2 - 22, valY, coinR)
        const vLbl = cleanText(this.scene, cx + cellW / 2 - 8, valY, item.value, {
          color: INK_HEX,
          size: 15,
          origin: [0, 0.5],
        })
        this.contentLayer.add([kLbl, vLbl])
      } else {
        const vLbl = cleanText(this.scene, cx + cellW / 2, valY, item.value, {
          color: INK_HEX,
          size: 15,
          origin: [0.5, 0.5],
        })
        vLbl.setScale(Math.min(1, (cellW - 10) / Math.max(1, vLbl.width)))
        this.contentLayer.add([kLbl, vLbl])
      }
    })

    // --- 2. ROYAL ACCOUNT DESK (Account Management & Deletion) ---
    this.drawParchmentCard(g, deskX, deskY, deskW, deskH, 32)
    const deskHeader = hudText(this.scene, deskX + deskW / 2, deskY + 21, 'ROYAL ACCOUNT DESK', 1, {
      color: '#ffe19a',
      size: 13,
      stroke: 2.5,
      origin: [0.5, 0.5],
    })
    this.contentLayer.add(deskHeader)

    const isAuthed = authService.isRegisteredAccount()
    const prof = this.overview.profile
    const createdDate = prof.created_at
      ? new Date(prof.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Today'
    const providers = this.overview.auth_providers.length > 0
      ? this.overview.auth_providers.map((p) => p.toUpperCase()).join(', ')
      : isAuthed
        ? 'EMAIL / PASSWORD'
        : 'LOCAL GUEST'
    const shortId = isAuthed ? `${prof.id.slice(0, 8)}…${prof.id.slice(-4)}` : 'Guest Session (Local)'

    const metaRows = [
      { k: 'ACCOUNT STATUS', v: isAuthed ? 'Registered Royal Account' : 'Unregistered Guest' },
      { k: 'ROYAL ACCOUNT ID', v: shortId },
      { k: 'ENLISTED DATE', v: createdDate },
      { k: 'LINKED SIGN-IN', v: providers },
    ]

    const metaStartY = deskY + 46
    const metaRowH = b.compact ? 22 : 26
    metaRows.forEach((m, i) => {
      const my = metaStartY + i * metaRowH
      const kt = cleanText(this.scene, deskX + 16, my, `${m.k}:`, {
        color: '#5f4326',
        size: 10,
        origin: [0, 0.5],
      })
      const vt = cleanText(this.scene, deskX + deskW - 16, my, m.v, {
        color: INK_HEX,
        size: 11,
        origin: [1, 0.5],
      })
      this.contentLayer.add([kt, vt])
    })

    const actionAreaBottom = deskY + deskH - 14
    const btnH = b.compact ? 34 : 38
    const btnW = b.wide ? deskW - 32 : Math.floor((deskW - 40) / 2)

    if (!isAuthed) {
      const loginBtn = new ChunkyButton({
        scene: this.scene,
        x: deskX + deskW / 2,
        y: actionAreaBottom - btnH / 2,
        w: Math.min(260, deskW - 32),
        h: btnH,
        label: 'LOGIN / CREATE ACCOUNT',
        fontSize: 12,
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
      const logoutX = b.wide ? deskX + deskW / 2 : deskX + 16 + btnW / 2
      const deleteX = b.wide ? deskX + deskW / 2 : deskX + deskW - 16 - btnW / 2
      const logoutY = b.wide ? actionAreaBottom - btnH * 1.5 - 10 : actionAreaBottom - btnH / 2
      const deleteY = b.wide ? actionAreaBottom - btnH / 2 : actionAreaBottom - btnH / 2

      const logoutBtn = new ChunkyButton({
        scene: this.scene,
        x: logoutX,
        y: logoutY,
        w: btnW,
        h: btnH,
        label: 'LOGOUT',
        fontSize: 12,
        fill: UI_COLORS.BTN_GOLD,
        shadowColor: UI_COLORS.BTN_GOLD_SHADOW,
        highlightColor: UI_COLORS.BTN_GOLD_HIGHLIGHT,
        onClick: () => {
          void authService.signOut().then(() => {
            this.onAuthChanged?.()
            void this.refreshOverview()
          })
        },
      })
      logoutBtn.container.setName('wardrobe-logout-btn')

      const deleteBtn = new ChunkyButton({
        scene: this.scene,
        x: deleteX,
        y: deleteY,
        w: btnW,
        h: btnH,
        label: 'DELETE ACCOUNT',
        fontSize: 12,
        fill: UI_COLORS.BTN_RED,
        shadowColor: UI_COLORS.BTN_RED_SHADOW,
        highlightColor: UI_COLORS.BTN_RED_HIGHLIGHT,
        onClick: () => this.openDeleteAccountModal(),
      })
      deleteBtn.container.setName('wardrobe-delete-account-btn')
      this.contentLayer.add([logoutBtn.container, deleteBtn.container])
    }
  }

  // ===========================================================================
  // DOM MODALS FOR ONE-TIME USERNAME CHANGE & PERMANENT ACCOUNT DELETION
  // ===========================================================================
  private closeDomModal(): void {
    if (this.domOverlay) {
      this.domOverlay.remove()
      this.domOverlay = null
    }
  }

  private openUsernameChangeModal(): void {
    this.closeDomModal()
    const currentName = this.overview.profile.username || this.overview.profile.display_name || ''
    const overlay = document.createElement('div')
    overlay.className = 'auth-modal-backdrop'
    overlay.setAttribute('data-wardrobe-modal', 'username')
    overlay.innerHTML = `
      <div class="auth-modal-card" style="max-width: 420px; border: 3px solid #d6a640;">
        <button type="button" class="auth-modal-close" aria-label="Close">✕</button>
        <h2 style="font-family: 'Lilita One', sans-serif; color: #ffe19a; margin: 0 0 8px; font-size: 22px; text-align: center;">
          ROYAL NAME DECREE
        </h2>
        <p style="color: #d6c8b4; font-size: 13px; line-height: 1.45; text-align: center; margin: 0 0 14px;">
          You may change your Royal Username <strong>only once</strong> for the lifetime of your account. Choose wisely!
        </p>
        <form class="auth-modal-form" novalidate>
          <div class="auth-input-group">
            <label class="auth-input-label" for="wardrobe-new-username">New Royal Username (3–20 chars, letters/numbers/_)</label>
            <input
              id="wardrobe-new-username"
              type="text"
              class="auth-input"
              value="${currentName.replace(/"/g, '&quot;')}"
              minlength="3"
              maxlength="20"
              required
              autocomplete="off"
            />
          </div>
          <div class="auth-error-box" style="display: none"></div>
          <div style="display: flex; gap: 10px; margin-top: 14px;">
            <button type="button" class="auth-forgot-cancel" style="flex: 1; padding: 11px; border-radius: 10px;">Cancel</button>
            <button type="submit" class="auth-submit-btn" style="flex: 1; margin-top: 0;">
              <span class="auth-submit-text">Seal Decree</span>
            </button>
          </div>
        </form>
      </div>
    `
    document.body.appendChild(overlay)
    this.domOverlay = overlay

    const closeBtn = overlay.querySelector<HTMLButtonElement>('.auth-modal-close')!
    const cancelBtn = overlay.querySelector<HTMLButtonElement>('.auth-forgot-cancel')!
    const form = overlay.querySelector<HTMLFormElement>('form')!
    const input = overlay.querySelector<HTMLInputElement>('#wardrobe-new-username')!
    const errorBox = overlay.querySelector<HTMLDivElement>('.auth-error-box')!
    const submitBtn = overlay.querySelector<HTMLButtonElement>('.auth-submit-btn')!

    closeBtn.onclick = () => this.closeDomModal()
    cancelBtn.onclick = () => this.closeDomModal()
    input.focus()

    form.onsubmit = async (e) => {
      e.preventDefault()
      errorBox.style.display = 'none'
      const check = validateRoyalUsername(input.value)
      if (!check.valid) {
        errorBox.textContent = check.error ?? 'Invalid username'
        errorBox.style.display = 'block'
        return
      }
      submitBtn.disabled = true
      const { error } = await authService.changeUsernameOnce(check.normalized)
      submitBtn.disabled = false
      if (error) {
        errorBox.textContent = error.message
        errorBox.style.display = 'block'
        return
      }
      this.closeDomModal()
      this.showToast(`Royal Username permanently updated to ${check.normalized}!`, 'success')
      this.onAuthChanged?.()
      await this.refreshOverview()
    }
  }

  private openDeleteAccountModal(): void {
    this.closeDomModal()
    const overlay = document.createElement('div')
    overlay.className = 'auth-modal-backdrop'
    overlay.setAttribute('data-wardrobe-modal', 'delete-account')
    overlay.innerHTML = `
      <div class="auth-modal-card" style="max-width: 430px; border: 3px solid #e05252;">
        <button type="button" class="auth-modal-close" aria-label="Close">✕</button>
        <h2 style="font-family: 'Lilita One', sans-serif; color: #ff7b7b; margin: 0 0 8px; font-size: 22px; text-align: center;">
          DELETE ROYAL ACCOUNT
        </h2>
        <p style="color: #f2dede; font-size: 13px; line-height: 1.45; text-align: center; margin: 0 0 12px;">
          This action is <strong>permanent and irreversible</strong>. Your profile, leaderboard scores, coins, upgrades, achievements, and titles will be permanently erased.
        </p>
        <form class="auth-modal-form" novalidate>
          <div class="auth-input-group">
            <label class="auth-input-label" for="wardrobe-delete-confirm">Type <strong>DELETE</strong> to confirm permanent removal</label>
            <input
              id="wardrobe-delete-confirm"
              type="text"
              class="auth-input"
              placeholder="DELETE"
              required
              autocomplete="off"
            />
          </div>
          <div class="auth-error-box" style="display: none"></div>
          <div style="display: flex; gap: 10px; margin-top: 14px;">
            <button type="button" class="auth-forgot-cancel" style="flex: 1; padding: 11px; border-radius: 10px;">Keep Account</button>
            <button type="submit" class="auth-submit-btn" style="flex: 1; margin-top: 0; background: #c9302c;">
              <span class="auth-submit-text">Delete Forever</span>
            </button>
          </div>
        </form>
      </div>
    `
    document.body.appendChild(overlay)
    this.domOverlay = overlay

    const closeBtn = overlay.querySelector<HTMLButtonElement>('.auth-modal-close')!
    const cancelBtn = overlay.querySelector<HTMLButtonElement>('.auth-forgot-cancel')!
    const form = overlay.querySelector<HTMLFormElement>('form')!
    const input = overlay.querySelector<HTMLInputElement>('#wardrobe-delete-confirm')!
    const errorBox = overlay.querySelector<HTMLDivElement>('.auth-error-box')!
    const submitBtn = overlay.querySelector<HTMLButtonElement>('.auth-submit-btn')!

    closeBtn.onclick = () => this.closeDomModal()
    cancelBtn.onclick = () => this.closeDomModal()
    input.focus()

    form.onsubmit = async (e) => {
      e.preventDefault()
      errorBox.style.display = 'none'
      if (input.value.trim() !== 'DELETE') {
        errorBox.textContent = 'Please type DELETE in uppercase to confirm'
        errorBox.style.display = 'block'
        return
      }
      submitBtn.disabled = true
      const { error } = await authService.deleteOwnAccount('DELETE')
      submitBtn.disabled = false
      if (error) {
        errorBox.textContent = error.message
        errorBox.style.display = 'block'
        return
      }
      this.closeDomModal()
      this.showToast('Your account has been permanently deleted.', 'success')
      this.onAuthChanged?.()
    }
  }
}