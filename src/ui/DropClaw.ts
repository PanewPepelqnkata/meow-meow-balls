import Phaser from 'phaser'
import { getTier } from '../config/ballTiers'
import { spawnY } from '../config/spawn'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, drawCollectibleBall } from '../game/rendering/BallAppearance'
import { cycleColor } from '../game/rendering/rgbCycle'
import { variantIdFor } from '../game/state/runVariant'

/**
 * Desktop drop claw v2: TWO METAL HANDS (not ropes). A gray cable runs
 * from the stage top into a riveted metal head; from the head's sides two
 * articulated hands grip the ball — each hand is a rigid 3-segment
 * (shoulder bar → curved palm → gripper fingers) drawn in its own
 * container pivoted at the head mount, so open/close is a pure GPU
 * rotation tween (zero Graphics re-tessellation — same PERF contract as
 * the aim-translate container move, render audit #3).
 *
 * On drop (setHolding(false)) the hands swing open while the ball falls;
 * when the next ball arrives (setHolding(true)) they close around it.
 * The hand shape hugs the CURRENT ball's silhouette (restContour), so
 * every tier from 1 to 10 reads as properly held.
 */
export class DropClaw {
  private readonly scene: Phaser.Scene
  private readonly g: Phaser.GameObjects.Graphics
  private holder: Phaser.GameObjects.Container | null = null
  private handL: Phaser.GameObjects.Container | null = null
  private handR: Phaser.GameObjects.Container | null = null
  private objectsCache: Array<Phaser.GameObjects.GameObject> | null = null
  private aimX = 360
  private tier = 1
  private seed = 1
  private visible = true
  /** false during the drop cooldown — the claw shows no ball, hands open. */
  private holding = true
  /** Mobile composition: the hook/hands assembly is hidden — the current
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
      // PERF: aim changes only TRANSLATE the container — the character +
      // hands are NOT re-tessellated per pointermove (render audit #3:
      // the aim-drag spike, largest frame mid-drag).
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

  /** Cooldown state: when `holding` is false the claw draws EMPTY with
   * the hands SWUNG OPEN — the ball is invisible until the drop cooldown
   * expires. Desktop keeps the cable/head/hands so the claw reads as an
   * open gripper; mobile has no hardware, so nothing shows. */
  setHolding(holding: boolean): void {
    if (this.holding !== holding) {
      this.holding = holding
      this.redraw()
    }
  }

  /** One hand: rigid metal gripper drawn in LOCAL coords, pivot at (0, 0)
   * = the head mount. Shoulder bar down-outward, a curved palm sweeping
   * under the ball silhouette, two gripper fingers closing on the ball's
   * lower third. Contact points derive from the CURRENT ball radius r so
   * any tier reads as held. Everything hangs below the head — the
   * ResponsiveLayout CLAW_TOP_WORST guard stays valid. */
  private drawHand(g: Phaser.GameObjects.Graphics, r: number): void {
    // ---- contact geometry (local: x outward, y downward) ----
    const shoulderX = r * 0.34 // head mount
    const tipX = r * 0.7 // fingertip, gripping the lower third
    const tipY = r * 1.48
    const metal = 0x8f969e
    const metalDark = 0x3c4046

    // shoulder bar: pivot → outward-down
    g.lineStyle(9, metal, 1)
    g.lineBetween(0, 0, shoulderX, r * 0.3)
    // palm: shoulder → bowed outside the ball → tip (quad bezier polyline)
    const pts: Array<{ x: number; y: number }> = []
    const cpx = r * 1.28
    const cpy = r * 0.62
    for (let i = 0; i <= 12; i++) {
      const t = i / 12
      const ax = shoulderX + (cpx - shoulderX) * t
      const ay = r * 0.3 + (cpy - r * 0.3) * t
      const bx = cpx + (tipX - cpx) * t
      const byy = cpy + (tipY - cpy) * t
      pts.push({ x: ax + (bx - ax) * t, y: ay + (byy - ay) * t })
    }
    g.lineStyle(9, metal, 1)
    g.strokePoints(pts as unknown as Phaser.Math.Vector2[], false, false)
    // gripper fingers: two short prongs at the tip curving INWARD onto
    // the ball's lower third — the actual grip
    g.lineStyle(6, metal, 1)
    g.lineBetween(tipX, tipY, tipX - r * 0.24, tipY + r * 0.16)
    g.lineBetween(tipX, tipY, tipX - r * 0.14, tipY + r * 0.2)
    // wrist disc at the pivot (the joint the hand swings around)
    g.fillStyle(metalDark, 1)
    g.fillCircle(0, 0, 6.5)
    g.lineStyle(2.5, 0x111111, 1)
    g.strokeCircle(0, 0, 6.5)
    g.fillStyle(0xd7dce1, 1)
    g.fillCircle(0, 0, 2.4)
  }

  private redraw(): void {
    if (!this.holder) {
      this.holder = this.scene.add.container(0, 0)
      this.holder.setDepth(this.g.depth)
      this.holder.add(this.g)
      // Two hand containers, added on first draw (pivot setup once).
      this.handL = this.scene.add.container(0, 0)
      this.handR = this.scene.add.container(0, 0)
      const handGL = this.scene.add.graphics()
      const handGR = this.scene.add.graphics()
      this.handL.add(handGL)
      this.handR.add(handGR)
      this.holder.add([this.handL, this.handR])
      this.objectsCache = [this.holder]
    }
    this.holder.x = this.aimX
    const g = this.g
    g.clear()
    if (!this.visible) {
      this.g.setVisible(false)
      this.holder.setVisible(false)
      return
    }
    this.g.setVisible(true)
    this.holder.setVisible(true)
    const tier = getTier(this.tier)
    if (!tier) return
    const r = tier.radius
    const by = spawnY(r) // ball center = exact spawn position
    const x = 0 // local coords inside the aim container

    // --- ball (same appearance source as gameplay renderer) ---
    // During the drop cooldown the claw hangs EMPTY — no ball, hands open.
    if (this.holding) {
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
    }

    // MOBILE: no hardware — the ball floats at the drop position.
    if (this.mobile) {
      this.handL?.setVisible(false)
      this.handR?.setVisible(false)
      return
    }

    // --- DESKTOP: cable → riveted head → two metal hands ---
    const topY = 0
    const headY = by - r - 12 // head center, ~20px above the ball top
    g.lineStyle(5, 0x3c4046, 1)
    g.lineBetween(x, topY, x, headY - 9)
    g.fillStyle(0x9aa1a8, 1)
    g.fillRoundedRect(x - 16, headY - 9, 32, 18, 5)
    g.lineStyle(3, 0x111111, 1)
    g.strokeRoundedRect(x - 16, headY - 9, 32, 18, 5)
    g.lineStyle(2, 0x111111, 1)
    g.strokeCircle(x - 7, headY, 3.2)
    g.strokeCircle(x + 7, headY, 3.2)
    g.lineBetween(x - 9, headY, x - 5, headY)
    g.lineBetween(x + 5, headY, x + 9, headY)

    // Hands: containers pivoted at the head's side mounts; the hand art
    // is drawn ONCE per redraw into each container's Graphics (local
    // coords, pivot at 0,0 = the mount). Open/close = container rotation
    // tween — no Graphics work in the tween callbacks.
    const mounts: Array<{ c: Phaser.GameObjects.Container | null; s: number }> = [
      { c: this.handL, s: -1 },
      { c: this.handR, s: 1 },
    ]
    for (const { c, s } of mounts) {
      if (!c) continue
      c.setPosition(x + s * 14, headY + 4)
      c.setVisible(true)
      const hg = c.list[0] as Phaser.GameObjects.Graphics
      hg.clear()
      hg.scaleX = s // mirror the same art for both hands
      this.drawHand(hg, r)
      // Closed pose grips the ball; open pose swings ~38° outward.
      this.scene.tweens.killTweensOf(c)
      c.rotation = this.holding ? 0 : s * 0.66
      if (!this.holding) {
        // Open: ease the hands out (GPU rotation only).
        this.scene.tweens.add({
          targets: c,
          rotation: s * 0.66,
          duration: 180,
          ease: 'Cubic.easeOut',
        })
      }
    }
  }
}
