import Phaser from 'phaser'
import { paintRoundTableBack, paintRoundTableFront } from './KingdomRoundTablePaint'
import { bakeCanvas } from './RoughArt'

export {
  paintButtonIcon,
  paintKingdomStatIcon,
  paintMiniTrophy,
  type KingdomButtonIconKind,
  type KingdomStatIconKind,
} from './KingdomIconPaint'
export { paintSignboardButton, paintStatsPlaque } from './KingdomSignboardPaint'


/** Logical 100 × 100 box for the stone-and-gold Round Table of Heroes. */
export function bakeRoundTableCarousel(
  scene: Phaser.Scene,
  w: number,
  h: number,
  u: number,
  dpr: number,
): { backImg: Phaser.GameObjects.Image; frontImg: Phaser.GameObjects.Image } {
  const backKey = 'br-round-table-back'
  const frontKey = 'br-round-table-front'
  const verticalUnit = h / 100
  bakeCanvas(scene, backKey, Math.ceil(w), Math.ceil(h), (ctx) => paintRoundTableBack(ctx, u, verticalUnit), dpr)
  bakeCanvas(scene, frontKey, Math.ceil(w), Math.ceil(h), (ctx) => paintRoundTableFront(ctx, u, verticalUnit), dpr)
  const backImg = scene.add.image(0, 0, backKey).setOrigin(0, 0).setDisplaySize(Math.ceil(w), Math.ceil(h))
  const frontImg = scene.add.image(0, 0, frontKey).setOrigin(0, 0).setDisplaySize(Math.ceil(w), Math.ceil(h))
  return { backImg, frontImg }
}
