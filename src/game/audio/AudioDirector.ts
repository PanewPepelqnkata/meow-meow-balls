import { DEFAULT_AUDIO_SETTINGS, sliderToGain, type AudioSettings } from './AudioSettings'
import { gameBus } from '../events/gameBus'
type SoundName = 'hover' | 'click' | 'drop' | 'merge' | 'ability' | 'pause' | 'resume' | 'gameover' | 'toggle'

const MELODY = [0, 3, 5, 7, 10, 7, 5, 3, -2, 0, 3, 5, 7, 5, 3, 0] as const
const BASS = [0, 0, -5, -5, -3, -3, -7, -7] as const
const ROOT_HZ = 130.81
export class AudioDirector {
  private static instance: AudioDirector | null = null
  private context: AudioContext | null = null
  private musicBus: GainNode | null = null
  private effectsBus: GainNode | null = null
  private musicTimer: number | null = null
  private musicStep = 0
  private unlocked = false
  private musicRequested = false
  private lastHoverAt = -Infinity
  private readonly offs: Array<() => void> = []
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS }
  private initialized = false
  private static installedGames = new WeakSet<Phaser.Game>()

  private constructor() {}

  static get(): AudioDirector {
    return (this.instance ??= new AudioDirector())
  }

  static uiHover(): void { AudioDirector.instance?.hover() }
  static uiClick(): void { AudioDirector.instance?.click() }
  static uiToggle(): void { AudioDirector.instance?.toggle() }
  static install(game: Phaser.Game, initialSettings: AudioSettings): AudioDirector {
    const director = this.get()
    if (this.installedGames.has(game)) {
      director.applySettings(initialSettings)
      return director
    }
    this.installedGames.add(game)
    if (!director.initialized) {
      director.initialized = true
      director.offs.push(
        gameBus.on('audio:settings', (next) => director.applySettings(next)),
        gameBus.on('fx:landing', ({ tier, impact }) => director.play('drop', Math.min(1, 0.32 + impact * 0.18 + tier * 0.025))),
        gameBus.on('fx:merge', ({ tier, chainDepth }) => director.play('merge', Math.min(1, 0.6 + tier * 0.035 + chainDepth * 0.05))),
        gameBus.on('ability:swapUsed', () => director.play('ability', 0.75)),
        gameBus.on('ability:raiseUsed', () => director.play('ability', 0.9)),
        gameBus.on('ability:shakeUsed', () => director.play('ability', 0.85)),
        gameBus.on('ui:pause', () => director.play('pause', 0.75)),
        gameBus.on('ui:resume', () => director.play('resume', 0.72)),
        gameBus.on('ui:start', () => director.startMusic()),
        gameBus.on('run:started', () => director.startMusic()),
        gameBus.on('run:gameover', () => director.play('gameover', 0.9)),
      )
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', director.onVisibilityChange)
        director.offs.push(() => document.removeEventListener('visibilitychange', director.onVisibilityChange))
      }
    }
    director.applySettings(initialSettings)
    const unlock = (): void => director.unlock()
    const destroy = (): void => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      game.events.off(Phaser.Core.Events.DESTROY, destroy)
      director.destroy()
    }
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('keydown', unlock)
    game.events.once(Phaser.Core.Events.DESTROY, destroy)
    return director
  }


  private onVisibilityChange = (): void => {
    if (document.hidden) this.context?.suspend().catch(() => undefined)
    else if (this.unlocked) this.context?.resume().catch(() => undefined)
  }

  /** Called only after a real user gesture, satisfying browser audio policies. */
  unlock(): void {
    if (this.unlocked) {
      if (this.context?.state === 'suspended') void this.context.resume().catch(() => undefined)
      return
    }
    const AudioContextConstructor = globalThis.AudioContext
    if (!AudioContextConstructor) return
    try {
      const context = new AudioContextConstructor()
      this.context = context
      this.musicBus = context.createGain()
      this.effectsBus = context.createGain()
      this.musicBus.connect(context.destination)
      this.effectsBus.connect(context.destination)
      this.unlocked = true
      this.applySettings(this.settings)
      void context.resume().then(() => {
        if (this.musicRequested) this.scheduleMusic()
      }).catch(() => undefined)
    } catch {
      // Unsupported/blocked audio degrades silently; gameplay stays unaffected.
    }
  }

  private applySettings(settings: AudioSettings): void {
    this.settings = { ...settings }
    if (!this.unlocked || !this.context || !this.musicBus || !this.effectsBus) return
    const now = this.context.currentTime
    const musicGain = settings.musicMuted ? 0 : sliderToGain(settings.musicVolume) * 0.012
    const effectsGain = settings.effectsMuted ? 0 : sliderToGain(settings.effectsVolume) * 0.06
    this.musicBus.gain.cancelScheduledValues(now)
    this.effectsBus.gain.cancelScheduledValues(now)
    this.musicBus.gain.setTargetAtTime(musicGain, now, 0.035)
    this.effectsBus.gain.setTargetAtTime(effectsGain, now, 0.012)
    if (settings.musicMuted || settings.musicVolume === 0) this.stopMusic()
    else if (this.musicRequested && this.musicTimer === null && this.context.state === 'running') this.scheduleMusic()
  }

  /** Theme-like tooltip tick. One shared debounce prevents pointer noise. */
  hover(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - this.lastHoverAt < 55) return
    this.lastHoverAt = now
    this.play('hover', 0.45)
  }

  click(): void { this.play('click', 0.7) }
  toggle(): void { this.play('toggle', 0.72) }

  private play(name: SoundName, amount: number): void {
    if (!this.unlocked || !this.context || this.context.state !== 'running' || this.settings.effectsMuted || this.settings.effectsVolume <= 0) return
    const ctx = this.context
    const t = ctx.currentTime
    const out = this.effectsBus
    if (!out) return
    const tone = (frequency: number, duration: number, wave: OscillatorType, gain: number, endFrequency = frequency): void => {
      const osc = ctx.createOscillator()
      const envelope = ctx.createGain()
      osc.type = wave
      osc.frequency.setValueAtTime(Math.max(24, frequency), t)
      osc.frequency.exponentialRampToValueAtTime(Math.max(24, endFrequency), t + duration)
      envelope.gain.setValueAtTime(0.0001, t)
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * amount * 0.14), t + Math.min(0.012, duration * 0.25))
      envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration)
      osc.connect(envelope)
      envelope.connect(out)
      osc.start(t)
      osc.stop(t + duration + 0.015)
    }
    const noise = (duration: number, gain: number): void => {
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
      const source = ctx.createBufferSource()
      const filter = ctx.createBiquadFilter()
      const envelope = ctx.createGain()
      source.buffer = buffer
      filter.type = 'lowpass'
      filter.frequency.value = 1500
      envelope.gain.setValueAtTime(gain * amount * 0.12, t)
      envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration)
      source.connect(filter)
      filter.connect(envelope)
      envelope.connect(out)
      source.start(t)
      source.stop(t + duration)
    }
    switch (name) {
      case 'hover': tone(610, 0.065, 'sine', 0.014, 760); break
      case 'click': tone(360, 0.085, 'sine', 0.025, 285); break
      case 'toggle': tone(420, 0.11, 'sine', 0.022, 540); break
      // Soft elastic jelly landing: a low rounded thump, viscous squelch and bubble.
      case 'drop': noise(0.075, 0.08); tone(116, 0.2, 'sine', 0.12, 68); tone(245, 0.14, 'triangle', 0.035, 118); break
      // A warm ascending reward flourish after the jelly impact, not a bright chime.
      case 'merge': tone(196, 0.12, 'sine', 0.06, 246); tone(246, 0.14, 'sine', 0.055, 293); tone(293, 0.2, 'triangle', 0.05, 392); break
      case 'ability': tone(174, 0.24, 'sine', 0.04, 261); tone(261, 0.26, 'triangle', 0.035, 349); break
      case 'pause': tone(330, 0.16, 'sine', 0.035, 262); tone(262, 0.18, 'sine', 0.03, 220); break
      case 'resume': tone(220, 0.15, 'sine', 0.03, 262); tone(262, 0.2, 'triangle', 0.035, 330); break
      case 'gameover': noise(0.18, 0.035); tone(174, 0.35, 'sine', 0.055, 87); tone(131, 0.45, 'sine', 0.025, 98); break
    }
  }

  startMusic(): void {
    this.musicRequested = true
    if (!this.unlocked) return
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => undefined)
    if (!this.settings.musicMuted && this.settings.musicVolume > 0 && this.musicTimer === null) this.scheduleMusic()
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer)
      this.musicTimer = null
    }
  }

  private scheduleMusic(): void {
    const ctx = this.context
    const out = this.musicBus
    if (!ctx || !out || ctx.state !== 'running' || this.settings.musicMuted || this.settings.musicVolume <= 0) return
    this.musicTimer = null
    const now = ctx.currentTime
    const beat = 60 / 84
    const stepDuration = beat / 2
    const step = this.musicStep++
    const slot = step % 16
    const chord = Math.floor(slot / 4)
    const melodyNote = MELODY[slot]!
    const bassNote = BASS[slot % BASS.length]!
    const chordOffsets = chord % 4 === 0 ? [0, 7, 12] : chord % 4 === 1 ? [3, 10, 15] : chord % 4 === 2 ? [5, 12, 17] : [-2, 5, 10]
    const isBarStart = slot % 4 === 0
    const playTone = (frequency: number, duration: number, wave: OscillatorType, volume: number): void => {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.type = wave
      osc.frequency.setValueAtTime(frequency, now)
      env.gain.setValueAtTime(0.0001, now)
      env.gain.exponentialRampToValueAtTime(volume, now + 0.06)
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration)
      osc.connect(env)
      env.connect(out)
      osc.start(now)
      osc.stop(now + duration + 0.02)
    }
    const hz = (semitones: number): number => ROOT_HZ * Math.pow(2, semitones / 12)
    if (isBarStart) {
      for (const offset of chordOffsets) playTone(hz(offset - 12), beat * 1.8, 'sine', 0.008)
      playTone(hz(bassNote - 12), beat * 1.45, 'triangle', 0.025)
    } else if (slot % 2 === 0) {
      playTone(hz(bassNote - 12), beat * 0.92, 'triangle', 0.016)
    }
    if (slot % 2 === 0 || slot === 7 || slot === 15) {
      playTone(hz(melodyNote), beat * (slot % 4 === 0 ? 0.78 : 0.42), 'sine', 0.012)
    }
    if (slot % 4 === 2) {
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.055), ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
      const source = ctx.createBufferSource()
      const filter = ctx.createBiquadFilter()
      const env = ctx.createGain()
      source.buffer = buffer
      filter.type = 'lowpass'
      filter.frequency.value = 900
      env.gain.setValueAtTime(0.016, now)
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.055)
      source.connect(filter)
      filter.connect(env)
      env.connect(out)
      source.start(now)
      source.stop(now + 0.06)
    }
    this.musicTimer = window.setTimeout(() => this.scheduleMusic(), stepDuration * 1000)
  }

  destroy(): void {
    this.stopMusic()
    for (const off of this.offs.splice(0)) off()
    void this.context?.close().catch(() => undefined)
    this.context = null
    this.musicBus = null
    this.effectsBus = null
    this.unlocked = false
    AudioDirector.instance = null
  }
}
