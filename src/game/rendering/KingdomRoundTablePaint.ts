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

/**
 * Luxury Single-Pedestal Round Table in a logical 100 × 100 box.
 * Features a massive turned marble-and-gold central pillar that splits at the bottom
 * into four sweeping royal cabriole legs with gilded lion-paw feet.
 */
export function paintRoundTableBack(ctx: CanvasRenderingContext2D, uX: number, uY = uX): void {
  ctx.save()
  ctx.scale(uX, uY)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Wide ambient floor shadow & gilded compass floor plinth
  ellipse(ctx, 50, 92.2, 41, 6.2, 'rgba(10, 8, 19, 0.52)')
  ellipse(ctx, 50, 90.2, 31.5, 4.5, '#3b3248', INK_HEX, 1.15)
  ellipse(ctx, 50, 89.2, 27.5, 3.6, '#695c73', '#d6ad60', 0.8)

  // Back pair of sweeping cabriole legs (drawn behind the central pedestal)
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(50 + side * 6.5, 72)
    ctx.bezierCurveTo(50 + side * 15, 73, 50 + side * 23, 78, 50 + side * 27.5, 84.5)
    ctx.lineTo(50 + side * 23.5, 86.5)
    ctx.bezierCurveTo(50 + side * 18, 81.5, 50 + side * 12, 78.5, 50 + side * 5, 78)
    ctx.closePath()
    ctx.fillStyle = '#4e445c'
    ctx.fill()
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 1.1
    ctx.stroke()
    // Gilded scroll foot at tip
    ellipse(ctx, 50 + side * 26.2, 85.8, 3.4, 1.8, '#c89638', INK_HEX, 1)
    ctx.restore()
  }

  // Single massive central turned pedestal column in the middle
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(41.5, 53)
  ctx.bezierCurveTo(43.5, 58, 44.5, 62, 40.5, 67.5)
  ctx.bezierCurveTo(37.5, 71.5, 39.5, 76.5, 42.5, 80.5)
  ctx.lineTo(57.5, 80.5)
  ctx.bezierCurveTo(60.5, 76.5, 62.5, 71.5, 59.5, 67.5)
  ctx.bezierCurveTo(55.5, 62, 56.5, 58, 58.5, 53)
  ctx.closePath()
  const colGrad = ctx.createLinearGradient(38, 53, 62, 82)
  colGrad.addColorStop(0, '#9e8f9b')
  colGrad.addColorStop(0.32, '#75687d')
  colGrad.addColorStop(0.7, '#483f54')
  colGrad.addColorStop(1, '#2a2538')
  ctx.fillStyle = colGrad
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 1.25
  ctx.stroke()

  // Vertical fluted ribs on the central bulbous urn shaft
  for (const dx of [-5.5, -2, 2, 5.5]) {
    ctx.strokeStyle = dx < 0 ? 'rgba(238, 224, 210, 0.22)' : 'rgba(17, 22, 37, 0.34)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(50 + dx * 0.85, 55)
    ctx.quadraticCurveTo(50 + dx * 1.35, 68, 50 + dx * 0.9, 79)
    ctx.stroke()
  }
  ctx.restore()

  // Heavy gold torus collars wrapping the central pedestal waist and base
  ellipse(ctx, 50, 56.2, 10.2, 2.5, '#d8a648', INK_HEX, 1.05)
  ellipse(ctx, 50, 68.2, 11.4, 2.8, '#e8bc62', INK_HEX, 1.1)
  ellipse(ctx, 50, 79.8, 10.6, 2.7, '#c89232', INK_HEX, 1.1)

  // Front pair of sweeping luxury cabriole legs splitting out from the central column
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(50 + side * 4.5, 76.5)
    ctx.bezierCurveTo(50 + side * 14, 77.5, 50 + side * 24, 82, 50 + side * 32.5, 89.2)
    ctx.lineTo(50 + side * 26.5, 91.5)
    ctx.bezierCurveTo(50 + side * 19.5, 86.2, 50 + side * 11.5, 82.8, 50 + side * 3.5, 82)
    ctx.closePath()
    const legGrad = ctx.createLinearGradient(50, 76, 50 + side * 33, 91)
    legGrad.addColorStop(0, '#8d7e8d')
    legGrad.addColorStop(0.55, '#5e5268')
    legGrad.addColorStop(1, '#373044')
    ctx.fillStyle = legGrad
    ctx.fill()
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 1.2
    ctx.stroke()

    // Gold acanthus leaf carving along the top knee of each split leg
    ctx.strokeStyle = '#e8bc62'
    ctx.lineWidth = 1.1
    ctx.beginPath()
    ctx.moveTo(50 + side * 6.5, 77.5)
    ctx.quadraticCurveTo(50 + side * 17, 79.2, 50 + side * 25.5, 85.8)
    ctx.stroke()

    // Gilded lion-paw / scroll foot at the bottom of each split leg
    ellipse(ctx, 50 + side * 30.2, 90.4, 4.4, 2.2, '#e2b456', INK_HEX, 1.15)
    ellipse(ctx, 50 + side * 30.2, 90.0, 2.8, 1.2, '#fff1b0')
    ctx.restore()
  }

  // Central gold finial boss where the four legs split from the pillar
  ellipse(ctx, 50, 81.2, 7.2, 2.6, '#d8a648', INK_HEX, 1.1)

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
