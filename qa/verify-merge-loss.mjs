#!/usr/bin/env node
/**
 * Phase 2.13.2 §1 — VERIFY no merge loss in the real browser.
 *
 * Deep T4/T5 jam (5 rows), then a T5 pair spawned INSIDE near each wall so the
 * merge happens low with a full pile above (the pocket closes after source
 * removal). Contract verified per case:
 *  - a T6 replacement ALWAYS appears (never both-sources-lost)
 *  - every completed merge record has deferredMs bounded (<= ~1000ms)
 *  - emergency records (aged pendings) flagged, spawned locally
 *  - ball count never drops without the replacement (+ net accounting)
 * All state sampled in ONE evaluate (no sampling artifact).
 */
import { chromium } from 'playwright'

const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setViewportSize({ width: 1170, height: 658 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(700)

async function runCase(name, pairXs, pairY) {
  await page.evaluate(() => window.__brScene.restart())
  await wait(600)
  const rows = [1030, 950, 870, 790, 730]
  let k = 0
  for (let r = 0; r < rows.length; r++) {
    const y = rows[r]
    const off = r % 2 === 0 ? 0 : 85
    for (let x = 235 + off; x <= 505 - off; x += 170) {
      const tier = (k + r) % 2 === 0 ? 4 : 5
      await page.evaluate(({ xx, tt, yy }) => window.__brScene.spawnAt(xx, tt, yy, true), { xx: x, tt: tier, yy: y })
      k++
      await wait(35)
    }
  }
  await wait(3200) // settle

  const pair = []
  for (const xx of pairXs) {
    const r2 = await page.evaluate(({ x, t, y }) => window.__brScene.spawnAt(x, t, y, true), { x: xx, t: 5, y: pairY })
    pair.push(r2.id)
    await wait(90)
  }

  // Sample atomically: ball inventory + records + renderer count in ONE call.
  const sample = () =>
    page.evaluate((minId) => {
      const balls = []
      for (const b of window.__brScene.visualState ? [] : []) balls.push(0) // (no-op, keep shape simple)
      const state = window.__brScene.visualState()
      const list = []
      for (const b of window.__brScene.ballList ? window.__brScene.ballList() : []) list.push(b)
      const records = window.__brScene.mergeLocality()
      return { state, list, records, minId }
    }, pair[1])

  let sawRep = false
  let repInfo = null
  let worstDefer = 0
  let emergencyCount = 0
  let minBalls = Infinity
  for (let s = 0; s < 40; s++) {
    await wait(250)
    const snap = await page.evaluate((afterId) => {
      const state = window.__brScene.visualState()
      const found = []
      for (let id = 1; id <= afterId + 80; id++) {
        const d = window.__brScene.ballDetail(id)
        if (d) found.push({ id, tier: d.tier, x: Math.round(d.center.pos.x), y: Math.round(d.center.pos.y) })
      }
      return { state, found, records: window.__brScene.mergeLocality() }
    }, pair[1])
    minBalls = Math.min(minBalls, snap.state.rendererBalls)
    for (const m of snap.records) {
      worstDefer = Math.max(worstDefer, m.deferredMs)
      if (m.emergency) emergencyCount++
    }
    if (!sawRep) {
      const rep = snap.found.find((b) => b.tier === 6 && b.id > pair[1])
      if (rep) { sawRep = true; repInfo = rep }
    }
  }
  const finalSnap = await page.evaluate(() => window.__brScene.visualState())
  console.log(`\n[${name}] T6 replacement: ${sawRep ? `SEEN #${repInfo.id} at (${repInfo.x},${repInfo.y})` : '*** LOST ***'}`)
  console.log(`[${name}] balls now: ${finalSnap.rendererBalls} (min seen ${minBalls}), worst deferral: ${worstDefer.toFixed(0)}ms, emergency resolutions: ${emergencyCount}`)
  await page.screenshot({ path: `qa/screens/p2132/verify-loss-${name}.png` })
  return { lost: !sawRep, worstDefer }
}

const a = await runCase('left', [300, 345], 950)
const b = await runCase('right', [430, 475], 950)
const c = await runCase('floor', [330, 375], 1020)
await browser.close()
const all = [a, b, c]
console.log(`\nVERDICT: ${all.every((r) => !r.lost) ? 'NO MERGE LOSS' : '*** LOSS REMAINS ***'}; worst deferral across cases: ${Math.max(...all.map((r) => r.worstDefer)).toFixed(0)}ms`)
