import Phaser from 'phaser'
import { getTier } from '../config/ballTiers'
import { spawnY } from '../config/spawn'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, drawCollectibleBall } from '../game/rendering/BallAppearance'
import { cycleColor } from '../game/rendering/rgbCycle'
import { variantIdFor } from '../game/state/runVariant'

/**
 * Phase 2.11.0 mechanical claw (spec §7, OPTIONAL): an illustrated claw
 * suspended from the top of the STAGE (world space, rendered by the world
 * camera). Vertical cable, gray metal joints, yellow claw arms hugging the
 * CURRENT next ball — which is drawn through the SHARED BallAppearance
 * pipeline (same tier color + seed as the preview and the actual dropped
 * ball). The claw follows the horizontal aim; on drop the ball leaves the
 * claw and falls under normal physics (the spawn uses the exact same
 * position and appearance the claw showed).
 */
export class DropClaw {
  private readonly scene: Phaser.Scene
  private readonly g: Phaser.GameObjects.Graphics
  private holder: Phaser.GameObjects.Container | null = null
  private objectsCache: Array<Phaser.GameObjects.GameObject> | null = null
  private aimX = 360
  private tier = 1
  private seed = 1
  private visible = true
  /** Mobile composition: the hook/rope assembly is hidden — the current
   * ball simply floats at the drop position. Desktop keeps the claw. */
  private mobile = false

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.g = scene.add.graphics().setDepth(5)
  }

  /** Composition switch (from the responsive layout). Triggers a redraw. */
  setMobile(mobile: boolean): void {
    if (this.mobile !== mobile) {
      this.mobile = mobile
      this.redraw()
    }
  }

  /** QA hook: the ball the claw is CURRENTLY displaying. */
  info(): { tier: number; seed: number; visible: boolean } {
    return { tier: this.tier, seed: this.seed, visible: this.visible }
  }

  objects(): Array<Phaser.GameObjects.GameObject> {
    return this.objectsCache ?? [this.g]
  }

  setAim(x: number): void {
    if (x !== this.aimX) {
      this.aimX = x
      // PERF: aim changes only TRANSLATE the container — the ~1100-tri
      // character + claw assembly are NOT re-tessellated per pointermove
      // (render audit #3: the aim-drag spike, largest frame mid-drag).
      if (this.holder) this.holder.x = x
    }
  }

  setBall(tier: number, seed: number): void {
    if (tier !== this.tier || seed !== this.seed) {
      this.tier = tier
      this.seed = seed
      this.redraw()
    }
  }

  private redraw(): void {
    if (!this.holder) {
      this.holder = this.scene.add.container(0, 0)
      this.holder.setDepth(this.g.depth)
      this.holder.add(this.g)
      this.objectsCache = [this.holder]
    }
    this.holder.x = this.aimX
    const g = this.g
    g.clear()
    if (!this.visible) { this.g.setVisible(false); return }
    this.g.setVisible(true)
    const tier = getTier(this.tier)
    if (!tier) return
    const r = tier.radius
    const by = spawnY(r) // ball center = exact spawn position
    const x = 0 // local coords inside the aim container

    // --- ball (same appearance source as gameplay renderer) ---
    const look = ballLookFor(this.tier, this.seed)
    const poly = restContour(look, r, x, by, 48)
    
    // Phase 2.12.1: Special rendering for Tier 8/9 in claw.
    // Phase 2.14.0: per-run variant (tiers 8-9 randomize each run).
    if (this.tier === 8) {
      // The cycling RGB ball: one solid colour, stepping every 0.25s.
      const pts = poly.map(p => ({ x: p.x, y: p.y }))
      g.fillStyle(cycleColor(Date.now()), 1)
      g.fillPoints(pts.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
      g.lineStyle(ballOutlineWidth(r), INK, 1)
      g.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      drawBallFace(g, look, { x, y: by }, r, 1)
    } else if (this.tier === 9 || this.tier === 10) {
      // The theme ball paints its own face — part of the design. The
      // run's theme roll (shark/pig) picks the renderer; the variant
      // picks the palette within the theme.
      drawCollectibleBall(g, x, by, r, this.tier, variantIdFor(this.tier), poly, 0, undefined, this.seed)
    } else {
      g.fillStyle(tier.color, 1)
      g.fillPoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
      g.lineStyle(ballOutlineWidth(r), INK, 1)
      g.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      drawBallFace(g, look, { x, y: by }, r, 1)
    }

    // --- cable from the stage top ---
    // MOBILE: the hanging hook/rope/drop mechanism is hidden completely —
    // the current ball simply floats at the drop position (thumb-reachable,
    // nothing above it to cover the score/HUD).
    // DESKTOP: SIMPLIFIED hardware (spec §4D) — a compact gray metal head
    // (with screws, matching the reference) + yellow arms. The whole
    // assembly now tops out ~20px above the ball (ResponsiveLayout's
    // CLAW_TOP_WORST assumes this) so the top-center score and the claw
    // never overlap on any desktop viewport.
    if (this.mobile) return
    const topY = 0
    const clawTop = by - r - 12
    g.lineStyle(5, 0x3c4046, 1)
    g.lineBetween(x, topY, x, clawTop - 8)
    // gray metal head block sitting right on the ball
    g.fillStyle(0x9aa1a8, 1)
    g.fillRoundedRect(x - 16, clawTop - 9, 32, 18, 5)
    g.lineStyle(3, 0x111111, 1)
    g.strokeRoundedRect(x - 16, clawTop - 9, 32, 18, 5)
    // +/× screws on the head (reference detail)
    g.lineStyle(2, 0x111111, 1)
    g.strokeCircle(x - 7, clawTop, 3.2)
    g.strokeCircle(x + 7, clawTop, 3.2)
    g.lineBetween(x - 9, clawTop, x - 5, clawTop)
    g.lineBetween(x + 5, clawTop, x + 9, clawTop)
    // compact yellow arms: head corners → bowed around the ball's shoulders → tips
    const armQuad = (sx: number, sy: number, cx: number, cy: number, ex: number, ey: number): void => {
      const pts: Array<{ x: number; y: number }> = []
      for (let i = 0; i <= 10; i++) {
        const t = i / 10
        const ax = sx + (cx - sx) * t
        const ay = sy + (cy - sy) * t
        const bx = cx + (ex - cx) * t
        const byy = cy + (ey - cy) * t
        pts.push({ x: ax + (bx - ax) * t, y: ay + (byy - ay) * t })
      }
      g.strokePoints(pts as unknown as Phaser.Math.Vector2[], false, false)
    }
    g.lineStyle(7, 0xffc93b, 1)
    armQuad(x - 14, clawTop + 9, x - r * 1.08, by - r * 0.2, x - r * 1.02, by + r * 0.15)
    armQuad(x + 14, clawTop + 9, x + r * 1.08, by - r * 0.2, x + r * 1.02, by + r * 0.15)
    // arm tips (rounded caps at the bottom of each arc)
    g.fillStyle(0xffc93b, 1)
    for (const s of [-1, 1]) {
      g.fillCircle(x + s * r * 1.02, by + r * 0.15, 5)
      g.lineStyle(2.5, 0x111111, 1)
      g.strokeCircle(x + s * r * 1.02, by + r * 0.15, 5)
    }
  }
}
