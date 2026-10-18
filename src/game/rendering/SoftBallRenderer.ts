import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { renderContour, softBallArea, softBallCentroid } from '../systems/SoftBall'
import type { SoftBall } from '../systems/SoftBall'
import { SOFT } from '../systems/SoftBall'
import type { SoftBallEntity } from '../systems/SoftBallManager'
import { BallEmotionSystem } from '../systems/BallEmotion'
import type { GameOverSequence } from './GameOverSequence'
import { INK, ballLookFor, ballOutlineWidth, drawBallFace, expressionAt, gazeAt, wobbleContour, drawRainbowBall, drawFantasyBall } from './BallAppearance'
import { variantIdFor } from '../state/runVariant'
import type { BallLook } from './BallAppearance'

/**
 * Phase 2.9 production renderer for soft-body balls, restyled in Phase
 * 2.10.2 as hand-drawn slime characters. Phase 2.11.0: the character look
 * and face drawing live in the SHARED `BallAppearance` module — preview and
 * crane draw the exact same character through the same functions; this
 * renderer only feeds them the live simulated contour.
 *
 * One shared Graphics layer, cleared and redrawn per frame. Two-pass
 * fill/stroke (Phase 2.9.3) keeps adjacent outlines clean.
 */
export class SoftBallRenderer {
  /** Live entities — the entity (not a snapshot) so the lifecycle state is
   * checked at DRAW time. Phase 2.13.4: the guard is on 'removed' ONLY.
   * A 'merging'-state ball is a DEFERRED merge source — a real ball that is
   * still in the world, holding its pocket open until the replacement
   * commits (Phase 2.13.3 transactional merges) — and it MUST be drawn:
   * skipping it made both sources vanish visually during the pending window
   * (the Phase 2.13.4 "disappearing balls" defect). Sources are removed in
   * the SAME frame the replacement spawns, so a merging ball can never
   * appear beside/inside its own replacement — the Phase 2.10.2 defect this
   * guard originally fixed stays fixed by the 'removed' check plus the
   * registry sync. */
  private readonly renderables = new Map<number, SoftBallEntity>()
  /** Per-character look cache (deterministic per ball seed, never per frame). */
  private readonly looks = new Map<number, BallLook>()
  /** Per-ball panic/danger emotion (visual only — see BallEmotionSystem). */
  readonly emotion = new BallEmotionSystem()
  /** The game-over pop sequence (set by the scene when it starts; the
   * renderer consults its panic override and per-ball scale). */
  gameOverSequence: GameOverSequence | null = null
  private readonly layer: Phaser.GameObjects.Graphics
  /** IDs actually drawn in the LAST update() — QA evidence that reserved
   * ('merging') sources remain visible while their replacement pends. */
  private readonly lastDrawnIds = new Set<number>()

  constructor(scene: Phaser.Scene) {
    this.layer = scene.add.graphics().setDepth(10)
  }

  register(ball: SoftBallEntity): void {
    this.renderables.set(ball.id, ball)
  }

  unregister(ballId: number): void {
    this.renderables.delete(ballId)
    this.looks.delete(ballId)
  }

  clear(): void {
    this.renderables.clear()
    this.looks.clear()
  }

  /** Diagnostics: number of live renderer entries (Phase 2.10.2 stale-renderer checks). */
  get size(): number {
    return this.renderables.size
  }

  /** Diagnostics: how many balls the LAST update() actually DREW. Registry
   * size and drawn count must agree while no merge is mid-flight; during a
   * deferred merge the locked sources must appear HERE too (Phase 2.13.4). */
  get drawnSize(): number {
    return this.lastDrawnIds.size
  }

  /** QA: was this ball actually drawn in the last frame? */
  isDrawn(ballId: number): boolean {
    return this.lastDrawnIds.has(ballId)
  }

  update(): void {
    const g = this.layer
    g.clear()
    // Advance the per-ball emotion (danger-zone panic) BEFORE drawing so
    // faces use this frame's eased panic value. Visual-only: the system
    // never touches physics state.
    this.emotion.update([...this.renderables.values()])
    // PHASE 2.9.3: two-pass draw. Pass 1 fills EVERY ball; pass 2 strokes
    // EVERY outline. Single-pass per-ball drawing let a later ball's stroke
    // cut into an earlier ball's fill at contact points — the main visible
    // "interpenetration" signal. With two passes, adjacent balls show BOTH
    // outlines cleanly at the junction.
    const polys: Array<{ 
      poly: Phaser.Math.Vector2[]; 
      color: number; 
      soft: SoftBall; 
      look: BallLook; 
      r: number;
      tier: number;
      entity: SoftBallEntity;
    }> = []
    this.lastDrawnIds.clear()
    
    for (const r of this.renderables.values()) {
      // Lifecycle guard: a REMOVED ball must never appear (not even for one
      // frame) beside or inside its replacement. A 'merging' ball is a
      // deferred-merge source — still real, still visible (Phase 2.13.4).
      if (r.state === 'removed') continue
      // Game-over pop: a ball mid-pop draws at its tweened scale; popped
      // (scale 0) balls vanish.
      const popScale = this.gameOverSequence?.scaleOverrides.get(r.id)
      if (popScale != null && popScale <= 0.002) continue
      this.lastDrawnIds.add(r.id)
      const pr = r.soft.radius * SOFT.particleRadiusFactor
      const base = renderContour(r.soft, 6, pr)
      const look = this.lookFor(r)
      const c = softBallCentroid(r.soft)
      const drawR = popScale != null ? r.soft.radius * popScale : r.soft.radius
      const poly = wobbleContour(look, base, c.x, c.y, drawR, 1.5).map(
        (p) => new Phaser.Math.Vector2(p.x, p.y),
      )
      const color = this.tierColor(r.tier)
      polys.push({ poly, color, soft: r.soft, look, r: drawR, tier: r.tier, entity: r })
      
      // Phase 2.12.1: Special rendering for Tier 8 (rainbow) and Tier 9 (fantasy).
      // Phase 2.14.0: both take the PER-RUN variant (runVariant rolls tiers
      // 8-9 anew every run — see src/game/state/runVariant.ts).
      if (r.tier === 8) {
        // Tier 8: Rainbow gradient
        const pts = poly.map(v => ({ x: v.x, y: v.y }))
        drawRainbowBall(g, pts, c.x, c.y, r.soft.radius, Date.now(), variantIdFor(8))
      } else if (r.tier === 9) {
        // Tier 9: Fantasy/unicorn
        drawFantasyBall(g, c.x, c.y, r.soft.radius, variantIdFor(9))
      } else {
        // Normal tier: solid fill
        g.fillStyle(color, 1)
        g.fillPoints(poly, true)
      }
    }
    
    // Pass 2: Outlines for all balls
    for (const { poly, r } of polys) {
      g.lineStyle(ballOutlineWidth(r), INK, 1)
      g.strokePoints(poly, true, true)
    }
    
    // Pass 3: Faces for all balls — live GLANCE timeline (pupils dart every
    // ~4 s, de-synced per ball) + EASTER-EGG expressions (wink/grin/tongue
    // flashing every 10–30 s), both deterministic per ball seed + time.
    for (const { soft, look, entity } of polys) {
      const c = softBallCentroid(soft)
      const ys = soft.particles.map((p) => p.position.y)
      const xs = soft.particles.map((p) => p.position.x)
      const aspect = Math.max(0.6, Math.min(1.0, (Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs))))
      const now = Date.now()
      // Game-over override: every surviving ball wears the doomed face.
      const panic = this.gameOverSequence?.panicOverride ?? this.emotion.panicOf(entity.id)
      drawBallFace(g, look, { x: c.x, y: c.y }, soft.radius, aspect, {
        gaze: gazeAt(entity.seed, now),
        expr: expressionAt(entity.seed, now),
        panic,
      })
    }
  }

  private lookFor(ball: SoftBallEntity): BallLook {
    let look = this.looks.get(ball.id)
    if (!look) {
      look = ballLookFor(ball.tier, ball.seed)
      this.looks.set(ball.id, look)
    }
    return look
  }

  private tierColor(tier: number): number {
    // Single source of truth: the color lives in the tier config — no local
    // mirror (an edited config color must reach rendering automatically).
    return getTier(tier)?.color ?? 0x4fc3f7
  }
}

/** Kept for tests/diagnostics that previously imported softBallArea via here. */
export { softBallArea }
