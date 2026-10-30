import Matter from 'matter-js'
import { SHAKE_ABILITY } from '../../config/shakeAbility'
import { STAGE } from '../../config/stage'
import type { SoftBallManager } from './SoftBallManager'

export interface DebrisParticle {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotation: number
  vRot: number
  color: number
  alpha: number
}

export interface DustPuff {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  maxRadius: number
  alpha: number
  growRate: number
}

export interface ShakeFrameState {
  active: boolean
  cameraDx: number
  cameraDy: number
  cameraRotation: number
}

/**
 * Shake ability manager:
 * - 10-second active earthquake experience.
 * - Gentle continuous seismic screen rumble (x/y translations + slight angular tilt).
 * - Periodic bounce pulses that nudge balls into contacts and merges.
 * - Falling rubble / ceiling rock debris across the WHOLE screen (stage width).
 * - NO physical lid or side walls — the top stays completely open so dropping
 *   balls during the ability does not glitch or teleport.
 */
export class ShakeManager {
  private active = false
  private startTime = 0
  private readonly durationMs = SHAKE_ABILITY.durationMs
  private clock: (() => number) | null = null
  private manager: SoftBallManager | null = null
  private lastRoundIndex = -1

  // Pooled particle systems for earthquake visual effects
  private debrisPool: DebrisParticle[] = []
  private dustPool: DustPuff[] = []
  private nextDebrisSpawnMs = 0
  private nextDustSpawnMs = 0

  constructor() {
    for (let i = 0; i < SHAKE_ABILITY.maxDebrisParticles; i++) {
      this.debrisPool.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 6,
        rotation: 0,
        vRot: 0,
        color: 0x5a504b,
        alpha: 1,
      })
    }
    for (let i = 0; i < SHAKE_ABILITY.maxDustPuffs; i++) {
      this.dustPool.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 4,
        maxRadius: 20,
        alpha: 0.8,
        growRate: 0.3,
      })
    }
  }

  setClock(fn: () => number): void {
    this.clock = fn
  }

  private now(): number {
    return this.clock ? this.clock() : performance.now()
  }

  bind(
    _physicsWorld: { addBody: (b: Matter.Body) => void; removeBody: (b: Matter.Body) => void },
    manager: SoftBallManager | null = null,
  ): void {
    this.manager = manager
  }

  get isActive(): boolean {
    return this.active
  }

  get remainingMs(): number {
    if (!this.active) return 0
    return Math.max(0, this.durationMs - (this.now() - this.startTime))
  }

  getDebris(): readonly DebrisParticle[] {
    return this.debrisPool
  }

  getDustPuffs(): readonly DustPuff[] {
    return this.dustPool
  }

  /**
   * Activate the earthquake shake ability for 10 seconds.
   * No physical lid or side walls — the top stays completely open so dropping
   * balls during the ability does not glitch or teleport.
   */
  activate(): boolean {
    if (this.active) return false
    this.active = true
    this.startTime = this.now()
    this.lastRoundIndex = -1
    this.nextDebrisSpawnMs = 0
    this.nextDustSpawnMs = 0

    // Immediately spawn an initial burst of debris and smoke puffs
    for (let i = 0; i < 6; i++) this.spawnDebris()
    for (let i = 0; i < 5; i++) this.spawnDust()

    this.triggerBounceRound(0)

    return true
  }


  private triggerBounceRound(roundIndex: number): void {
    this.lastRoundIndex = roundIndex
    if (!this.manager) return

    const balls = this.manager.getBalls()
    for (const b of balls) {
      if (b.state === 'removed') continue
      this.manager.wakeBall(b.id)

      // Random lateral variation per ball so balls mix and bounce off each other
      const lateralJitter = (Math.random() - 0.5) * 2 * SHAKE_ABILITY.bounceJitterX
      const upwardImpulse = SHAKE_ABILITY.bounceVelocityY * (0.85 + Math.random() * 0.3)

      for (const p of b.soft.particles) {
        Matter.Body.setVelocity(p, {
          x: p.velocity.x * 0.5 + lateralJitter,
          y: Math.min(p.velocity.y, upwardImpulse),
        })
      }
    }
  }

  private spawnDebris(): void {
    const p = this.debrisPool.find((d) => !d.active)
    if (!p) return

    // Debris falls across the WHOLE screen (stage width), not just above the container
    p.active = true
    p.x = Math.random() * STAGE.width
    p.y = -20 - Math.random() * 60
    p.vx = (Math.random() - 0.5) * 2.5
    p.vy = 2.0 + Math.random() * 3.5
    p.size = 4 + Math.random() * 7
    p.rotation = Math.random() * Math.PI * 2
    p.vRot = (Math.random() - 0.5) * 0.15
    // Rock / rubble tones: grey, brown, slate
    const colors = [0x504842, 0x6e625a, 0x3d3632, 0x7c7066]
    p.color = colors[Math.floor(Math.random() * colors.length)] ?? 0x504842
    p.alpha = 0.95
  }

  private spawnDust(): void {
    const d = this.dustPool.find((p) => !p.active)
    if (!d) return

    // Dust puffs spawn across the whole screen edges and floor area
    const side = Math.random()
    if (side < 0.3) {
      // Left edge of screen
      d.x = Math.random() * 80
      d.y = 200 + Math.random() * 800
      d.vx = 0.5 + Math.random() * 1.0
    } else if (side < 0.6) {
      // Right edge of screen
      d.x = STAGE.width - 80 + Math.random() * 80
      d.y = 200 + Math.random() * 800
      d.vx = -(0.5 + Math.random() * 1.0)
    } else if (side < 0.8) {
      // Top edge
      d.x = Math.random() * STAGE.width
      d.y = 100 + Math.random() * 100
      d.vx = (Math.random() - 0.5) * 1.5
    } else {
      // Floor area
      d.x = Math.random() * STAGE.width
      d.y = 1000 + Math.random() * 100
      d.vx = (Math.random() - 0.5) * 1.5
    }

    d.active = true
    d.vy = -(0.5 + Math.random() * 1.2)
    d.radius = 4 + Math.random() * 4
    d.maxRadius = 14 + Math.random() * 12
    d.alpha = 0.65 + Math.random() * 0.2
    d.growRate = 0.4 + Math.random() * 0.4
  }

  private updateParticles(deltaMs: number): void {
    // Debris falls until it goes below the screen
    for (const d of this.debrisPool) {
      if (!d.active) continue
      d.x += d.vx
      d.y += d.vy
      d.vy += 0.15 // Gravity on debris
      d.rotation += d.vRot
      if (d.y > STAGE.height + 20) {
        d.active = false
      }
    }

    for (const p of this.dustPool) {
      if (!p.active) continue
      p.x += p.vx
      p.y += p.vy
      p.radius += p.growRate
      p.alpha -= deltaMs * 0.001 * 0.75
      if (p.alpha <= 0 || p.radius >= p.maxRadius) {
        p.active = false
      }
    }
  }

  /**
   * Per-frame update during gameplay loop.
   * Computes gentle seismic camera rumble and updates particles.
   */
  update(nowMs?: number, deltaMs = 16.6): ShakeFrameState {
    if (!this.active) {
      return { active: false, cameraDx: 0, cameraDy: 0, cameraRotation: 0 }
    }

    const t = nowMs !== undefined ? nowMs : this.now()
    const elapsed = t - this.startTime

    if (elapsed >= this.durationMs) {
      this.reset()
      return { active: false, cameraDx: 0, cameraDy: 0, cameraRotation: 0 }
    }

    // Seismic pulses
    const roundIndex = Math.floor(elapsed / SHAKE_ABILITY.cyclePeriodMs)
    const timeInRound = elapsed % SHAKE_ABILITY.cyclePeriodMs

    if (roundIndex > this.lastRoundIndex && timeInRound < SHAKE_ABILITY.pulseDurationMs) {
      this.triggerBounceRound(roundIndex)
    }

    // Gentle seismic rumble (slow pseudo-noise multi-sine)
    const decay = Math.min(1, Math.max(0.7, (this.durationMs - elapsed) / 1000))
    const s1 = Math.sin(elapsed * 0.028)
    const s2 = Math.cos(elapsed * 0.051)
    const s3 = Math.sin(elapsed * 0.083)
    const s4 = Math.cos(elapsed * 0.119)

    const cameraDx = (s1 * 0.6 + s3 * 0.4) * SHAKE_ABILITY.rumbleIntensity * decay
    const cameraDy = (s2 * 0.5 + s4 * 0.5) * SHAKE_ABILITY.rumbleIntensity * decay
    const cameraRotation = Math.sin(elapsed * 0.035) * SHAKE_ABILITY.rumbleRotation * decay

    // Spawn falling debris and cartoon dust puffs frequently
    if (elapsed > this.nextDebrisSpawnMs) {
      this.spawnDebris()
      this.nextDebrisSpawnMs = elapsed + 60 + Math.random() * 80
    }
    if (elapsed > this.nextDustSpawnMs) {
      this.spawnDust()
      this.nextDustSpawnMs = elapsed + 45 + Math.random() * 60
    }

    this.updateParticles(deltaMs)

    return { active: true, cameraDx, cameraDy, cameraRotation }
  }

  /**
   * Reset ability (new run or cleanup).
   */
  reset(): void {
    this.active = false
    this.startTime = 0
    this.lastRoundIndex = -1
    for (const d of this.debrisPool) d.active = false
    for (const p of this.dustPool) p.active = false
  }
}
