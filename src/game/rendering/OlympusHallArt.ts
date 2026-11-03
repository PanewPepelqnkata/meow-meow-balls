/** Static, pixel-space canvas art for the Hall of Glory; no scene or runtime state. */
const INK = '#30291f'
const IVORY = '#fff3d5'

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2)
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

function cloudBank(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + w * 0.16, y + h * 0.88)
  ctx.bezierCurveTo(x + w * 0.02, y + h * 0.88, x, y + h * 0.58, x + w * 0.17, y + h * 0.55)
  ctx.bezierCurveTo(x + w * 0.12, y + h * 0.24, x + w * 0.4, y + h * 0.07, x + w * 0.53, y + h * 0.32)
  ctx.bezierCurveTo(x + w * 0.7, y + h * 0.1, x + w * 0.91, y + h * 0.27, x + w * 0.87, y + h * 0.51)
  ctx.bezierCurveTo(x + w, y + h * 0.48, x + w, y + h * 0.84, x + w * 0.85, y + h * 0.88)
  ctx.bezierCurveTo(x + w * 0.69, y + h * 0.95, x + w * 0.35, y + h * 0.94, x + w * 0.16, y + h * 0.88)
  ctx.closePath()
  ctx.fillStyle = '#f5f5e9'
  ctx.fill()
  ctx.strokeStyle = '#b9cdcb'
  ctx.lineWidth = 1.3
  ctx.stroke()
}

/** Small, deliberately low-contrast architecture stays behind the cards. */
function distantTemple(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const templeW = Math.min(126, w * 0.255)
  const templeH = Math.min(84, h * 0.155)
  const x = w * 0.81 - templeW / 2
  const y = Math.max(87, h * 0.145)
  const columnTop = y + templeH * 0.34
  const baseY = y + templeH * 0.86

  cloudBank(ctx, x - templeW * 0.21, baseY - templeH * 0.06, templeW * 1.4, templeH * 0.43)

  ctx.fillStyle = '#dce4d5'
  ctx.fillRect(x + templeW * 0.13, columnTop, templeW * 0.74, baseY - columnTop)
  ctx.fillStyle = '#f4efd8'
  ctx.strokeStyle = '#aab9ac'
  ctx.lineWidth = 1.25
  for (let i = 0; i < 4; i++) {
    const columnX = x + templeW * (0.13 + i * 0.215)
    roundedRect(ctx, columnX, columnTop, templeW * 0.095, baseY - columnTop, 1.5)
    ctx.fill()
    ctx.stroke()
  }

  roundedRect(ctx, x + templeW * 0.035, baseY, templeW * 0.93, templeH * 0.085, 2)
  ctx.fill()
  ctx.stroke()
  roundedRect(ctx, x, columnTop - templeH * 0.085, templeW, templeH * 0.1, 2)
  ctx.fill()
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x - templeW * 0.035, columnTop - templeH * 0.085)
  ctx.lineTo(x + templeW * 0.5, y)
  ctx.lineTo(x + templeW * 1.035, columnTop - templeH * 0.085)
  ctx.closePath()
  ctx.fillStyle = '#efe6c8'
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x + templeW * 0.23, columnTop - templeH * 0.13)
  ctx.lineTo(x + templeW * 0.5, y + templeH * 0.105)
  ctx.lineTo(x + templeW * 0.77, columnTop - templeH * 0.13)
  ctx.strokeStyle = '#c9bf98'
  ctx.stroke()
}

function colonnade(ctx: CanvasRenderingContext2D, w: number, h: number, right: boolean): void {
  ctx.save()
  if (right) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  const floorY = h * 0.82
  const farTop = Math.max(112, h * 0.27)

  ctx.beginPath()
  ctx.moveTo(4, 84)
  ctx.lineTo(w * 0.26, farTop - 7)
  ctx.lineTo(w * 0.26, farTop + 4)
  ctx.lineTo(4, 101)
  ctx.closePath()
  ctx.fillStyle = '#e8e8d7'
  ctx.fill()
  ctx.strokeStyle = '#b7c2b1'
  ctx.lineWidth = 1.4
  ctx.stroke()

  for (let i = 2; i >= 0; i--) {
    const depth = 0.12 + i * 0.44
    const x = w * (0.025 + depth * 0.205)
    const top = 89 + (farTop - 89) * depth
    const bottom = floorY - h * 0.12 * depth
    const columnW = Math.max(9, w * 0.047 * (1 - depth * 0.56))

    ctx.beginPath()
    ctx.moveTo(x + columnW * 0.13, top + 8)
    ctx.lineTo(x + columnW * 0.87, top + 8)
    ctx.lineTo(x + columnW, bottom - 7)
    ctx.lineTo(x, bottom - 7)
    ctx.closePath()
    ctx.fillStyle = '#e9e9d9'
    ctx.fill()
    ctx.strokeStyle = '#b4c0ad'
    ctx.lineWidth = 1.35
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x + columnW * 0.58, top + 13)
    ctx.lineTo(x + columnW * 0.62, bottom - 12)
    ctx.strokeStyle = '#cbd2bf'
    ctx.stroke()

    ctx.fillStyle = '#e7e4cd'
    ctx.strokeStyle = '#b4c0ad'
    roundedRect(ctx, x - columnW * 0.2, top, columnW * 1.4, 8, 2.5)
    ctx.fill()
    ctx.stroke()
    roundedRect(ctx, x - columnW * 0.18, bottom - 7, columnW * 1.36, 8, 2.5)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

function foregroundColumn(ctx: CanvasRenderingContext2D, w: number, h: number, right: boolean): void {
  ctx.save()
  if (right) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  const x = 5
  const columnW = Math.max(12, Math.min(24, w * 0.034))
  const bottom = h * 0.82 + 2

  ctx.beginPath()
  ctx.moveTo(x + 2, 86)
  ctx.lineTo(x + columnW - 2, 86)
  ctx.lineTo(x + columnW, bottom)
  ctx.lineTo(x, bottom)
  ctx.closePath()
  ctx.fillStyle = IVORY
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x + columnW * 0.7, 89)
  ctx.lineTo(x + columnW - 3, 89)
  ctx.lineTo(x + columnW - 1.8, bottom - 3)
  ctx.lineTo(x + columnW * 0.7, bottom - 3)
  ctx.closePath()
  ctx.fillStyle = '#e6d2a2'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + columnW * 0.4, 98)
  ctx.lineTo(x + columnW * 0.4, bottom - 12)
  ctx.strokeStyle = '#b6a580'
  ctx.lineWidth = 1.15
  ctx.stroke()

  ctx.fillStyle = '#f4e3b5'
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  roundedRect(ctx, 2.5, 79, columnW + 5, 10, 3)
  ctx.fill()
  ctx.stroke()
  roundedRect(ctx, 2.5, bottom - 3, columnW + 5, 12, 3)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function greekKey(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const cell = h * 2.2
  const count = Math.floor(w / cell)
  const start = x + (w - count * cell) / 2
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const left = start + i * cell
    ctx.moveTo(left, y + h)
    ctx.lineTo(left + h * 1.7, y + h)
    ctx.lineTo(left + h * 1.7, y)
    ctx.lineTo(left + h * 0.2, y)
    ctx.lineTo(left + h * 0.2, y + h * 0.67)
    ctx.lineTo(left + h * 1.2, y + h * 0.67)
    ctx.lineTo(left + h * 1.2, y + h * 0.33)
    ctx.lineTo(left + h * 0.7, y + h * 0.33)
  }
  ctx.stroke()
}

/** Full-viewport environment; architecture stays behind the inset UI header. */
export function drawOlympusHall(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.clip()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = '#dcebee'
  ctx.fillRect(0, 0, w, h)

  cloudBank(ctx, w * 0.035, 86, w * 0.29, Math.min(83, h * 0.16))
  cloudBank(ctx, w * 0.49, 76, w * 0.22, Math.min(58, h * 0.12))
  distantTemple(ctx, w, h)
  const floorY = h * 0.82
  cloudBank(ctx, 2, floorY - h * 0.225, w * 0.43, h * 0.19)
  cloudBank(ctx, w * 0.63, floorY - h * 0.19, w * 0.365 - 2, h * 0.16)
  colonnade(ctx, w, h, false)
  colonnade(ctx, w, h, true)

  ctx.fillStyle = '#f1e7d0'
  ctx.fillRect(0, floorY, w, h - floorY)
  ctx.beginPath()
  ctx.moveTo(1.5, floorY)
  ctx.lineTo(w - 1.5, floorY)
  ctx.strokeStyle = '#d5cfbd'
  ctx.lineWidth = 1
  ctx.stroke()

  const vanishY = floorY - h * 0.22
  const floorBottom = h - 1.5
  const perspective = (floorY - vanishY) / (floorBottom - vanishY)
  ctx.beginPath()
  for (let i = 0; i <= 4; i++) {
    const bottomX = 1.5 + (w - 3) * i / 4
    const topX = w / 2 + (bottomX - w / 2) * perspective
    ctx.moveTo(topX, floorY + 1.5)
    ctx.lineTo(bottomX, floorBottom)
  }
  for (let i = 1; i <= 3; i++) {
    const depth = i / 3
    const y = floorY + (h - floorY) * depth * depth * 0.87
    ctx.moveTo(1.5, y)
    ctx.lineTo(w - 1.5, y)
  }
  ctx.strokeStyle = '#e0d6c2'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(w * 0.075, h - 15)
  ctx.lineTo(w * 0.105, h - 21)
  ctx.lineTo(w * 0.13, h - 19)
  ctx.moveTo(w * 0.81, h - 29)
  ctx.lineTo(w * 0.84, h - 34)
  ctx.lineTo(w * 0.855, h - 32)
  ctx.strokeStyle = '#d7ccb3'
  ctx.lineWidth = 1
  ctx.stroke()

  foregroundColumn(ctx, w, h, false)
  foregroundColumn(ctx, w, h, true)
  // A quiet atmospheric wash softens architecture without changing the theme.
  ctx.fillStyle = 'rgba(255, 248, 233, 0.28)'
  ctx.fillRect(0, 0, w, h)

  ctx.restore()
}

/**
 * A transparent-corner marble tablet. Keep the face clear for a header near
 * y=30 and rows from y=50/65; the meander is confined to the last 12 pixels.
 */
export function drawOlympusTablet(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.clip()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const radius = Math.min(22, w * 0.07, h * 0.08)

  roundedRect(ctx, 3, 3, w - 6, h - 6, radius)
  ctx.fillStyle = '#c4a466'
  ctx.fill()
  roundedRect(ctx, 8, 7.5, w - 16, h - 19, radius - 5)
  ctx.fillStyle = '#fff8e9'
  ctx.fill()
  ctx.strokeStyle = '#a77a32'
  ctx.lineWidth = 1.8
  ctx.stroke()
  roundedRect(ctx, 12, 11.5, w - 24, h - 27, radius - 8)
  ctx.strokeStyle = '#e7d2a2'
  ctx.lineWidth = 1
  ctx.stroke()

  // Sparse edge veins never divide the text-bearing face into panels.
  ctx.beginPath()
  ctx.moveTo(17, 19)
  ctx.lineTo(28, 22)
  ctx.lineTo(33, 19)
  ctx.lineTo(42, 23)
  ctx.moveTo(28, 22)
  ctx.lineTo(30, 28)
  ctx.moveTo(w - 14, h * 0.39)
  ctx.lineTo(w - 21, h * 0.405)
  ctx.lineTo(w - 19, h * 0.423)
  ctx.lineTo(w - 27, h * 0.44)
  ctx.moveTo(17, h - 31)
  ctx.lineTo(27, h - 27)
  ctx.lineTo(35, h - 30)
  ctx.lineTo(45, h - 26)
  ctx.strokeStyle = '#e0d2b7'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.strokeStyle = '#9b752e'
  ctx.lineWidth = 0.95
  greekKey(ctx, 18, h - 10.3, w - 36, 4.5)

  roundedRect(ctx, 3, 3, w - 6, h - 6, radius)
  ctx.strokeStyle = INK
  ctx.lineWidth = 4.5
  ctx.stroke()
  ctx.restore()
}
