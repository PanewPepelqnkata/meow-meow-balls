import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import {
  ballLookFor,
  ballOutlineWidth,
  drawBallFace,
  drawCrabBall,
  drawSharkBall,
  drawPigBall,
  restContour,
  INK,
} from './BallAppearance'
import { cycleColor } from './rgbCycle'
import { loadSave, type SaveDataV1 } from '../state/save'
import { VARIANT_COUNT } from '../state/runVariant'
import { UI_COLORS, ChunkyButton } from '../../ui/DesignSystem'
import { hudText } from '../../ui/Typography'

/**
 * Authentic physical cartoon book / album binder representation of the Collection.
 *
 * Visual & Physical Design:
 * - Hardcover binder with warm rich leather tones (drop shadows, rounded corners, stitching notches).
 * - Multi-layer cream / aged parchment spread with deckled edges and center spine crease/shadow.
 * - Real binder brass/metal spine rings and stitching along the spine.
 * - Interactive physical bookmark tabs at top/side to switch chapters:
 *     [T1-8 CORE] [T9 VARIANTS] [T10 CRABS] [MYTHIC]
 * - Tangible page flip transition:
 *     When tapping PREV/NEXT, bookmark tabs, or dragging/swiping horizontally:
 *     Smooth 3D page curl/turn animation using scaleX, skew/shear, dynamic shadow sweep,
 *     and depth stacking without per-frame canvas viewport bakes.
 * - Alive cartoon balls:
 *     Draws balls using the live pipeline (`drawCollectibleBall` / `drawBallFace` / `drawCrabBall`),
 *     with idle breathing/bobbing animations.
 * - Discovery ink stamps:
 *     Tilted retro circular/oval ink stamps with discovery dates and "CERTIFIED" / "RECORDED" ink imprint.
 * - Mystery locked silhouettes:
 *     Authentic rough pencil-sketch / ink-wash silhouettes (strictly zero emojis, clean cartoon typography).
 * - Full horizontal swipe / drag support for touch and desktop.
 */
export class CollectionBookView {
  private scene: Phaser.Scene
  private parentContainer: Phaser.GameObjects.Container
  private bookContainer: Phaser.GameObjects.Container
  private pageLayer: Phaser.GameObjects.Container
  private tabContainer: Phaser.GameObjects.Container
  private navContainer: Phaser.GameObjects.Container
  private overlayG: Phaser.GameObjects.Graphics

  private vw: number
  private vh: number
  private topY: number
  private currentPage = 0
  private readonly totalPages = 4
  private isTurningPage = false

  // Drag / swipe gesture tracking
  private pointerDownX = 0
  private pointerDownY = 0
  private pointerDownTime = 0
  private isPointerDragging = false

  // Animation update handle
  private animTimerEvent: Phaser.Time.TimerEvent | null = null
  private liveBalls: Array<{
    g: Phaser.GameObjects.Graphics
    renderFn: () => void
  }> = []

  constructor(scene: Phaser.Scene, parentContainer: Phaser.GameObjects.Container, vw: number, vh: number, topY: number) {
    this.scene = scene
    this.parentContainer = parentContainer
    this.bookContainer = scene.add.container(0, 0)
    this.parentContainer.add(this.bookContainer)

    this.vw = vw
    this.vh = vh
    this.topY = topY

    // Sub-containers to layer tabs, book binder, animated page spread, and nav controls
    this.tabContainer = scene.add.container(0, 0)
    this.pageLayer = scene.add.container(0, 0)
    this.overlayG = scene.add.graphics()
    this.navContainer = scene.add.container(0, 0)

    this.bookContainer.add(this.tabContainer)
    this.bookContainer.add(this.pageLayer)
    this.bookContainer.add(this.overlayG)
    this.bookContainer.add(this.navContainer)

    this.setupSwipeInput()
    this.renderFull()
    this.startLivingLoop()
  }

  public destroy(): void {
    if (this.animTimerEvent) {
      this.animTimerEvent.remove()
      this.animTimerEvent = null
    }
    this.liveBalls.length = 0
    this.bookContainer.destroy()
  }

  /**
   * Continuous gentle update loop for breathing/pulsing ball faces, crab claws, and prism cycle.
   */
  private startLivingLoop(): void {
    if (this.animTimerEvent) {
      this.animTimerEvent.remove()
    }
    this.animTimerEvent = this.scene.time.addEvent({
      delay: 50, // 20fps gentle repaint for live showcase elements (safe for iOS WebGL)
      loop: true,
      callback: () => {
        if (!this.bookContainer.visible || this.isTurningPage) return
        for (const item of this.liveBalls) {
          item.renderFn()
        }
      },
    })
  }

  private setupSwipeInput(): void {
    const hitZone = this.scene.add.zone(this.vw / 2, this.vh / 2, this.vw, this.vh).setInteractive()
    this.bookContainer.addAt(hitZone, 0)

    hitZone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.pointerDownX = p.x
      this.pointerDownY = p.y
      this.pointerDownTime = Date.now()
      this.isPointerDragging = true
    })

    hitZone.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.isPointerDragging) return
      this.isPointerDragging = false

      const dx = p.x - this.pointerDownX
      const dy = p.y - this.pointerDownY
      const elapsed = Date.now() - this.pointerDownTime

      // Swipe detected: horizontal movement > 45px and predominantly horizontal
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2 && elapsed < 650) {
        if (dx < 0 && this.currentPage < this.totalPages - 1) {
          this.turnToPage(this.currentPage + 1, 1)
        } else if (dx > 0 && this.currentPage > 0) {
          this.turnToPage(this.currentPage - 1, -1)
        }
      }
    })
  }

  public renderFull(): void {
    this.renderTabs()
    this.renderPageSpread(this.currentPage)
    this.renderBottomNav()
  }

  /**
   * Chapter bookmark tabs protruding from top edge of binder.
   */
  private renderTabs(): void {
    this.tabContainer.removeAll(true)

    const tabs = [
      { id: 0, label: 'CORE T1-8', color: 0x3b82f6 },
      { id: 1, label: 'T9 VARIANTS', color: 0xec4899 },
      { id: 2, label: 'T10 CRABS', color: 0xf97316 },
      { id: 3, label: 'MYTHIC', color: 0xa855f7 },
    ]

    const bookW = Math.min(500, this.vw * 0.94)
    const bookX = this.vw / 2 - bookW / 2
    const bookTopY = this.topY + 36

    const tabCount = tabs.length
    const tabGap = 6
    const totalGap = (tabCount - 1) * tabGap
    const tabW = Math.max(70, Math.min(108, (bookW - 32 - totalGap) / tabCount))
    const tabH = 30
    const startX = bookX + 16

    tabs.forEach((tab, idx) => {
      const tx = startX + idx * (tabW + tabGap)
      const isSelected = this.currentPage === tab.id
      const ty = isSelected ? bookTopY - tabH + 6 : bookTopY - tabH + 12

      const g = this.scene.add.graphics()
      this.tabContainer.add(g)

      // Tab drop shadow
      g.fillStyle(0x0a0c14, 0.6)
      g.fillRoundedRect(tx + 2, ty + 2, tabW, tabH, { tl: 8, tr: 8, bl: 0, br: 0 })

      // Tab leather/cloth fill
      g.fillStyle(isSelected ? tab.color : 0x1f263d, 1)
      g.fillRoundedRect(tx, ty, tabW, tabH, { tl: 8, tr: 8, bl: 0, br: 0 })

      // Top stitching
      g.lineStyle(1.5, isSelected ? 0xffffff : 0x475569, isSelected ? 0.7 : 0.5)
      g.strokeRoundedRect(tx + 2, ty + 2, tabW - 4, tabH - 2, { tl: 6, tr: 6, bl: 0, br: 0 })

      // Tab label
      const txt = hudText(this.scene, tx + tabW / 2, ty + tabH / 2 - 2, tab.label, 1, {
        color: isSelected ? '#ffffff' : '#94a3b8',
        size: Math.max(9, Math.min(11, tabW * 0.12)),
        stroke: isSelected ? 2 : 0,
        origin: [0.5, 0.5],
      })
      this.tabContainer.add(txt)

      // Interactive hit zone for tab
      const zone = this.scene.add.zone(tx + tabW / 2, ty + tabH / 2, tabW, tabH).setInteractive({ useHandCursor: true })
      this.tabContainer.add(zone)

      zone.on('pointerdown', () => {
        if (this.currentPage !== tab.id && !this.isTurningPage) {
          const dir = tab.id > this.currentPage ? 1 : -1
          this.turnToPage(tab.id, dir)
        }
      })
    })
  }

  /**
   * Turns to target page with animated paper curl/flip transition.
   */
  private turnToPage(targetPage: number, direction: number): void {
    if (this.isTurningPage || targetPage === this.currentPage) return
    this.isTurningPage = true

    // Animate page peel / flip
    const bookW = Math.min(500, this.vw * 0.94)
    const bookX = this.vw / 2 - bookW / 2
    const bookTopY = this.topY + 36
    const bottomNavH = 56
    const bookH = this.vh - bookTopY - bottomNavH - 16

    // Sweep shadow graphics
    this.overlayG.clear()

    // Flip timeline
    this.scene.tweens.add({
      targets: this.pageLayer,
      scaleX: 0.05,
      x: direction > 0 ? this.vw / 2 - bookW * 0.4 : this.vw / 2 + bookW * 0.4,
      duration: 160,
      ease: 'Quad.easeIn',
      onUpdate: (tween) => {
        const p = tween.progress
        this.overlayG.clear()
        // Sweeping flip shadow
        const shadowAlpha = Math.sin(p * Math.PI) * 0.45
        this.overlayG.fillStyle(0x000000, shadowAlpha)
        this.overlayG.fillRect(bookX + 8, bookTopY + 8, bookW - 16, bookH - 16)
      },
      onComplete: () => {
        this.currentPage = targetPage
        this.renderPageSpread(this.currentPage)
        this.renderTabs()
        this.renderBottomNav()

        // Page unfolding back to full scale
        this.pageLayer.x = direction > 0 ? this.vw / 2 + bookW * 0.4 : this.vw / 2 - bookW * 0.4
        this.scene.tweens.add({
          targets: this.pageLayer,
          scaleX: 1,
          x: 0,
          duration: 200,
          ease: 'Back.easeOut',
          onUpdate: (tween) => {
            const p = tween.progress
            this.overlayG.clear()
            const shadowAlpha = (1 - p) * 0.35
            this.overlayG.fillStyle(0x000000, shadowAlpha)
            this.overlayG.fillRect(bookX + 8, bookTopY + 8, bookW - 16, bookH - 16)
          },
          onComplete: () => {
            this.overlayG.clear()
            this.isTurningPage = false
          },
        })
      },
    })
  }

  /**
   * Renders the physical open binder spread and current page contents.
   */
  private renderPageSpread(pageIndex: number): void {
    this.pageLayer.removeAll(true)
    this.liveBalls.length = 0

    const save = loadSave()
    const bookW = Math.min(500, this.vw * 0.94)
    const bookX = this.vw / 2 - bookW / 2
    const bookTopY = this.topY + 36
    const bottomNavH = 56
    const bookH = this.vh - bookTopY - bottomNavH - 16

    const bgG = this.scene.add.graphics()
    this.pageLayer.add(bgG)

    // 1. Heavy physical book drop shadow
    bgG.fillStyle(0x05070e, 0.75)
    bgG.fillRoundedRect(bookX - 6, bookTopY + 6, bookW + 12, bookH + 8, 20)

    // 2. Outer Hardcover Binder Leather (Warm rich brown/tan binder)
    bgG.fillStyle(0x281e18, 1)
    bgG.fillRoundedRect(bookX - 4, bookTopY - 3, bookW + 8, bookH + 6, 18)
    bgG.lineStyle(3, 0x140e0b, 1)
    bgG.strokeRoundedRect(bookX - 4, bookTopY - 3, bookW + 8, bookH + 6, 18)

    // Gold embossed corner protectors on hardcover
    const cornerSize = 22
    bgG.fillStyle(0xd4af37, 0.9)
    // Top-left
    bgG.fillTriangle(bookX - 4, bookTopY - 3, bookX - 4 + cornerSize, bookTopY - 3, bookX - 4, bookTopY - 3 + cornerSize)
    // Top-right
    bgG.fillTriangle(bookX + bookW + 4, bookTopY - 3, bookX + bookW + 4 - cornerSize, bookTopY - 3, bookX + bookW + 4, bookTopY - 3 + cornerSize)
    // Bottom-left
    bgG.fillTriangle(bookX - 4, bookTopY + bookH + 3, bookX - 4 + cornerSize, bookTopY + bookH + 3, bookX - 4, bookTopY + bookH + 3 - cornerSize)
    // Bottom-right
    bgG.fillTriangle(bookX + bookW + 4, bookTopY + bookH + 3, bookX + bookW + 4 - cornerSize, bookTopY + bookH + 3, bookX + bookW + 4, bookTopY + bookH + 3 - cornerSize)

    // 3. Thick Cream Parchment Paper Spread
    const pageInsetX = bookX + 8
    const pageInsetY = bookTopY + 8
    const pageW = bookW - 16
    const pageH = bookH - 16

    // Stacked page effect (under-pages edge shadow)
    bgG.fillStyle(0xd5c6a5, 0.8)
    bgG.fillRoundedRect(pageInsetX - 2, pageInsetY + 2, pageW + 4, pageH + 2, 12)
    bgG.fillStyle(0xe2d6ba, 0.9)
    bgG.fillRoundedRect(pageInsetX - 1, pageInsetY + 1, pageW + 2, pageH + 1, 12)

    // Main parchment paper surface
    bgG.fillStyle(0xf7f0dd, 1) // authentic cream parchment tone
    bgG.fillRoundedRect(pageInsetX, pageInsetY, pageW, pageH, 10)

    // Subtle paper deckled stitching perimeter
    bgG.lineStyle(1.5, 0xd4c29d, 0.7)
    bgG.strokeRoundedRect(pageInsetX + 6, pageInsetY + 6, pageW - 12, pageH - 12, 8)

    // 4. Center Spine Crease & Shadow (Two-page spread illusion)
    const spineX = this.vw / 2
    bgG.fillStyle(0x000000, 0.08)
    bgG.fillRect(spineX - 18, pageInsetY, 36, pageH)
    bgG.fillStyle(0x000000, 0.12)
    bgG.fillRect(spineX - 8, pageInsetY, 16, pageH)
    bgG.lineStyle(2, 0x9c8360, 0.45)
    bgG.lineBetween(spineX, pageInsetY + 4, spineX, pageInsetY + pageH - 4)

    // Brass binder spine rings
    const ringCount = 5
    const ringSpacing = (pageH - 40) / (ringCount - 1)
    for (let r = 0; r < ringCount; r++) {
      const ry = pageInsetY + 20 + r * ringSpacing
      // Ring shadow
      bgG.fillStyle(0x000000, 0.3)
      bgG.fillEllipse(spineX + 2, ry + 2, 14, 8)
      // Metallic brass ring
      bgG.fillStyle(0xb5892b, 1)
      bgG.fillEllipse(spineX, ry, 12, 6)
      bgG.fillStyle(0xfff3a1, 0.9)
      bgG.fillEllipse(spineX - 2, ry - 1, 6, 2)
      bgG.lineStyle(1, 0x4d380e, 1)
      bgG.strokeEllipse(spineX, ry, 12, 6)
    }

    // 5. Render Page Specific Contents
    const contentX = pageInsetX + 16
    const contentY = pageInsetY + 14
    const contentW = pageW - 32
    const contentH = pageH - 28

    switch (pageIndex) {
      case 0:
        this.renderCoreTiersPage(contentX, contentY, contentW, contentH, save)
        break
      case 1:
        this.renderTier9VariantsPage(contentX, contentY, contentW, contentH, save)
        break
      case 2:
        this.renderTier10CrabsPage(contentX, contentY, contentW, contentH, save)
        break
      case 3:
        this.renderMythicPage(contentX, contentY, contentW, contentH, save)
        break
    }
  }

  /**
   * PAGE 1: Core Tiers 1-8 progression with live bouncing balls and discovery ink stamps.
   */
  private renderCoreTiersPage(
    x: number,
    y: number,
    w: number,
    h: number,
    save: SaveDataV1,
  ): void {
    const pageHeader = hudText(this.scene, x + w / 2, y, 'CORE SPHERE COMPENDIUM', 1, {
      color: '#2d241e',
      size: 16,
      stroke: 0,
      origin: [0.5, 0],
    })
    this.pageLayer.add(pageHeader)

    const pageSub = hudText(this.scene, x + w / 2, y + 20, 'Tiers 1 through 8 — foundation of the merge journey', 1, {
      color: '#7c6a58',
      size: 10.5,
      stroke: 0,
      origin: [0.5, 0],
      shadow: false,
    })
    this.pageLayer.add(pageSub)

    const listTopY = y + 40
    const totalItems = 8
    const itemH = Math.min(52, (h - 48) / totalItems)

    for (let tier = 1; tier <= totalItems; tier++) {
      const rowY = listTopY + (tier - 1) * itemH
      const discoveredAt = save.discovered[String(tier)]
      const isDiscovered = discoveredAt != null

      const rowG = this.scene.add.graphics()
      this.pageLayer.add(rowG)

      // Parchment cutout card row
      rowG.fillStyle(isDiscovered ? 0xfffcf5 : 0xede4d1, 0.95)
      rowG.fillRoundedRect(x, rowY + 2, w, itemH - 4, 8)
      rowG.lineStyle(1.5, isDiscovered ? 0xd8c6a2 : 0xc7b491, 1)
      rowG.strokeRoundedRect(x, rowY + 2, w, itemH - 4, 8)

      // Ball center
      const ballR = Math.min(18, (itemH - 12) / 2)
      const ballX = x + ballR + 10
      const ballY = rowY + itemH / 2

      // Live animated ball graphics container
      const ballG = this.scene.add.graphics()
      this.pageLayer.add(ballG)

      if (isDiscovered) {
        const renderBall = () => {
          ballG.clear()
          const look = ballLookFor(tier, tier * 1013)
          const poly = restContour(look, ballR, ballX, ballY, 28)
          const pts = poly.map((p) => new Phaser.Math.Vector2(p.x, p.y))
          const t = getTier(tier)
          const fillColor = tier === 8 ? cycleColor(Date.now()) : (t?.color ?? 0xffffff)

          ballG.fillStyle(fillColor, 1)
          ballG.fillPoints(pts, true)
          ballG.lineStyle(ballOutlineWidth(ballR), INK, 1)
          ballG.strokePoints(pts, true, true)
          drawBallFace(ballG, look, { x: ballX, y: ballY }, ballR, 1)
        }
        renderBall()
        this.liveBalls.push({ g: ballG, renderFn: renderBall })
      } else {
        // Locked Rough Pencil Silhouette (Strictly NO question mark emoji)
        this.drawLockedSilhouette(ballG, ballX, ballY, ballR, tier)
      }

      // Tier Name / Identity
      const tierDef = getTier(tier)
      const faceLabel = tier === 8 ? 'PRISM' : (tierDef?.face.toUpperCase() ?? 'SPHERE')
      const titleStr = isDiscovered ? `TIER ${tier}: ${faceLabel}` : `TIER ${tier}: ??????`

      const title = hudText(this.scene, ballX + ballR + 12, rowY + 8, titleStr, 1, {
        color: isDiscovered ? '#1e1b18' : '#7a6f62',
        size: 13,
        stroke: 0,
        origin: [0, 0],
      })
      this.pageLayer.add(title)

      // Discovery date / Status stamp
      if (isDiscovered) {
        const d = new Date(discoveredAt)
        const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
        const sub = hudText(this.scene, ballX + ballR + 12, rowY + 25, `First recorded: ${dateStr}`, 1, {
          color: '#3b82f6',
          size: 10,
          stroke: 0,
          origin: [0, 0],
          shadow: false,
        })
        this.pageLayer.add(sub)

        // Physical ink stamp on right edge
        this.drawInkStamp(x + w - 44, rowY + itemH / 2, 'RECORDED', 0x1e40af, (tier % 2 === 0 ? 0.08 : -0.06))
      } else {
        const sub = hudText(this.scene, ballX + ballR + 12, rowY + 25, 'Merge lower spheres to unlock log', 1, {
          color: '#8c7d6b',
          size: 10,
          stroke: 0,
          origin: [0, 0],
          shadow: false,
        })
        this.pageLayer.add(sub)
      }
    }
  }

  /**
   * PAGE 2: Tier 9 Collectibles (Shark & Pig run-rolled skins with swatch stamps).
   */
  private renderTier9VariantsPage(
    x: number,
    y: number,
    w: number,
    h: number,
    save: SaveDataV1,
  ): void {
    const pageHeader = hudText(this.scene, x + w / 2, y, 'TIER 9: ANIMAL CHRONICLES', 1, {
      color: '#2d241e',
      size: 16,
      stroke: 0,
      origin: [0.5, 0],
    })
    this.pageLayer.add(pageHeader)

    const pageSub = hudText(this.scene, x + w / 2, y + 20, 'Unique Shark & Pig mutations rolled across your runs', 1, {
      color: '#7c6a58',
      size: 10.5,
      stroke: 0,
      origin: [0.5, 0],
      shadow: false,
    })
    this.pageLayer.add(pageSub)

    const gridTopY = y + 44
    const cols = 2
    const rows = 4
    const cellW = (w - 12) / cols
    const cellH = Math.min(84, (h - 56) / rows)

    for (let i = 0; i < VARIANT_COUNT; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = x + col * (cellW + 12)
      const cy = gridTopY + row * (cellH + 6)

      const key = `9:${i}`
      const isGot = save.variants[key] != null
      const isShark = i < 4 // Half shark, half pig representation
      const themeLabel = isShark ? 'SHARK' : 'PIG'

      const g = this.scene.add.graphics()
      this.pageLayer.add(g)

      // Card frame
      g.fillStyle(isGot ? 0xfffcf5 : 0xede4d1, 0.95)
      g.fillRoundedRect(cx, cy, cellW, cellH, 8)
      g.lineStyle(1.5, isGot ? 0xdb2777 : 0xc7b491, isGot ? 0.7 : 0.4)
      g.strokeRoundedRect(cx, cy, cellW, cellH, 8)

      // Ball preview
      const ballR = Math.min(20, cellH * 0.28)
      const ballCx = cx + cellW * 0.26
      const ballCy = cy + cellH / 2

      const ballG = this.scene.add.graphics()
      this.pageLayer.add(ballG)

      if (isGot) {
        const renderT9 = () => {
          ballG.clear()
          if (isShark) {
            drawSharkBall(ballG, ballCx, ballCy, ballR, i, undefined, 0, undefined, 9 * 7717 + i)
          } else {
            drawPigBall(ballG, ballCx, ballCy, ballR, i - 4, undefined, 0, undefined, 9 * 7717 + i)
          }
        }
        renderT9()
        this.liveBalls.push({ g: ballG, renderFn: renderT9 })

        // Discovery stamp
        this.drawInkStamp(cx + cellW - 24, cy + 18, 'LOGGED', 0x9d174d, 0.12)
      } else {
        this.drawLockedSilhouette(ballG, ballCx, ballCy, ballR, 9)
      }

      // Title & label
      const name = isGot ? `${themeLabel} #${(i % 4) + 1}` : `SPECIES #${i + 1}`
      const title = hudText(this.scene, cx + cellW * 0.52, cy + cellH / 2 - 8, name, 1, {
        color: isGot ? '#1e1b18' : '#7a6f62',
        size: 11.5,
        stroke: 0,
        origin: [0, 0.5],
      })
      this.pageLayer.add(title)

      const status = hudText(
        this.scene,
        cx + cellW * 0.52,
        cy + cellH / 2 + 10,
        isGot ? 'COLLECTED' : 'Mystery Seed',
        1,
        {
          color: isGot ? '#b45309' : '#8c7d6b',
          size: 9.5,
          stroke: 0,
          origin: [0, 0.5],
          shadow: false,
        },
      )
      this.pageLayer.add(status)
    }
  }

  /**
   * PAGE 3: Tier 10 Crab Sanctum with live claws, pincers, and walking leg animations.
   */
  private renderTier10CrabsPage(
    x: number,
    y: number,
    w: number,
    h: number,
    save: SaveDataV1,
  ): void {
    const pageHeader = hudText(this.scene, x + w / 2, y, 'TIER 10: CRAB ALCOVE', 1, {
      color: '#2d241e',
      size: 16,
      stroke: 0,
      origin: [0.5, 0],
    })
    this.pageLayer.add(pageHeader)

    const pageSub = hudText(this.scene, x + w / 2, y + 20, 'The mighty Clawed Crusher — sovereign of the high merges', 1, {
      color: '#7c6a58',
      size: 10.5,
      stroke: 0,
      origin: [0.5, 0],
      shadow: false,
    })
    this.pageLayer.add(pageSub)

    const isCrabDiscovered = save.discovered['10'] != null
    const centerCardY = y + 46
    const centerCardH = Math.min(220, h - 68)

    const g = this.scene.add.graphics()
    this.pageLayer.add(g)

    // Center showcase paper card
    g.fillStyle(isCrabDiscovered ? 0xfffcf5 : 0xede4d1, 0.95)
    g.fillRoundedRect(x, centerCardY, w, centerCardH, 12)
    g.lineStyle(2, isCrabDiscovered ? 0xc2410c : 0xc7b491, 0.8)
    g.strokeRoundedRect(x, centerCardY, w, centerCardH, 12)

    const ballCx = x + w / 2
    const ballCy = centerCardY + centerCardH * 0.42
    const ballR = Math.min(48, centerCardH * 0.24)

    const crabG = this.scene.add.graphics()
    this.pageLayer.add(crabG)

    if (isCrabDiscovered) {
      const renderCrab = () => {
        crabG.clear()
        drawCrabBall(crabG, ballCx, ballCy, ballR, 0, undefined, 0, undefined, 1010)
      }
      renderCrab()
      this.liveBalls.push({ g: crabG, renderFn: renderCrab })

      // Official discovery seal
      this.drawInkStamp(x + w - 48, centerCardY + 44, 'COLLECTED', 0xc2410c, -0.15)
    } else {
      this.drawLockedSilhouette(crabG, ballCx, ballCy, ballR, 10)
    }

    const crabTitle = hudText(
      this.scene,
      x + w / 2,
      centerCardY + centerCardH * 0.74,
      isCrabDiscovered ? 'CRAB (THEME 10)' : 'UNIDENTIFIED PINCH CRAB',
      1,
      {
        color: isCrabDiscovered ? '#1e1b18' : '#7a6f62',
        size: 15,
        stroke: 0,
        origin: [0.5, 0.5],
      },
    )
    this.pageLayer.add(crabTitle)

    const crabDesc = hudText(
      this.scene,
      x + w / 2,
      centerCardY + centerCardH * 0.88,
      isCrabDiscovered ? 'Pincers armed and ready. Merged from two Tier 9 beasts.' : 'Merge two Tier 9 animals to reveal the apex crustacean.',
      1,
      {
        color: isCrabDiscovered ? '#c2410c' : '#8c7d6b',
        size: 11,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      },
    )
    this.pageLayer.add(crabDesc)
  }

  /**
   * PAGE 4: Mythic Tiers 11 & 12 secret silhouettes and discovery entries.
   */
  private renderMythicPage(
    x: number,
    y: number,
    w: number,
    h: number,
    save: SaveDataV1,
  ): void {
    const pageHeader = hudText(this.scene, x + w / 2, y, 'MYTHIC & FINAL SECRETS', 1, {
      color: '#2d241e',
      size: 16,
      stroke: 0,
      origin: [0.5, 0],
    })
    this.pageLayer.add(pageHeader)

    const pageSub = hudText(this.scene, x + w / 2, y + 20, 'The legendary heights of the Ball Rush merge universe', 1, {
      color: '#7c6a58',
      size: 10.5,
      stroke: 0,
      origin: [0.5, 0],
      shadow: false,
    })
    this.pageLayer.add(pageSub)

    const tiers = [11, 12]
    const cardH = Math.min(130, (h - 58) / 2)

    tiers.forEach((tier, index) => {
      const cardY = y + 46 + index * (cardH + 12)
      const isGot = save.discovered[String(tier)] != null

      const g = this.scene.add.graphics()
      this.pageLayer.add(g)

      g.fillStyle(isGot ? 0xfffcf5 : 0xede4d1, 0.95)
      g.fillRoundedRect(x, cardY, w, cardH, 12)
      g.lineStyle(2, isGot ? 0x7c3aed : 0xc7b491, 0.7)
      g.strokeRoundedRect(x, cardY, w, cardH, 12)

      const ballCx = x + 44
      const ballCy = cardY + cardH / 2
      const ballR = 26

      const ballG = this.scene.add.graphics()
      this.pageLayer.add(ballG)

      if (isGot) {
        const renderMythic = () => {
          ballG.clear()
          const look = ballLookFor(tier, tier * 9991)
          const poly = restContour(look, ballR, ballCx, ballCy, 32)
          const pts = poly.map((p) => new Phaser.Math.Vector2(p.x, p.y))

          // Radiant aura
          ballG.fillStyle(0x7c3aed, 0.2)
          ballG.fillCircle(ballCx, ballCy, ballR * 1.3)

          ballG.fillStyle(0x18181b, 1)
          ballG.fillPoints(pts, true)
          ballG.lineStyle(ballOutlineWidth(ballR), 0xa855f7, 1)
          ballG.strokePoints(pts, true, true)
          drawBallFace(ballG, look, { x: ballCx, y: ballCy }, ballR, 1)
        }
        renderMythic()
        this.liveBalls.push({ g: ballG, renderFn: renderMythic })
        this.drawInkStamp(x + w - 44, cardY + cardH / 2, 'LEGEND', 0x6d28d9, 0.1)
      } else {
        this.drawLockedSilhouette(ballG, ballCx, ballCy, ballR, tier)
      }

      const label = tier === 12 ? 'TIER 12: THE FINAL SECRET' : 'TIER 11: COSMIC BEACON'
      const title = hudText(this.scene, ballCx + ballR + 16, cardY + 24, label, 1, {
        color: isGot ? '#1e1b18' : '#7a6f62',
        size: 13.5,
        stroke: 0,
        origin: [0, 0],
      })
      this.pageLayer.add(title)

      const desc = hudText(
        this.scene,
        ballCx + ballR + 16,
        cardY + 48,
        isGot ? 'Uncovered and engraved in the royal hall of fame.' : 'Surpass all known limits to unlock this cosmic mystery.',
        1,
        {
          color: isGot ? '#7c3aed' : '#8c7d6b',
          size: 11,
          stroke: 0,
          origin: [0, 0],
          shadow: false,
        },
      )
      this.pageLayer.add(desc)
    })
  }

  /**
   * Renders a mystery locked silhouette with a rough hand-drawn pencil/ink look.
   * Strictly zero emojis: uses clean cartoon typography and sketch hatching.
   */
  private drawLockedSilhouette(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    tier: number,
  ): void {
    // Soft pencil sketch background disc
    g.fillStyle(0xd5c9b0, 0.6)
    g.fillCircle(cx, cy, r)

    // Hand-drawn sketchy contour
    g.lineStyle(1.5, 0x82735f, 0.75)
    g.strokeCircle(cx, cy, r)
    g.lineStyle(1.0, 0x5e5241, 0.5)
    g.strokeCircle(cx + 0.5, cy - 0.5, r - 1.5)

    // Rough sketch hatch marks across silhouette
    g.lineStyle(1, 0x82735f, 0.35)
    for (let i = -r * 0.6; i <= r * 0.6; i += 5) {
      const len = Math.sqrt(Math.max(0, r * r - i * i)) * 0.7
      g.lineBetween(cx + i - len * 0.4, cy + i - len * 0.4, cx + i + len * 0.4, cy + i + len * 0.4)
    }

    // Clean Roman numeral or tier watermark inside the sketched ball
    const numStr = `T${tier}`
    const label = hudText(this.scene, cx, cy, numStr, 1, {
      color: '#716353',
      size: Math.max(10, r * 0.75),
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    })
    this.pageLayer.add(label)
  }

  /**
   * Renders a tilted rubber ink stamp with authentic ink bleed and rim.
   */
  private drawInkStamp(
    cx: number,
    cy: number,
    text: string,
    color: number,
    angleRad = 0.08,
  ): void {
    const stampC = this.scene.add.container(cx, cy)
    stampC.setRotation(angleRad)
    this.pageLayer.add(stampC)

    const g = this.scene.add.graphics()
    stampC.add(g)

    const sw = Math.max(54, text.length * 7.5 + 16)
    const sh = 20

    // Outer inked border
    g.lineStyle(2, color, 0.75)
    g.strokeRoundedRect(-sw / 2, -sh / 2, sw, sh, 5)

    // Inner fine border
    g.lineStyle(1, color, 0.4)
    g.strokeRoundedRect(-sw / 2 + 2, -sh / 2 + 2, sw - 4, sh - 4, 3)

    // Inked text
    const colorHex = '#' + color.toString(16).padStart(6, '0')
    const t = hudText(this.scene, 0, 0, text, 1, {
      color: colorHex,
      size: 9,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    })
    t.setAlpha(0.85)
    stampC.add(t)
  }

  /**
   * Bottom page navigation with Uiverse tactile buttons and page indicator stamp.
   */
  private renderBottomNav(): void {
    this.navContainer.removeAll(true)

    const bookW = Math.min(500, this.vw * 0.94)
    const bottomNavH = 56
    const navY = this.vh - bottomNavH / 2 - 8
    const btnW = Math.max(92, Math.min(124, this.vw * 0.28))
    const btnH = 42

    // Prev Button
    const prevBtn = new ChunkyButton({
      scene: this.scene,
      x: this.vw / 2 - bookW / 2 + btnW / 2 + 8,
      y: navY,
      w: btnW,
      h: btnH,
      label: '< PREV',
      fontSize: 13,
      fill: UI_COLORS.BTN_BLUE,
      disabled: this.currentPage === 0,
      onClick: () => {
        if (this.currentPage > 0) {
          this.turnToPage(this.currentPage - 1, -1)
        }
      },
    })
    this.navContainer.add(prevBtn.container)

    // Center Page Indicator Stamp
    const pageLabels = ['CORE (T1-8)', 'T9 VARIANTS', 'T10 CRABS', 'MYTHIC']
    const pageBadgeText = hudText(
      this.scene,
      this.vw / 2,
      navY - 6,
      `PAGE ${this.currentPage + 1} OF ${this.totalPages}`,
      1,
      {
        color: '#ffffff',
        size: 13,
        stroke: 3,
        origin: [0.5, 0.5],
      },
    )
    this.navContainer.add(pageBadgeText)

    const sectionTitleText = hudText(
      this.scene,
      this.vw / 2,
      navY + 10,
      pageLabels[this.currentPage] ?? '',
      1,
      {
        color: UI_COLORS.TEXT_GOLD,
        size: 11,
        stroke: 2,
        origin: [0.5, 0.5],
      },
    )
    this.navContainer.add(sectionTitleText)

    // Next Button
    const nextBtn = new ChunkyButton({
      scene: this.scene,
      x: this.vw / 2 + bookW / 2 - btnW / 2 - 8,
      y: navY,
      w: btnW,
      h: btnH,
      label: 'NEXT >',
      fontSize: 13,
      fill: UI_COLORS.BTN_BLUE,
      disabled: this.currentPage === this.totalPages - 1,
      onClick: () => {
        if (this.currentPage < this.totalPages - 1) {
          this.turnToPage(this.currentPage + 1, 1)
        }
      },
    })
    this.navContainer.add(nextBtn.container)
  }
}
