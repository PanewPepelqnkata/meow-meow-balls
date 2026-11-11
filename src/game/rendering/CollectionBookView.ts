import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { collectionSlotsFor, collectionDiscovery, hasUnidentifiedCollectionFinds } from '../../config/collectibleCollection'
import { ChunkyButton, UI_COLORS } from '../../ui/DesignSystem'
import { readSafeArea } from '../../ui/ResponsiveLayout'
import { hudText } from '../../ui/Typography'
import { loadSave } from '../state/save'
import {
  ballLookFor,
  collectionOutlineWidth,
  drawBallFace,
  drawCollectibleBall,
  INK,
  restContour,
} from './BallAppearance'
import { cycleColor } from './rgbCycle'

interface BookLeaf {
  container: Phaser.GameObjects.Container
  redraws: Array<() => void>
}

const CHAPTERS = [
  { label: 'CORE', tab: 'CORE T1–8', color: 0x3b82f6 },
  { label: 'TIER 9', tab: 'TIER 9', color: 0xec4899 },
  { label: 'TIER 10', tab: 'TIER 10', color: 0xf97316 },
  { label: 'TIER 11', tab: 'TIER 11', color: 0xa855f7 },
  { label: 'TIER 12', tab: 'TIER 12', color: 0xa855f7 },
] as const

/** Leather binder with two independently laid-out, spine-hinged paper leaves. */
export class CollectionBookView {
  private readonly bookContainer: Phaser.GameObjects.Container
  private readonly binderBaseG: Phaser.GameObjects.Graphics
  private readonly tabContainer: Phaser.GameObjects.Container
  private readonly spreadContainer: Phaser.GameObjects.Container
  private readonly turningLeafContainer: Phaser.GameObjects.Container
  private readonly shadowG: Phaser.GameObjects.Graphics
  private readonly leafShadeG: Phaser.GameObjects.Graphics
  private readonly spineG: Phaser.GameObjects.Graphics
  private readonly navContainer: Phaser.GameObjects.Container
  private get save() {
    return loadSave()
  }
  private readonly bookX: number
  private readonly bookTopY: number
  private readonly bookW: number
  private readonly bookH: number
  private readonly pageX: number
  private readonly pageY: number
  private readonly pageW: number
  private readonly pageH: number
  private readonly leafW: number
  private readonly spineX: number
  private readonly navY: number
  private leftPage: BookLeaf
  private rightPage: BookLeaf
  private prevButton!: ChunkyButton
  private nextButton!: ChunkyButton
  private readonly tabs: Array<{ graphics: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text }> = []
  private pageNumberText: Phaser.GameObjects.Text | null = null
  private chapterText: Phaser.GameObjects.Text | null = null
  private currentPage = 0
  private isTurningPage = false
  private destroyed = false
  private pageTween: Phaser.Tweens.Tween | null = null
  private animTimerEvent: Phaser.Time.TimerEvent | null = null
  private readonly turnState = { progress: 0 }
  private swipePointer: number | null = null
  private pointerDownX = 0
  private pointerDownY = 0
  private pointerDownTime = 0

  constructor(
    private readonly scene: Phaser.Scene,
    parentContainer: Phaser.GameObjects.Container,
    vw: number,
    vh: number,
    topY: number,
  ) {
    const safe = readSafeArea()
    const left = Math.max(12, safe.left + 8)
    const right = Math.max(12, safe.right + 8)
    this.bookW = Math.floor(Math.min(760, vw - left - right))
    this.bookX = Math.floor(left + (vw - left - right - this.bookW) / 2)
    this.bookTopY = topY + 30
    this.navY = vh - Math.max(36, safe.bottom + 30)
    this.bookH = Math.floor(Math.min(640, this.navY - 36 - this.bookTopY))
    this.pageX = this.bookX + 8
    this.pageY = this.bookTopY + 8
    this.pageW = this.bookW - 16
    this.pageH = this.bookH - 16
    this.leafW = this.pageW / 2
    this.spineX = this.pageX + this.leafW

    this.bookContainer = scene.add.container(0, 0).setName('collection-book')
    parentContainer.add(this.bookContainer)
    this.binderBaseG = scene.add.graphics().setName('book-cover')
    this.tabContainer = scene.add.container(0, 0)
    this.spreadContainer = scene.add.container(this.spineX, this.pageY)
    this.shadowG = scene.add.graphics()
    this.turningLeafContainer = scene.add.container(this.spineX, this.pageY).setVisible(false)
    this.leafShadeG = scene.add.graphics()
    this.spineG = scene.add.graphics().setName('book-binding')
    this.navContainer = scene.add.container(0, 0)
    this.bookContainer.add([
      this.binderBaseG,
      this.tabContainer,
      this.spreadContainer,
      this.shadowG,
      this.turningLeafContainer,
      this.spineG,
      this.navContainer,
    ])

    this.leftPage = this.createLeaf(0, 0)
    this.rightPage = this.createLeaf(0, 1)
    this.spreadContainer.add([this.leftPage.container, this.rightPage.container])
    this.positionLeaf(this.leftPage, 0)
    this.positionLeaf(this.rightPage, 1)
    this.renderStaticBinder()
    this.renderSpine()
    this.renderTabs()
    this.renderBottomNav()
    this.setupSwipeInput()
    this.animTimerEvent = scene.time.addEvent({
      delay: 50,
      loop: true,
      callback: () => {
        if (this.destroyed || this.isTurningPage) return
        for (const draw of this.leftPage.redraws) draw()
        for (const draw of this.rightPage.redraws) draw()
      },
    })
    // Parent destruction also releases scene-level input/tweens, including mid-turn exits.
    this.bookContainer.once(Phaser.GameObjects.Events.DESTROY, this.release, this)
  }

  public destroy(): void {
    if (this.destroyed) return
    this.release()
    this.bookContainer.destroy()
  }

  private release(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.pageTween?.remove()
    this.pageTween = null
    this.animTimerEvent?.remove()
    this.animTimerEvent = null
    this.scene.input.off('pointerup', this.finishSwipe, this)
    this.scene.input.off('pointerupoutside', this.cancelSwipe, this)
    this.scene.input.off('gameout', this.cancelSwipe, this)
    this.leafShadeG.destroy()
  }

  private renderStaticBinder(): void {
    const g = this.binderBaseG
    const { bookX: x, bookTopY: y, bookW: w, bookH: h } = this
    g.fillStyle(0x05070e, 0.65)
    g.fillRoundedRect(x - 4, y + 6, w + 8, h + 6, 16)
    g.fillStyle(0x2b1e16, 1)
    g.fillRoundedRect(x - 4, y - 3, w + 8, h + 6, 16)
    g.lineStyle(3, 0x140e0b, 1)
    g.strokeRoundedRect(x - 4, y - 3, w + 8, h + 6, 16)
    g.lineStyle(1.5, 0x6a5035, 0.8)
    g.strokeRoundedRect(x - 1, y, w + 2, h, 13)

    // Stitched leather perimeter; the cover never participates in the page tween.
    g.lineStyle(1, 0xb29461, 0.7)
    for (let sx = x + 26; sx < x + w - 26; sx += 9) {
      g.lineBetween(sx, y + 3, sx + 4, y + 3)
      g.lineBetween(sx, y + h - 3, sx + 4, y + h - 3)
    }
    for (let sy = y + 26; sy < y + h - 26; sy += 9) {
      g.lineBetween(x + 2, sy, x + 2, sy + 4)
      g.lineBetween(x + w - 2, sy, x + w - 2, sy + 4)
    }
    const corner = 20
    g.fillStyle(0xd4af37, 1)
    g.fillTriangle(x - 4, y - 3, x - 4 + corner, y - 3, x - 4, y - 3 + corner)
    g.fillTriangle(x + w + 4, y - 3, x + w + 4 - corner, y - 3, x + w + 4, y - 3 + corner)
    g.fillTriangle(x - 4, y + h + 3, x - 4 + corner, y + h + 3, x - 4, y + h + 3 - corner)
    g.fillTriangle(x + w + 4, y + h + 3, x + w + 4 - corner, y + h + 3, x + w + 4, y + h + 3 - corner)
    g.fillStyle(0x251a12, 1)
    g.fillCircle(x + 3, y + 4, 1.7)
    g.fillCircle(x + w - 3, y + 4, 1.7)
    g.fillCircle(x + 3, y + h - 4, 1.7)
    g.fillCircle(x + w - 3, y + h - 4, 1.7)

    g.fillStyle(0xcabc9e, 1)
    g.fillRoundedRect(this.pageX - 2, this.pageY + 3, this.pageW + 4, this.pageH + 2, 8)
    g.fillStyle(0xe6dac2, 1)
    g.fillRoundedRect(this.pageX - 1, this.pageY + 1, this.pageW + 2, this.pageH + 1, 8)
  }

  private renderSpine(): void {
    const g = this.spineG
    const { spineX: x, pageY: y, pageH: h } = this
    for (let i = 0; i < 6; i++) {
      g.fillStyle(0x3c2b17, 0.025 + i * 0.012)
      g.fillRect(x - 12 + i * 2, y, 24 - i * 4, h)
    }
    g.lineStyle(1, 0xb8aa92, 0.9)
    g.lineBetween(x, y + 3, x, y + h - 3)
    const count = h < 280 ? 3 : 5
    for (let i = 0; i < count; i++) {
      const ringY = y + 20 + (i * (h - 40)) / (count - 1)
      g.fillStyle(0x000000, 0.22)
      g.fillEllipse(x + 2, ringY + 2, 16, 6)
      g.fillStyle(0xb58b2a, 1)
      g.fillEllipse(x, ringY, 15, 6)
      g.fillStyle(0xfde087, 1)
      g.fillEllipse(x, ringY - 1, 11, 3)
      g.fillStyle(0x2b1e16, 1)
      g.fillCircle(x - 6, ringY, 1.8)
      g.fillCircle(x + 6, ringY, 1.8)
    }
  }

  private renderTabs(): void {
    const gap = 4
    const w = (this.bookW - 24 - gap * (CHAPTERS.length - 1)) / CHAPTERS.length
    const y = this.bookTopY - 20
    CHAPTERS.forEach((chapter, i) => {
      const x = this.bookX + 12 + i * (w + gap)
      const active = i === this.currentPage
      const top = y - (active ? 3 : 0)
      let tab = this.tabs[i]
      if (!tab) {
        const graphics = this.scene.add.graphics()
        const text = hudText(this.scene, x + w / 2, top + 11, chapter.tab, 1, {
          color: '#ffffff', size: 11, stroke: 2, origin: [0.5, 0.5], shadow: false,
        })
        text.setScale(Math.min(1, (w - 8) / text.width))
        const hit = this.scene.add.zone(x + w / 2, y + 9, w, 28).setInteractive({ useHandCursor: true })
        hit.setName(`book-tab-${i}`)
        hit.on('pointerdown', () => this.turnToPage(i))
        this.tabContainer.add([graphics, text, hit])
        tab = { graphics, text }
        this.tabs.push(tab)
      }
      const g = tab.graphics
      g.clear()
      g.fillStyle(0x000000, 0.35)
      g.fillRoundedRect(x, top + 3, w, 28, 7)
      g.fillStyle(chapter.color, active ? 1 : 0.7)
      g.fillRoundedRect(x, top, w, 28, 7)
      g.lineStyle(1.5, INK, 1)
      g.strokeRoundedRect(x, top, w, 28, 7)
      g.lineStyle(1, 0xffffff, active ? 0.7 : 0.35)
      g.strokeRoundedRect(x + 2, top + 2, w - 4, 24, 5)
      tab.text.setY(top + 11)
    })
  }

  private positionLeaf(leaf: BookLeaf, side: number): void {
    leaf.container.setPosition(side === 0 ? -this.leafW : 0, 0).setScale(1).setVisible(true)
  }

  private turnToPage(target: number): void {
    if (this.destroyed || this.isTurningPage || target < 0 || target >= CHAPTERS.length || target === this.currentPage) return
    this.isTurningPage = true
    this.cancelSwipe()
    this.prevButton.setDisabled(true)
    this.nextButton.setDisabled(true)
    const forward = target > this.currentPage
    const source = forward ? this.rightPage : this.leftPage
    const oldUnder = forward ? this.leftPage : this.rightPage
    const newLeft = this.createLeaf(target, 0)
    const newRight = this.createLeaf(target, 1)
    const under = forward ? newRight : newLeft
    const back = forward ? newLeft : newRight

    // Only the source leaf lifts. Its neighbor stays until covered by the back face.
    this.spreadContainer.add(under.container)
    this.positionLeaf(under, forward ? 1 : 0)
    this.turningLeafContainer.add([source.container, back.container, this.leafShadeG])
    this.positionLeaf(source, forward ? 1 : 0)
    this.positionLeaf(back, forward ? 0 : 1)
    back.container.setVisible(false)
    this.turningLeafContainer.setScale(1).setVisible(true)
    this.turnState.progress = 0
    this.pageTween = this.scene.tweens.add({
      targets: this.turnState,
      progress: 1,
      duration: 540,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const p = this.turnState.progress
        const firstFace = p < 0.5
        const lift = Math.sin(Math.PI * p)
        const side = (firstFace ? forward : !forward) ? 1 : -1
        source.container.setVisible(firstFace)
        back.container.setVisible(!firstFace)
        // Positive scale on each face keeps all lettering readable, never mirror-written.
        this.turningLeafContainer.scaleX = Math.max(0.002, Math.abs(Math.cos(Math.PI * p)))
        this.leafShadeG.clear()
        this.leafShadeG.fillStyle(0x675032, lift * 0.16)
        this.leafShadeG.fillRect(side > 0 ? 0 : -this.leafW, 0, this.leafW, this.pageH)
        this.shadowG.clear()
        const shadowW = this.leafW * 0.28 * lift
        for (let i = 0; i < 8; i++) {
          const bandW = shadowW / 8
          this.shadowG.fillStyle(0x251a12, lift * (1 - i / 8) * 0.2)
          this.shadowG.fillRect(side > 0 ? i * bandW + 1 : -(i + 1) * bandW - 1, this.pageY, bandW, this.pageH)
        }
        this.shadowG.x = this.spineX
      },
      onComplete: () => {
        this.pageTween = null
        source.container.destroy()
        oldUnder.container.destroy()
        this.spreadContainer.add(back.container)
        this.positionLeaf(newLeft, 0)
        this.positionLeaf(newRight, 1)
        this.leftPage = newLeft
        this.rightPage = newRight
        this.turningLeafContainer.setVisible(false).setScale(1)
        this.shadowG.clear()
        this.leafShadeG.clear()
        this.currentPage = target
        this.isTurningPage = false
        this.renderTabs()
        this.renderBottomNav()
      },
    })
  }

  private createLeaf(chapter: number, side: number): BookLeaf {
    const container = this.scene.add.container(0, 0).setName(`book-leaf-${chapter}-${side}`)
    const leaf: BookLeaf = { container, redraws: [] }
    const paper = this.scene.add.graphics().setName('book-paper')
    container.add(paper)
    paper.fillStyle(0xf8f2e1, 1)
    paper.fillRoundedRect(0, 0, this.leafW, this.pageH, { tl: side === 0 ? 8 : 0, tr: side === 1 ? 8 : 0, bl: side === 0 ? 8 : 0, br: side === 1 ? 8 : 0 })
    paper.lineStyle(1, 0xd0c2a5, 1)
    paper.strokeRect(1, 1, this.leafW - 2, this.pageH - 2)
    const x = side === 0 ? 10 : 18
    const w = this.leafW - 28
    const tier = chapter + 8
    const header = chapter === 0 ? (side === 0 ? 'CORE • I–IV' : 'CORE • V–VIII')
      : `TIER ${tier} • ${side === 0 ? 'I–IV' : 'V–VIII'}`
    this.paperText(leaf, x, 10, w, header, 15, '#2d241e', 20)
    paper.lineStyle(1, 0xc7b491, 0.7)
    paper.lineBetween(x, 35, x + w, 35)
    const bodyY = 44
    const unidentified = chapter !== 0 && hasUnidentifiedCollectionFinds(this.save.variants, tier)
    const bodyH = this.pageH - bodyY - 24 - (unidentified ? 28 : 0)
    const slots = chapter === 0 ? null : collectionSlotsFor(tier)
    const first = side * 4
    const cols = w >= 260 && bodyH < 300 ? 2 : 1
    const rows = 4 / cols
    const gap = 6
    const cardW = (w - gap * (cols - 1)) / cols
    const cardH = (bodyH - gap * (rows - 1)) / rows
    for (let slot = 0; slot < 4; slot++) {
      const entry = first + slot
      this.renderEntry(leaf, x + (slot % cols) * (cardW + gap), bodyY + Math.floor(slot / cols) * (cardH + gap), cardW, cardH, chapter === 0 ? entry + 1 : tier, 0, slots?.[entry]?.theme)
    }
    if (unidentified) {
      this.paperText(leaf, x, this.pageH - 46, w, 'Older records: character unknown.\nRediscover to identify.', 9, '#8a7a66', 24, true)
    }
    this.paperText(leaf, x, this.pageH - 18, w, `${chapter * 2 + side + 1}  /  ${CHAPTERS.length * 2}`, 10, '#8a7a66', 14)
    return leaf
  }

  /** All bounds are leaf-local; the inner margin is reserved for the brass rings. */
  private paperText(leaf: BookLeaf, x: number, y: number, w: number, text: string, size: number, color: string, maxH: number, wrap = false): Phaser.GameObjects.Text {
    const label = hudText(this.scene, x + w / 2, y, text, 1, {
      color, size, stroke: 0, origin: [0.5, 0], shadow: false,
    }).setStroke('#000000', 0).setName('book-text')
    if (wrap) label.setWordWrapWidth(w, true).setAlign('center')
    label.setScale(Math.min(1, w / Math.max(1, label.width), maxH / Math.max(1, label.height)))
    leaf.container.add(label)
    return label
  }

  private renderEntry(leaf: BookLeaf, x: number, y: number, w: number, h: number, tier: number, variant: number, theme?: string | null): void {
    const save = this.save
    const collectible = tier >= 9
    const discovery = collectible && theme ? collectionDiscovery(save.variants, tier, theme) : null
    const at = collectible ? discovery?.at : save.discovered[String(tier)]
    const known = at != null
    const palette = discovery?.variant ?? variant
    const card = this.scene.add.graphics().setName('book-entry')
    leaf.container.add(card)
    card.fillStyle(known ? 0xfffcf5 : 0xede4d1, 1)
    card.fillRoundedRect(x, y, w, h, 6)
    card.lineStyle(1, known ? 0xd8c6a2 : 0xc7b491, 1)
    card.strokeRoundedRect(x, y, w, h, 6)
    const title = collectible ? (known ? theme!.toUpperCase() : 'UNKNOWN CHARACTER')
      : `T${tier} • ${known ? (tier === 8 ? 'PRISM' : getTier(tier)!.face.toUpperCase()) : '????'}`
    const status = known ? this.discoveryDate(at) : collectible && theme == null ? 'LOCKED • UNIMPLEMENTED' : 'UNDISCOVERED'
    const compact = h < 72
    if (compact) {
      const r = Math.min(18, (h - 8) / 2)
      this.addBall(leaf, x + 24, y + h / 2, r, tier, palette, known, theme)
      this.paperText(leaf, x + 46, y + h / 2 - 14, w - 52, title, 11, known ? '#2d241e' : '#7a6f62', 14)
      this.paperText(leaf, x + 46, y + h / 2 + 3, w - 52, status, 10, known ? '#2563eb' : '#8c7d6b', 12)
    } else {
      this.paperText(leaf, x + 6, y + 6, w - 12, title, 12, known ? '#2d241e' : '#7a6f62', 16)
      // Collectible art draws its own details inside the radius; use the
      // same extent as core tiers so the character fills the card.
      const extent = 1.1
      const r = Math.min(52, w / (extent * 2.2), (h - 50) / (extent * 1.8))
      const centerY = y + 24 + (h - 46) / 2
      this.addBall(leaf, x + w / 2, centerY, r, tier, palette, known, theme)
      if (known) this.drawInkStamp(leaf, x + w / 2, y + h - 17, status, CHAPTERS[collectible ? tier - 8 : 0]!.color, Math.min(w - 12, 88))
      else this.paperText(leaf, x + 4, y + h - 21, w - 8, status, 10, '#8c7d6b', 14)
    }
  }

  private addBall(leaf: BookLeaf, x: number, y: number, r: number, tier: number, variant: number, known: boolean, theme?: string | null): void {
    const g = this.scene.add.graphics().setName('book-ball')
    leaf.container.add(g)
    if (!known || (tier >= 9 && !theme)) {
      g.fillStyle(0xd5c8b2, 0.75)
      g.fillCircle(x, y, r)
      g.lineStyle(1.5, 0x8a7a66, 0.9)
      g.strokeCircle(x, y, r)
      g.lineStyle(1, 0x8a7a66, 0.4)
      g.lineBetween(x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7)
      this.paperText(leaf, x - r, y - Math.min(6, r * 0.4), r * 2, tier >= 9 ? '?' : `T${tier}`, Math.min(14, r), '#655745', Math.min(18, r * 1.4))
      return
    }
    const seed = tier * 1013 + variant
    if (tier >= 9 && theme) {
      const draw = (): void => {
        g.clear()
        drawCollectibleBall(g, x, y, r, tier, variant, undefined, 0, undefined, seed, theme, 0, tier === 11 ? 1100 + variant : undefined, true)
      }
      draw()
      leaf.redraws.push(draw)
      return
    }
    const look = ballLookFor(tier, seed)
    const poly = restContour(look, r, x, y, 24).map((point) => new Phaser.Math.Vector2(point.x, point.y))
    const center = { x, y }
    const tierColor = getTier(tier)!.color
    const draw = (): void => {
      g.clear()
      g.fillStyle(tier === 8 ? cycleColor(Date.now()) : tierColor, 1)
      g.fillPoints(poly, true)
      g.lineStyle(collectionOutlineWidth(r), INK, 1)
      g.strokePoints(poly, true, true)
      drawBallFace(g, look, center, r, 1, undefined, true)
    }
    draw()
    leaf.redraws.push(draw)
  }

  private drawInkStamp(leaf: BookLeaf, x: number, y: number, text: string, color: number, w: number): void {
    const stamp = this.scene.add.container(x, y).setRotation(-0.055)
    leaf.container.add(stamp)
    const g = this.scene.add.graphics()
    stamp.add(g)
    g.lineStyle(1.3, color, 0.8)
    g.strokeRoundedRect(-w / 2, -9, w, 18, 3)
    g.lineStyle(0.7, color, 0.5)
    g.strokeRoundedRect(-w / 2 + 2, -7, w - 4, 14, 2)
    const label = hudText(this.scene, 0, 0, text, 1, {
      color: `#${color.toString(16).padStart(6, '0')}`, size: 10, stroke: 0, shadow: false, origin: [0.5, 0.5],
    }).setStroke('#000000', 0).setAlpha(0.85)
    label.setScale(Math.min(1, (w - 8) / label.width))
    stamp.add(label)
  }

  private discoveryDate(at: number): string {
    return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  }

  private renderBottomNav(): void {
    // Keep hit zones registered across turns; rebuilding them loses taps on the completion frame.
    if (this.pageNumberText && this.chapterText) {
      this.prevButton.setDisabled(this.currentPage === 0)
      this.nextButton.setDisabled(this.currentPage === CHAPTERS.length - 1)
      this.pageNumberText.setText(`${this.currentPage + 1} / ${CHAPTERS.length}`)
      this.chapterText.setText(CHAPTERS[this.currentPage]!.label)
      return
    }
    const w = Math.min(116, (this.bookW - 94) / 2)
    this.prevButton = new ChunkyButton({
      scene: this.scene, x: this.bookX + w / 2 + 4, y: this.navY, w, h: 42,
      label: 'PREV', fontSize: 13, fill: UI_COLORS.BTN_BLUE, disabled: this.currentPage === 0,
      onClick: () => this.turnToPage(this.currentPage - 1),
    })
    this.prevButton.container.setName('book-prev')
    this.nextButton = new ChunkyButton({
      scene: this.scene, x: this.bookX + this.bookW - w / 2 - 4, y: this.navY, w, h: 42,
      label: 'NEXT', fontSize: 13, fill: UI_COLORS.BTN_BLUE, disabled: this.currentPage === CHAPTERS.length - 1,
      onClick: () => this.turnToPage(this.currentPage + 1),
    })
    this.nextButton.container.setName('book-next')
    this.navContainer.add([this.prevButton.container, this.nextButton.container])
    const page = hudText(this.scene, this.spineX, this.navY - 7, `${this.currentPage + 1} / ${CHAPTERS.length}`, 1, {
      color: '#ffffff', size: 14, stroke: 3, origin: [0.5, 0.5],
    })
    const title = hudText(this.scene, this.spineX, this.navY + 10, CHAPTERS[this.currentPage]!.label, 1, {
      color: UI_COLORS.TEXT_GOLD, size: 10, stroke: 2, origin: [0.5, 0.5], shadow: false,
    })
    this.navContainer.add([page, title])
    this.pageNumberText = page
    this.chapterText = title
  }

  private setupSwipeInput(): void {
    const zone = this.scene.add.zone(this.spineX, this.pageY + this.pageH / 2, this.pageW, this.pageH).setInteractive()
    this.bookContainer.addAt(zone, 0)
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isTurningPage) return
      const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y)
      this.swipePointer = pointer.id
      this.pointerDownX = world.x
      this.pointerDownY = world.y
      this.pointerDownTime = this.scene.time.now
    })
    this.scene.input.on('pointerup', this.finishSwipe, this)
    this.scene.input.on('pointerupoutside', this.cancelSwipe, this)
    this.scene.input.on('gameout', this.cancelSwipe, this)
  }

  private finishSwipe(pointer: Phaser.Input.Pointer): void {
    if (this.swipePointer !== pointer.id) return
    this.swipePointer = null
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y)
    const dx = world.x - this.pointerDownX
    const dy = world.y - this.pointerDownY
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2 && this.scene.time.now - this.pointerDownTime < 650) {
      this.turnToPage(this.currentPage + (dx < 0 ? 1 : -1))
    }
  }

  private cancelSwipe(): void {
    this.swipePointer = null
  }
}
