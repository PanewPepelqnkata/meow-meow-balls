import { INK_HEX, paintCrown } from './KingdomMenuArt'

const TAU = Math.PI * 2

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string, lineWidth = 1): void {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU)
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }
}

function daisPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ctx.moveTo(14, 52)
  ctx.bezierCurveTo(16, 68, 22, 81, 29, 88)
  ctx.bezierCurveTo(40, 96, 60, 96, 71, 88)
  ctx.bezierCurveTo(78, 81, 84, 68, 86, 52)
  ctx.closePath()
}

/**
 * Open Flat Royal Table (No Center Spike, Raised Podiums) in a logical 100 × 100 box.
 * The flat tabletop sits at y ≈ 46 with a wide perspective ellipse (rx ≈ 44, ry ≈ 15.5)
 * and a flush inlaid royal crest in the center so hero balls on raised podiums never clip.
 */
export function paintRoundTableBack(ctx: CanvasRenderingContext2D, uX: number, uY = uX): void {
  ctx.save()
  ctx.scale(uX, uY)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Floor ambient shadow & stepped royal stone plinth
  ellipse(ctx, 50, 91.5, 43, 5.8, 'rgba(10, 8, 19, 0.48)')
  ellipse(ctx, 50, 88.5, 37.5, 5.2, '#483f54', INK_HEX, 1.15)
  ellipse(ctx, 50, 86.8, 34.5, 4.4, '#7c6e80', '#cbb49d', 0.75)

  // Fluted stone pedestal column under the table
  daisPath(ctx)
  const stone = ctx.createLinearGradient(0, 50, 0, 92)
  stone.addColorStop(0, '#9c8d96')
  stone.addColorStop(0.24, '#6e6476')
  stone.addColorStop(0.7, '#443e51')
  stone.addColorStop(1, '#292639')
  ctx.fillStyle = stone
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 1.2
  ctx.stroke()

  ctx.save()
  daisPath(ctx)
  ctx.clip()
  for (let row = 0; row < 4; row++) {
    ctx.strokeStyle = row % 2 ? 'rgba(222, 207, 193, 0.17)' : 'rgba(21, 18, 33, 0.28)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(12, 62 + row * 6.2)
    ctx.bezierCurveTo(32, 67 + row * 5, 68, 57 + row * 7, 88, 62 + row * 5.5)
    ctx.stroke()
  }
  // Vertical carved pilasters on base
  for (const px of [30, 43, 57, 70]) {
    ctx.strokeStyle = 'rgba(17, 22, 37, 0.32)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(px, 56)
    ctx.lineTo(50 + (px - 50) * 0.78, 88)
    ctx.stroke()
  }
  ctx.restore()

  // Deep carved stone apron & heavy gold table rim
  ellipse(ctx, 50, 51.2, 46.2, 16.8, '#3f354b', INK_HEX, 1.3)
  ellipse(ctx, 50, 48.6, 45.4, 15.8, '#c69238', INK_HEX, 1.15)
  ellipse(ctx, 50, 47.2, 43.8, 14.8, '#f0ca78', '#98691e', 0.75)

  // Flat open royal tabletop surface (slate marble outer ring + crimson velvet field)
  ellipse(ctx, 50, 46.5, 41.2, 13.5, '#463957', INK_HEX, 0.9)
  ellipse(ctx, 50, 46.2, 36.8, 11.8, '#69223a', '#e2b866', 0.85)

  // Radial compass-rose gold inlay lines on the flat tabletop
  ctx.save()
  ctx.strokeStyle = 'rgba(235, 194, 107, 0.35)'
  ctx.lineWidth = 0.75
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU
    ctx.beginPath()
    ctx.moveTo(50 + Math.cos(a) * 12, 46.2 + Math.sin(a) * 3.8)
    ctx.lineTo(50 + Math.cos(a) * 35.5, 46.2 + Math.sin(a) * 11.2)
    ctx.stroke()
  }
  ctx.restore()

  // Flush center gold medallion inlay (completely flat so no spike ever blocks a ball)
  ellipse(ctx, 50, 46.0, 13.5, 4.4, '#382c48', '#e5be6d', 0.85)
  ellipse(ctx, 50, 45.9, 9.2, 3.0, '#8d243a', '#f2ce7e', 0.65)
  paintCrown(ctx, 50, 45.6, 8.8, 4.2, 0.55)

  // Front rim specular highlight
  ctx.fillStyle = 'rgba(255, 246, 196, 0.44)'
  ctx.beginPath()
  ctx.ellipse(36, 59.8, 12, 1.4, 0.12, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/** Kept as a no-op overlay so existing 2-layer callers stay clean without any occluding front lip or spire. */
export function paintRoundTableFront(ctx: CanvasRenderingContext2D, uX: number, uY = uX): void {
  ctx.save()
  ctx.scale(uX, uY)
  ctx.restore()
}
