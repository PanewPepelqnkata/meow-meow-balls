export interface AudioSettings {
  musicVolume: number
  effectsVolume: number
  musicMuted: boolean
  effectsMuted: boolean
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = {
  musicVolume: 0.72,
  effectsVolume: 0.78,
  musicMuted: false,
  effectsMuted: false,
}

export function normalizeAudioVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

/** Perceived-volume curve for a 0..1 settings slider. */
export function sliderToGain(value: number): number {
  const normalized = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return normalized * normalized
}

