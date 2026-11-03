export interface ChampionColumn {
  x: number
  y: number
  w: number
  h: number
  rank: number
  visualCX: number
}

const INK = '#171613'
const MARBLE = '#f4ecd9'
const MARBLE_LIGHT = '#fff9e9'
const MARBLE_SHADE = '#ddd0b3'
const MARBLE_DARK = '#c6b797'
const GOLD = '#d9a83f'
const GOLD_DARK = '#9e6c21'

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w * 0.5, h * 0.5)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawPlinth(
  ctx: CanvasRenderingContext2D,
  w: number,
  plinthY: number,
  plinthH: number,
  outline: number,
): void {
  if (plinthH <= 0 || w <= 0) return

  const xPad = Math.min(w * 0.035, 18)
  const topH = Math.min(plinthH * 0.3, Math.max(outline * 3, 12))
  const faceTop = plinthY + topH * 0.62
  const faceBottom = plinthY + plinthH * 0.82
  const faceH = Math.max(0, faceBottom - faceTop)
  const radius = Math.min(outline * 2.2, plinthH * 0.12)

  roundedRect(ctx, xPad, plinthY + topH * 0.18, w - xPad * 2, topH, radius)
  ctx.fillStyle = MARBLE_LIGHT
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  roundedRect(ctx, xPad * 1.35, plinthY + topH * 0.56, w - xPad * 2.7, plinthH * 0.34, radius * 0.72)
  ctx.fillStyle = MARBLE_SHADE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  if (faceH > outline * 2.5) {
    roundedRect(ctx, xPad * 1.7, faceTop, w - xPad * 3.4, faceH, radius * 0.45)
    ctx.fillStyle = '#eee2c8'
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = outline * 0.78
    ctx.stroke()

    const keyH = Math.min(faceH * 0.62, Math.max(0, plinthH * 0.25))
    if (keyH >= 6) {
      const tile = Math.max(10, Math.min(20, keyH * 1.55))
      const keyY = faceTop + (faceH - keyH) * 0.5
      ctx.strokeStyle = GOLD_DARK
      ctx.lineWidth = Math.max(1, outline * 0.66)
      ctx.lineCap = 'square'
      for (let px = xPad * 2.15; px + tile < w - xPad * 2.15; px += tile) {
        ctx.beginPath()
        ctx.moveTo(px, keyY)
        ctx.lineTo(px + tile * 0.72, keyY)
        ctx.lineTo(px + tile * 0.72, keyY + keyH)
        ctx.lineTo(px + tile * 0.25, keyY + keyH)
        ctx.lineTo(px + tile * 0.25, keyY + keyH * 0.36)
        ctx.lineTo(px + tile * 0.49, keyY + keyH * 0.36)
        ctx.lineTo(px + tile * 0.49, keyY + keyH * 0.68)
        ctx.stroke()
      }
      ctx.lineCap = 'round'
    }
  }

  const footY = plinthY + plinthH * 0.83
  const footH = Math.max(outline * 2, plinthH * 0.17)
  roundedRect(ctx, xPad * 0.7, footY, w - xPad * 1.4, Math.min(footH, plinthY + plinthH - footY), radius)
  ctx.fillStyle = MARBLE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(xPad * 1.45, plinthY + topH * 0.72)
  ctx.lineTo(w - xPad * 1.45, plinthY + topH * 0.72)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = Math.max(1, outline * 0.65)
  ctx.stroke()
}

function drawShaft(
  ctx: CanvasRenderingContext2D,
  column: ChampionColumn,
  deckH: number,
  outline: number,
): void {
  const cx = column.x + column.w * 0.5
  const baseH = Math.min(column.h * 0.2, Math.max(8, deckH * 0.3))
  const baseY = column.y + column.h - baseH
  const topY = Math.min(column.y + deckH * 0.84, baseY)
  const shaftH = Math.max(0, baseY - topY)
  const topHalf = column.w * 0.275
  const bottomHalf = column.w * 0.345

  if (shaftH > 0) {
    ctx.beginPath()
    ctx.moveTo(cx - topHalf, topY)
    ctx.lineTo(cx + topHalf, topY)
    ctx.lineTo(cx + bottomHalf, baseY)
    ctx.lineTo(cx - bottomHalf, baseY)
    ctx.closePath()
    ctx.fillStyle = MARBLE
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = outline
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(cx + topHalf * 0.52, topY + outline * 0.55)
    ctx.lineTo(cx + bottomHalf * 0.62, baseY - outline * 0.8)
    ctx.lineTo(cx + bottomHalf * 0.91, baseY - outline * 0.8)
    ctx.lineTo(cx + topHalf * 0.92, topY + outline * 0.55)
    ctx.closePath()
    ctx.fillStyle = '#e4d8bf'
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(cx - topHalf * 0.72, topY + outline)
    ctx.lineTo(cx - bottomHalf * 0.78, baseY - outline)
    ctx.moveTo(cx + topHalf * 0.08, topY + outline)
    ctx.lineTo(cx + bottomHalf * 0.09, baseY - outline)
    ctx.strokeStyle = MARBLE_LIGHT
    ctx.lineWidth = Math.max(1.2, column.w * 0.035)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(cx - topHalf * 0.92, topY + shaftH * 0.42)
    ctx.quadraticCurveTo(cx - topHalf * 0.68, topY + shaftH * 0.48, cx - topHalf * 0.78, topY + shaftH * 0.54)
    ctx.strokeStyle = MARBLE_DARK
    ctx.lineWidth = Math.max(0.8, outline * 0.42)
    ctx.stroke()
  }

  const baseW = column.w * 0.86
  const baseX = cx - baseW * 0.5
  const stepH = Math.max(3, baseH * 0.43)
  roundedRect(ctx, cx - column.w * 0.39, baseY, column.w * 0.78, stepH, outline * 0.7)
  ctx.fillStyle = MARBLE_LIGHT
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  roundedRect(ctx, baseX, baseY + stepH * 0.58, baseW, Math.max(2, column.y + column.h - (baseY + stepH * 0.58)), outline * 0.8)
  ctx.fillStyle = MARBLE_SHADE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(baseX + outline, baseY + stepH * 0.72)
  ctx.lineTo(baseX + baseW - outline, baseY + stepH * 0.72)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = Math.max(1, outline * 0.62)
  ctx.stroke()


}
function drawCapital(
  ctx: CanvasRenderingContext2D,
  column: ChampionColumn,
  deckH: number,
  outline: number,
): void {
  const { x, y, w } = column
  const layerH = Math.max(2, deckH * 0.2)
  const faceY = y + deckH * 0.39
  const faceH = deckH * 0.61
  const radius = Math.min(outline * 2, deckH * 0.14)

  roundedRect(ctx, x + w * 0.1, faceY, w * 0.8, faceH, radius)
  ctx.fillStyle = MARBLE_SHADE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  roundedRect(ctx, x + w * 0.045, y + deckH * 0.31, w * 0.91, layerH, radius)
  ctx.fillStyle = MARBLE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  roundedRect(ctx, x, y + deckH * 0.16, w, layerH, radius)
  ctx.fillStyle = MARBLE_LIGHT
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x + w * 0.14, y + deckH * 0.77)
  ctx.lineTo(x + w * 0.86, y + deckH * 0.77)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = Math.max(1, outline * 0.72)
  ctx.stroke()

  ctx.beginPath()
  ctx.ellipse(column.visualCX, y + deckH * 0.58, w * 0.35, Math.max(2, deckH * 0.105), 0, 0, Math.PI * 2)
  ctx.fillStyle = '#fffaf0'
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = Math.max(1.5, outline * 0.82)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(column.visualCX, y + deckH * 0.58, w * 0.27, Math.max(1, deckH * 0.05), 0, Math.PI * 1.06, Math.PI * 1.94)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = Math.max(1, outline * 0.6)
  ctx.stroke()
}

function drawLeaf(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  breadth: number,
  fill: string,
  outline: number,
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.max(0.001, Math.hypot(dx, dy))
  const px = -dy / length * breadth
  const py = dx / length * breadth
  const mx = (x1 + x2) * 0.5
  const my = (y1 + y2) * 0.5

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.quadraticCurveTo(mx + px, my + py, x2, y2)
  ctx.quadraticCurveTo(mx - px, my - py, x1, y1)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()
}

function drawMedal(
  ctx: CanvasRenderingContext2D,
  column: ChampionColumn,
  deckH: number,
  outline: number,
): void {
  const { w, h, rank, visualCX: cx } = column
  const radius = Math.max(12, Math.min(24, Math.round(Math.min(w * 0.17, h * 0.155))))
  const cy = column.y + deckH + radius + Math.max(5, Math.round(h * 0.045))
  const medalFill = rank === 2 ? '#d9e0e1' : rank === 3 ? '#cf8954' : '#f0bf4d'
  const medalEdge = rank === 2 ? '#73828a' : rank === 3 ? '#8f4d2b' : '#a96f1e'
  const laurel = rank === 2 ? '#bdc9cc' : rank === 3 ? '#bd7544' : '#e5ad37'
  const leafOutline = Math.max(0.8, outline * 0.47)

  ctx.strokeStyle = medalEdge
  ctx.lineWidth = Math.max(1.4, outline * 0.77)
  ctx.beginPath()
  ctx.moveTo(cx - radius * 1.12, cy + radius * 0.78)
  ctx.bezierCurveTo(cx - radius * 1.48, cy + radius * 0.33, cx - radius * 1.4, cy - radius * 0.31, cx - radius * 1.13, cy - radius * 0.78)
  ctx.moveTo(cx + radius * 1.12, cy + radius * 0.78)
  ctx.bezierCurveTo(cx + radius * 1.48, cy + radius * 0.33, cx + radius * 1.4, cy - radius * 0.31, cx + radius * 1.13, cy - radius * 0.78)
  ctx.stroke()

  for (let i = 0; i < 4; i += 1) {
    const t = (i + 1) / 5
    const leafY = cy + radius * (0.64 - t * 1.25)
    const leafX = radius * (1.19 + Math.sin(t * Math.PI) * 0.12)
    const tipY = leafY - radius * 0.2
    drawLeaf(ctx, cx - leafX, leafY, cx - leafX - radius * 0.42, tipY, radius * 0.17, laurel, leafOutline)
    drawLeaf(ctx, cx + leafX, leafY, cx + leafX + radius * 0.42, tipY, radius * 0.17, laurel, leafOutline)
  }

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = medalFill
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.77, 0, Math.PI * 2)
  ctx.strokeStyle = medalEdge
  ctx.lineWidth = Math.max(1, outline * 0.58)
  ctx.stroke()
}

function drawPlaque(
  ctx: CanvasRenderingContext2D,
  column: ChampionColumn,
  plinthY: number,
  deckH: number,
  outline: number,
): void {
  const { y, h, w, visualCX } = column
  const radius = Math.max(12, Math.min(24, Math.round(Math.min(w * 0.17, h * 0.155))))
  const medalCenterY = y + deckH + radius + Math.max(5, Math.round(h * 0.045))
  const plateY = medalCenterY + radius + Math.max(5, Math.round(h * 0.035))
  const plateBottom = Math.min(plinthY - Math.max(4, outline), y + h - Math.max(7, h * 0.055))
  const plateH = Math.min(h * 0.18, plateBottom - plateY)
  if (plateH <= 0) return

  const plateW = w * 0.78
  const plateX = visualCX - plateW * 0.5
  const radiusCorner = Math.min(outline * 1.65, plateH * 0.24)
  roundedRect(ctx, plateX, plateY, plateW, plateH, radiusCorner)
  ctx.fillStyle = '#fff7e4'
  ctx.fill()
  ctx.strokeStyle = GOLD_DARK
  ctx.lineWidth = Math.max(1.2, outline * 0.85)
  ctx.stroke()

  const inset = Math.min(3, plateW * 0.045, plateH * 0.18)
  roundedRect(ctx, plateX + inset, plateY + inset, plateW - inset * 2, plateH - inset * 2, Math.max(1, radiusCorner * 0.55))
  ctx.strokeStyle = '#d4aa58'
  ctx.lineWidth = Math.max(0.8, outline * 0.45)
  ctx.stroke()

  const studR = Math.max(0.9, Math.min(1.8, outline * 0.48))
  for (let side = -1; side <= 1; side += 2) {
    ctx.beginPath()
    ctx.arc(visualCX + side * (plateW * 0.43), plateY + plateH * 0.5, studR, 0, Math.PI * 2)
    ctx.fillStyle = GOLD
    ctx.fill()
  }
}

export function drawChampionPodium(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  slots: readonly ChampionColumn[],
  plinthY: number,
  plinthH: number,
  deckH: number,
): void {
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const outline = Math.max(2.2, Math.min(4.2, Math.min(w, h) / 100))

  drawPlinth(ctx, w, plinthY, plinthH, outline)

  for (const column of slots) {
    if (column.w <= 0 || column.h <= 0) continue
    drawShaft(ctx, column, deckH, outline)
    drawCapital(ctx, column, deckH, outline)
    drawMedal(ctx, column, deckH, outline)
    drawPlaque(ctx, column, plinthY, deckH, outline)
  }

  ctx.restore()
}
