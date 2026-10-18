#!/usr/bin/env node
/**
 * Phase 2.13.1 — Merge-locality verification against REAL chaotic gameplay.
 *
 * Drives three crowded scenarios (left wall, right wall, center) with REAL
 * cascading merges, then reads the MergeSystem locality records (source
 * midpoint vs replacement position per completed merge) and verifies every
 * single merge stayed local. Also samples a deep pile ball for instant
 * teleports and runs a buried-ball scan.
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

const LOCAL_BOUND = 320 // MAX_RING_PX(240) + rNew headroom
let failures = 0
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function detail(id) {
  return page.evaluate((i) => window.__brScene.ballDetail(i), id)
}

async function runCase(name, spawnPlan) {
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  const ids = []
  for (const { x, tier, y } of spawnPlan) {
    const r = await page.evaluate(({ xx, tt, yy }) => window.__brScene.spawnAt(xx, tt, yy, true), { xx: x, tt: tier, yy: y })
    ids.push(r.id)
    await wait(60)
  }
  await wait(3000) // settle + cascade

  // Watch a mid-pile ball for instant teleports across the merge window.
  const watchId = ids[Math.floor(ids.length / 2)]
  let lastWatch = (await detail(watchId))?.center?.pos
  let maxJump = 0
  for (let s = 0; s < 15; s++) {
    await wait(200)
    const w = await detail(watchId)
    if (w && lastWatch) {
      const jump = Math.hypot(w.center.pos.x - lastWatch.x, w.center.pos.y - lastWatch.y)
      if (jump > maxJump) maxJump = jump
      lastWatch = { x: w.center.pos.x, y: w.center.pos.y }
    }
  }

  const records = await page.evaluate(() => window.__brScene.mergeLocality())
  console.log(`\n[${name}] ${records.length} recorded merges`)
  let worst = null
  for (const m of records) {
    const dist = Math.hypot(m.x - m.cx, m.y - m.cy)
    if (!worst || dist > worst.dist) worst = { dist, m }
  }
  if (records.length === 0) {
    check(`${name}: merges occurred`, false, 'no merge records')
  } else {
    check(`${name}: every replacement local (bound ${LOCAL_BOUND}px)`, worst.dist <= LOCAL_BOUND,
      `worst ${Math.round(worst.dist)}px (tier ${worst.m.tier} → (${Math.round(worst.m.x)},${Math.round(worst.m.y)}) from (${Math.round(worst.m.cx)},${Math.round(worst.m.cy)}), pushed=${worst.m.pushed}, deferred=${worst.m.deferredMs}ms)`)
    const pushed = records.reduce((n, m) => n + m.pushed, 0)
    const deferred = records.filter((m) => m.deferredMs > 0).length
    // Phase 2.13.3: with both sources retained until resolution, a wedged
    // pair's replacement claims the pair's exact space — a crowded core can
    // legitimately nudge a few more neighbors than the old remove-first
    // flow (which left a void). The SAFETY bounds are unchanged and are
    // what this check enforces: every individual push ≤ MAX_PUSH (60px,
    // recorded as maxPushPx), and never a pathological neighbor count.
    const maxPush = records.reduce((m, r) => Math.max(m, r.maxPushPx ?? 0), 0)
    check(`${name}: bounded pushes only (each ≤ 60px)`,
      records.every((m) => (m.maxPushPx ?? 0) <= 62) && records.every((m) => m.pushed <= 6),
      `${pushed} total pushes, max single push ${maxPush.toFixed(1)}px, ${deferred} deferred-resolved merges`)
  }
  check(`${name}: no pile-ball teleport (200ms jump ≤ 90px)`, maxJump <= 90, `maxJump=${Math.round(maxJump)}px`)

  // Buried-ball scan over every surviving ball we can enumerate.
  const survivors = []
  for (const id of ids) {
    const d = await detail(id)
    if (d) survivors.push({ id, x: d.center.pos.x, y: d.center.pos.y, t: d.tier })
  }
  const RADII = { 1: 44, 2: 52, 3: 62, 4: 76, 5: 90, 6: 106, 7: 130, 8: 165, 9: 205 }
  let buried = 0
  for (let i = 0; i < survivors.length; i++) {
    for (let j = i + 1; j < survivors.length; j++) {
      const A = survivors[i], B = survivors[j]
      const d = Math.hypot(A.x - B.x, A.y - B.y)
      if (d < 0.6 * ((RADII[A.t] ?? 40) + (RADII[B.t] ?? 40))) buried++
    }
  }
  check(`${name}: no ball buried inside another`, buried === 0,
    `${buried} deep overlaps among ${survivors.length} tracked survivors`)
  const dup = await page.evaluate(() => window.__brScene.visualState())
  check(`${name}: no duplicate renderers`, dup.rendererBalls === dup.registered,
    `renderer=${dup.rendererBalls} registered=${dup.registered}`)
  await page.screenshot({ path: `qa/screens/p2131/verify-${name}.png` })
}

console.log('Phase 2.13.1 — merge locality verification (real cascading merges)\n')

// LEFT wall: crowded left pile, big balls, cascades allowed (real behavior).
await runCase('left-wall', [
  { x: 250, tier: 4, y: 1030 }, { x: 330, tier: 4, y: 1030 }, { x: 410, tier: 4, y: 1030 },
  { x: 290, tier: 5, y: 930 }, { x: 380, tier: 5, y: 930 },
  { x: 250, tier: 4, y: 840 }, { x: 340, tier: 4, y: 840 },
  { x: 280, tier: 5, y: 760 }, { x: 300, tier: 5, y: 700 },
])
// RIGHT wall mirror.
await runCase('right-wall', [
  { x: 470, tier: 4, y: 1030 }, { x: 390, tier: 4, y: 1030 }, { x: 310, tier: 4, y: 1030 },
  { x: 430, tier: 5, y: 930 }, { x: 340, tier: 5, y: 930 },
  { x: 470, tier: 4, y: 840 }, { x: 380, tier: 4, y: 840 },
  { x: 440, tier: 5, y: 760 }, { x: 420, tier: 5, y: 700 },
])
// CENTER, fully crowded core.
await runCase('center-crowd', [
  { x: 280, tier: 4, y: 1030 }, { x: 360, tier: 4, y: 1030 }, { x: 440, tier: 4, y: 1030 },
  { x: 320, tier: 5, y: 930 }, { x: 400, tier: 5, y: 930 },
  { x: 300, tier: 4, y: 840 }, { x: 380, tier: 4, y: 840 }, { x: 340, tier: 6, y: 740 },
  { x: 360, tier: 5, y: 680 }, { x: 380, tier: 5, y: 640 },
])

await browser.close()
console.log(`\n${failures === 0 ? '✓ MERGE LOCALITY VERIFIED IN REAL GAMEPLAY' : `✗ ${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
