#!/usr/bin/env node
/**
 * Phase 2.13.2 — Reproduce MERGE LOSS (both sources vanish, no replacement).
 *
 * Fills the container DEEP with a T4/T5 checkerboard (5 rows), then spawns a
 * T5 pair INSIDE the jam so the merge happens low with a full pile above.
 * The source removal lets the pile collapse into the freed pocket; the
 * pending T6 then has nowhere to go. Watch 8s: ball count + T6 appearance.
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

async function runCase(name, pairXs, pairY, pairTier) {
  await page.evaluate(() => window.__brScene.restart())
  await wait(600)
  // Deep checkerboard: rows of alternating T4/T5, offset per row so no
  // same-tier balls ever touch (no unintended merges).
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

  const before = await page.evaluate(() => window.__brScene.visualState())
  const pair = []
  for (const xx of pairXs) {
    const res = await page.evaluate((x) => window.__brScene.spawnAt(x, 7, 0, true), 0) // placeholder, replaced below
    void res
    const r2 = await page.evaluate(({ x, t, y }) => window.__brScene.spawnAt(x, t, y, true), { x: xx, t: pairTier, y: pairY })
    pair.push(r2.id)
    await wait(90)
  }

  let sawRep = false
  let repPos = null
  let minBalls = Infinity
  for (let s = 0; s < 32; s++) {
    await wait(250)
    const v = await page.evaluate(() => window.__brScene.visualState())
    minBalls = Math.min(minBalls, v.rendererBalls)
    if (!sawRep) {
      for (let id = pair[1] + 1; id <= pair[1] + 60; id++) {
        const d = await page.evaluate((i2) => window.__brScene.ballDetail(i2), id)
        if (d && d.tier === pairTier + 1) { sawRep = true; repPos = `(${Math.round(d.center.pos.x)},${Math.round(d.center.pos.y)})`; break }
      }
    }
  }
  const records = await page.evaluate(() => window.__brScene.mergeLocality())
  const after = await page.evaluate(() => window.__brScene.visualState())
  console.log(`\n[${name}] balls: ${before.rendererBalls} → ${after.rendererBalls} (min ${minBalls})`)
  console.log(`[${name}] T${pairTier + 1} replacement: ${sawRep ? `SEEN at ${repPos}` : '*** NEVER APPEARED — MERGE LOSS ***'}`)
  console.log(`[${name}] merge records: ${records.length}${records.length ? ` tiers=${records.map((m) => m.tier).join(',')}` : ''}`)
  await page.screenshot({ path: `qa/screens/p2132/repro-loss-${name}.png` })
  return { lost: !sawRep }
}

const a = await runCase('deep-left', [300, 345], 950, 5)
const b = await runCase('deep-right', [430, 475], 950, 5)
await browser.close()
console.log(`\nVERDICT: deep-left ${a.lost ? '*** LOST ***' : 'ok'}, deep-right ${b.lost ? '*** LOST ***' : 'ok'}`)
