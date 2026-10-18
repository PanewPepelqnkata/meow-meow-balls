import Phaser from 'phaser'
import type { UiLayout } from './ResponsiveLayout'
import { BALL_TIERS } from '../config/ballTiers'
import { hudText, WHITE } from './Typography'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK } from '../game/rendering/BallAppearance'

/**
 * Phase 2.13.2 (spec §4) — polished tier progression path.
 * Phase 2.16.2 (user spec) — desktop renders a FULL CIRCLE ring on the
 * left side (like the reference image); portrait keeps the bottom row.
 *
 * Node state reads from the REAL discovery state, not a cosmetic counter:
 * - Discovered tiers: colored CHARACTER nodes — the actual ball faces
 *   through the shared appearance pipeline (tier 8 its rainbow identity,
 *   tier 9 its fantasy identity, both with faces).
 * - Undiscovered tiers: dark nodes with white "?" marks.
 * - The connecting curve is a smooth two-tone stroke (soft dark under-line
 *   + bright blue over-line).
 * - On unlock the node pops (scale overshoot) with a yellow glow flash and
 *   an expanding ring pulse, then settles.
 * Tiers 1–3 start known (Phase 2.13.1); every later tier unlocks via
 * `state:discovered` (forwarded by UIScene → UiRoot.unlockTier).
 */
export class TierProgression {
  private objs: Array<Phaser.GameObjects.GameObject> = []
  private nodeObjs: Array<Phaser.GameObjects.Container | null> = []
  private readonly scene: Phaser.Scene
  /** Phase 2.13.1 (spec §4): tiers 1–3 are known from the very first
   * session — unlocked and colored from the first layout, no discovery
   * animation for them. Tiers 4–10 stay locked until genuinely discovered. */
  private discovered = new Set<number>([1, 2, 3])
  private lastLayout: UiLayout | null = null

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  /** QA hook (read-only): currently unlocked tiers. */
  get unlocked(): number[] {
    return [...this.discovered].sort((a, b) => a - b)
  }

  /** Reset to the opening state (restart): tiers 1–3 known (Phase 2.13.1). */
  reset(): void {
    this.discovered = new Set<number>([1, 2, 3])
    if (this.lastLayout) this.layout(this.lastLayout)
  }

  /** Unlock a newly discovered tier: relayout + pop + glow/ring pulse. */
  unlockTier(tier: number): void {
    if (this.discovered.has(tier)) return
    this.discovered.add(tier)
    if (this.lastLayout) this.layout(this.lastLayout)
    const node = this.nodeObjs[tier - 1]
    const rr = this.lastLayout?.tiers.nodeR ?? 16
    if (node) {
      // Character pop: scale overshoot, settles back.
      node.setScale(1.6)
      this.scene.tweens.add({ targets: node, scale: 1, duration: 420, ease: 'Back.easeOut' })

      // Subtle glow flash behind the node (fades fast).
      const glow = this.scene.add.graphics().setPosition(node.x, node.y).setDepth(39)
      glow.fillStyle(0xffee44, 0.4)
      glow.fillCircle(0, 0, rr * 1.7)
      this.scene.tweens.add({
        targets: glow,
        alpha: 0,
        duration: 480,
        ease: 'Cubic.easeOut',
        onComplete: () => glow.destroy(),
      })

      // Expanding ring pulse (drawn around the node center, scales outward).
      const pulse = this.scene.add.graphics().setPosition(node.x, node.y).setDepth(40)
      pulse.lineStyle(3.5, 0xffee44, 1)
      pulse.strokeCircle(0, 0, rr)
      pulse.setAlpha(0.85)
      this.scene.tweens.add({
        targets: pulse,
        scale: 2.4,
        alpha: 0,
        duration: 650,
        ease: 'Cubic.easeOut',
        onComplete: () => pulse.destroy(),
      })
    }
  }

  layout(l: UiLayout): void {
    this.lastLayout = l
    // Kill in-flight unlock tweens first — layout() destroys the node
    // containers and a resize landing mid-pop must not tween dead objects.
    for (const node of this.nodeObjs) {
      if (node) this.scene.tweens.killTweensOf(node)
    }
    for (const o of this.objs) o.destroy()
    this.objs = []
    this.nodeObjs = []
    const nodes = BALL_TIERS
    const positions: Array<{ x: number; y: number }> = []

    if (l.tiers.kind === 'ring' && l.tiers.cx != null && l.tiers.cy != null && l.tiers.r != null) {
      // Phase 2.16.2: FULL CIRCLE ring on the left side (like the reference
      // image): tier 1 at the top, the tiers running clockwise around the
      // circle; the two-tone connector is the circle itself. A small blue
      // arrow outside the FIRST LOCKED tier points outward — "this is next".
      const cx = l.tiers.cx
      const cy = l.tiers.cy
      const r = l.tiers.r
      for (let i = 0; i < nodes.length; i++) {
        const a = -Math.PI / 2 + (Math.PI * 2 * i) / nodes.length
        positions.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
      }
      // Two-tone connector: soft dark under-circle + bright blue over-circle.
      const under = this.scene.add.graphics().setDepth(39)
      under.lineStyle(9, 0x1c2430, 0.5)
      under.strokeCircle(cx, cy, r)
      this.objs.push(under)
      const curve = this.scene.add.graphics().setDepth(40)
      curve.lineStyle(4.5, 0x3f8cff, 1)
      curve.strokeCircle(cx, cy, r)
      this.objs.push(curve)

      // Next-tier arrow: outside the first locked node, pointing outward.
      const nextTier = nodes.find((t) => !this.discovered.has(t.tier))
      if (nextTier) {
        const a = -Math.PI / 2 + (Math.PI * 2 * (nextTier.tier - 1)) / nodes.length
        const dist = r + l.tiers.nodeR + Math.max(7, l.tiers.nodeR * 0.5)
        const ax = cx + Math.cos(a) * dist
        const ay = cy + Math.sin(a) * dist
        const s = Math.max(6, l.tiers.nodeR * 0.55)
        const arrow = this.scene.add.graphics().setDepth(41)
        arrow.fillStyle(0x3f8cff, 1)
        arrow.lineStyle(2.5, 0x111111, 1)
        // Triangle pointing along the outward radial direction (a).
        arrow.beginPath()
        arrow.moveTo(ax + Math.cos(a) * s * 1.15, ay + Math.sin(a) * s * 1.15)
        arrow.lineTo(ax + Math.cos(a + 2.5) * s, ay + Math.sin(a + 2.5) * s)
        arrow.lineTo(ax + Math.cos(a - 2.5) * s, ay + Math.sin(a - 2.5) * s)
        arrow.closePath()
        arrow.fillPath()
        arrow.strokePath()
        this.objs.push(arrow)
      }
    } else {
      // Portrait row.
      const y = l.tiers.rowY ?? 0
      const x0 = l.tiers.rowX0 ?? 0
      const x1 = l.tiers.rowX1 ?? l.vw
      for (let i = 0; i < nodes.length; i++) {
        positions.push({ x: x0 + ((x1 - x0) * i) / (nodes.length - 1), y })
      }
      const under = this.scene.add.graphics().setDepth(39)
      under.lineStyle(9, 0x1c2430, 0.5)
      under.lineBetween(Math.max(6, x0 - 16), y, Math.min(l.vw - 6, x1 + 16), y)
      this.objs.push(under)
      const track = this.scene.add.graphics().setDepth(40)
      track.lineStyle(4.5, 0x3f8cff, 1)
      track.lineBetween(Math.max(6, x0 - 16), y, Math.min(l.vw - 6, x1 + 16), y)
      this.objs.push(track)
    }

    const rr = l.tiers.nodeR
    nodes.forEach((t, i) => {
      const { x, y } = positions[i]!
      const isUnlocked = this.discovered.has(t.tier)
      const node = this.scene.add.container(x, y).setDepth(41)
      const g = this.scene.add.graphics()

      if (isUnlocked) {
        // Colored CHARACTER node — the actual ball through the shared
        // appearance pipeline (deterministic per-tier seed).
        this.drawCharacterNode(g, t.tier, t.color, rr)
      } else {
        g.fillStyle(0x1c1e22, 1)
        g.fillCircle(0, 0, rr)
        // Same ink weight as the unlocked character nodes on the same ring.
        g.lineStyle(Math.max(2.5, ballOutlineWidth(rr)), 0x111111, 1)
        g.strokeCircle(0, 0, rr)
      }
      node.add(g)

      if (!isUnlocked) {
        node.add(
          hudText(this.scene, 0, 0, '?', l.fontScale, {
            color: WHITE,
            size: rr * 1.9,
            stroke: 2,
            origin: [0.5, 0.5],
            shadow: false,
          }),
        )
      }
      this.objs.push(node)
      this.nodeObjs[t.tier - 1] = node
    })
  }

  /**
   * A discovered tier's node: the actual ball character — rest contour,
   * tier color fill (rainbow wedges for tier 8, pastel+horn for tier 9),
   * ink outline and FACE, through the same appearance pipeline as the
   * game balls. Deterministic per-tier seed.
   */
  private drawCharacterNode(
    g: Phaser.GameObjects.Graphics,
    tier: number,
    color: number,
    rr: number,
  ): void {
    const look = ballLookFor(tier, tier * 7919 + 17)
    const poly = restContour(look, rr, 0, 0, 24)
    const pts = poly.map((p) => new Phaser.Math.Vector2(p.x, p.y))

    if (tier === 8) {
      this.drawRainbowNode(g, rr)
    } else if (tier === 9) {
      this.drawFantasyNode(g, rr)
    } else {
      g.fillStyle(color, 1)
      g.fillPoints(pts, true)
    }

    g.lineStyle(Math.max(2.5, ballOutlineWidth(rr)), INK, 1)
    g.strokePoints(pts, true, true)
    drawBallFace(g, look, { x: 0, y: 0 }, rr, 1)
  }

  /** Tier 8 progression identity: saturated rainbow ring segments. */
  private drawRainbowNode(g: Phaser.GameObjects.Graphics, rr: number): void {
    const colors = [0xff4444, 0xff9933, 0xffee44, 0x66dd44, 0x44ccff, 0xaa66ff]
    const seg = (Math.PI * 2) / colors.length
    for (let i = 0; i < colors.length; i++) {
      g.fillStyle(colors[i]!, 1)
      g.beginPath()
      g.moveTo(0, 0)
      g.arc(0, 0, rr, i * seg, (i + 1) * seg)
      g.closePath()
      g.fillPath()
    }
  }

  /** Tier 9 progression identity: pastel body with a small gold horn. */
  private drawFantasyNode(g: Phaser.GameObjects.Graphics, rr: number): void {
    g.fillStyle(0xf3c6e2, 1)
    g.fillCircle(0, 0, rr)
    // Horn pointing up.
    g.fillStyle(0xffd54f, 1)
    g.beginPath()
    g.moveTo(-rr * 0.22, -rr * 0.78)
    g.lineTo(0, -rr * 1.32)
    g.lineTo(rr * 0.22, -rr * 0.78)
    g.closePath()
    g.fillPath()
    g.lineStyle(2.5, 0x111111, 1)
    g.strokePath()
  }
}
