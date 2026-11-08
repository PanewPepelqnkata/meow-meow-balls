import Phaser from 'phaser'
import type { KingdomMenuLayout } from '../../ui/KingdomMenuLayout'
import { bakeCanvas } from './RoughArt'
import { throneHallGeometry } from './KingdomStallArt'

export const KINGDOM_GLOW_KEY = 'br-throne-candle-warm-radial'
const INK = 0x111625
const GOLD = 0xd6ad60
export const THRONE_LIGHTS = { ROYAL: 0xc99bff, GOLD: 0xffd185, VELVET: 0xe66d91 } as const
const SUN_COLORS = [THRONE_LIGHTS.ROYAL, THRONE_LIGHTS.GOLD, THRONE_LIGHTS.VELVET] as const

interface ChandelierRig {
  x: number
  y: number
  w: number
  phase: number
  ambient: Phaser.GameObjects.Image
  pool: Phaser.GameObjects.Image
  halo: Phaser.GameObjects.Image
  body: Phaser.GameObjects.Container
  flames: Phaser.GameObjects.Graphics
}

/** Two bounded candle rigs, four velvet banners and jewel-toned volumetric window light. */
export class KingdomMenuEffects {
  readonly ambient: Phaser.GameObjects.Container
  readonly surface: Phaser.GameObjects.Container
  readonly sunbeams: Phaser.GameObjects.Graphics
  readonly banners: Phaser.GameObjects.Graphics
  readonly chandeliers: Phaser.GameObjects.Container
  readonly particles: Phaser.GameObjects.Graphics
  private readonly rigs: ChandelierRig[] = []
  private layout: KingdomMenuLayout | null = null

  constructor(private readonly scene: Phaser.Scene, private readonly reducedMotion: boolean) {
    this.ambient = scene.add.container(0, 0).setName('throne-hall-ambient')
    this.surface = scene.add.container(0, 0).setName('throne-hall-floor-light')
    this.sunbeams = scene.add.graphics().setName('throne-stained-glass-sunbeams').setBlendMode(Phaser.BlendModes.ADD)
    this.banners = scene.add.graphics().setName('throne-royal-banners')
    this.chandeliers = scene.add.container(0, 0).setName('throne-iron-chandeliers')
    this.particles = scene.add.graphics().setName('throne-lit-dust')
    if (!scene.textures.exists(KINGDOM_GLOW_KEY)) {
      bakeCanvas(scene, KINGDOM_GLOW_KEY, 256, 256, (ctx) => {
        const light = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
        light.addColorStop(0, 'rgba(255,238,182,1)')
        light.addColorStop(0.18, 'rgba(255,211,127,0.8)')
        light.addColorStop(0.45, 'rgba(255,183,87,0.29)')
        light.addColorStop(1, 'rgba(255,159,61,0)')
        ctx.fillStyle = light
        ctx.fillRect(0, 0, 256, 256)
      })
    }
  }

  build(layout: KingdomMenuLayout): void {
    this.clear()
    this.layout = layout
    const geometry = throneHallGeometry(layout)
    for (let i = 0; i < 2; i++) {
      const x = geometry.chandelierXs[i]!
      const y = geometry.chandelierY
      const w = geometry.chandelierW
      const ambient = this.scene.add.image(x, y, KINGDOM_GLOW_KEY).setBlendMode(Phaser.BlendModes.ADD)
      const pool = this.scene.add.image(x, layout.height * 0.7, KINGDOM_GLOW_KEY).setBlendMode(Phaser.BlendModes.ADD)
      const halo = this.scene.add.image(0, 0, KINGDOM_GLOW_KEY).setDisplaySize(w * 1.8, w * 1.1).setBlendMode(Phaser.BlendModes.ADD)
      this.ambient.add(ambient)
      this.surface.add(pool)
      const iron = this.scene.add.graphics()
      iron.lineStyle(Math.max(1.5, w * 0.025), INK)
      iron.lineBetween(-w * 0.36, 0, 0, -w * 0.46).lineBetween(w * 0.36, 0, 0, -w * 0.46)
      iron.lineBetween(0, -w * 0.46, 0, -y)
      iron.lineStyle(Math.max(1, w * 0.01), 0x8c7c72, 0.65)
      iron.lineBetween(1, -w * 0.46, 1, -y)
      iron.lineStyle(w * 0.07, INK).strokeEllipse(0, w * 0.04, w, w * 0.25)
      iron.lineStyle(Math.max(1, w * 0.018), GOLD, 0.65).strokeEllipse(0, w * 0.015, w * 0.98, w * 0.23)
      for (let candle = 0; candle < 6; candle++) {
        const angle = candle / 6 * Math.PI * 2
        const cx = Math.cos(angle) * w * 0.44
        const cy = Math.sin(angle) * w * 0.1
        iron.fillStyle(0xe9d6b5).fillRoundedRect(cx - w * 0.025, cy - w * 0.16, w * 0.05, w * 0.16, 1)
        iron.fillStyle(0x28232b).fillEllipse(cx, cy + w * 0.01, w * 0.12, w * 0.04)
      }
      const flames = this.scene.add.graphics().setName(`throne-chandelier-flames-${i}`)
      const body = this.scene.add.container(x, y, [halo, iron, flames]).setName(`throne-chandelier-${i}`)
      this.chandeliers.add(body)
      this.rigs.push({ x, y, w, phase: i * 2.3 + 0.4, ambient, pool, halo, body, flames })
    }
    this.update(0)
  }

  update(time: number): void {
    if (!this.layout) return
    const t = this.reducedMotion ? 0 : time
    for (const rig of this.rigs) {
      const sway = this.reducedMotion ? 0 : Math.sin(t * 0.65 + rig.phase) * 0.009
      const flicker = this.reducedMotion ? 1 : 0.94 + Math.sin(t * 6.3 + rig.phase) * 0.09 + Math.sin(t * 17.1 + rig.phase * 3) * 0.035
      rig.body.setRotation(sway)
      rig.ambient.setDisplaySize(rig.w * 4.1, rig.w * 3.5).setAlpha(0.26 * flicker)
      rig.pool.setDisplaySize(rig.w * 3.3, rig.w * 0.9).setAlpha(0.23 * flicker)
      rig.halo.setAlpha(0.22 * flicker)
      const g = rig.flames
      g.clear()
      for (let candle = 0; candle < 6; candle++) {
        const angle = candle / 6 * Math.PI * 2
        const x = Math.cos(angle) * rig.w * 0.44
        const y = Math.sin(angle) * rig.w * 0.1 - rig.w * 0.16
        const flameH = rig.w * (0.12 + (this.reducedMotion ? 0 : Math.sin(t * 10.5 + candle * 2.4 + rig.phase) * 0.018))
        const tip = this.reducedMotion ? 0 : Math.sin(t * 8 + candle + rig.phase) * rig.w * 0.018
        g.fillStyle(0xff9c44, 0.95).fillTriangle(x - rig.w * 0.035, y, x + rig.w * 0.035, y, x + tip, y - flameH)
        g.fillStyle(0xffe4a0).fillTriangle(x - rig.w * 0.022, y, x + rig.w * 0.022, y, x + tip * 0.6, y - flameH * 0.8)
        g.fillStyle(0xffffed).fillEllipse(x, y - flameH * 0.17, rig.w * 0.026, flameH * 0.4)
      }
    }
    this.drawSunlight(t)
    this.drawBanners(t)
    this.drawDust(t)
  }

  clear(): void {
    this.ambient.removeAll(true)
    this.surface.removeAll(true)
    this.chandeliers.removeAll(true)
    this.rigs.length = 0
    this.sunbeams.clear()
    this.banners.clear()
    this.particles.clear()
    this.layout = null
  }

  destroy(): void {
    this.clear()
    this.ambient.destroy(true)
    this.surface.destroy(true)
    this.sunbeams.destroy()
    this.banners.destroy()
    this.chandeliers.destroy(true)
    this.particles.destroy()
  }

  private drawSunlight(t: number): void {
    const layout = this.layout!
    const geometry = throneHallGeometry(layout)
    const g = this.sunbeams
    g.clear()
    for (let side = 0; side < 2; side++) {
      const sourceX = geometry.windowXs[side]!
      const sourceY = geometry.windowY + geometry.windowH * 0.25
      const targetX = sourceX + (side === 0 ? 1 : -1) * layout.width * 0.29
      const targetY = layout.height * 0.85
      for (let color = 0; color < 3; color++) {
        const dx = (color - 1) * geometry.windowW * 0.27
        const pulse = 0.9 + Math.sin(t * 0.34 + side * 2 + color) * 0.1
        // Layered widening shafts provide a feathered, volumetric edge without a shader.
        for (let layer = 0; layer < 3; layer++) {
          const halfW = geometry.windowW * (0.1 + layer * 0.09)
          g.fillStyle(SUN_COLORS[color]!, (0.017 + (2 - layer) * 0.011) * pulse)
          g.beginPath().moveTo(sourceX + dx - halfW * 0.3, sourceY)
            .lineTo(sourceX + dx + halfW * 0.3, sourceY)
            .lineTo(targetX + dx * 2.5 + halfW * 2.8, targetY)
            .lineTo(targetX + dx * 2.5 - halfW * 2.8, targetY).closePath().fillPath()
        }
        g.fillStyle(SUN_COLORS[color]!, 0.065 * pulse).fillEllipse(targetX + dx * 2.5, targetY, geometry.windowW * 1.6, geometry.windowW * 0.3)
      }
    }
  }

  private drawBanners(t: number): void {
    const layout = this.layout!
    const geometry = throneHallGeometry(layout)
    const g = this.banners
    const w = Math.max(16, Math.min(layout.width * 0.055, 58))
    const h = Math.min(layout.height * 0.2, w * 3.3)
    const y = layout.height * 0.19
    g.clear()
    for (let i = 0; i < 4; i++) {
      const x = geometry.pillarXs[i]! - w / 2
      const wave = this.reducedMotion ? 0 : Math.sin(t * 1.25 + i * 1.9) * w * 0.065
      g.lineStyle(3, GOLD).lineBetween(x - w * 0.2, y, x + w * 1.2, y)
      for (let strip = 0; strip < 6; strip++) {
        const sy = y + h * strip / 6
        const sway0 = wave * strip / 6
        const sway1 = wave * (strip + 1) / 6
        const nextY = y + h * (strip + 1) / 6
        g.fillStyle(i % 2 ? 0x49294e : 0x8d243a)
        g.beginPath().moveTo(x + sway0, sy).lineTo(x + w + sway0, sy)
          .lineTo(x + w + sway1, nextY).lineTo(x + sway1, nextY).closePath().fillPath()
        g.fillStyle(0xf0a57e, 0.1).fillRect(x + w * 0.19 + sway0, sy, w * 0.13, h / 6 + 0.5)
        g.fillStyle(0x180f2c, 0.2).fillRect(x + w * 0.67 + sway0, sy, w * 0.11, h / 6 + 0.5)
        g.lineStyle(1.3, GOLD, 0.8).lineBetween(x + 2 + sway0, sy, x + 2 + sway1, nextY)
          .lineBetween(x + w - 2 + sway0, sy, x + w - 2 + sway1, nextY)
      }
      g.fillStyle(i % 2 ? 0x49294e : 0x8d243a).fillTriangle(x + wave, y + h - 1, x + w + wave, y + h - 1, x + w / 2 + wave, y + h + w * 0.4)
      g.lineStyle(1.4, GOLD).lineBetween(x + wave, y + h, x + w / 2 + wave, y + h + w * 0.4)
        .lineBetween(x + w / 2 + wave, y + h + w * 0.4, x + w + wave, y + h)
      const cx = x + w / 2 + wave * 0.35
      const cy = y + h * 0.42
      g.fillStyle(GOLD).beginPath().moveTo(cx - w * 0.28, cy + w * 0.1)
        .lineTo(cx - w * 0.34, cy - w * 0.2).lineTo(cx - w * 0.12, cy - w * 0.08)
        .lineTo(cx, cy - w * 0.32).lineTo(cx + w * 0.12, cy - w * 0.08)
        .lineTo(cx + w * 0.34, cy - w * 0.2).lineTo(cx + w * 0.28, cy + w * 0.1).closePath().fillPath()
      g.fillRect(cx - w * 0.28, cy + w * 0.15, w * 0.56, w * 0.08)
    }
  }

  private drawDust(t: number): void {
    const g = this.particles
    g.clear()
    if (this.reducedMotion) return
    const layout = this.layout!
    const geometry = throneHallGeometry(layout)
    for (let i = 0; i < 30; i++) {
      const side = i % 2
      const age = t * (0.025 + i % 3 * 0.006) + i * 0.193
      const cycle = age % 1
      const sourceX = geometry.windowXs[side]!
      const targetX = sourceX + (side === 0 ? 1 : -1) * layout.width * 0.29
      const x = sourceX + (targetX - sourceX) * cycle + Math.sin(t * 0.4 + i * 2) * geometry.windowW * 0.9
      const y = geometry.windowY + geometry.windowH * 0.2 + layout.height * 0.74 * cycle
      const alpha = Math.sin(cycle * Math.PI) * (0.22 + (i % 4) * 0.09)
      g.fillStyle(i % 3 === 0 ? 0xe9c9ff : 0xffe4ad, alpha).fillCircle(x, y, 0.7 + i % 3 * 0.4)
    }
    const corners = [
      [layout.width * 0.06, layout.height * 0.2],
      [layout.width * 0.94, layout.height * 0.2],
      [layout.width * 0.08, layout.height * 0.76],
      [layout.width * 0.92, layout.height * 0.76],
    ] as const
    for (let i = 0; i < corners.length; i++) {
      const pulse = Math.max(0, Math.sin(t * 1.15 + i * 1.8))
      if (pulse < 0.72) continue
      const [x, y] = corners[i]!
      const r = 2.5 + pulse * 2.5
      g.fillStyle(0xfff1b8, pulse * 0.8).fillCircle(x, y, r * 0.28)
      g.lineStyle(1, 0xffdf7c, pulse * 0.55).lineBetween(x - r, y, x + r, y).lineBetween(x, y - r, x, y + r)
    }
  }
}
