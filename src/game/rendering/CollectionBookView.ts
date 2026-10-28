import Phaser from 'phaser'
import { BALL_TIERS, getTier } from '../../config/ballTiers'
import { COLLECTIBLE_THEMES } from '../../config/collectibleThemes'
import { drawBallIcon } from '../scenes/TitleScene'
import { loadSave } from '../state/save'
import { VARIANT_COUNT } from '../state/runVariant'
import { UI_COLORS, ChunkyButton } from '../../ui/DesignSystem'
import { hudText } from '../../ui/Typography'

/**
 * Physical Album Booklet representation of the Collection & Journal.
 *
 * Structure:
 * - Book Header: Progress ribbon (X / Y Discovered) & Category jump tabs
 * - Book Page: Physical binder/album page card with stitching, paper shadow, and page corners
 * - Sections:
 *   - Page 1: "Core Collection" (Tiers 1–8 standard balls + discovery log stamps)
 *   - Page 2: "Tier 9 Variants" (Shark & Pig theme variants with custom stickers)
 *   - Page 3: "Tier 10 Variants" (Crab theme variants & evolutions)
 *   - Page 4: "Mythic Tiers" (Tiers 11–12 mysterious final secrets)
 * - Navigation: Chunky Prev/Next cartoon buttons and Page X of Y stamp
 */
export class CollectionBookView {
  private scene: Phaser.Scene
  private parentContainer: Phaser.GameObjects.Container
  private bookContainer: Phaser.GameObjects.Container
  private vw: number
  private vh: number
  private topY: number
  private currentPage = 0
  private totalPages = 4

  constructor(scene: Phaser.Scene, parentContainer: Phaser.GameObjects.Container, vw: number, vh: number, topY: number) {
    this.scene = scene
    this.parentContainer = parentContainer
    this.bookContainer = scene.add.container(0, 0)
    this.parentContainer.add(this.bookContainer)
    this.vw = vw
    this.vh = vh
    this.topY = topY
    this.render()
  }

  public render(): void {
    this.bookContainer.removeAll(true)

    const save = loadSave()
    const discovered = new Set(Object.keys(save.discovered).map(Number))
    const totalTiers = BALL_TIERS.length
    const gotTiers = [...discovered].filter((t) => t >= 1 && t <= totalTiers).length

    // 1. Overall Collection Banner / Header Ribbon
    const ribbonW = Math.min(420, this.vw * 0.88)
    const ribbonH = 34
    const ribbonY = this.topY + 6

    const ribbonG = this.scene.add.graphics()
    this.bookContainer.add(ribbonG)

    // Ribbon drop shadow
    ribbonG.fillStyle(UI_COLORS.INK, 1)
    ribbonG.fillRoundedRect(this.vw / 2 - ribbonW / 2, ribbonY + 2, ribbonW, ribbonH, 10)

    // Ribbon fill
    ribbonG.fillStyle(UI_COLORS.CARD_BG, 1)
    ribbonG.fillRoundedRect(this.vw / 2 - ribbonW / 2, ribbonY, ribbonW, ribbonH, 10)
    ribbonG.lineStyle(2, UI_COLORS.CARD_BORDER, 1)
    ribbonG.strokeRoundedRect(this.vw / 2 - ribbonW / 2, ribbonY, ribbonW, ribbonH, 10)

    // Discovered tally text
    const tallyText = hudText(
      this.scene,
      this.vw / 2,
      ribbonY + ribbonH / 2,
      `COLLECTION DISCOVERY: ${gotTiers} / ${totalTiers} TIERS`,
      1,
      {
        color: UI_COLORS.TEXT_GOLD,
        size: Math.max(12, Math.min(16, this.vw * 0.035)),
        stroke: 3,
        origin: [0.5, 0.5],
      },
    )
    this.bookContainer.add(tallyText)

    // 2. Physical Book Canvas Frame
    const bookTopY = ribbonY + ribbonH + 14
    const bottomNavH = 58
    const bookH = this.vh - bookTopY - bottomNavH - 16
    const bookW = Math.min(480, this.vw * 0.92)
    const bookX = this.vw / 2 - bookW / 2

    const pageG = this.scene.add.graphics()
    this.bookContainer.add(pageG)

    // Outer physical book drop shadow
    pageG.fillStyle(0x060810, 0.7)
    pageG.fillRoundedRect(bookX - 4, bookTopY + 4, bookW + 8, bookH + 4, 18)

    // Book Cover Border / Binder spine
    pageG.fillStyle(0x131828, 1)
    pageG.fillRoundedRect(bookX - 2, bookTopY - 2, bookW + 4, bookH + 4, 16)
    pageG.lineStyle(3, UI_COLORS.INK, 1)
    pageG.strokeRoundedRect(bookX - 2, bookTopY - 2, bookW + 4, bookH + 4, 16)

    // Page Surface (Cream / Parchment Album Page)
    pageG.fillStyle(0x1b233a, 1)
    pageG.fillRoundedRect(bookX + 4, bookTopY + 4, bookW - 8, bookH - 8, 12)

    // Inner paper stitching / header border
    pageG.lineStyle(2, 0x2b3859, 0.8)
    pageG.strokeRoundedRect(bookX + 10, bookTopY + 10, bookW - 20, bookH - 20, 10)

    // 3. Render current page content
    const pageContentY = bookTopY + 20
    const pageContentH = bookH - 40
    switch (this.currentPage) {
      case 0:
        this.renderCoreCollectionPage(bookX + 16, pageContentY, bookW - 32, pageContentH, save)
        break
      case 1:
        this.renderTier9VariantsPage(bookX + 16, pageContentY, bookW - 32, pageContentH, save)
        break
      case 2:
        this.renderTier10VariantsPage(bookX + 16, pageContentY, bookW - 32, pageContentH, save)
        break
      case 3:
        this.renderMythicPage(bookX + 16, pageContentY, bookW - 32, pageContentH, save)
        break
    }

    // 4. Bottom Page Turn Navigation
    const navY = this.vh - bottomNavH / 2 - 8
    const btnW = Math.max(90, Math.min(120, this.vw * 0.28))
    const btnH = 42

    // Prev Button
    const prevBtn = new ChunkyButton({
      scene: this.scene,
      x: this.vw / 2 - bookW / 2 + btnW / 2,
      y: navY,
      w: btnW,
      h: btnH,
      label: '◀ PREV',
      fontSize: 13,
      fill: UI_COLORS.BTN_BLUE,
      disabled: this.currentPage === 0,
      onClick: () => {
        if (this.currentPage > 0) {
          this.currentPage--
          this.render()
        }
      },
    })
    this.bookContainer.add(prevBtn.container)

    // Page Indicator Badge
    const pageLabels = ['CORE (T1-8)', 'TIER 9 SKINS', 'TIER 10 SKINS', 'MYTHIC']
    const pageBadgeText = hudText(
      this.scene,
      this.vw / 2,
      navY - 6,
      `PAGE ${this.currentPage + 1} OF ${this.totalPages}`,
      1,
      {
        color: UI_COLORS.TEXT_WHITE,
        size: 13,
        stroke: 3,
        origin: [0.5, 0.5],
      },
    )
    this.bookContainer.add(pageBadgeText)

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
    this.bookContainer.add(sectionTitleText)

    // Next Button
    const nextBtn = new ChunkyButton({
      scene: this.scene,
      x: this.vw / 2 + bookW / 2 - btnW / 2,
      y: navY,
      w: btnW,
      h: btnH,
      label: 'NEXT ▶',
      fontSize: 13,
      fill: UI_COLORS.BTN_BLUE,
      disabled: this.currentPage === this.totalPages - 1,
      onClick: () => {
        if (this.currentPage < this.totalPages - 1) {
          this.currentPage++
          this.render()
        }
      },
    })
    this.bookContainer.add(nextBtn.container)
  }

  /**
   * PAGE 1: Core progression collection (Tiers 1–8).
   * Balls from 1 to 8 are always the same every run.
   * Shows discovered status, ball icon, name, and Journal first-discovery date.
   */
  private renderCoreCollectionPage(
    x: number,
    y: number,
    w: number,
    h: number,
    save: ReturnType<typeof loadSave>,
  ): void {
    const pageTitle = hudText(this.scene, x + w / 2, y, 'CORE BALLS (TIER 1–8)', 1, {
      color: UI_COLORS.TEXT_GOLD,
      size: 16,
      stroke: 3,
      origin: [0.5, 0],
    })
    this.bookContainer.add(pageTitle)

    const pageSubtitle = hudText(
      this.scene,
      x + w / 2,
      y + 20,
      'Standard progression balls — discovered on your journey',
      1,
      {
        color: UI_COLORS.TEXT_MUTED,
        size: 11,
        stroke: 0,
        origin: [0.5, 0],
        shadow: false,
      },
    )
    this.bookContainer.add(pageSubtitle)

    const listTopY = y + 42
    const totalItems = 8
    const itemH = Math.min(52, (h - 52) / totalItems)
    const g = this.scene.add.graphics()
    this.bookContainer.add(g)

    for (let tier = 1; tier <= totalItems; tier++) {
      const rowY = listTopY + (tier - 1) * itemH
      const discoveredAt = save.discovered[String(tier)]
      const isDiscovered = discoveredAt != null

      // Card row background
      g.fillStyle(isDiscovered ? 0x222c4a : 0x161c2e, 0.9)
      g.fillRoundedRect(x, rowY + 2, w, itemH - 4, 8)
      g.lineStyle(1.5, isDiscovered ? 0x3d4d7a : 0x232c45, 1)
      g.strokeRoundedRect(x, rowY + 2, w, itemH - 4, 8)

      // Ball Icon
      const ballR = Math.min(18, (itemH - 12) / 2)
      const ballX = x + ballR + 10
      const ballY = rowY + itemH / 2

      if (isDiscovered) {
        drawBallIcon(this.scene, g, tier, ballX, ballY, ballR, {
          seed: tier * 1013,
        })
      } else {
        g.fillStyle(0x0f1320, 1)
        g.fillCircle(ballX, ballY, ballR)
        g.lineStyle(1.5, 0x2e3852, 1)
        g.strokeCircle(ballX, ballY, ballR)

        const q = hudText(this.scene, ballX, ballY, '?', 1, {
          color: '#556282',
          size: ballR * 1.2,
          stroke: 0,
          origin: [0.5, 0.5],
          shadow: false,
        })
        this.bookContainer.add(q)
      }

      // Tier Name / Title
      const tierDef = getTier(tier)
      const faceLabel = tier === 8 ? 'RGB PRISM' : (tierDef?.face.toUpperCase() ?? 'BALL')
      const titleStr = isDiscovered ? `TIER ${tier} • ${faceLabel}` : `TIER ${tier} • LOCKED`
      const title = hudText(this.scene, ballX + ballR + 12, rowY + 9, titleStr, 1, {
        color: isDiscovered ? UI_COLORS.TEXT_WHITE : '#647294',
        size: 13,
        stroke: isDiscovered ? 2 : 0,
        origin: [0, 0],
      })
      this.bookContainer.add(title)
      // Discovery date / Status (Journal Integration)
      let subtitleStr = 'Merge to discover'
      if (isDiscovered) {
        const d = new Date(discoveredAt)
        subtitleStr = `Discovered ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      }
      const dateText = hudText(this.scene, ballX + ballR + 12, rowY + 26, subtitleStr, 1, {
        color: isDiscovered ? UI_COLORS.TEXT_BLUE : '#475373',
        size: 10,
        stroke: 0,
        origin: [0, 0],
        shadow: false,
      })
      this.bookContainer.add(dateText)
    }
  }

  /**
   * PAGE 2: Tier 9 Collectibles (Shark, Pig, and run-rolled variants).
   */
  private renderTier9VariantsPage(
    x: number,
    y: number,
    w: number,
    h: number,
    save: ReturnType<typeof loadSave>,
  ): void {
    const pageTitle = hudText(this.scene, x + w / 2, y, 'TIER 9 COLLECTIBLES', 1, {
      color: UI_COLORS.TEXT_GOLD,
      size: 16,
      stroke: 3,
      origin: [0.5, 0],
    })
    this.bookContainer.add(pageTitle)

    const pageSubtitle = hudText(
      this.scene,
      x + w / 2,
      y + 20,
      'Random animal skin rolled each run — collect all variants!',
      1,
      {
        color: UI_COLORS.TEXT_MUTED,
        size: 11,
        stroke: 0,
        origin: [0.5, 0],
        shadow: false,
      },
    )
    this.bookContainer.add(pageSubtitle)

    const g = this.scene.add.graphics()
    this.bookContainer.add(g)

    // Render Cards for each collectible variant of Tier 9
    const gridTopY = y + 46
    const cols = 2
    const rows = 4
    const cellW = (w - 12) / cols
    const cellH = Math.min(84, (h - 60) / rows)

    const t9Themes = COLLECTIBLE_THEMES[9] ?? [{ name: 'shark', weight: 1 }, { name: 'pig', weight: 1 }]

    for (let i = 0; i < VARIANT_COUNT; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = x + col * (cellW + 12)
      const cy = gridTopY + row * (cellH + 8)

      const key = `9:${i}`
      const isGot = save.variants[key] != null

      const themeName = t9Themes[i % t9Themes.length]?.name ?? 'shark'

      // Card frame
      g.fillStyle(isGot ? 0x222c4a : 0x161c2e, 1)
      g.fillRoundedRect(cx, cy, cellW, cellH, 10)
      g.lineStyle(1.5, isGot ? 0x4f649e : 0x232c45, 1)
      g.strokeRoundedRect(cx, cy, cellW, cellH, 10)

      // Ball preview
      const ballR = Math.min(20, cellH * 0.28)
      const ballCx = cx + cellW * 0.26
      const ballCy = cy + cellH / 2

      if (isGot) {
        drawBallIcon(this.scene, g, 9, ballCx, ballCy, ballR, {
          variant: i,
          seed: 9 * 7717 + i,
        })
      } else {
        g.fillStyle(0x0e121e, 1)
        g.fillCircle(ballCx, ballCy, ballR)
        g.lineStyle(1.5, 0x2e3852, 1)
        g.strokeCircle(ballCx, ballCy, ballR)

        const q = hudText(this.scene, ballCx, ballCy, '?', 1, {
          color: '#556282',
          size: ballR * 1.2,
          stroke: 0,
          origin: [0.5, 0.5],
          shadow: false,
        })
        this.bookContainer.add(q)
      }

      // Variant description
      const label = isGot ? `${themeName.toUpperCase()} #${i + 1}` : `SKIN #${i + 1}`
      const variantText = hudText(this.scene, cx + cellW * 0.52, cy + cellH / 2 - 8, label, 1, {
        color: isGot ? UI_COLORS.TEXT_WHITE : '#647294',
        size: 11,
        stroke: isGot ? 2 : 0,
        origin: [0, 0.5],
      })
      this.bookContainer.add(variantText)

      const statusSub = hudText(
        this.scene,
        cx + cellW * 0.52,
        cy + cellH / 2 + 8,
        isGot ? 'COLLECTED' : 'Run Mystery',
        1,
        {
          color: isGot ? UI_COLORS.TEXT_GOLD : '#475373',
          size: 9.5,
          stroke: 0,
          origin: [0, 0.5],
          shadow: false,
        },
      )
      this.bookContainer.add(statusSub)
    }
  }

  /**
   * PAGE 3: Tier 10 Collectibles (Crab theme and evolutions).
   */
  private renderTier10VariantsPage(
    x: number,
    y: number,
    w: number,
    h: number,
    save: ReturnType<typeof loadSave>,
  ): void {
    const pageTitle = hudText(this.scene, x + w / 2, y, 'TIER 10 • CRAB ALCOVE', 1, {
      color: UI_COLORS.TEXT_GOLD,
      size: 16,
      stroke: 3,
      origin: [0.5, 0],
    })
    this.bookContainer.add(pageTitle)

    const pageSubtitle = hudText(
      this.scene,
      x + w / 2,
      y + 20,
      'The mighty Clawed Crusher — unlocked through Tier 9 merges',
      1,
      {
        color: UI_COLORS.TEXT_MUTED,
        size: 11,
        stroke: 0,
        origin: [0.5, 0],
        shadow: false,
      },
    )
    this.bookContainer.add(pageSubtitle)

    const g = this.scene.add.graphics()
    this.bookContainer.add(g)

    const isCrabDiscovered = save.discovered['10'] != null
    const centerCardY = y + 54
    const centerCardH = Math.min(220, h - 80)

    // Big Showcase Card
    g.fillStyle(isCrabDiscovered ? 0x222c4a : 0x161c2e, 1)
    g.fillRoundedRect(x, centerCardY, w, centerCardH, 12)
    g.lineStyle(2, isCrabDiscovered ? 0x4f649e : 0x232c45, 1)
    g.strokeRoundedRect(x, centerCardY, w, centerCardH, 12)

    const ballCx = x + w / 2
    const ballCy = centerCardY + centerCardH * 0.42
    const ballR = Math.min(48, centerCardH * 0.24)

    if (isCrabDiscovered) {
      drawBallIcon(this.scene, g, 10, ballCx, ballCy, ballR, {
        seed: 1010,
      })
    } else {
      g.fillStyle(0x0e121e, 1)
      g.fillCircle(ballCx, ballCy, ballR)
      g.lineStyle(2, 0x2e3852, 1)
      g.strokeCircle(ballCx, ballCy, ballR)

      const q = hudText(this.scene, ballCx, ballCy, '?', 1, {
        color: '#556282',
        size: ballR * 1.2,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      })
      this.bookContainer.add(q)
    }

    const crabTitle = hudText(
      this.scene,
      x + w / 2,
      centerCardY + centerCardH * 0.74,
      isCrabDiscovered ? 'CRAB (THEME 10)' : 'LOCKED CRAB',
      1,
      {
        color: isCrabDiscovered ? UI_COLORS.TEXT_WHITE : '#647294',
        size: 15,
        stroke: isCrabDiscovered ? 3 : 0,
        origin: [0.5, 0.5],
      },
    )
    this.bookContainer.add(crabTitle)

    const crabDesc = hudText(
      this.scene,
      x + w / 2,
      centerCardY + centerCardH * 0.88,
      isCrabDiscovered ? 'Pincers armed and ready to crush' : 'Two Tier 9 balls merge into this creature',
      1,
      {
        color: isCrabDiscovered ? UI_COLORS.TEXT_BLUE : '#475373',
        size: 11,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      },
    )
    this.bookContainer.add(crabDesc)
  }

  /**
   * PAGE 4: Mythic Tiers (11 & 12).
   */
  private renderMythicPage(
    x: number,
    y: number,
    w: number,
    h: number,
    save: ReturnType<typeof loadSave>,
  ): void {
    const pageTitle = hudText(this.scene, x + w / 2, y, 'MYTHIC & FINAL SECRETS', 1, {
      color: UI_COLORS.TEXT_GOLD,
      size: 16,
      stroke: 3,
      origin: [0.5, 0],
    })
    this.bookContainer.add(pageTitle)

    const pageSubtitle = hudText(
      this.scene,
      x + w / 2,
      y + 20,
      'The ultimate heights of the Ball Rush merge universe',
      1,
      {
        color: UI_COLORS.TEXT_MUTED,
        size: 11,
        stroke: 0,
        origin: [0.5, 0],
        shadow: false,
      },
    )
    this.bookContainer.add(pageSubtitle)

    const g = this.scene.add.graphics()
    this.bookContainer.add(g)

    const tiers = [11, 12]
    const cardH = Math.min(130, (h - 60) / 2)

    tiers.forEach((tier, index) => {
      const cardY = y + 54 + index * (cardH + 12)
      const isGot = save.discovered[String(tier)] != null

      g.fillStyle(isGot ? 0x222c4a : 0x161c2e, 1)
      g.fillRoundedRect(x, cardY, w, cardH, 12)
      g.lineStyle(2, isGot ? 0x4f649e : 0x232c45, 1)
      g.strokeRoundedRect(x, cardY, w, cardH, 12)

      const ballCx = x + 44
      const ballCy = cardY + cardH / 2
      const ballR = 24

      if (isGot) {
        drawBallIcon(this.scene, g, tier, ballCx, ballCy, ballR, {
          seed: tier * 9991,
        })
      } else {
        g.fillStyle(0x0e121e, 1)
        g.fillCircle(ballCx, ballCy, ballR)
        g.lineStyle(1.5, 0x2e3852, 1)
        g.strokeCircle(ballCx, ballCy, ballR)

        const q = hudText(this.scene, ballCx, ballCy, '?', 1, {
          color: '#556282',
          size: ballR * 1.2,
          stroke: 0,
          origin: [0.5, 0.5],
          shadow: false,
        })
        this.bookContainer.add(q)
      }

      const label = tier === 12 ? 'TIER 12 • THE FINAL SECRET' : 'TIER 11 • COSMIC BEACON'
      const title = hudText(this.scene, ballCx + ballR + 16, cardY + 24, label, 1, {
        color: isGot ? UI_COLORS.TEXT_WHITE : '#647294',
        size: 14,
        stroke: isGot ? 2 : 0,
        origin: [0, 0],
      })
      this.bookContainer.add(title)

      const desc = hudText(
        this.scene,
        ballCx + ballR + 16,
        cardY + 48,
        isGot ? 'Uncovered and recorded in the hall of fame.' : 'Surpass all limits to reach this legendary tier.',
        1,
        {
          color: isGot ? UI_COLORS.TEXT_BLUE : '#475373',
          size: 11,
          stroke: 0,
          origin: [0, 0],
          shadow: false,
        },
      )
      this.bookContainer.add(desc)
    })
  }
}
