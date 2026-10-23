import Phaser from 'phaser'
import { ballLookFor, faceLayoutFor, INK } from './BallAppearance'
import type { BallLook, FaceLayout, EyeLayout } from './BallAppearance'
import { BALL_EMOTION } from '../../config/ballEmotion'
import type { EmotionLevel } from '../../config/ballEmotion'
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

/** The fear layer's depth — above the face sprites (11), so the frightened
 * mouth and sweat always draw over the neutral face. */
const FEAR_DEPTH = 12

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
  /** The FEAR layer: the frightened mouth + sweat, drawn ABOVE the face
   * sprites (depth 12) so the feared mouth always covers the neutral
   * mouth sprite — no visibility race, so the face can never vanish. */
  private readonly fearG: Phaser.GameObjects.Graphics

  constructor(private readonly scene: Phaser.Scene) {
    this.tempG = scene.add.graphics().setVisible(false)
    this.fearG = scene.add.graphics().setDepth(FEAR_DEPTH)
  }

  /** Clear the fear layer — called once per frame before the face pass. */
  clearFearLayer(): void {
    this.fearG.clear()
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
        scleraL: this.scene.add.image(0, 0, scleraKey).setDepth(FACE_DEPTH).setVisible(false),
        scleraR: this.scene.add.image(0, 0, scleraKey).setDepth(FACE_DEPTH).setVisible(false),
        pupilL: this.scene.add.image(0, 0, pupilKey).setDepth(FACE_DEPTH).setVisible(false),
        pupilR: this.scene.add.image(0, 0, pupilKey).setDepth(FACE_DEPTH).setVisible(false),
        mouth: this.scene.add.image(0, 0, mouthKey).setDepth(FACE_DEPTH).setVisible(false),
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
      scleraL: this.scene.add.image(0, 0, scleraKey).setDepth(FACE_DEPTH).setVisible(false),
      scleraR: this.scene.add.image(0, 0, scleraKey).setDepth(FACE_DEPTH).setVisible(false),
      pupilL: this.scene.add.image(0, 0, pupilKey).setDepth(FACE_DEPTH).setVisible(false),
      pupilR: this.scene.add.image(0, 0, pupilKey).setDepth(FACE_DEPTH).setVisible(false),
      mouth: this.scene.add.image(0, 0, mouthKey).setDepth(FACE_DEPTH).setVisible(false),
    }
    this.views.set(ballId, view)
    return view
  }

  /**
   * Position/scale the face sprites for one ball this frame.
   * `liveR` is the ball's live radius; the atlas was baked at FACE_ATLAS_R
   * so every sprite scales by liveR / FACE_ATLAS_R (uniform — the squash
   * comes from the layout's own aspect-scaled geometry).
   *
   * `fear` (0..1) is the ball's eased danger measure and `level` its
   * discrete phase (worried / scared / panic). The fear morph is applied
   * to the SPRITE face (not the live Graphics path): the eyes widen, the
   * pupils shrink and pin upward, and the mouth is replaced by the
   * frightened O (drawn on the pool's own fear layer, above the face
   * sprites). Doing it here — instead of hiding the sprites and redrawing
   * on the shared body layer — keeps the face visible in every state: the
   * old fallback made the face VANISH for the morph's duration because the
   * shared layer's per-frame clear raced the sprite visibility.
   */
  layoutFace(
    view: SpriteBallView,
    atlas: FaceAtlas,
    cx: number,
    cy: number,
    liveR: number,
    aspect: number,
    gaze: { x: number; y: number },
    fear = 0,
    level: EmotionLevel = 'normal',
  ): void {
    const s = liveR / FACE_ATLAS_R
    // Recompute the layout at the LIVE radius + aspect: positions/sizes
    // carry the squash exactly like the live path (faceLayoutFor is pure).
    const L = faceLayoutFor(atlas.look, liveR, aspect, gaze)
    const asym = atlas.look.eyeAsym
    // --- FEAR MORPH (sprite path) -------------------------------------
    // The same morph the live path applies (drawBallFace), expressed as
    // sprite transforms so no vector redraw is needed per frame.
    const em = Math.min(1, fear * BALL_EMOTION.criticalPanicIntensity)
    const eyeGrow = 1 + (BALL_EMOTION.eyeScaleMax - 1) * em
    const pupilShrink = 1 - (1 - BALL_EMOTION.pupilScaleMax) * em
    // The pupils pin toward the TOP of the eye (gaze.y = -1 is the top).
    const up = BALL_EMOTION.pupilUpwardGaze * em

    const placeSclera = (img: Phaser.GameObjects.Image, e: EyeLayout, sy: number): void => {
      img.setVisible(true)
      img.setPosition(cx + e.x, cy + e.y)
      img.setScale(s * eyeGrow, s * sy * eyeGrow)
    }
    placeSclera(view.scleraL, L.eyes[0]!, 1)
    placeSclera(view.scleraR, L.eyes[1]!, asym)

    const placePupil = (img: Phaser.GameObjects.Image, e: EyeLayout, sy: number): void => {
      img.setVisible(true)
      // Pin the pupil upward inside the sclera as the fear rises.
      const slackY = Math.max(0, e.b - e.pb - e.rim * 0.5)
      const py = fear > 0 ? e.py * (1 - em) + -up * slackY * em : e.py
      img.setPosition(cx + e.x + e.px, cy + e.y + py)
      img.setScale(s * pupilShrink, s * sy * pupilShrink)
    }
    placePupil(view.pupilL, L.eyes[0]!, 1)
    placePupil(view.pupilR, L.eyes[1]!, asym)

    // The MOUTH: the marker stroke is the neutral face. Under fear it is
    // replaced by the frightened O, drawn on the pool's own fear layer.
    // The per-PHASE treatment is what makes the ladder readable:
    //   worried — a small tight "o" (uneasy)
    //   scared  — a wider open O
    //   panic   — the full agape O (with tongue) + sweat drops
    if (fear > 0.05) {
      view.mouth.setVisible(false)
      this.drawFearMouth(view, atlas, L, cx, cy, liveR, fear, level)
      return
    }
    view.mouth.setVisible(true)
    view.mouth.setPosition(cx + L.mouth.x, cy + L.mouth.y + L.mouth.depth / 2)
    view.mouth.setScale(s)
  }

  /**
   * Draw one ball's feared mouth (+ sweat) on the pool's fear layer.
   *
   * The fear layer sits ABOVE the face sprites, so the frightened mouth
   * always covers the neutral mouth sprite without any visibility race.
   * The tremble offset (the same deterministic jitter the live path uses)
   * is applied to the whole face — the BODY never moves.
   */
  private drawFearMouth(
    view: SpriteBallView,
    atlas: FaceAtlas,
    L: FaceLayout,
    cx: number,
    cy: number,
    liveR: number,
    fear: number,
    level: EmotionLevel,
  ): void {
    const g = this.fearG
    const E = BALL_EMOTION
    const m = L.mouth
    const em = Math.min(1, fear * E.criticalPanicIntensity)
    // The tremble: deterministic (sine pair — smooth and loopable), the
    // same signal the live path uses. It moves the FACE, never the body.
    const t = Date.now() / 1000
    const amp = E.shakeIntensity * fear * fear * (level === 'panic' ? E.criticalShakeBoost : 1)
    const jx = Math.sin(t * E.shakeFrequency * 6.283) * amp
    const jy = Math.cos(t * E.shakeFrequency * 6.283 * 1.17) * amp * 0.7
    const X = (v: number): number => cx + v + jx
    const Y = (v: number): number => cy + v + jy

    // Per-phase mouth size: worried is a small tight o, scared opens up,
    // panic is the full agape O.
    //
    // The base is the NEUTRAL MOUTH'S FULL WIDTH (m.halfW * 2) — the
    // config's mouthScaleMax/mouthOpenMax are multipliers ON THE MOUTH,
    // and a 2.6x/3.2x scared mouth is only readable if it starts from the
    // mouth's own width. (The pre-sprite live path used m.halfW — HALF
    // the mouth — so its frightened mouth came out at ~12px on an 88px
    // ball: a dot, not a face.)
    const base = m.halfW * 2
    const phase = level === 'panic' ? 1 : level === 'scared' ? 0.8 : 0.55
    const mw = base * E.mouthScaleMax * (0.6 + 0.4 * em) * phase
    const mh = base * E.mouthOpenMax * (0.55 + 0.45 * em) * phase
    const my = m.y + liveR * 0.1 * em
    // Gasping: the O pulses slightly with the shake phase.
    const gasp = 1 + Math.sin(t * E.shakeFrequency * 6.283 * 0.5) * 0.08 * fear

    g.fillStyle(INK, 1)
    g.fillEllipse(X(m.x), Y(my), mw * gasp, mh * gasp)
    // Inner mouth (dark red) for depth.
    g.fillStyle(0x8c2f39, 1)
    g.fillEllipse(X(m.x), Y(my + mh * 0.08), mw * gasp * 0.72, mh * gasp * 0.62)
    // Tongue tip peeking from the bottom of the O (panic only).
    if (level === 'panic') {
      g.fillStyle(0xff7fa5, 1)
      g.fillEllipse(X(m.x), Y(my + mh * 0.34), mw * gasp * 0.5, mh * gasp * 0.34)
    }

    // SWEAT DROPS: the cartoon panic tell. They appear from 'scared' up.
    if (level !== 'normal' && fear > E.sweatAt * (level === 'scared' ? 0.75 : 1)) {
      const sweatA = Math.min(1, (fear - E.sweatAt * 0.75) / Math.max(0.01, 1 - E.sweatAt * 0.75))
      const dropPhase = t * 2.2
      for (let i = 0; i < E.sweatDrops; i++) {
        const side = i % 2 === 0 ? -1 : 1
        const ph = dropPhase + i * 1.7
        const k = ph - Math.floor(ph) // 0..1 loop
        const dist = liveR * (0.72 + k * 0.5)
        const dxp = side * dist
        const dyp = -liveR * (0.55 + Math.sin(k * Math.PI) * 0.45) - i * liveR * 0.04
        const dropR = liveR * 0.055 * (0.7 + 0.3 * Math.sin(i * 3.1))
        g.fillStyle(0x9fdcff, 0.95 * sweatA)
        g.fillCircle(X(dxp), Y(dyp), dropR)
        g.fillStyle(0xffffff, 0.85 * sweatA)
        g.fillCircle(X(dxp - dropR * 0.25), Y(dyp - dropR * 0.3), dropR * 0.38)
      }
    }
    void view
    void atlas
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
    this.fearG.destroy()
  }
}


