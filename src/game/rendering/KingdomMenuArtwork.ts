import type Phaser from 'phaser'
import type { KingdomMenuArtwork } from '../../react/kingdomMenuBridge'
import type { KingdomMenuLayout } from '../../ui/KingdomMenuLayout'
import { paintKingdomStatIcon, paintSignboardButton, paintStatsPlaque } from './KingdomWidgetsArt'

const artworkCache = new WeakMap<Phaser.Game, { signature: string; artwork: KingdomMenuArtwork }>()

/** Export the same authored widget painters once per layout, never on a React frame. */
export function bakeKingdomMenuArtwork(scene: Phaser.Scene, layout: KingdomMenuLayout, dpr: number): KingdomMenuArtwork {
  const signature = `v5:throne-medallion-flat-table:${dpr}:${layout.stats.w}:${layout.stats.h}:${layout.carousel.w}:${layout.carousel.h}:${layout.buttons.map((button) => `${button.action}/${button.w}/${button.h}/${button.compact}`).join(':')}`
  const cached = artworkCache.get(scene.game)
  if (cached?.signature === signature) return cached.artwork
  // Native images do not need duplicate GPU textures in Phaser's texture manager.
  const canvas = document.createElement('canvas')
  const rasterize = (width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): string => {
    canvas.width = Math.ceil(width * dpr)
    canvas.height = Math.ceil(height * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    paint(ctx)
    return canvas.toDataURL()
  }
  const artwork: KingdomMenuArtwork = {
    stats: rasterize(layout.stats.w, layout.stats.h, (ctx) => paintStatsPlaque(ctx, layout.stats.w, layout.stats.h)),
    buttons: {},
    icons: { best: '', collection: '', coins: '' },
  }
  for (const button of layout.buttons) {
    artwork.buttons[button.action] = rasterize(button.w + 16, button.h + 16, (ctx) => {
      paintSignboardButton(ctx, button.w, button.h, button.action === 'account' ? 'login' : button.action, button.action === 'play', button.compact, '', true)
    })
  }
  for (const kind of ['best', 'collection', 'coins'] as const) {
    artwork.icons[kind] = rasterize(48, 48, (ctx) => paintKingdomStatIcon(ctx, kind, 24, 24, 18.5))
  }
  canvas.width = 1
  canvas.height = 1
  artworkCache.set(scene.game, { signature, artwork })
  return artwork
}
