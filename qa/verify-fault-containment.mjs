import { bootGame, frameCount, report } from './lib-game.mjs'

/**
 * Guards the FAULT CONTAINMENT invariant — the guarantee that a single
 * bad frame can never take the whole game (and the whole canvas HUD)
 * down again.
 *
 * The crash this exists for: a texture removed while a live sprite was
 * bound to it nulls the frame's source, and the next WebGL render of
 * that sprite throws "Cannot read properties of null (reading
 * 'resolution')" inside Phaser's render pass, which has no try/catch.
 * Phaser's requestAnimationFrame schedules the next frame AFTER the
 * callback returns, so that throw stopped the game loop PERMANENTLY —
 * and since the entire HUD is canvas content, the user saw the whole UI
 * disappear and only a page reload recovered.
 *
 * The containment wraps the game's step callback in a try/catch, so a
 * throw of ANY kind is contained: the loop keeps running and the error
 * is recorded.
 *
 * This script INJECTS the exact crash and asserts the game survives it.
 */
const { browser, page, errors } = await bootGame()

const failures = []

// (1) The containment must be INSTALLED.
const installed = await page.evaluate(() => ({
  marker: window.__brContainmentInstalled === true,
  containedBefore: window.__brContainedErrors ?? 0,
}))
if (!installed.marker) failures.push('the fault containment is NOT installed')

// (2) Inject the crash: a VISIBLE sprite bound to a texture that is then
// destroyed -> the frame's source becomes null -> the render throws.
await page.evaluate(() => {
  const scene = window.__brGame.scene.getScene('playground')
  const key = 'br-qa-crash-probe'
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  scene.textures.addCanvas(key, canvas)
  const img = scene.add.image(360, 300, key).setDepth(9999).setVisible(true)
  // Expose it so the probe can destroy it afterwards.
  window.__brCrashProbeImage = img
  scene.textures.remove(key)
})

await page.waitForTimeout(1200)
const after = await page.evaluate(() => ({
  frame: window.__brGame.loop.frame,
  contained: window.__brContainedErrors ?? 0,
  err: window.__brUpdateError ?? null,
  running: window.__brGame.loop.running,
}))
await page.waitForTimeout(1000)
const after2 = await page.evaluate(() => ({
  frame: window.__brGame.loop.frame,
  contained: window.__brContainedErrors ?? 0,
}))

if (after.contained <= installed.containedBefore) {
  failures.push('the injected crash was NOT contained (__brContainedErrors did not increase)')
}
if (after2.frame <= after.frame) {
  failures.push(`the game loop stopped (${after.frame} -> ${after2.frame})`)
}
if (after.running === false) failures.push('the game loop reports it is not running')
if (!after.err) failures.push('no error was recorded (__brUpdateError is empty)')

// (3) The game must recover: destroy the broken object and confirm the
// loop advances cleanly and no NEW errors appear.
await page.evaluate(() => {
  const img = window.__brCrashProbeImage
  if (img && typeof img.destroy === 'function') img.destroy()
  window.__brCrashProbeImage = null
})
const beforeClean = await frameCount(page)
await page.waitForTimeout(1200)
const afterClean = await frameCount(page)
if (afterClean - beforeClean < 10) {
  failures.push(`the loop did not recover after the broken object was destroyed (${beforeClean} -> ${afterClean})`)
}

// (4) The canvas must still be painted (the HUD is canvas content).
const painted = await page.evaluate(() => {
  const canvas = document.querySelector('.game-container canvas')
  if (!canvas) return -1
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  if (!gl) return -1
  const px = new Uint8Array(4 * 16)
  gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const distinct = new Set()
  for (let i = 0; i < 16; i++) {
    distinct.add(`${px[i * 4]},${px[i * 4 + 1]},${px[i * 4 + 2]}`)
  }
  return distinct.size
})
if (painted === 0) failures.push('the canvas is blank — the HUD is not rendering')

if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`)

await browser.close()
report(
  'fault containment: an injected render crash does not kill the game',
  failures,
  `installed=${installed.marker} contained ${installed.containedBefore} -> ${after.contained} | loop ${after.frame} -> ${after2.frame} | recovered ${beforeClean} -> ${afterClean} | err=${after.err}`,
)
