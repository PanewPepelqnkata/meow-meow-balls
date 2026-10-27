import Phaser from 'phaser'
import Matter from 'matter-js'
import { STAGE } from '../../config/stage'
import { containerBounds, wallCollidersAt, tipCollidersAt, interiorCorners } from '../../config/container'
import { SPAWN, spawnY, clampSpawnX } from '../../config/spawn'
import { THEME_PROGRESS } from '../../config/presentation'
import { SPAWNABLE_TIERS, getTier, randomSpawnTier } from '../../config/ballTiers'
import { SOFT } from '../systems/SoftBall'
import { PhysicsWorld } from '../systems/PhysicsWorld'
import { SoftBallManager } from '../systems/SoftBallManager'
import { WallAnimator } from '../systems/WallAnimator'
import { InputController } from '../systems/InputSystem'
import { MergeSystem } from '../systems/MergeSystem'
import { isOutsideContainer } from '../../config/gameOver'
import { GameOverSequence } from '../rendering/GameOverSequence'
import { GameOverWatch } from '../systems/GameOverWatch'
import { ScoreSystem } from '../systems/ScoreSystem'
import { ContainerView } from '../rendering/ContainerView'
import { SoftBallRenderer } from '../rendering/SoftBallRenderer'
import { BackgroundScene } from './BackgroundScene'
import { ScoreFeedback } from '../rendering/ScoreFeedback'
import { gameBus } from '../events/gameBus'
import { DebugOverlay } from '../debug/DebugOverlay'
import { PerfOverlay } from '../debug/PerfOverlay'
import { session, fastbootRequested } from '../state/session'
import { bannerForcedByVariant } from '../rendering/DiscoveryBanner'
import { hasDiscoveredTier, recordDiscovery, recordMerge, recordRunEnd, savedBest, themeSetting } from '../state/save'
import { rollNewRunSeed, runVariantFor } from '../state/runVariant'
import {
  ballLookFor,
  drawBallFace,
  faceLayoutFor,
  restContour,
  wobbleContour,
  ballOutlineWidth,
  INK,
} from '../rendering/BallAppearance'
import { resolveLayout, readSafeArea } from '../../ui/ResponsiveLayout'
import type { UiLayout } from '../../ui/ResponsiveLayout'
import { randomSeed } from '../rendering/BallAppearance'
import { cycleColor } from '../rendering/rgbCycle'
import { DropClaw } from '../../ui/DropClaw'
import type { UIScene } from './UIScene'

/**
 * Phase 2.4 gameplay scene; Phase 2.11.0 restructure: this scene is now the
 * WORLD scene — its camera frames the gameplay band of the fixed 720×1280
 * stage inside a full-window canvas (zoom + center from the central
 * ResponsiveLayout). All HUD/UI lives in UIScene (rendered on top, its own
 * camera), so no per-object camera-ignore bookkeeping is needed. Physics,
 * merging, scoring, abilities and game-over logic are unchanged.
 *
 * Appearance seeding (Phase 2.11.0 §11): the scene allocates the next ball's
 * appearance seed AHEAD of the drop, publishes it with the tier through
 * `state:next`, and passes the SAME seed into spawnBall — preview, claw and
 * the actual dropped character are one shared appearance.
 */
export class PlaygroundScene extends Phaser.Scene {
  private physicsWorld!: PhysicsWorld
  private balls!: SoftBallManager
  private inputController!: InputController
  private mergeSystem!: MergeSystem
  private score = new ScoreSystem()
  private ballRenderer!: SoftBallRenderer
  private backgroundScene: BackgroundScene | undefined
  private scoreFeedback!: ScoreFeedback
  private walls!: WallAnimator
  private containerView!: ContainerView
  private claw!: DropClaw
  private debug: DebugOverlay | null = null
  // Tiers 1–3 are known from every run's start; tier 4+ unlock
  // PROGRESSIVELY — merging into 4 fires its discovery (card first run,
  // wind card afterwards), and the progression line locks/unlocks with it.
  /** The lowest tier the wind banner presents — tier 4 repeats included
   * (tier 4's own first discovery shows the card, like 5+). */
  private static readonly WIND_BANNER_MIN_TIER = 4
  /** First-time-this-run tiers. Tiers 1–3 are known from every run's
   * start; tier 4+ unlock progressively during the run (4's discovery
   * fires like any other tier's). */
  private discoveredTiers = new Set<number>([1, 2, 3])
  /** Tiers discovered in THIS run — a repeat discovery (a tier already in
   * the lifetime save) still gets the NON-BLOCKING banner animation once
   * per run, but never twice for the same tier in the same run. */
  private runDiscoveredTiers = new Set<number>()

  private registeredIds = new Set<number>()
  /**
   * Phase 2.13.0 (spec §4/§12): TWO-slot ball queue.
   * `currentBall` is what the crane holds and what the next drop releases;
   * `nextBallState` is what the Next Ball preview shows. The old single
   * `nextTier/nextSeed` pair fed BOTH the crane and the preview, so the
   * preview displayed the currently-held ball — the reported preview defect.
   */
  private currentBall = { tier: 1, seed: 0 }
  private nextBallState = { tier: 1, seed: 0 }
  /** Last emitted drop-cooldown gate state (flip-only bus emission). */
  private lastDropHolding = true
  private devScorePre: HTMLPreElement | null = null
  /** Phase 2.20 dev-only perf overlay (?perf=1) + its rolling samples. */
  private perf: PerfOverlay | null = null
  private perfFrameStart = 0
  private perfPhysicsMs = 0
  private perfRenderMs = 0
  /**
   * PROD-READABLE frame timings.
   *
   * The physics/render split is the measurement that says which half of
   * the frame budget to attack, and it was only reachable through the
   * DEV-only PerfOverlay — so in a production build the `?diag=1` WALL
   * line printed `phys ?ms render ?ms` and the device could not report
   * it. These two fields are ALWAYS collected (the timers above run
   * unconditionally; only the OVERLAY is dev-gated), so the prod diag
   * can read them directly.
   *
   * Cost: two `performance.now()` calls per frame, which the scene
   * already paid unconditionally for these very values.
   */
  readonly frameTimings = { physicsMs: 0, renderMs: 0 }
  /** Last emitted walls countdown — suppresses per-frame no-change events. */
  private lastWallsMs = Number.NaN
  private readonly devDiagnostics: Array<Record<string, unknown>> = []
  private devDeformPre: HTMLPreElement | null = null
  /** Game-over state (Phase 2.10.0): once triggered, drops/inputs/abilities
   * stop and the physics is paused until a full restart. */
  private gameOver = false
  /** The end-of-run panic→pop sequence (created on first game over). */
  private gameOverSequence: GameOverSequence | null = null
  /** Phase 2.14.0: highest tier reached THIS run (leaderboard flavor). */
  private bestTierRun = 1
  /** Drops are ignored until this scene-time (restart click suppression). */
  private dropSuppressUntil = 0
  /** Cached layout for pointer→stage mapping and camera framing. */
  private layoutCache: UiLayout | null = null
  /** UIScene reference (lazily resolved — for pointer-over-UI gating). */
  private uiScene: UIScene | null = null
  /** Dev-telemetry handles to the live physics geometry (exposed read-only
   * through window.__brScene below; never mutated through them). */
  private devWallBodies: Matter.Body[] = []
  private devFloorBody: Matter.Body | null = null

  constructor() {
    super('playground')
  }

  create(): void {
    // Phase 2.12.1: the full-screen background lives in the dedicated
    // BackgroundScene (registered BELOW this scene) — see GameRoot. This
    // scene's camera stays transparent so the themed background shows through.
    this.backgroundScene = this.scene.get('BackgroundScene') as BackgroundScene | undefined
    // Phase 2.13.0: two-slot ball queue — crane shows `currentBall`, the
    // Next Ball preview shows `nextBallState`.
    this.initQueue()

    // World camera: transparent background — the UI scene renders on top.
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)')
    this.applyWorldCamera()
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyWorldCamera, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyWorldCamera, this)
    })

    this.physicsWorld = new PhysicsWorld()
    // Floor is fixed; walls are separate bodies so Raise Walls can animate them.
    // Tip caps are static bodies aligned with the visible rounded wall tips.
    const wallBodies = wallCollidersAt().map((spec: { vertices: { x: number; y: number }[]; label: string }) => createWallBody(spec))
    const tipBodies = tipCollidersAt().map((spec) => createWallBody(spec))
    const floorBody = createWallBody(floorCollider())
    this.devWallBodies = wallBodies
    this.devFloorBody = floorBody
    for (const body of [...wallBodies, ...tipBodies, floorBody]) {
      this.physicsWorld.addBody(body)
    }
    this.walls = new WallAnimator()
    this.walls.setClock(() => this.time.now)

    this.balls = new SoftBallManager(this.physicsWorld.world)
    this.balls.setPhysics(this.physicsWorld)
    this.balls.tierRadius = (tier) => getTier(tier)?.radius ?? 34
    // Bind AFTER the manager exists — Phase 2.9.9 fix: the previous code bound
    // while `this.balls` was still undefined, so the animator's manager ref
    // (wakeAll on wall motion) was silently dead.
    this.walls.bind(wallBodies, (h) => {
      this.containerView.redrawWalls(h)
      this.balls.invalidateWallGeo()
    }, this.balls, tipBodies)
    this.ballRenderer = new SoftBallRenderer(this)
    // Baked-rendering invalidation (settled-state kill): EVERY genuine wake
    // funnels through SoftBallManager.wakeBall (auditStuckBalls, partial
    // wake repair, merge displacement, wall raise wakeAll, translateBall) —
    // dropping the ball's baked textures here means stale baked pixels can
    // never reach the screen (the renderer's draw-time softBallSleeping
    // check is the second gate; this one fires the same frame, off-draw).
    this.balls.onBallWake = (id) => this.ballRenderer.dropBake(id)
    // Per-substep soft-body solver passes, exactly once per Engine.update —
    // never per rendered frame: rest/pressure → contact backstop (iterates
    // internally) → positional area restoration → boundary safety net →
    // freeze balls whose rest window completed (always LAST so they sleep
    // in a repaired, clamped state).
    this.physicsWorld.setSubStepHandler(() => {
      const perf = this.perf
      if (!perf) {
        this.balls.stepAll(this.physicsWorld.activeContactBodyIds())
        this.balls.separateContacts()
        this.balls.expandShape()
        this.balls.clampToContainer()
        this.balls.commitRest()
        return
      }
      let t0 = performance.now()
      this.balls.stepAll(this.physicsWorld.activeContactBodyIds())
      perf.stepAllMs = performance.now() - t0
      t0 = performance.now()
      this.balls.separateContacts()
      perf.separateMs = performance.now() - t0
      t0 = performance.now()
      this.balls.expandShape()
      perf.expandMs = performance.now() - t0
      t0 = performance.now()
      this.balls.clampToContainer()
      perf.clampMs = performance.now() - t0
      this.balls.commitRest()
    })
    
    // Phase 2.12.2: score feedback stays in the world scene (popups track
    // world-space merge positions); the discovery modal moved to UIScene.
    this.scoreFeedback = new ScoreFeedback(this)
    
    this.mergeSystem = new MergeSystem(this.balls, this.physicsWorld, this.score, {
      onMerge: (tier, x, y, chainDepth, points, seed) => {
        // Phase 2.13.0: score reward + combo label from the REAL chain state;
        // tier colors the `+N` popup. Restrained burst at the merge point.
        this.scoreFeedback.showScoreReward(points, x, y, true, chainDepth, tier)
        this.scoreFeedback.showMergeBurst(x, y, tier)
        // Combo glow: a light sheet sweeps the frame left→right in the
        // container's color; big combos (chain ≥ 4) sweep in rainbow RGB.
        if (chainDepth >= 2) this.containerView.playGlow(chainDepth)
        // Micro camera shake scales dynamically with chain depth and high tiers
        if (chainDepth >= 2 || tier >= 5) {
          const duration = chainDepth >= 4 ? 140 : chainDepth >= 3 ? 110 : 70
          const intensity = chainDepth >= 4 ? 0.005 : chainDepth >= 3 ? 0.0035 : 0.0018
          this.cameras.main.shake(duration, intensity)
        }

        // Phase 2.13.0 (spec §1/§7): the discovery presentation fires ONLY
        // for first-time-this-run tiers 4+ — tiers 1–3 merge silently. The
        // seed is the ACTUAL replacement ball's appearance seed.
        const firstTime = !this.discoveredTiers.has(tier)
        if (firstTime) {
          this.discoveredTiers.add(tier)
          gameBus.emit('state:discovered', { tier })
          // QA wind mode (?discovery=wind): the banner IS the discovery
          // presentation for every discovered tier (4+), first-time or not.
          if (bannerForcedByVariant() && tier >= PlaygroundScene.WIND_BANNER_MIN_TIER) {
            this.runDiscoveredTiers.add(tier)
            gameBus.emit('discovery:banner', { tier, seed })
          }
          // First time EVER (lifetime save has no record) → the CARD MODAL,
          // tier 4 and up: every earned ball gets its collectible moment.
          else if (!hasDiscoveredTier(tier) && tier >= PlaygroundScene.WIND_BANNER_MIN_TIER) {
            gameBus.emit('discovery:show', { tier, seed })
          }
          // REPEAT (seen in an earlier run) → the wind card, once per tier
          // per run so chains can't spam it. The game never pauses.
          else if (!this.runDiscoveredTiers.has(tier)) {
            this.runDiscoveredTiers.add(tier)
            gameBus.emit('discovery:banner', { tier, seed })
          }
        }

        // Phase 2.14.0 (spec §2): lifetime records for the JOURNAL,
        // COLLECTION and stats screens. Tiers 8–9 record their PER-RUN
        // variant (randomized every run — the collectible variants).
        if (firstTime) recordDiscovery(tier, runVariantFor(tier))
        recordMerge(tier)
        if (tier > this.bestTierRun) this.bestTierRun = tier

        // Phase 2.13.0 (spec §6): background milestones — primary trigger is
        // a first-time significant tier, secondary is an exceptional combo.
        this.themeMilestone(tier, firstTime, chainDepth)

        // Dev diagnostics
        if (this.devDiagnostics.length > 6) this.devDiagnostics.shift()
        this.devDiagnostics.push({ tier, x: Math.round(x), y: Math.round(y), points })
      },
    })

    this.containerView = new ContainerView(this)
    this.claw = new DropClaw(this)
    this.claw.setMobile(this.layoutCache?.composition === 'portrait')

    // Aim band + drop target use the EXTRAPOLATED interior at the actual
    // spawn height for the LARGEST spawnable tier (raised-wall-anchored,
    // Phase 2.10.1), so aim, claw preview and spawn always agree.
    const b = containerBounds()
    const maxSpawnRadius = Math.max(...SPAWNABLE_TIERS.map((t) => getTier(t)?.radius ?? 0))
    const aimInterior = {
      x: b.innerLeftAt(spawnY(maxSpawnRadius)),
      width: b.innerRightAt(spawnY(maxSpawnRadius)) - b.innerLeftAt(spawnY(maxSpawnRadius)),
    }
    this.inputController = new InputController({
      stageWidth: STAGE.width,
      stageHeight: STAGE.height,
      interior: aimInterior,
      maxRadius: maxSpawnRadius,
      cooldownMs: SPAWN.cooldownMs,
      toStage: (pointer) => this.viewportToStage(pointer),
      onDrop: (target) => this.dropBall(target.x),
    })
    this.inputController.attach(this)
    // Phase 2.14.0: while the start screen is up, gameplay input is gated
    // (the menu overlays everything). START emits 'ui:start' which unlocks.
    if (session.menuActive) this.inputController.setEnabled(false)

    if (import.meta.env.DEV) {
      this.debug = new DebugOverlay(this, this.physicsWorld, this.balls)
      // Phase 2.20: ?perf=1 mounts the frame-budget overlay (FPS, frame
      // time, physics/render split, ball/particle counts, DPR, canvas
      // resolution). DEV-only.
      if (new URLSearchParams(window.location.search).get('perf') === '1') {
        this.perf = new PerfOverlay(this, this.ballRenderer, this.balls)
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.perf?.destroy())
      }
      // Dev diagnostics ONLY behind explicit URL params — never in normal
      // gameplay (Phase 2.5 §4).
      const params = new URLSearchParams(window.location.search)
      if (params.get('diag') === '1' || params.get('autodrop') === '1') {
        this.devScorePre = document.createElement('pre')
        this.devScorePre.id = 'br-score'
        this.devScorePre.style.cssText = 'position:fixed;left:4px;bottom:4px;margin:0;font-size:10px;z-index:98;pointer-events:none'
        this.devDeformPre = document.createElement('pre')
        this.devDeformPre.id = 'br-deform'
        this.devDeformPre.style.cssText = 'position:fixed;right:4px;bottom:4px;margin:0;font-size:10px;z-index:98;pointer-events:none'
        document.body.append(this.devScorePre, this.devDeformPre)
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
          this.devScorePre?.remove()
          this.devDeformPre?.remove()
        })
      }
      if (params.get('autodrop') === '1') {
        let last = 0
        this.events.on(Phaser.Scenes.Events.UPDATE, (t: number) => {
          if (t - last > 1300) {
            last = t
            this.dropBall(300 + Math.random() * 120)
          }
        })
      }
    }
    this.input.keyboard?.on('keydown-R', () => {
      if (session.menuActive) return
      this.restartRun()
    })
    // Ability shortcuts (Phase 2.11.0): Q swap, E raise walls.
    this.input.keyboard?.on('keydown-Q', () => {
      if (session.menuActive) return
      this.doSwap()
    })
    this.input.keyboard?.on('keydown-E', () => {
      if (session.menuActive) return
      this.doRaise()
    })
    // UIScene → world commands (buttons live in UIScene; behavior here).
    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      gameBus.on('ui:swap', () => this.doSwap()),
    )
    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      gameBus.on('ui:raise', () => this.doRaise()),
    )
    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      gameBus.on('ui:restart', () => this.restartRun()),
    )
    // Baked rendering: drop all baked textures + quads with the scene.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ballRenderer?.destroy()
    })
    // Phase 2.14.0: title screen START → gameplay input unlocks (once).
    // A short drop-suppression window swallows the very pointerup that
    // pressed START (Phaser dispatches input to every scene; the same click
    // must not also drop the held ball as gameplay unlocks).
    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      gameBus.on('ui:start', () => {
        session.menuActive = false
        if (!this.gameOver) {
          this.inputController.setEnabled(true)
          this.dropSuppressUntil = this.time.now + 400
        }
      }),
    )
    if (import.meta.env.DEV) {
      this.input.keyboard?.on('keydown-P', () => this.spawnArrangement())
      if (new URLSearchParams(window.location.search).get('arrangement') === '1') {
        this.spawnArrangement()
      }
    }

    // Publish initial HUD state (UIScene may not be listening yet — it pulls
    // the same values from the registry on create; the registry is the
    // boot-time sync point). The queue is initialized BEFORE this point in
    // create(); see initQueue(). Phase 2.14.0: the persisted all-time best
    // seeds the registry (localStorage save), not the session default 0.
    this.registry.set('next', { ...this.nextBallState })
    this.registry.set('best', Math.max(savedBest(), this.best()))

    // The UI scene renders on top of this one (Phaser auto-starts only the
    // first config scene); launch AFTER the registry above is populated so
    // UIScene.create reads complete boot state.
    this.scene.launch('UIScene')
    // Phase 2.14.0: the start screen renders ABOVE UIScene (last scene in
    // the config list). Dev fastboot (?fastboot=1) skips it entirely — QA
    // suites and dev iteration boot straight into gameplay.
    if (!fastbootRequested()) this.scene.launch('TitleScene')

    ;(window as unknown as Record<string, string>).__brCreateDone = 'yes'
    if (import.meta.env.DEV) {
      // Development-only READ-ONLY diagnostic interface (Phase 2.9.9): QA
      // scripts and the debug overlay read real world-space measurements
      // from here — live Matter vertices, per-ball effective masses,
      // deformation and rest state. Nothing here mutates game state.
      const verts = (body: Matter.Body) => body.vertices.map((v) => ({ x: +v.x.toFixed(2), y: +v.y.toFixed(2) }))
      /** Clamp an x so a ball of `radius` fits between the wall lines at a
       * CUSTOM height y (clampSpawnX only knows the spawn height). */
      const clampSpawnXAt = (x: number, radius: number, y: number): number => {
        const b = containerBounds()
        const left = b.innerLeftAt(y) + radius + 1
        const right = b.innerRightAt(y) - radius - 1
        return Math.min(Math.max(x, left), Math.max(left, right))
      }
      // Appearance modules for QA probes (draw bisecting, consistency checks).
      ;(window as unknown as Record<string, unknown>).__brModules = {
        ballLookFor,
        drawBallFace,
        faceLayoutFor,
        restContour,
        wobbleContour,
        ballOutlineWidth,
        INK,
        getTier,
        spawnY,
        interiorCorners,
        gameBus,
        Matter,
        cycleColor,
      }
      ;(window as unknown as Record<string, unknown>).__brScene = {
        dropAt: (x: number) => this.dropBall(x),
        /** DEV-ONLY QA hook (mutating, same spirit as dropAt): spawn a ball of
         * `tier` at x, optionally at an explicit y (default: the standard
         * spawn height) — lets browser QA build deterministic merge/game-over
         * scenarios in the production game. `clamp` (optional) keeps the
         * spawn inside the extrapolated wall lines at the CUSTOM y (the
         * container narrows toward the top; raw spawns at high y can land
         * outside them). */
        spawnAt: (x: number, tier: number, y?: number, clamp = false) => {
          const t = getTier(tier)
          const rr = t?.radius ?? 38
          const yy = y ?? spawnY(rr)
          const xx = clamp ? clampSpawnXAt(x, rr, yy) : x
          const ball = this.balls.spawnBall(xx, yy, tier)
          this.ballRenderer.register(ball)
          this.registeredIds.add(ball.id)
          return { id: ball.id, tier: ball.tier }
        },
        /** DEV-ONLY QA hook (mutating): full restart, same as the button. */
        restart: () => this.restartRun(),
        /** DEV-ONLY QA hook (Phase 2.13.0, read-only): the two-slot queue. */
        queueInfo: () => ({
          current: { ...this.currentBall },
          next: { ...this.nextBallState },
          swapUsed: this.swapUsed,
          raiseUsed: this.raiseUsed,
        }),
        /** DEV-ONLY QA hook (Phase 2.13.0, MUTATING — QA only): force the
         * queue contents for deterministic preview/crane regression tests. */
        setQueue: (current: { tier: number; seed: number }, next: { tier: number; seed: number }) => {
          this.currentBall = { ...current }
          this.nextBallState = { ...next }
          this.publishQueue()
        },
        /** DEV-ONLY QA hook (Phase 2.12.1): switch background theme for visual testing. */
        setTheme: (theme: 'light' | 'space' | 'jungle' | 'fantasy') =>
          this.backgroundScene?.setTheme(theme),
        /** DEV-ONLY QA hook (mutating): fire a combo reward popup at an
         * explicit depth/position for visual testing. */
        comboPopup: (points: number, x: number, y: number, depth: number, tier = 3) =>
          this.scoreFeedback.showScoreReward(points, x, y, true, depth, tier),
        /** DEV-ONLY QA hook (Phase 2.16.3, mutating): fire the container
         * combo glow at an explicit chain depth (rainbow at ≥ 4). */
        containerGlow: (chainDepth: number) => this.containerView.playGlow(chainDepth),
        /** DEV-ONLY QA hook (Phase 2.12.1, read-only): transient visual-system state. */
        visualState: () => ({
          popups: this.scoreFeedback?.popupCount ?? -1,
          popupTexts: this.scoreFeedback?.popupLabels ?? [],
          popupAlphas: this.scoreFeedback?.popupAlphas ?? [],
          discoveryVisible: this.ui()?.discoveryState().visible ?? false,
          discoveryTier: this.ui()?.discoveryState().tier ?? null,
          rendererBalls: this.ballRenderer?.size ?? -1,
          /** Phase 2.13.4: balls the renderer actually DREW last frame —
           * must equal rendererBalls (deferred-merge sources included). */
          rendererDrawn: this.ballRenderer?.drawnSize ?? -1,
          registered: this.registeredIds.size,
        }),
        /** DEV-ONLY QA hook (Phase 2.13.1, read-only): recent merge locality
         * records (source midpoint vs replacement position, pushes). */
        mergeLocality: () => this.mergeSystem.lastMerges.map((m) => ({ ...m })),
        /** DEV-ONLY QA hook (Phase 2.13.3, read-only): LIVE pending-merge
         * state — deferred merges waiting for a valid local position and the
         * locked ('merging') source balls, which must remain in the world
         * (visible) until the replacement exists. */
        mergePending: () => this.mergeSystem.pendingSnapshot(),
        /** DEV-ONLY QA hook (Phase 2.13.4, read-only): the merge TRANSACTION
         * log — one record per accepted pair: transaction id, source ids,
         * deferral + pending duration, replacement id, outcome. */
        mergeTransactions: () => this.mergeSystem.mergeTransactions.map((t) => ({ ...t })),
        /** DEV-ONLY QA hook (Phase 2.13.4, read-only): was this ball
         * actually DRAWN in the last renderer frame? (Registry membership
         * and drawing are now distinct — deferred-merge sources must appear
         * in BOTH.) */
        isDrawn: (id: number) => this.ballRenderer?.isDrawn(id) ?? false,
        /** DEV-ONLY QA hook (baked rendering, read-only): baked-quad
         * diagnostics — how many balls rendered as textured quads last
         * frame, and whether a specific id did. Settled piles should show
         * bakedSize → ball count; a wake must clear the id same-frame. */
        bakedSize: () => this.ballRenderer?.bakedSize ?? -1,
        isBaked: (id: number) => this.ballRenderer?.isBaked(id) ?? false,
        /** DEV-ONLY QA hook (SpriteBalls, read-only): live sprite transform
         * of one ball (acceptance §3 — squash/stretch verification). */
        spriteView: (id: number) => this.ballRenderer?.debugSpriteView(id) ?? null,
        /** DEV-ONLY QA hook: where the claw currently holds the next ball
         * (stage coords) — appearance-consistency probes. */
        spawnInfo: (tier: number) => ({
          x: this.inputController.aimX,
          y: spawnY(getTier(tier)?.radius ?? 38),
        }),
        /** DEV-ONLY QA hook: the ball the claw is actually displaying. */
        clawInfo: () => this.claw.info(),
        /** Game-over state (read-only) + the overlay button position in
         * viewport px (the overlay lives in UIScene; QA clicks it there). */
        gameOver: () => ({
          over: this.gameOver,
          score: this.score.score,
          best: this.best(),
          overlay: (this.ui()?.overlayVisible() ?? false),
          buttonViewport: this.ui()?.playAgainCenter() ?? null,
        }),
        /** Viewport-space positions of interactive UI (QA automation). */
        uiPositions: () => this.ui()?.uiPositions() ?? null,
        /** DEV-ONLY QA hook (Phase 2.13.0, read-only): tiers the progression
         * path currently shows unlocked (real discovery state). */
        progressionUnlocked: () => this.ui()?.progressionUnlocked() ?? [],
        /** DEV-ONLY QA hook (Phase 2.13.1): Raise Walls button lifecycle. */
        abilityRaiseUsed: () => this.ui()?.abilityRaiseUsed() ?? false,
        /** DEV-ONLY deep diagnostic: per-particle state of one ball + its
         * nearest foreign contacts (positions, speeds, sleeping flags). */
        ballDetail: (id: number) => {
          const e = this.balls.getBalls().find((x) => x.id === id)
          if (!e) return null
          const s = e.soft
          const others = this.balls.getBalls().filter((x) => x.id !== id)
          const near: Array<Record<string, unknown>> = []
          for (const o of others) {
            const oSleeping = o.soft.center.isSleeping && o.soft.particles.every((p) => p.isSleeping)
            for (const p of o.soft.particles) {
              const d = Math.hypot(p.position.x - s.center.position.x, p.position.y - s.center.position.y)
              if (d < s.radius * 1.6) {
                near.push({
                  tier: o.tier,
                  id: o.id,
                  d: +d.toFixed(1),
                  sleeping: oSleeping,
                  pos: { x: +p.position.x.toFixed(1), y: +p.position.y.toFixed(1) },
                  v: +Math.hypot(p.velocity.x, p.velocity.y).toFixed(2),
                })
              }
            }
          }
          near.sort((a, b) => (a.d as number) - (b.d as number))
          return {
            tier: e.tier,
            /** Lifecycle state ('active' | 'merging') — Phase 2.13.4 merge
             * transaction logging: pending sources must read 'merging'. */
            state: e.state,
            area: +(s.area / s.restArea).toFixed(3),
            resting: this.balls.restDebug(id),
            center: {
              pos: { x: +s.center.position.x.toFixed(1), y: +s.center.position.y.toFixed(1) },
              v: +Math.hypot(s.center.velocity.x, s.center.velocity.y).toFixed(2),
              sleeping: s.center.isSleeping,
            },
            particles: s.particles.map((p) => ({
              pos: { x: +p.position.x.toFixed(1), y: +p.position.y.toFixed(1) },
              v: +Math.hypot(p.velocity.x, p.velocity.y).toFixed(2),
              sleeping: p.isSleeping,
            })),
            nearest: near.slice(0, 12),
          }
        },
        physicsCounts: () => ({
          bodies: this.physicsWorld.getAllBodies().length,
          constraints: Matter.Composite.allConstraints(this.physicsWorld.world).length,
          balls: this.balls.count,
        }),
        /** DEV-ONLY QA hook (Phase 2.11.2 spec §5): worst cross-ball collision
         * disc overlap among ACTIVE balls — the same math as the unit-test
         * worstPairOverlap. Verifies in the LIVE browser that separate
         * logical balls never interpenerate beyond the standing-wedge
         * tolerance (2.5px) during merges and crowded piles. */
        pairOverlap: () => {
          const balls = this.balls.getBalls().filter((b) => b.state === 'active')
          let worst = -Infinity
          let worstPair: [number, number] | null = null
          for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
              const ra = balls[i]!.soft.radius * SOFT.particleRadiusFactor + SOFT.contactSkin
              const rb = balls[j]!.soft.radius * SOFT.particleRadiusFactor + SOFT.contactSkin
              for (const pa of balls[i]!.soft.particles) {
                for (const pb of balls[j]!.soft.particles) {
                  const d = Math.hypot(pa.position.x - pb.position.x, pa.position.y - pb.position.y)
                  const o = ra + rb - d
                  if (o > worst) {
                    worst = o
                    worstPair = [balls[i]!.tier, balls[j]!.tier]
                  }
                }
              }
            }
          }
          return { worst: +worst.toFixed(2), worstPair, balls: balls.length }
        },
        /** Live wall/floor collider vertices + animation phase. */
        wallGeometry: () => ({
          phase: this.walls.phaseNow,
          height: +this.walls.height.toFixed(2),
          left: this.devWallBodies[0] ? verts(this.devWallBodies[0]) : null,
          right: this.devWallBodies[1] ? verts(this.devWallBodies[1]) : null,
          floor: this.devFloorBody ? verts(this.devFloorBody) : null,
        }),
        /** Per-ball real measurements: effective mass, deformation, rest. */
        /** Phase 2.10.2 diagnostics: renderer-entry count vs logical balls,
         * merge lifecycle stats, and the last boundary-clamp correction. */
        lifecycle: () => ({
          renderables: this.ballRenderer.size,
          logicalBalls: this.balls.count,
          clampCorrection: +this.balls.lastClampCorrection.toFixed(2),
          merge: this.mergeSystem.stats,
        }),
        telemetry: () => ({
          step: this.physicsWorld.stepCount,
          balls: this.balls.getBalls().map((b) => {
            const xs = b.soft.particles.map((p) => p.position.x)
            const ys = b.soft.particles.map((p) => p.position.y)
            const w = Math.max(...xs) - Math.min(...xs)
            const h = Math.max(...ys) - Math.min(...ys)
            const vs = b.soft.particles.map((p) => Math.hypot(p.velocity.x, p.velocity.y))
            const c = b.soft.center.position
            const cv = b.soft.particles.reduce((s, p) => s + p.velocity.x, 0) / b.soft.particles.length
            const cy = b.soft.particles.reduce((s, p) => s + p.velocity.y, 0) / b.soft.particles.length
            return {
              id: b.id,
              tier: b.tier,
              mass: +(b.soft.center.mass + b.soft.particles.reduce((s, p) => s + p.mass, 0)).toFixed(3),
              area: +this.balls.areaRatio(b.id).toFixed(3),
              aspect: +(Math.min(w, h) / Math.max(w, h)).toFixed(3),
              maxSpeed: +Math.max(...vs).toFixed(2),
              centroidSpeed: +Math.hypot(cv, cy).toFixed(3),
              cx: +c.x.toFixed(1),
              cy: +c.y.toFixed(1),
              sleeping: b.soft.center.isSleeping && b.soft.particles.every((p) => p.isSleeping),
              rest: this.balls.restDebug(b.id),
            }
          }),
          worstPairOverlap: (() => {
            const balls = this.balls.getBalls()
            let worst = 0
            for (let i = 0; i < balls.length; i++) {
              for (let j = i + 1; j < balls.length; j++) {
                const rA = balls[i]!.soft.radius * 0.32 + 2
                const rB = balls[j]!.soft.radius * 0.32 + 2
                for (const pa of balls[i]!.soft.particles) {
                  for (const pb of balls[j]!.soft.particles) {
                    const d = Math.hypot(pa.position.x - pb.position.x, pa.position.y - pb.position.y)
                    worst = Math.max(worst, rA + rB - d)
                  }
                }
              }
            }
            return +worst.toFixed(2)
          })(),
          lastSeparationCorrection: +this.balls.lastSeparationCorrection.toFixed(2),
        }),
      }
    }
    gameBus.emit('dev:ready', { at: Date.now() })
  }

  /** The single authoritative physics update path. */
  override update(time: number, delta: number): void {
    this.perfFrameStart = performance.now()
    try {
      this.updateInner(time, delta)
    } catch (err) {
      if (this.devScorePre) {
        ;(window as unknown as Record<string, string>).__brUpdateError = String(err)
      }
      throw err
    }
  }

  private updateInner(time: number, delta: number): void {
    // Phase 2.16.0: while the start screen is up this scene is completely
    // HIDDEN by TitleScene (no dimming/alpha games anymore) — input stays
    // gated by session.menuActive. When PLAY reveals the scene, the camera
    // and claw are simply at full strength.
    // Game over: pause the physics safely (no new steps, no merges, no new
    // drops — inputs are disabled); visuals/effects continue to fade out.
    // Phase 2.13.0: the discovery presentation pauses physics the same way —
    // `step` is skipped entirely so no sim time accumulates invisibly.
    if (!this.gameOver && !this.discoveryBlocking()) {
      // Side-wall containment exists only below the CURRENT wall tops
      // (Phase 2.10.1): feed the live animated height to the boundary
      // backstop so balls can genuinely overflow through the open top.
      const wallTopY = containerBounds().floorY - this.walls.height
      this.balls.wallTopY = wallTopY
      // The danger zone rides the rim: Raise Walls moves the panic line.
      this.ballRenderer.emotion.wallTopY = wallTopY
      // The frame timings are ALWAYS measured (two performance.now() calls
      // per frame) so the production `?diag=1` readout can report the
      // physics/render split — that split is the measurement that says
      // which half of the frame budget to attack, and it was unreachable
      // in prod before. The dev-only PerfOverlay reads the same values.
      const physStart = performance.now()
      this.physicsWorld.step(delta)
      this.perfPhysicsMs = performance.now() - physStart
      this.frameTimings.physicsMs = this.perfPhysicsMs

      // One drain per frame: mark first contact (merge eligibility), then merge.
      // Soft bodies deform physically — the 2.4 visual-impact feeding is retired.
      const events = this.physicsWorld.takeCollisionEvents()
      const ballBodyIds: number[] = []
      for (const { bodyA, bodyB, normalX, normalY, approachSpeed } of events) {
        ballBodyIds.push(bodyA.id, bodyB.id)
        // JELLY: feed the deform springs (visual only) — the contact
        // normal + approach speed are captured at collisionStart.
        //
        // NORMAL DIRECTION (verified against raw Matter, not assumed):
        // Matter flips the normal so that dot(normal, B - A) < 0 — the
        // normal points FROM bodyB TOWARD bodyA. The contact direction ON
        // a body must point TOWARD the other body, so bodyA gets -normal
        // (which points at bodyB) and bodyB gets +normal (which points at
        // bodyA). Measured: with bodyA = the floor, dot(normal, A->B) =
        // -79.9, i.e. the normal points at the floor.
        const bA = this.balls.getBallByBodyId(bodyA.id)
        const bB = this.balls.getBallByBodyId(bodyB.id)
        if (bA) this.ballRenderer.registerBallImpact(bA, { x: -normalX, y: -normalY }, approachSpeed)
        if (bB) this.ballRenderer.registerBallImpact(bB, { x: normalX, y: normalY }, approachSpeed)
      }
      if (ballBodyIds.length) this.balls.markTouched(ballBodyIds)
      this.mergeSystem.processMerges(events)
      // Sync renderer registration BEFORE the draw pass: a merge in this
      // frame must never render its removed sources (the "second ball
      // inside the merged ball" defect — the old order drew the stale
      // sources for one frame alongside the replacement).
      this.syncRegistration()

      this.checkGameOver(delta)
      this.walls.update(this.time.now)
      this.updateClaw()
      // Drop-cooldown gate → claw/preview visibility. Emitted on FLIP only
      // (mirrors the walls:countdown discipline — no per-frame bus spam).
      const holding = this.inputController.cooldownRemainingMs(this.time.now) <= 0
      if (holding !== this.lastDropHolding) {
        this.lastDropHolding = holding
        gameBus.emit('state:dropHolding', { holding })
      }
    }
    // Countdown only on change — while no Raise Walls countdown runs the
    // value is constant, and re-emitting it every frame just wakes the HUD.
    if (this.walls.remainingMs !== this.lastWallsMs) {
      this.lastWallsMs = this.walls.remainingMs
      gameBus.emit('walls:countdown', { remainingMs: this.walls.remainingMs })
    }
    const renderStart = performance.now()
    this.ballRenderer.update(delta)
    // Game-over pop sequence fx (pooled particles/rings) — no-op while idle.
    this.gameOverSequence?.update(delta)
    // Combo glow sweep (no-op unless a sweep is running).
    this.containerView.update(delta)
    // Phase 2.12.1: background animates inside BackgroundScene's own update
    // loop — nothing to drive from here anymore.
    this.debug?.update(delta)
    this.perfRenderMs = performance.now() - renderStart
    this.frameTimings.renderMs = this.perfRenderMs
    if (this.perf) {
      this.perf?.sample(this.perfFrameStart, this.perfPhysicsMs, this.perfRenderMs)
      this.perf?.tick()
    }

    if (import.meta.env.DEV) {
      // Read-only per-frame state for QA scripts — always on in dev so the
      // production game (no URL params) is verifiable; the DOM <pre> overlays
      // remain behind explicit params.
      ;(window as unknown as Record<string, unknown>).__brState = {
        score: this.score.score,
        best: this.best(),
        steps: this.physicsWorld.stepCount,
        balls: this.balls.count,
        tiers: this.balls.getBalls().map((b) => b.tier),
        touched: this.balls.getBalls().map((b) => b.touched),
        diagnostics: this.devDiagnostics,
        areas: this.balls.getBalls().slice(0, 6).map((b) => +this.balls.areaRatio(b.id).toFixed(2)),
        speeds: this.balls.getBalls().slice(0, 6).map((b) => +this.balls.speed(b.id).toFixed(2)),
      }
    }
    if (this.devScorePre && this.devDeformPre) {
      this.devScorePre.textContent = `score=${this.score.score} best=${this.best()} steps=${this.physicsWorld.stepCount} balls=${this.balls.count}`
      this.devDeformPre.textContent = JSON.stringify(this.devDiagnostics)
    }
    void time
  }

  private best(): number {
    return Number(this.registry.get('best') ?? 0)
  }

  /** Center the world camera on the gameplay band (central layout rules).
   * HiDPI: the canvas buffer is dpr× CSS px — normalize to CSS px first
   * (resolveLayout's contract), then multiply the layout zoom by dpr so the
   * CSS-px layout renders 1:1 into the buffer. */
  private applyWorldCamera(): void {
    const z = this.game.scale.displayScale.x || 1
    this.layoutCache = resolveLayout(this.scale.width / z, this.scale.height / z, readSafeArea())
    // Composition may flip on rotate: the claw's mobile state follows.
    if (this.claw) this.claw.setMobile(this.layoutCache.composition === 'portrait')
    const cam = this.cameras.main
    cam.setZoom(this.layoutCache.world.zoom * this.game.scale.displayScale.x)
    cam.centerOn(this.layoutCache.world.centerX, this.layoutCache.world.centerY)
  }

  /**
   * Viewport px → stage coords through the world camera, or null when the
   * pointer is over a UI control (UIScene buttons) — those taps must never
   * move the aim or drop a ball (both scenes receive every pointer event;
   * the rect check is the cross-scene gate).
   */
  private viewportToStage(pointer: Phaser.Input.Pointer): { x: number; y: number } | null {
    if (this.ui()?.isPointerOverUi(pointer.x, pointer.y)) return null
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    return { x: world.x, y: world.y }
  }

  /** Lazily resolved UIScene reference (boot order: world scene first). */
  private ui(): UIScene | null {
    if (!this.uiScene) this.uiScene = (this.scene.get('UIScene') as UIScene | undefined) ?? null
    return this.uiScene
  }

  /** Phase 2.13.0 (spec §6): background theme milestones.
   * Primary: a first-time DISCOVERED tier whose mapping in
   * THEME_PROGRESS.advanceOnTier advances the theme N steps.
   * Secondary: an exceptional chain (≥ comboDepth) advances ONE step — but
   * never while a discovery presentation is active, and never more than one
   * step per combo event (no random switching, no per-particle cycling). */
  private themeMilestone(tier: number, firstTime: boolean, chainDepth: number): void {
    if (!this.backgroundScene) return
    // Phase 2.14.0: a pinned theme (SETTINGS) freezes the background — the
    // run-progression milestones only apply on AUTO. Phase 2.19: portrait
    // phones are pinned to space (their composition theme) — no cycling.
    if (themeSetting() !== 'auto') return
    // PORTRAIT AUTO (user spec): start light; the FIRST ball discovery
    // transitions to space (once — no further portrait cycling).
    if (window.innerWidth < window.innerHeight) {
      if (firstTime) this.backgroundScene.setTheme('space', THEME_PROGRESS.fadeMs)
      return
    }
    const steps = firstTime ? (THEME_PROGRESS.advanceOnTier[tier] ?? 0) : 0
    if (steps > 0) {
      this.backgroundScene.advanceTheme(steps)
      return
    }
    if (chainDepth >= THEME_PROGRESS.comboDepth && !this.discoveryBlocking()) {
      this.backgroundScene.advanceTheme(1, true)
    }
  }

  private doSwap(): void {
    if (this.gameOver || session.menuActive || this.swapUsed || this.discoveryBlocking()) return
    this.swapUsed = true
    // Swap rerolls the CURRENT (held) ball only — the preview slot is
    // untouched, keeping the queue consistent (Phase 2.13.0).
    this.currentBall = { tier: randomSpawnTier(), seed: randomSeed() }
    this.publishQueue()
    gameBus.emit('ability:swapUsed', {})
  }
  private swapUsed = false

  /** Phase 2.12.2: true while the discovery modal owns the screen — world
   * inputs (drops via isPointerOverUi, ability shortcuts here) are paused. */
  private discoveryBlocking(): boolean {
    return this.ui()?.discoveryState().visible ?? false
  }

  private doRaise(): void {
    // Phase 2.13.1 (spec §7): Raise Walls is ONE-USE per run. The single
    // gate for BOTH keyboard ('E') and the button ('ui:raise'): once the
    // activation succeeds, raiseUsed latches for the whole run — repeated
    // presses while raising/raised/lowering (walls.activate() already
    // refuses those) or after the walls lower again are all no-ops.
    if (this.gameOver || session.menuActive || this.raiseUsed || this.discoveryBlocking()) return
    if (!this.walls.activate()) return
    // Baked rendering: during the wall ANIMATION the danger zone sweeps
    // through the pile and ball faces morph — suspend NEW bakes so nothing
    // mid-animation freezes a face into a texture. Existing baked BODIES
    // stay valid (walls don't move balls directly; wakeAll resets their
    // rest windows and faces stay live on top — see SoftBallRenderer).
    this.ballRenderer.suspendBaking()
    this.time.delayedCall(this.walls.animationDurationMs() + 50, () => {
      this.ballRenderer.resumeBaking()
    })
    this.raiseUsed = true
    gameBus.emit('ability:raiseUsed', {})
  }

  private raiseUsed = false

  private dropBall(x: number): void {
    if (this.gameOver || session.menuActive || this.discoveryBlocking()) return
    // Guard against the restart click double-acting: the PLAY AGAIN button
    // handler enables input, and the same pointerup then reaches the canvas
    // drop path — suppress drops for a short window after a restart.
    if (this.time.now < this.dropSuppressUntil) return
    const tier = getTier(this.currentBall.tier)
    if (!tier) return
    // Spawn ABOVE the fully raised wall tops (Phase 2.10.1, config/spawn.ts):
    // the ball's BOTTOM starts `clearanceAboveRaisedWall` above the raised
    // wall tops, horizontally clamped so the full collision envelope starts
    // clear of the extrapolated slanted wall lines at the actual spawn
    // height (same lines for normal and raised walls by construction).
    const y = spawnY(tier.radius)
    const clampedX = clampSpawnX(x, tier.radius)
    // §11 shared appearance: the ball spawns with EXACTLY the seed the
    // claw showed (the CURRENT slot — Phase 2.13.0 queue).
    const ball = this.balls.spawnBall(clampedX, y, this.currentBall.tier, false, this.currentBall.seed)
    this.ballRenderer.register(ball)
    this.registeredIds.add(ball.id)
    // The cooldown starts NOW: claw + preview drop their balls the same
    // frame (the update-loop flip would otherwise lag one frame).
    this.lastDropHolding = false
    gameBus.emit('state:dropHolding', { holding: false })
    // Queue rotation: previous next becomes current; a fresh ball enters next.
    this.currentBall = { ...this.nextBallState }
    this.nextBallState = { tier: randomSpawnTier(), seed: randomSeed() }
    // ?test=<tier>: keep dealing the test tier so the queue never runs out
    // of it (a plain drop in test mode always yields the test ball).
    const testTier = Number(new URLSearchParams(window.location.search).get('test') ?? '')
    if (Number.isInteger(testTier) && testTier >= 1 && testTier <= 12) {
      this.nextBallState = { tier: testTier, seed: randomSeed() }
    }
    // PERF (iOS): pre-bake the new NEXT ball's face atlas NOW (idle
    // frame) — the drop frame then reuses it instead of rasterizing
    // 3×256² textures mid-event.
    // PERF: defer the atlas bake to the NEXT frame — it rides the
    // input frame otherwise (measured 1.5-3.5ms).
    this.time.delayedCall(1, () =>
      this.ballRenderer.prewarmFace(this.nextBallState.tier, this.nextBallState.seed),
    )
    // Phase 2.14.0: leaderboard bookkeeping — spawned tiers count too.
    if (tier.tier > this.bestTierRun) this.bestTierRun = tier.tier
    this.publishQueue()
  }

  /**
   * Phase 2.13.0 (spec §4/§12): the authoritative two-slot queue.
   * `state:next` continues to carry the PREVIEW ball (what UIScene renders
   * in the Next Ball box); the crane reads `currentBall` directly.
   */
  private initQueue(): void {
    this.currentBall = { tier: randomSpawnTier(), seed: randomSeed() }
    this.nextBallState = { tier: randomSpawnTier(), seed: randomSeed() }
    // ?test=8: the crane holds a tier-8 ball (and the queue keeps dealing
    // tier 8s) — a quick way to eyeball the colour-cycling ball and its
    // discovery animations without merging up to it.
    const testTier = Number(new URLSearchParams(window.location.search).get('test') ?? '')
    if (Number.isInteger(testTier) && testTier >= 1 && testTier <= 12) {
      this.currentBall = { tier: testTier, seed: randomSeed() }
      this.nextBallState = { tier: testTier, seed: randomSeed() }
    }
    this.publishQueue()
  }

  private publishQueue(): void {
    this.registry.set('next', { ...this.nextBallState })
    this.registry.set('current', { ...this.currentBall })
    gameBus.emit('state:next', { tier: this.nextBallState.tier, seed: this.nextBallState.seed })
  }

  /** Register/unregister renderer entries to mirror BallManager state. */
  private syncRegistration(): void {
    for (const ball of this.balls.getBalls()) {
      if (!this.registeredIds.has(ball.id)) {
        this.ballRenderer.register(ball)
        this.registeredIds.add(ball.id)
      }
    }
    for (const id of this.registeredIds) {
      if (!this.balls.getBallById(id)) {
        this.ballRenderer.unregister(id)
        this.ballRenderer.emotion.forget(id)
        this.registeredIds.delete(id)
      }
    }
  }

  /** The claw holds the CURRENT queue slot (not the preview ball). */
  private updateClaw(): void {
    const tier = getTier(this.currentBall.tier)
    if (!tier) return
    // Mobile composition: no hook — the ball floats at the drop position.
    this.claw.setMobile(this.layoutCache?.composition === 'portrait')
    this.claw.setAim(this.inputController.aimX)
    this.claw.setBall(this.currentBall.tier, this.currentBall.seed)
    // Empty claw during the drop cooldown — the ball reappears with it.
    this.claw.setHolding(this.lastDropHolding)
  }

  /**
   * Phase 2.10.1 game-over detection (spec §3): GENUINE OVERFLOW — a touched
   * ball whose centroid has left the container past a slanted side-wall line
   * and dropped below the CURRENT wall tops, dwelling there for
   * GAME_OVER.overflowGraceMs. Being above the rim is never enough: a pile
   * rising above the wall tops stays INSIDE the wall lines, the spawned ball
   * waiting at the elevated point is untouched, and a transient splash-out
   * that falls back inside resets its own timer. Logic lives in
   * GameOverWatch (headless-testable); the scene only feeds it the outside
   * ids each frame (it owns the live wall height during Raise Walls).
   */
  private readonly overWatch = new GameOverWatch()

  private checkGameOver(deltaMs: number): void {
    if (this.gameOver) return
    const height = this.walls.height
    const outside: number[] = []
    for (const ball of this.balls.getBalls()) {
      if (!ball.touched) continue
      const c = this.balls.centroid(ball.id)
      if (c && isOutsideContainer(c, height)) outside.push(ball.id)
    }
    if (this.overWatch.observe(outside, deltaMs)) {
      this.triggerGameOver()
    }
  }

  private triggerGameOver(): void {
    this.gameOver = true
    this.inputController.setEnabled(false)
    gameBus.emit('ability:enabled', { enabled: false })
    // Phase 2.14.0: lifetime records — leaderboard entry (score + best tier
    // reached) and the persisted best score. recordRunEnd returns the new
    // all-time best so the HUD 'BEST' reflects the save.
    this.registry.set('best', recordRunEnd(this.score.score, this.bestTierRun))
    gameBus.emit('state:best', { best: this.best() })
    // GAME OVER SEQUENCE: balls realize they're doomed, panic, then pop in
    // a staggered chain. The panel springs in when the chain finishes
    // ('run:gameover' now fires from the sequence completion, not here).
    const doomed = this.balls.getBalls().filter((b) => b.state !== 'removed')
    this.gameOverSequence = this.gameOverSequence ?? new GameOverSequence(this, (id) => {
      this.balls.removeBall(id, false)
      this.ballRenderer.unregister(id)
      this.ballRenderer.emotion.forget(id)
      this.registeredIds.delete(id)
    })
    this.ballRenderer.gameOverSequence = this.gameOverSequence
    this.gameOverSequence.start(doomed, () => {
      gameBus.emit('run:gameover', { score: this.score.score, best: this.best() })
    })
  }

  private restartRun(): void {
    // Full reset (Phase 2.10.0): gameplay state, game-over state, overlay,
    // HUD ability state, walls, physics and rendering all start clean.
    this.gameOver = false
    this.overWatch.reset()
    this.inputController.setEnabled(false)
    this.swapUsed = false
    // Phase 2.13.1: the one-use Raise Walls charge is restored only on a
    // genuinely new run (restart button / 'R').
    this.raiseUsed = false
    this.balls.clearBalls()
    this.ballRenderer.clear()
    this.ballRenderer.emotion.clear()
    this.ballRenderer.gameOverSequence = null
    this.gameOverSequence = null
    this.registeredIds.clear()
    this.physicsWorld.reset()
    this.walls.reset()
    this.score.reset()
    this.mergeSystem.resetChain()
    // Phase 2.12.0: Clear new visual systems
    // The discovery modal lives in UIScene and resets on 'run:started'
    // (Phase 2.12.2); first-time-tier state is cleared here. Score popups
    // are world-scene presentation and MUST die with the run (2.12.1
    // regression: a merge landing on the restart frame left a popup up).
    this.scoreFeedback.clearAll()
    this.discoveredTiers.clear()
    this.discoveredTiers.add(1)
    this.discoveredTiers.add(2)
    this.discoveredTiers.add(3)
    // Tier 4 is NOT pre-seeded: the progression line must start locked at
    // 4 and unlock PROGRESSIVELY — merging into 4 fires its discovery
    // (card on the first run, wind card afterwards) like every other tier.
    // A new run may show the repeat-discovery banner once per tier again.
    this.runDiscoveredTiers.clear()
    // Phase 2.14.0: a new run is a NEW variant roll for tiers 8–9, and the
    // leaderboard's best-tier tracker restarts from the spawnable base.
    rollNewRunSeed()
    this.bestTierRun = 1
    this.initQueue()
    // Phase 2.13.0: background returns to the opening theme on restart
    // (Phase 2.14.0: unless the player pinned a fixed theme in SETTINGS).
    if (themeSetting() === 'auto') this.backgroundScene?.resetTheme()
    gameBus.emit('state:best', { best: this.best() })
    gameBus.emit('ability:enabled', { enabled: true })
    this.inputController.setEnabled(true)
    this.dropSuppressUntil = this.time.now + 350
    gameBus.emit('run:started', { at: Date.now() })
  }

  /** DEV-ONLY (P key / ?arrangement=1): a plausible mid-game pile. */
  private spawnArrangement(): void {
    const layout: Array<[number, number, number]> = [
      [1, 260, 1045],
      [1, 352, 1045],
      [1, 306, 965],
      [2, 360, 905],
      [2, 268, 880],
      [3, 380, 830],
      [1, 300, 780],
      [2, 420, 760],
      [3, 320, 690],
      [4, 390, 615],
    ]
    for (const [tier, x, y] of layout) {
      const ball = this.balls.spawnBall(x, y, tier)
      this.ballRenderer.register(ball)
      this.registeredIds.add(ball.id)
    }
  }
}

import { createWallBody, floorCollider } from '../systems/ContainerBodies'
