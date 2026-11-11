import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { collectionDiscovery, collectionSlotsFor, isCollectibleTier } from '../../config/collectibleCollection'
import { readSafeArea, WORLD_GEOM, type UiLayout } from '../../ui/ResponsiveLayout'
import { hudText } from '../../ui/Typography'
import { loadSave } from '../state/save'
import { ballLookFor, collectionOutlineWidth, drawBallFace, drawCollectibleBall, INK, restContour } from './BallAppearance'
import { cycleColor } from './rgbCycle'

export interface DiscoveryBookOptions {
  tier: number
  seed: number
  /** Required for collectible tiers; character identity, not the palette. */
  theme?: string | null
  /** Palette within the character theme. Defaults to palette zero. */
  variant?: number | null
  firstTime: boolean
  /** Screen-space origin, normally the newly unlocked tier-track node. */
  origin?: { x: number; y: number } | null
}

interface BookEntry {
  slot: number
  tier: number
  theme: string | null
  label: string
  variant: number
  seed: number
  known: boolean
  implemented: boolean
  at: number | null
}

interface BookRig {
  motion: Phaser.GameObjects.Container
  heading: Phaser.GameObjects.Container
  hero: Phaser.GameObjects.Container
  halo: Phaser.GameObjects.Container
  stamp: Phaser.GameObjects.Container
  labels: Phaser.GameObjects.Container
  unknown: Phaser.GameObjects.Container
  highlight: Phaser.GameObjects.Graphics
  left: Phaser.GameObjects.Container | null
  front: Phaser.GameObjects.Container | null
  binding: Phaser.GameObjects.Container | null
  shade: Phaser.GameObjects.Graphics | null
  targetX: number
  targetY: number
  targetScale: number
  width: number
  height: number
}

const LEATHER = 0x2b1e16
const LEATHER_INK = 0x140e0b
const PAPER = 0xf8f2e1
const RULE = 0xd0c2a5
const GOLD = 0xd4af37
const CARD = 0xfffcf5
const MUTED = '#8a7a66'
const PAPER_INK = '#2d241e'
const HALF_W = 300
const HALF_H = 224
const HERO_RADIUS = 74
const DEPTH = 90

/**
 * Non-interactive, screen-space discovery art. Use in the CSS-pixel UI scene,
 * with its current layout getter when available. Never pauses gameplay, takes
 * input, changes the camera, or writes collection progress. A new show replaces
 * the previous presentation; destroy is idempotent and the instance is reusable.
 */
export class DiscoveryBookAnimation {
  private root: Phaser.GameObjects.Container | null = null
  private rig: BookRig | null = null
  private readonly tweens = new Set<Phaser.Tweens.Tween>()
  private readonly timers = new Set<Phaser.Time.TimerEvent>()
  private media: MediaQueryList | null = null
  private reducedMotion = false
  private firstTime = false
  private generation = 0
  private entranceOrigin: { x: number; y: number } | null = null

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hudLayout?: () => UiLayout,
  ) {}

  isShowing(): boolean {
    return this.root !== null
  }

  show(options: DiscoveryBookOptions): void {
    // Resolve before replacing an active animation: never invent a collectible
    // slot or silently let the canonical renderer fall back to another theme.
    const entries = this.entriesFor(options)
    const target = isCollectibleTier(options.tier)
      ? entries.find((entry) => entry.theme === options.theme)!
      : entries[options.tier - 1]!
    this.destroy()
    this.firstTime = options.firstTime
    this.entranceOrigin = options.origin ?? null
    this.root = this.scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0)
      .setName('discovery-book-animation')
    this.rig = options.firstTime
      ? this.buildBook(entries, target)
      : this.buildRepeat(entries, target)
    this.layout()
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this)
    this.scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this)
    this.root.once(Phaser.GameObjects.Events.DESTROY, this.destroy, this)
    this.reducedMotion = false
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.media = window.matchMedia('(prefers-reduced-motion: reduce)')
      this.reducedMotion = this.media.matches
      this.media.addEventListener?.('change', this.onMotionChange)
    }
    if (!this.reducedMotion && options.firstTime) this.applyEntranceOrigin()
    if (this.reducedMotion) {
      this.applySettledPose()
      this.later(options.firstTime ? 2100 : 1750, () => this.exit())
    } else if (options.firstTime) {
      this.playBook()
    } else {
      this.playRepeat()
    }
  }

  destroy(): void {
    this.generation++
    this.cancelMotion()
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this)
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.destroy, this)
    this.media?.removeEventListener?.('change', this.onMotionChange)
    this.media = null
    const root = this.root
    this.root = null
    this.rig = null
    root?.off(Phaser.GameObjects.Events.DESTROY, this.destroy, this)
    root?.destroy()
  }

  private entriesFor(options: DiscoveryBookOptions): BookEntry[] {
    const collectible = isCollectibleTier(options.tier)
    if (!Number.isInteger(options.tier) || !getTier(options.tier)) {
      throw new RangeError(`No collection chapter for tier ${options.tier}`)
    }
    const slots = collectible ? collectionSlotsFor(options.tier) : null
    if (collectible && !slots!.some((slot) => slot.theme !== null && slot.theme === options.theme)) {
      throw new RangeError(`No collection slot for tier ${options.tier}, theme ${String(options.theme)}`)
    }
    const save = loadSave()
    return Array.from({ length: 8 }, (_, slot): BookEntry => {
      const tier = collectible ? options.tier : slot + 1
      const theme = slots?.[slot]?.theme ?? null
      const current = collectible ? theme === options.theme : tier === options.tier
      const discovery = collectible && theme ? collectionDiscovery(save.variants, tier, theme) : null
      const at = collectible ? discovery?.at ?? null : save.discovered[String(tier)] ?? null
      const variant = current ? options.variant ?? 0 : discovery?.variant ?? 0
      return {
        slot, tier, theme, variant,
        label: collectible ? slots![slot]!.label ?? 'LOCKED' : tier === 8 ? 'PRISM' : getTier(tier)!.face.toUpperCase(),
        seed: current ? options.seed : tier * 1013 + variant,
        known: current ? !options.firstTime : at !== null,
        implemented: !collectible || theme !== null,
        at,
      }
    })
  }

  private buildBook(entries: BookEntry[], target: BookEntry): BookRig {
    const motion = this.container(this.root!, 0, 0, 'discovery-book-spread')
    const shadow = this.graphics(motion)
    shadow.fillStyle(0x05070e, 0.2).fillEllipse(0, HALF_H + 13, 604, 31)
    const left = this.container(motion, 0, 0, 'discovery-book-left-leaf')
    const right = this.container(motion, 0, 0, 'discovery-book-right-leaf')
    let targetX = 0
    let targetY = 0
    let labels!: Phaser.GameObjects.Container
    let unknown!: Phaser.GameObjects.Container
    let highlight!: Phaser.GameObjects.Graphics
    for (let side = 0; side < 2; side++) {
      const page = side === 0 ? left : right
      const x = side === 0 ? -HALF_W : 0
      this.leather(this.graphics(page), x, -HALF_H, HALF_W, HALF_H * 2)
      this.paper(this.graphics(page), x + 8, -HALF_H + 10, HALF_W - 16, HALF_H * 2 - 23)
      const chapter = isCollectibleTier(target.tier) ? `TIER ${target.tier}` : 'CORE'
      this.text(page, x + HALF_W / 2, -184, `${chapter}  •  ${side === 0 ? 'I–IV' : 'V–VIII'}`, 23, PAPER_INK, 246)
      const rule = this.graphics(page)
      rule.lineStyle(1.5, RULE).lineBetween(x + 26, -163, x + 274, -163)
      for (let row = 0; row < 4; row++) {
        const entry = entries[side * 4 + row]!
        const cy = -114 + row * 81
        const cx = x + 57
        const card = this.graphics(page).setName(`discovery-book-slot-${entry.slot}`)
        card.fillStyle(entry.known ? CARD : 0xede4d1).fillRoundedRect(x + 24, cy - 35, 252, 70, 7)
        card.lineStyle(1.2, entry.known ? 0xd8c6a2 : RULE).strokeRoundedRect(x + 24, cy - 35, 252, 70, 7)
        this.text(page, x + 261, cy - 23, String(entry.slot + 1).padStart(2, '0'), 11, MUTED, 23)
        const entryLabels = this.container(page, 0, 0)
        const entryUnknown = this.container(page, 0, 0)
        const selected = entry.slot === target.slot
        if (selected) {
          highlight = this.graphics(page).setAlpha(0)
          highlight.fillStyle(GOLD, 0.12).fillRoundedRect(x + 24, cy - 35, 252, 70, 7)
          highlight.lineStyle(2.5, GOLD).strokeRoundedRect(x + 24, cy - 35, 252, 70, 7)
          targetX = cx
          targetY = cy
          labels = entryLabels
          unknown = entryUnknown
          this.text(entryLabels, x + 163, cy - 11, entry.label, 23, PAPER_INK, 166)
          this.text(entryLabels, x + 163, cy + 16, 'NEWLY COLLECTED', 14, '#805b16', 166)
          this.unknownBall(entryUnknown, cx, cy, true)
          this.text(entryUnknown, x + 163, cy - 10, 'A NEW FACE…', 20, MUTED, 166)
          this.text(entryUnknown, x + 163, cy + 15, 'READY TO COLLECT', 13, MUTED, 166)
          entryLabels.setAlpha(0)
        } else if (entry.known) {
          this.ball(page, cx, cy, 25, entry)
          this.text(entryLabels, x + 163, cy - 11, entry.label, 22, PAPER_INK, 166)
          const date = entry.at === null ? 'COLLECTED' : new Date(entry.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
          this.text(entryLabels, x + 163, cy + 16, date, 14, MUTED, 166)
        } else {
          this.unknownBall(entryUnknown, cx, cy, entry.implemented)
          this.text(entryLabels, x + 163, cy - 10, entry.implemented ? 'UNKNOWN' : 'LOCKED', 21, MUTED, 166)
          this.text(entryLabels, x + 163, cy + 15, entry.implemented ? 'UNDISCOVERED' : 'UNIMPLEMENTED', 13, MUTED, 166)
        }
      }
      const chapterIndex = isCollectibleTier(target.tier) ? target.tier - 8 : 0
      this.text(page, x + 150, 198, `${chapterIndex * 2 + side + 1}  /  10`, 14, MUTED, 170)
    }
    const binding = this.container(motion, 0, 0, 'discovery-book-binding')
    const rings = this.graphics(binding)
    for (let i = 0; i < 6; i++) {
      rings.fillStyle(0x3c2b17, 0.025 + i * 0.012).fillRect(-12 + i * 2, -213, 24 - i * 4, 422)
    }
    rings.lineStyle(1, 0xb8aa92).lineBetween(0, -210, 0, 207)
    for (let i = 0; i < 5; i++) this.ring(rings, 0, -190 + i * 95)
    const shade = this.graphics(motion)
    shade.fillStyle(0x251a12, 0.22).fillRect(0, -213, 220, 422)
    shade.setAlpha(0)
    const front = this.container(motion, 0, 0, 'discovery-book-front-cover')
    this.leather(this.graphics(front), 0, -HALF_H, HALF_W, HALF_H * 2)
    const foil = this.graphics(front)
    foil.lineStyle(2, GOLD, 0.8).strokeRoundedRect(28, -191, 244, 382, 10)
    foil.lineStyle(1, GOLD, 0.45).strokeRoundedRect(35, -184, 230, 368, 7)
    // A small embossed book, not a substitute ball or coin emblem.
    foil.lineStyle(3, GOLD).strokeRoundedRect(110, -144, 80, 59, 6)
    foil.lineBetween(150, -139, 150, -91)
    foil.lineBetween(119, -125, 140, -125).lineBetween(160, -125, 181, -125)
    foil.lineBetween(119, -115, 140, -115).lineBetween(160, -115, 181, -115)
    this.text(front, 150, -23, 'THE\nCOLLECTION', 37, '#e4c976', 224)
    this.text(front, 150, 70, 'BALL RUSH', 19, '#b29461', 205)
    this.text(front, 150, 150, isCollectibleTier(target.tier) ? `TIER ${target.tier}` : 'THE CORE CHAPTER', 17, '#e4c976', 220)
    const heading = this.container(motion, 0, 0)
    this.text(heading, 0, -275, 'NEW DISCOVERY', 36, '#fff4d5', 560, true)
    this.text(heading, 0, -244, `${target.label}  •  TIER ${target.tier}  •  SLOT ${String(target.slot + 1).padStart(2, '0')}`, 17, '#f0d892', 580, true)
    const halo = this.halo(motion, 0, -38)
    const hero = this.container(motion, 0, -38, 'discovery-book-ball')
    this.ball(hero, 0, 0, HERO_RADIUS, target)
    const stamp = this.stamp(motion, 0, 256, 'COLLECTION UPDATED', 294, 36)
    left.setVisible(false).setScale(0.002, 1)
    binding.setAlpha(0)
    heading.setAlpha(0)
    hero.setAlpha(0)
    halo.setAlpha(0)
    stamp.setAlpha(0)
    motion.setPosition(-HALF_W / 2, 32).setScale(0.9).setRotation(-0.045).setAlpha(0)
    return { motion, heading, hero, halo, stamp, labels, unknown, highlight, left, front, binding, shade, targetX, targetY, targetScale: 25 / HERO_RADIUS, width: 640, height: 610 }
  }

  private buildRepeat(entries: BookEntry[], target: BookEntry): BookRig {
    const motion = this.container(this.root!, 0, 0, 'discovery-book-repeat-page')
    const g = this.graphics(motion)
    g.fillStyle(0x05070e, 0.22).fillRoundedRect(-185, -96, 374, 208, 15)
    this.leather(g, -185, -101, 370, 202)
    this.paper(g, -171, -93, 347, 184)
    g.lineStyle(1, RULE).lineBetween(-19, 48, 158, 48)
    g.fillStyle(PAPER).fillTriangle(157, -93, 176, -74, 157, -74)
    g.lineStyle(1, RULE).lineBetween(157, -93, 157, -74).lineBetween(157, -74, 176, -74)
    this.ring(g, -168, -66)
    this.ring(g, -168, 63)
    const heading = this.container(motion, 0, 0)
    this.text(heading, 66, -67, 'BACK IN THE BOOK', 19, '#805b16', 192)
    this.text(heading, 66, -34, target.label, 29, PAPER_INK, 192)
    this.text(heading, 66, -4, `TIER ${target.tier}  •  SLOT ${String(target.slot + 1).padStart(2, '0')} / 08`, 14, MUTED, 192)
    const labels = this.container(motion, 0, 0)
    this.text(labels, 66, 65, 'ALREADY COLLECTED', 13, MUTED, 192)
    const unknown = this.container(motion, 0, 0).setVisible(false)
    const highlight = this.graphics(motion)
    const railX = -141
    entries.forEach((entry, index) => {
      const x = railX + index * 11
      const selected = entry.slot === target.slot
      highlight.fillStyle(selected ? GOLD : entry.known ? 0xb6a376 : 0xe1d6bf)
      highlight.fillCircle(x, 71, selected ? 4 : 2.8)
      if (selected) highlight.lineStyle(1, 0x805b16).strokeCircle(x, 71, 5.8)
    })
    const halo = this.halo(motion, -103, -11).setScale(0.53).setAlpha(0)
    const hero = this.container(motion, -103, -11, 'discovery-book-ball').setScale(0.54)
    this.ball(hero, 0, 0, HERO_RADIUS, target)
    const stamp = this.stamp(motion, 66, 28, 'COLLECTED', 164, 27).setAlpha(0)
    motion.setPosition(26, -8).setScale(0.96).setRotation(-0.025).setAlpha(0)
    return { motion, heading, hero, halo, stamp, labels, unknown, highlight, left: null, front: null, binding: null, shade: null, targetX: -103, targetY: -11, targetScale: 0.54, width: 410, height: 242 }
  }

  private playBook(): void {
    const rig = this.rig!
    // Anticipation: a closed, weighty leather volume; only this rig moves.
    this.animate({
      targets: rig.motion,
      x: -HALF_W / 2,
      y: 0,
      scale: 1,
      rotation: 0,
      alpha: 1,
      duration: 260,
      ease: 'Back.easeOut',
    }, () => {
      const turn = { progress: 0 }
      this.animate({ targets: rig.heading, alpha: 1, duration: 260, ease: 'Sine.easeOut' })
      this.animate({ targets: turn, progress: 1, duration: 360, ease: 'Sine.easeInOut', onUpdate: () => {
        const p = turn.progress
        const face = Math.cos(Math.PI * p)
        rig.motion.x = -HALF_W / 2 * (1 - p)
        rig.front!.setVisible(p < 0.5).setScale(Math.max(0.002, face), 1)
        rig.left!.setVisible(p >= 0.5).setScale(Math.max(0.002, -face), 1)
        rig.binding!.setAlpha(p)
        const lift = Math.sin(Math.PI * p)
        rig.shade!.setAlpha(lift).setScale(Math.max(0.002, lift), 1).setX(p < 0.5 ? 0 : -220 * lift)
      } }, () => {
        rig.front!.setVisible(false)
        rig.left!.setVisible(true).setScale(1)
        rig.shade!.setAlpha(0)
        this.reveal(rig)
      })
    })
  }

  private reveal(rig: BookRig): void {
    rig.hero.setAlpha(0).setScale(0.76).setY(-51)
    rig.halo.setAlpha(0).setScale(0.78)
    this.animate({ targets: rig.hero, alpha: 1, scale: 1, y: -38, duration: 260, ease: 'Back.easeOut' })
    this.animate({ targets: rig.halo, alpha: 0.85, scale: 1, duration: 260, ease: 'Sine.easeOut' })
    this.later(340, () => {
      this.animate({ targets: rig.halo, alpha: 0, scale: 1.12, duration: 230, ease: 'Sine.easeOut' })
      const flight = { progress: 0 }
      this.animate({ targets: flight, progress: 1, duration: 360, ease: 'Cubic.easeInOut', onUpdate: () => {
        const p = flight.progress
        rig.hero.setPosition(rig.targetX * p, -38 + (rig.targetY + 38) * p - Math.sin(Math.PI * p) * 62)
        rig.hero.setScale(1 + (rig.targetScale - 1) * p)
        rig.hero.rotation = Math.sin(Math.PI * p) * (rig.targetX < 0 ? -0.13 : 0.13)
      } }, () => this.land(rig))
    })
  }

  private land(rig: BookRig): void {
    rig.hero.setPosition(rig.targetX, rig.targetY).setRotation(0)
      .setScale(rig.targetScale * 1.15, rig.targetScale * 0.85)
    this.animate({ targets: rig.hero, scaleX: rig.targetScale, scaleY: rig.targetScale, duration: 190, ease: 'Back.easeOut' })
    this.animate({ targets: rig.unknown, alpha: 0, duration: 100 })
    this.animate({ targets: [rig.labels, rig.highlight], alpha: 1, duration: 130 })
    rig.stamp.setScale(1.06).setRotation(-0.035)
    this.animate({ targets: rig.stamp, alpha: 1, scale: 1, duration: 190, ease: 'Cubic.easeOut' })
    rig.motion.y = 3
    this.animate({ targets: rig.motion, y: 0, duration: 160, ease: 'Sine.easeOut' })
    // Includes the short settle, then a readable, motionless hold.
    this.later(1510, () => this.exit())
  }

  private playRepeat(): void {
    const rig = this.rig!
    this.animate({ targets: rig.motion, x: 0, y: 0, scale: 1, rotation: 0, alpha: 1, duration: 220, ease: 'Cubic.easeOut' })
    this.later(220, () => {
      rig.stamp.setScale(1.04).setRotation(-0.035)
      this.animate({ targets: rig.stamp, alpha: 1, scale: 1, duration: 160, ease: 'Sine.easeOut' })
    })
    this.later(1730, () => this.exit())
  }

  private applySettledPose(): void {
    const rig = this.rig
    if (!rig) return
    rig.motion.setPosition(0, 0).setScale(1).setRotation(0).setAlpha(1)
    rig.left?.setVisible(true).setScale(1)
    rig.front?.setVisible(false)
    rig.binding?.setAlpha(1)
    rig.shade?.setAlpha(0)
    rig.heading.setAlpha(1)
    rig.hero.setPosition(rig.targetX, rig.targetY).setScale(rig.targetScale).setRotation(0).setAlpha(1)
    rig.halo.setAlpha(0)
    rig.unknown.setVisible(false)
    rig.labels.setAlpha(1)
    rig.highlight.setAlpha(1)
    rig.stamp.setAlpha(1).setScale(1).setRotation(-0.035)
  }

  private readonly onMotionChange = (event: MediaQueryListEvent): void => {
    if (!event.matches || !this.root) return
    this.reducedMotion = true
    this.cancelMotion()
    this.applySettledPose()
    this.later(this.firstTime ? 1800 : 1400, () => this.exit())
  }

  private exit(): void {
    const rig = this.rig
    if (!rig) return
    if (this.reducedMotion) {
      this.animate({ targets: rig.motion, alpha: 0, duration: 160, ease: 'Sine.easeOut' }, () => this.destroy())
    } else {
      this.animate({ targets: rig.motion, y: 14, scale: 0.96, alpha: 0, duration: this.firstTime ? 300 : 270, ease: 'Cubic.easeIn' }, () => this.destroy())
    }
  }

  private applyEntranceOrigin(): void {
    const root = this.root
    const rig = this.rig
    const origin = this.entranceOrigin
    if (!root || !rig || !origin) return
    const scale = root.scaleX || 1
    rig.motion.setPosition((origin.x - root.x) / scale, (origin.y - root.y) / scale)
      .setScale(0.12).setRotation(-0.08).setAlpha(0.3)
  }

  private layout(): void {
    const root = this.root
    const rig = this.rig
    if (!root || !rig) return
    const layout = this.hudLayout?.()
    const dpr = this.scene.game.scale.displayScale.x || 1
    const vw = layout?.vw ?? this.scene.scale.width / dpr
    const vh = layout?.vh ?? this.scene.scale.height / dpr
    const safe = readSafeArea()
    let left = Math.max(12, safe.left + 10)
    const right = vw - Math.max(12, safe.right + 10)
    let top = Math.max(12, safe.top + 10)
    let bottom = vh - Math.max(12, safe.bottom + 10)
    if (layout?.composition === 'portrait') {
      // The stack's gameplay-slot estimate includes extra breathing room on
      // narrow phones; anchor to the actually visible HUD row instead.
      top = Math.max(top, vh * 0.2)
      bottom = Math.min(bottom, layout.stack.controlsTop - 12)
    } else {
      // Leave the pause/header controls visible; use a genuine side gutter
      // when the layout has one rather than covering the live merge pile.
      top += Math.min(120, vh * 0.16)
      if (layout) {
        const gameRight = vw / 2 + WORLD_GEOM.CONTAINER_OUTER_W * layout.world.zoom / 2
        if (right - gameRight >= 280) left = Math.max(left, gameRight + 14)
      }
    }
    // Extremely short layouts still keep the complete art inside safe bounds.
    if (bottom <= top + 40) {
      top = Math.max(8, safe.top + 8)
      bottom = vh - Math.max(8, safe.bottom + 8)
    }
    const availableW = Math.max(1, right - left)
    const availableH = Math.max(1, bottom - top)
    const scale = this.firstTime
      ? Math.max(0.001, Math.min(1, availableW / rig.width, availableH / rig.height))
      : Math.max(0.001, Math.min(1.05, Math.min(210, availableW * 0.52) / rig.width, Math.min(286, availableH * 0.72) / rig.height))
    const x = this.firstTime ? (left + right) / 2 : right - rig.width * scale / 2
    const phoneBookOffset = this.firstTime && layout?.composition === 'portrait' ? vh * 0.11 : 0
    const y = top + rig.height * scale / 2 + phoneBookOffset
    // Only the anchor is responsive. Local animation coordinates survive an
    // orientation change without restarting timers or fighting tween targets.
    root.setPosition(x, y).setScale(scale)
  }

  private ball(parent: Phaser.GameObjects.Container, x: number, y: number, radius: number, entry: BookEntry): void {
    const g = this.graphics(parent).setName('discovery-book-canonical-ball')
    if (isCollectibleTier(entry.tier)) {
      // Thumbnail mode includes themed accessories without registering live
      // ball IDs, antenna springs, Earth glow images, or gameplay state.
      drawCollectibleBall(g, x, y, radius, entry.tier, entry.variant, undefined, 0, undefined, entry.seed, entry.theme!, 0, undefined, true)
      return
    }
    const look = ballLookFor(entry.tier, entry.seed)
    const poly = restContour(look, radius, x, y, 32) as Phaser.Math.Vector2[]
    g.fillStyle(entry.tier === 8 ? cycleColor(Date.now()) : getTier(entry.tier)!.color).fillPoints(poly, true)
    g.lineStyle(collectionOutlineWidth(radius), INK).strokePoints(poly, true, true)
    drawBallFace(g, look, { x, y }, radius, 1, undefined, true)
  }

  private unknownBall(parent: Phaser.GameObjects.Container, x: number, y: number, implemented: boolean): void {
    const g = this.graphics(parent)
    g.fillStyle(0xd5c8b2, 0.75).fillCircle(x, y, 25)
    g.lineStyle(1.5, 0x8a7a66, 0.8).strokeCircle(x, y, 25)
    this.text(parent, x, y, implemented ? '?' : '–', 24, '#655745', 38)
  }

  private leather(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    g.fillStyle(LEATHER).fillRoundedRect(x, y, w, h, 15)
    g.lineStyle(3, LEATHER_INK).strokeRoundedRect(x, y, w, h, 15)
    g.lineStyle(1.5, 0x6a5035, 0.8).strokeRoundedRect(x + 4, y + 4, w - 8, h - 8, 12)
    g.lineStyle(1, 0xb29461, 0.7)
    for (let sx = x + 23; sx < x + w - 23; sx += 10) {
      g.lineBetween(sx, y + 8, sx + 4, y + 8)
      g.lineBetween(sx, y + h - 8, sx + 4, y + h - 8)
    }
    for (let sy = y + 24; sy < y + h - 24; sy += 10) {
      g.lineBetween(x + 8, sy, x + 8, sy + 4)
      g.lineBetween(x + w - 8, sy, x + w - 8, sy + 4)
    }
    g.fillStyle(GOLD)
    g.fillTriangle(x + 2, y + 2, x + 22, y + 2, x + 2, y + 22)
    g.fillTriangle(x + w - 2, y + 2, x + w - 22, y + 2, x + w - 2, y + 22)
    g.fillTriangle(x + 2, y + h - 2, x + 22, y + h - 2, x + 2, y + h - 22)
    g.fillTriangle(x + w - 2, y + h - 2, x + w - 22, y + h - 2, x + w - 2, y + h - 22)
  }

  private paper(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    g.fillStyle(0xcabc9e).fillRoundedRect(x - 2, y + 5, w + 4, h, 7)
    g.fillStyle(0xe6dac2).fillRoundedRect(x - 1, y + 2, w + 2, h, 7)
    g.fillStyle(PAPER).fillRoundedRect(x, y, w, h, 7)
    g.lineStyle(1, RULE).strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, 5)
    g.lineStyle(1, 0x8a7a66, 0.035)
    for (let sy = y + 14; sy < y + h - 8; sy += 11) g.lineBetween(x + 7, sy, x + w - 7, sy)
  }

  private ring(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.fillStyle(0x000000, 0.22).fillEllipse(x + 2, y + 2, 18, 8)
    g.fillStyle(0xb58b2a).fillEllipse(x, y, 18, 7)
    g.fillStyle(0xfde087).fillEllipse(x, y - 1, 13, 3)
    g.fillStyle(LEATHER).fillCircle(x - 7, y, 1.8).fillCircle(x + 7, y, 1.8)
  }

  private halo(parent: Phaser.GameObjects.Container, x: number, y: number): Phaser.GameObjects.Container {
    const halo = this.container(parent, x, y)
    const g = this.graphics(halo)
    g.fillStyle(GOLD, 0.08).fillCircle(0, 0, 113)
    g.fillStyle(GOLD, 0.1).fillCircle(0, 0, 95)
    g.lineStyle(1.5, GOLD, 0.55).strokeCircle(0, 0, 103)
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6
      g.lineStyle(i % 2 ? 2 : 3, GOLD, 0.75)
      g.lineBetween(Math.cos(angle) * 113, Math.sin(angle) * 113, Math.cos(angle) * 124, Math.sin(angle) * 124)
    }
    return halo
  }

  private stamp(parent: Phaser.GameObjects.Container, x: number, y: number, label: string, w: number, h: number): Phaser.GameObjects.Container {
    const stamp = this.container(parent, x, y)
    const g = this.graphics(stamp)
    g.fillStyle(PAPER, 0.98).fillRoundedRect(-w / 2, -h / 2, w, h, 5)
    g.lineStyle(2, GOLD).strokeRoundedRect(-w / 2, -h / 2, w, h, 5)
    g.lineStyle(0.8, 0x805b16, 0.55).strokeRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 3)
    this.text(stamp, 0, 0, label, h * 0.53, '#805b16', w - 16)
    return stamp
  }

  private container(parent: Phaser.GameObjects.Container, x: number, y: number, name?: string): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y)
    if (name) container.setName(name)
    parent.add(container)
    return container
  }

  private graphics(parent: Phaser.GameObjects.Container): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics()
    parent.add(g)
    return g
  }

  private text(parent: Phaser.GameObjects.Container, x: number, y: number, label: string, size: number, color: string, maxW: number, outlined = false): Phaser.GameObjects.Text {
    const text = hudText(this.scene, x, y, label, 1, { color, size, stroke: outlined ? 3 : 0, shadow: false, origin: [0.5, 0.5] })
      .setAlign('center').setName('discovery-book-text')
    if (!outlined) text.setStroke('#000000', 0)
    text.setScale(Math.min(1, maxW / Math.max(1, text.width)))
    parent.add(text)
    return text
  }

  private animate(config: Phaser.Types.Tweens.TweenBuilderConfig, complete?: () => void): void {
    const generation = this.generation
    const tween = this.scene.tweens.add({ ...config, onComplete: () => {
      this.tweens.delete(tween)
      if (this.root && this.generation === generation) complete?.()
    } })
    this.tweens.add(tween)
  }

  private later(delay: number, callback: () => void): void {
    const generation = this.generation
    const timer = this.scene.time.delayedCall(delay, () => {
      this.timers.delete(timer)
      if (this.root && this.generation === generation) callback()
    })
    this.timers.add(timer)
  }

  private cancelMotion(): void {
    for (const timer of this.timers) timer.remove(false)
    this.timers.clear()
    for (const tween of this.tweens) tween.remove()
    this.tweens.clear()
  }
}
