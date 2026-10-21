import Phaser from 'phaser'
import { ballLookFor, faceLayoutFor, INK } from './BallAppearance'
import type { BallLook, FaceLayout, EyeLayout } from './BallAppearance'
import { SPRITE_FILL_DEPTH, SPRITE_OUTLINE_DEPTH } from './TierBaker'

/**
 * POOLED FACE SPRITES (SpriteBalls) — replaces per-ball face Graphics
 * commands. A face is 5 sprites off a per-ball baked atlas:
 *
 *   sclera ×2  (white oval + ink rim, one per eye; the RIGHT sclera is
 *              replaced by the wink lid when the easter egg flashes)
 *   pupil  ×2  (ink oval + highlights, positioned by the live gaze)
 *   mouth   1  (ink marker stroke; grin scales it, panic REPLACES it with
 *              the live-drawn frightened O — see the Graphics fallback)
 *
 * The atlas is baked ONCE per ball at first registration from its look
 * (`ballLookFor(tier, seed)`) at a fixed face radius, then everything is
 * positioned/scaled per frame from `faceLayoutFor` — the same normalized
 * layout the live path used, so proportions are identical up to scale.
 * Layout geometry (positions, sizes) is DERIVED per frame from the live
 * aspect so squash still deforms the face coherently.
 *
 * EASTER EGGS + PANIC (wink lid, grin, tongue, frightened O, sweat) are
 * transient single-ball states: when active, the face falls back to the
 * shared live Graphics overlay for that ball (bounded: at most the 1–3
 * balls in an emotional state draw vector faces — the steady state pile
 * is 100% sprites). Eyes stay sprites even then.
 *
 * TEXTURE HYGIENE: atlas keys are per ball id (ids never reused within a
 * run — see SoftBallRenderer doc); drop() removes texture + sprites. A
 * merge removes the source via unregister → no per-merge leak.
 */

/** Face atlas bake radius (stage px). Display scale = liveR / this. */
const FACE_ATLAS_R = 120

/** Sclera/pupil sprite depth — above fills (9.5) and outlines (10.5). */
const FACE_DEPTH = 11

interface FaceAtlas {
  /** Atlas key prefix (`br-face-<id>-`). */
  prefix: string
  scleraKey: string
  pupilKey: string
  mouthKey: string
  /** Layout the atlas was baked at (fractions derive from this radius). */
  layout: FaceLayout
  /** The look this atlas was baked from (mouth style, tilt, asym). */
  look: BallLook
}

/**
 * One ball's complete sprite view: body quads + face sprites. Body quad
 * textures come from the TierBaker (per tier, or per-ball for tiers 8/9);
 * the renderer assigns them via setBodyTextures().
 */
export interface SpriteBallView {
  fill: Phaser.GameObjects.Image
  outline: Phaser.GameObjects.Image
  scleraL: Phaser.GameObjects.Image
  scleraR: Phaser.GameObjects.Image
  pupilL: Phaser.GameObjects.Image
  pupilR: Phaser.GameObjects.Image
  mouth: Phaser.GameObjects.Image
}

export class FacePool {
  /** Deterministic per-look atlas key (ballLookFor is deterministic per
   * tier+seed, so the look's numbers identify the atlas). */
  private static lookSignature(look: BallLook): string {
    return `br-face-${look.lobes1}-${look.lobes2}-${look.amp1}-${look.amp2}-${look.phase1}`
  }

  private readonly atlases = new Map<string, FaceAtlas>()
  /** ballId → atlas look-key (for atlas() lookups). */
  private readonly ballLookKeys = new Map<number, string>()
  private readonly views = new Map<number, SpriteBallView>()
  private readonly tempG: Phaser.GameObjects.Graphics

  constructor(private readonly scene: Phaser.Scene) {
    this.tempG = scene.add.graphics().setVisible(false)
  }

  /** Baked atlas for a ball (null for tiers whose face came out empty —
   * impossible in practice: every look has eyes + mouth). */
  atlas(ballId: number): FaceAtlas | undefined {
    const key = this.ballLookKeys.get(ballId)
    return key ? this.atlases.get(key) : undefined
  }

  view(ballId: number): SpriteBallView | undefined {
    return this.views.get(ballId)
  }

  /**
   * Bake the ball's neutral face atlas (sclera / pupil / mouth pieces) and
   * create its sprite set. Idempotent per ball id.
   */
  ensure(ballId: number, look: BallLook): SpriteBallView {
    const existing = this.views.get(ballId)
    if (existing) return existing

    const r = FACE_ATLAS_R
    const L = faceLayoutFor(look, r, 1)
    // Atlas keyed by the LOOK (deterministic per tier+seed) — shared
    // across balls with identical looks, pre-baked at queue rotation.
    const lookKeyStr = FacePool.lookSignature(look)
    const prefix = lookKeyStr
    const scleraKey = `${prefix}-sclera`
    const pupilKey = `${prefix}-pupil`
    const mouthKey = `${prefix}-mouth`

    // PERF: the look atlas already exists (prewarmed at queue rotation
    // or baked for a previous identical look) — skip the 3×256²
    // re-raster + upload entirely; just create this ball's sprite set
    // against the shared textures.
    if (
      this.scene.textures.exists(scleraKey) &&
      this.scene.textures.exists(pupilKey) &&
      this.scene.textures.exists(mouthKey)
    ) {
      this.ballLookKeys.set(ballId, lookKeyStr)
      const view: SpriteBallView = {
        // The body quads start HIDDEN: '__DEFAULT' is an opaque 32x32 PNG,
        // so a visible placeholder would paint a solid square at world
        // (0,0) for every ball. Tier 8/9 re-shows `fill` explicitly
        // (drawSpecialQuads); tier 1-7 draws its body on the shared
        // Graphics layer and never needs these quads at all.
        fill: this.scene.add.image(0, 0, '__DEFAULT').setDepth(SPRITE_FILL_DEPTH).setVisible(false),
        outline: this.scene.add.image(0, 0, '__DEFAULT').setDepth(SPRITE_OUTLINE_DEPTH).setVisible(false),
        scleraL: this.scene.add.image(0, 0, scleraKey).setDepth(FACE_DEPTH),
        scleraR: this.scene.add.image(0, 0, scleraKey).setDepth(FACE_DEPTH),
        pupilL: this.scene.add.image(0, 0, pupilKey).setDepth(FACE_DEPTH),
        pupilR: this.scene.add.image(0, 0, pupilKey).setDepth(FACE_DEPTH),
        mouth: this.scene.add.image(0, 0, mouthKey).setDepth(FACE_DEPTH),
      }
      this.views.set(ballId, view)
      return view
    }

    // SCLERA: white oval + thick ink rim, centered in the tile. Baked at
    // layout scale (r = FACE_ATLAS_R); displayed scaled by (liveR / r).
    const e0: EyeLayout = L.eyes[0]!
    // The old texture is NOT removed: the atlas is SHARED between every
    // ball with the same look, and other balls' face sprites are still
    // bound to it. Phaser's remove() nulls the texture source, so the
    // next render of one of those sprites throws "Cannot read properties
    // of null (reading 'resolution')" inside the render pass — which
    // kills the game loop and the whole UI with it. generateTexture()
    // overwrites the key in place, so the removal is unnecessary: the
    // existing sprites keep a valid texture and show the new bake.
    this.tempG.clear()
    this.tempG.setPosition(128, 128)
    this.tempG.fillStyle(0xffffff, 1)
    // 64-pt smoothness: the sclera displays at up to ~1:3 css→device
    // scale on dpr-3 phones; 32-pt faceting was visible as hexagonal
    // edges (user report). One bake per ball — cost is nil.
    this.tempG.fillEllipse(0, 0, e0.a * 2, e0.b * 2, 64)
    this.tempG.lineStyle(e0.rim, INK, 1)
    this.tempG.strokeEllipse(0, 0, e0.a * 2, e0.b * 2, 64)
    this.tempG.generateTexture(scleraKey, 256, 256)
    // PUPIL: ink oval + main highlight + tiny secondary dot, centered.
    // The old texture is NOT removed (see the SCLERA note above): the
    // atlas is shared between every ball with this look, and removing it
    // nulls the source of a texture other balls' face sprites are still
    // bound to — the next render then throws inside the render pass and
    // kills the whole game loop.
    this.tempG.clear()
    this.tempG.setPosition(128, 128)
    this.tempG.fillStyle(INK, 1)
    this.tempG.fillEllipse(0, 0, e0.pa * 2, e0.pb * 2, 64)
    this.tempG.fillStyle(0xffffff, 1)
    this.tempG.fillEllipse(-e0.pa * 0.32, -e0.pb * 0.34, e0.pa * 0.6, e0.pa * 0.6, 48)
    this.tempG.fillEllipse(-e0.pa * 0.1, -e0.pb * 0.38, e0.pa * 0.24, e0.pa * 0.24, 32)
    this.tempG.generateTexture(pupilKey, 256, 256)
    // MOUTH: the ink marker stroke, centered on its bounding arc.
    const m = L.mouth
    // The old texture is NOT removed (see the SCLERA note above).
    this.tempG.clear()
    this.tempG.setPosition(128, 128)
    const steps = 14
    const pts: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= steps; i++) {
      const t = -1 + (2 * i) / steps
      const tiltLift = m.style === 1 ? 1 + m.tilt * 0.35 * t : 1
      pts.push({ x: t * m.halfW, y: (1 - t * t) * m.depth * tiltLift })
    }
    // Center the arc's bbox: mouth spans x ∈ [−halfW, halfW], y ∈ [0, depth].
    this.tempG.setPosition(128, 128 - m.depth / 2)
    this.tempG.lineStyle(m.stroke, INK, 1)
    this.tempG.strokePoints(pts as unknown as Phaser.Math.Vector2[], false, false)
    this.tempG.generateTexture(mouthKey, 256, 256)
    this.tempG.clear()

    let atlas = this.atlases.get(lookKeyStr)
    if (!atlas) {
      atlas = { prefix, scleraKey, pupilKey, mouthKey, layout: L, look }
      this.atlases.set(lookKeyStr, atlas)
    }
    this.ballLookKeys.set(ballId, lookKeyStr)

    const view: SpriteBallView = {
      // Hidden at creation — see the note in ensure()'s fast path above.
      fill: this.scene.add.image(0, 0, '__DEFAULT').setDepth(SPRITE_FILL_DEPTH).setVisible(false),
      outline: this.scene.add.image(0, 0, '__DEFAULT').setDepth(SPRITE_OUTLINE_DEPTH).setVisible(false),
      scleraL: this.scene.add.image(0, 0, scleraKey).setDepth(FACE_DEPTH),
      scleraR: this.scene.add.image(0, 0, scleraKey).setDepth(FACE_DEPTH),
      pupilL: this.scene.add.image(0, 0, pupilKey).setDepth(FACE_DEPTH),
      pupilR: this.scene.add.image(0, 0, pupilKey).setDepth(FACE_DEPTH),
      mouth: this.scene.add.image(0, 0, mouthKey).setDepth(FACE_DEPTH),
    }
    this.views.set(ballId, view)
    return view
  }

  /**
   * Position/scale the face sprites for one ball this frame.
   * `liveR` is the ball's live radius; the atlas was baked at FACE_ATLAS_R
   * so every sprite scales by liveR / FACE_ATLAS_R (uniform — the squash
   * comes from the layout's own aspect-scaled geometry).
   */
  layoutFace(
    view: SpriteBallView,
    atlas: FaceAtlas,
    cx: number,
    cy: number,
    liveR: number,
    aspect: number,
    gaze: { x: number; y: number },
  ): void {
    const s = liveR / FACE_ATLAS_R
    // Recompute the layout at the LIVE radius + aspect: positions/sizes
    // carry the squash exactly like the live path (faceLayoutFor is pure).
    const L = faceLayoutFor(atlas.look, liveR, aspect, gaze)
    const asym = atlas.look.eyeAsym

    const placeSclera = (img: Phaser.GameObjects.Image, e: EyeLayout, sy: number): void => {
      img.setVisible(true)
      img.setPosition(cx + e.x, cy + e.y)
      img.setScale(s, s * sy)
    }
    placeSclera(view.scleraL, L.eyes[0]!, 1)
    placeSclera(view.scleraR, L.eyes[1]!, asym)

    const placePupil = (img: Phaser.GameObjects.Image, e: EyeLayout, sy: number): void => {
      img.setVisible(true)
      img.setPosition(cx + e.x + e.px, cy + e.y + e.py)
      img.setScale(s, s * sy)
    }
    placePupil(view.pupilL, L.eyes[0]!, 1)
    placePupil(view.pupilR, L.eyes[1]!, asym)

    view.mouth.setVisible(true)
    view.mouth.setPosition(cx + L.mouth.x, cy + L.mouth.y + L.mouth.depth / 2)
    view.mouth.setScale(s)
  }

  /** Hide every face sprite of one ball (live-graphics fallback frames). */
  hideFace(view: SpriteBallView): void {
    view.scleraL.setVisible(false)
    view.scleraR.setVisible(false)
    view.pupilL.setVisible(false)
    view.pupilR.setVisible(false)
    view.mouth.setVisible(false)
  }

  /**
   * Drop one ball's atlas + sprites (unregister / restart / game-over
   * removal). Texture keys are per ball id; ids are never reused.
   */
  /**
   * PERF (iOS): pre-bake the atlas for a FUTURE ball (tier + seed are
   * known at queue-rotation time, long before the drop). The drop frame
   * then reuses the atlas — no generateTexture in the event frame.
   */
  prewarm(tier: number, seed: number): void {
    const look = ballLookFor(tier, seed)
    const lookKeyStr = FacePool.lookSignature(look)
    if (this.atlases.has(lookKeyStr)) return
    const syntheticId = -1 - Math.abs(seed % 100000)
    this.ensure(syntheticId, look)
    this.drop(syntheticId) // atlas persists (shared); view was throwaway
    void lookKeyStr
  }

  drop(ballId: number): void {
    // Atlases are LOOK-keyed and SHARED (bounded by distinct looks) —
    // merged/removed balls release only their sprite views + id mapping.
    this.ballLookKeys.delete(ballId)
    const view = this.views.get(ballId)
    if (view) {
      view.fill.destroy()
      view.outline.destroy()
      view.scleraL.destroy()
      view.scleraR.destroy()
      view.pupilL.destroy()
      view.pupilR.destroy()
      view.mouth.destroy()
      this.views.delete(ballId)
    }
  }

  clear(): void {
    for (const id of [...this.views.keys()]) this.drop(id)
  }

  destroy(): void {
    this.clear()
    this.tempG.destroy()
  }
}


