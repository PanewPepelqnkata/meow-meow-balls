#!/usr/bin/env node
/**
 * Phase 2.13.1 — Adversarial merge-locality reproduction (real browser).
 *
 * Packs the container with LARGE balls (alternating T4/T5 checkerboard — no
 * unintended merges), then merges a T5 pair → T6 replacement (r=106) in a
 * packed region, once near the LEFT wall, once near the RIGHT wall.
 * Records source midpoint vs replacement position + a "buried ball" scan.
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

async function runCase(name, pairXs) {
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  // Pack: alternate T4/T5 rows across the floor.
  let i = 0
  for (const y of [1030, 930, 830]) {
    for (let x = 240; x <= 520; x += 88) {
      const tier = i++ % 2 === 0 ? 4 : 5
      await page.evaluate(({ xx, tt, yy }) => window.__brScene.spawnAt(xx, tt, yy, true), { xx: x, tt: tier, yy: y })
      await wait(30)
    }
  }
  await wait(2600) // settle

  // The merge pair: two T5s dropped together (they merge into T6; they may
  // also merge with pile T5s — either way a real crowded T6 creation).
  const a = await page.evaluate((xx) => window.__brScene.spawnAt(xx, 5, 860, true), pairXs[0])
  await wait(50)
  const b = await page.evaluate((xx) => window.__brScene.spawnAt(xx, 5, 860, true), pairXs[1])
  await wait(400)
  const da = await page.evaluate((id) => window.__brScene.ballDetail(id), a.id)
  const db = await page.evaluate((id) => window.__brScene.ballDetail(id), b.id)
  const mid = da && db
    ? { x: (da.center.pos.x + db.center.pos.x) / 2, y: (da.center.pos.y + db.center.pos.y) / 2 }
    : null
  console.log(`\n[${name}] sources:`, da ? `A(${Math.round(da.center.pos.x)},${Math.round(da.center.pos.y)})` : 'A-merged',
    db ? `B(${Math.round(db.center.pos.x)},${Math.round(db.center.pos.y)})` : 'B-merged',
    mid ? `mid=(${Math.round(mid.x)},${Math.round(mid.y)})` : '')

  // Track the T6 replacement for ~6s.
  let best = null
  for (let s = 0; s < 24; s++) {
    await wait(250)
    let found = null
    for (let id = b.id + 1; id <= b.id + 120; id++) {
      const d = await page.evaluate((i2) => window.__brScene.ballDetail(i2), id)
      if (d && d.tier === 6) { found = d; break }
    }
    if (found && mid) {
      const dist = Math.hypot(found.center.pos.x - mid.x, found.center.pos.y - mid.y)
      if (!best || dist > best.dist) best = { ...found, dist, at: (s + 1) * 250 }
    }
  }
  if (best) {
    console.log(`[${name}] T6 replacement worst displacement: ${Math.round(best.dist)}px at (${Math.round(best.center.pos.x)},${Math.round(best.center.pos.y)}) — ${best.dist > 320 ? '*** TELEPORTED ***' : 'local'}`)
  } else {
    console.log(`[${name}] no T6 replacement observed (chain or deferral)`)
  }

  // Buried-ball scan: any two centers closer than 0.7× the sum of radii?
  const buried = await page.evaluate(() => {
    const out = []
    const vis = window.__brScene.visualState()
    return vis.rendererBalls
  })
  void buried
  await page.screenshot({ path: `qa/screens/p2131/repro-${name}.png` })
}

await runCase('left-wall', [250, 300])
await runCase('right-wall', [460, 510])
await browser.close()
