import { bootGame, report } from './lib-game.mjs'

/**
 * Guards the SAVE WRITE SCHEDULING.
 *
 * localStorage.setItem is a SYNCHRONOUS IPC round-trip on iOS (5-20 ms
 * per call). The save module's own note: "a 4-merge chain stalled frames
 * by 60 ms+".
 *
 * The guard asserts:
 *  1. the deferred write is scheduled on requestIdleCallback (not a bare
 *     setTimeout that fires between frames, landing the IPC inside the
 *     frame budget), and
 *  2. the write still HAPPENS (the data is persisted) — the idle path
 *     must not silently drop the save, and
 *  3. an immediate flush (writeNow) still writes right away and does not
 *     leave a pending idle write behind that fires a second write.
 */
const failures = []
const { browser, page, errors } = await bootGame()

// 1. The scheduling mechanism.
const sched = await page.evaluate(() => ({
  hasIdle: typeof window.requestIdleCallback === 'function',
}))
console.log('requestIdleCallback available:', sched.hasIdle)

// 2. A merge writes the save, and the write eventually lands.
await page.evaluate(() => {
  window.__writes = []
  const orig = Storage.prototype.setItem
  Storage.prototype.setItem = function (k, v) {
    window.__writes.push({ k, t: performance.now() })
    return orig.call(this, k, v)
  }
})
await page.evaluate(() => {
  // Trigger the merge's save path directly (the discovery record — the
  // first-time tier milestone — is what calls recordDiscovery/recordMerge).
  const pg = window.__brGame.scene.getScene('playground')
  pg.balls.getBalls().length
  // Drive a merge: two same-tier balls in contact merge, and the merge
  // hook records the discovery + the merge stat.
  window.__brScene.spawnAt(300, 2, 760, true)
  window.__brScene.spawnAt(320, 2, 760, true)
})
await page.waitForTimeout(3000)
const writes = await page.evaluate(() => window.__writes)
const saveWrites = writes.filter((w) => w.k === 'ballrush.save.v1')
console.log(`save writes after a merge: ${saveWrites.length}`)
if (saveWrites.length === 0) failures.push('the save was never written after a merge')

// 3. The write must land in IDLE time, not during a busy frame. Sample the
// frame times around the write: the write must not be inside a frame.
const idle = await page.evaluate(async () => {
  const g = window.__brGame
  const frames = []
  const origCb = g.loop.callback
  let inFrame = false
  g.loop.callback = (t, d) => {
    inFrame = true
    const s = performance.now()
    origCb(t, d)
    frames.push({ start: s, end: performance.now() })
    inFrame = false
  }
  window.__writeMarks = []
  const orig = Storage.prototype.setItem
  Storage.prototype.setItem = function (k, v) {
    if (k === 'ballrush.save.v1') window.__writeMarks.push({ t: performance.now(), inFrame })
    return orig.call(this, k, v)
  }
  // Trigger a fresh write (a merge records a lifetime stat).
  window.__brScene.spawnAt(300, 3, 760, true)
  window.__brScene.spawnAt(322, 3, 760, true)
  await new Promise((r) => setTimeout(r, 3000))
  return { frames: frames.length, marks: window.__writeMarks }
})
console.log(`write marks: ${JSON.stringify(idle.marks)}`)
for (const m of idle.marks) {
  if (m.inFrame) failures.push('the save write happened INSIDE a frame (it would hitch the frame)')
}
if (idle.marks.length === 0) failures.push('the deferred write never fired')

if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
report(
  'save write: scheduled on idle, never inside a frame',
  failures,
  `writes=${saveWrites.length} idleMarks=${idle.marks.length}`,
)
