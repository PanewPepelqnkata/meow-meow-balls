/* global window, console, process */
/* Phase 2.9.9 browser verification for the soft-body behavior — runs the
 * NORMAL production game (dev server, no query params) and drives organic
 * gameplay (the spawn queue is tiers 1-3; larger balls form only through
 * genuine merges). All measurements come from the dev-only READ-ONLY
 * interface (window.__brScene.telemetry): effective masses, area/aspect
 * deformation, worst pair overlap, sleep state.
 * Screenshots land in qa/screens/, measurements in qa/verify-report.json.
 * Usage: node qa/verify.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5173/'
mkdirSync('qa/screens', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLEERROR', m.text())
})
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', null, { timeout: 20000 })
await page.waitForTimeout(500)

const state = () => page.evaluate(() => window.__brState)
const tel = () => page.evaluate(() => window.__brScene.telemetry())
const shot = (name) => page.screenshot({ path: `qa/screens/${name}.png`, type: 'png' })
const dropAt = (x) => page.evaluate((x) => window.__brScene.dropAt(x), x)
const sleep = (ms) => page.waitForTimeout(ms)

const report = { scenarios: [], checks: {} }
const record = (name, data) => {
  report.scenarios.push({ name, ...data })
  console.log(name, JSON.stringify(data))
}

const getRadius = (tier) => [0, 38, 48, 57, 75, 97, 126][tier] ?? 38

/* --- A: single drop sanity ------------------------------------------------ */
await dropAt(360)
await sleep(3000)
record('A single drop', { state: await state(), screenshot: 'qa/screens/a1-settled.png' })
await shot('a1-settled')

/* --- B: organic build + weight consistency ---------------------------------
 * Drop at varied positions; merges form larger tiers over time. For every
 * settled loader-on-support pair, record the support's area loss relative to
 * ITS OWN unloaded baseline (area when the ball was first seen freshly
 * merged), grouped by loader class (small: tier ≤ 2, large: tier ≥ 4). */
const baseline = new Map()
const obs = { small: [], large: [] }
let shotSmall = false
let shotLarge = false
let maxTierSeen = 1

const observe = async (t) => {
  for (const b of t.balls) {
    // Phase 2.11.0 baseline fix: the support's reference area must be a
    // SETTLED state — first-sight capture routinely grabbed the expanded
    // post-merge state, inflating every later areaLoss (the residual
    // stochastic verify flake). Capture the baseline only when the ball is
    // quiescent and out of its first rest window — the same conditions an
    // accepted load observation requires.
    if (!baseline.has(b.id) && b.maxSpeed < 1.5 && (b.rest.counter >= 120 || b.rest.lastReset === 'fast')) {
      baseline.set(b.id, b.area)
    }
  }
  for (const s of t.balls) {
    const sr = getRadius(s.tier)
    for (const l of t.balls) {
      if (l.id === s.id) continue
      // quiescent pair (settled contact): not necessarily Matter-asleep —
      // the 2s sleep window rarely elapses between drops, but maxSpeed < 1
      // means the contact force is the loader's static weight
      if (l.maxSpeed > 1.5 || s.maxSpeed > 1.5) continue
      // Exclude supports still inside their first quiet window (rest
      // counter < half the window): their area may still be settling toward
      // equilibrium, inflating apparent areaLoss.
      // Phase 2.10.2: also exclude WAR-SURRENDERED supports — a ball under
      // the standing-war amnesty rests at its WEDGED compression (up to the
      // surrender area tolerance), which reflects the solver churn it just
      // exited, not a calm settled load response. The strict controlled
      // weight-consistency experiment lives in weight-consistency.test.ts.
      if (s.rest.surrendered === true) continue
      if (s.rest.counter < 120 && s.rest.lastReset !== 'fast') continue
      const lr = getRadius(l.tier)
      const dx = Math.abs(l.cx - s.cx)
      const dy = s.cy - l.cy
      if (!(dy > 0 && dy < sr + lr && dx < (sr + lr) / 2)) continue
      const base = baseline.get(s.id) ?? s.area
      const entry = {
        supportTier: s.tier,
        supportMass: s.mass,
        loaderTier: l.tier,
        loaderMass: l.mass,
        areaLoss: +(1 - s.area / base).toFixed(4),
        // specific compression: area loss per unit of RELATIVE load —
        // weight consistency means this is ~constant across all pairs
        // (comparing raw areaLoss across different support tiers is not:
        // a tier-4 under a tier-2 and a tier-6 under a tier-4 carry similar
        // relative loads by design)
        specificLoss: +((1 - s.area / base) / (l.mass / s.mass)).toFixed(4),
        aspect: s.aspect,
      }
      if (l.tier <= 2 && s.tier >= 4) {
        obs.small.push(entry)
        if (!shotSmall && l.maxSpeed < 1.5) {
          shotSmall = true
          await shot('g1-small-on-large')
        }
      } else if (l.tier >= 3 && s.tier >= 4) {
        obs.large.push(entry)
        if (!shotLarge && l.maxSpeed < 1.5) {
          shotLarge = true
          await shot('h1-large-on-large')
        }
      }
    }
  }
}

// Organic loop: restart on game over (Phase 2.11.0) — a mid-run overflow
// used to freeze the simulation and starve the large-loader sample count.
for (let i = 0; i < 400 && !(obs.small.length >= 3 && obs.large.length >= 2); i++) {
  await dropAt(250 + Math.random() * 220)
  await sleep(1150) // > drop cooldown (1000ms)
  await observe(await tel())
  maxTierSeen = Math.max(maxTierSeen, ...(await tel()).balls.map((b) => b.tier))
  const go = await page.evaluate(() => window.__brScene.gameOver?.().over ?? false)
  if (go) {
    // New run: ball ids may repeat — stale baselines are meaningless.
    baseline.clear()
    await page.evaluate(() => window.__brScene.restart())
    await sleep(900) // restart drop-suppression window
  }
}
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN)
record('B organic build + load observations', {
  maxTierSeen,
  smallLoadObs: obs.small,
  largeLoadObs: obs.large,
  smallMeanAreaLoss: +mean(obs.small.map((o) => o.areaLoss)).toFixed(4),
  largeMeanAreaLoss: +mean(obs.large.map((o) => o.areaLoss)).toFixed(4),
})

/* --- I: narrow-gap drop ---------------------------------------------------- */
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', null, { timeout: 20000 })
await page.waitForTimeout(400)
await dropAt(245) // two large-ish spawns with a narrow gap; cooldown 1s
await sleep(1100)
await dropAt(475)
await sleep(6000)
await dropAt(360)
await sleep(6000)
const tI = await tel()
await shot('i1-narrow-gap')
record('I narrow gap drop', {
  worstPairOverlap: tI.worstPairOverlap,
  balls: tI.balls.map((b) => ({ tier: b.tier, area: b.area, aspect: b.aspect, sleeping: b.sleeping })),
  screenshot: 'qa/screens/i1-narrow-gap.png',
})

/* --- J: dense pile after settle ------------------------------------------- */
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', null, { timeout: 20000 })
await page.waitForTimeout(400)
const xs = [250, 310, 370, 430, 470, 280, 340, 400, 450, 300, 360, 420]
for (const x of xs) {
  await dropAt(x)
  await sleep(1050)
}
// settle long enough for the final merges to expand, compact and sleep
// (a late merge spawns a fresh ball whose ring is still expanding)
await sleep(30_000)
const tJ = await tel()
await shot('j1-dense-pile-settled')
record('J dense pile settled', {
  worstPairOverlap: tJ.worstPairOverlap,
  lastSeparationCorrection: tJ.lastSeparationCorrection,
  sleeping: tJ.balls.filter((b) => b.sleeping).length,
  total: tJ.balls.length,
  balls: tJ.balls.map((b) => ({ tier: b.tier, area: b.area, aspect: b.aspect, sleeping: b.sleeping })),
  screenshot: 'qa/screens/j1-dense-pile-settled.png',
})

/* --- checks ---------------------------------------------------------------- */
const median = (arr) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const allObs = [...obs.small, ...obs.large]
const medSmall = median(obs.small.map((o) => o.specificLoss))
const medLarge = median(obs.large.map((o) => o.specificLoss))
report.checks = {
  productionStateNotNull: (await state()) != null,
  smallLoadObserved: obs.small.length >= 3,
  largeLoadObserved: obs.large.length >= 2,
  // weight consistency, organically: per unit of RELATIVE load
  // (loaderMass/supportMass), small loads must not compress their supports
  // disproportionately harder than large loads — the pre-2.9.9 failure mode
  // (16g standing gas drive) made light balls act several times heavier.
  // Organic single observations are noisy (baseline timing), so compare
  // medians with a 2.5x allowance; the strictly controlled tier-1-vs-tier-5
  // experiment lives in weight-consistency.test.ts.
  // Phase 2.11.0: when the large-load median is below the measurement floor
  // (settled baselines make genuine large-load compression ~0), the ratio is
  // undefined — degrade to the absolute bound: small loads must not compress
  // their supports excessively either (same 0.08 bound as
  // noExcessiveDeformation). The strict tier-1-vs-tier-5 experiment remains
  // weight-consistency.test.ts.
  smallNotDisproportionatelyHeavy: medLarge < 0.004 ? medSmall < 0.08 : medSmall / medLarge < 2.5,
  // no observation shows excessive deformation. Phase 2.10.1: bound
  // recalibrated 0.02 → 0.08 for the intentionally softer slime tuning —
  // a heavy organic load (e.g. tier-5 on tier-4, measured 0.042) now
  // legitimately compresses the support more; the pathology this guards
  // (the pre-2.9.8 gas collapse) equilibrated at 0.3–0.7 REST area.
  noExcessiveDeformation: allObs.every((o) => o.areaLoss < 0.08),
  smallOnLargeScreenshot: shotSmall,
  largeOnLargeScreenshot: shotLarge,
  narrowGapBounded: tI.worstPairOverlap < 4,
  densePileSettlesAndSleeps: tJ.balls.length > 0 && tJ.balls.every((b) => b.sleeping) && tJ.worstPairOverlap < 4,
  densePileShapesRound: tJ.balls.every((b) => b.area > 0.7 && b.aspect > 0.7),
  ballMassesRecorded: tJ.balls.every((b) => b.mass > 0),
}
console.log(`OBS specificLoss medians: small=${medSmall.toFixed(4)} large=${medLarge.toFixed(4)} ratio=${medLarge > 0 ? (medSmall / medLarge).toFixed(2) : 'n/a (large below measurement floor)'}`)
console.log('CHECKS', JSON.stringify(report.checks, null, 2))
writeFileSync('qa/verify-report.json', JSON.stringify(report, null, 2))
await browser.close()
const pass = Object.values(report.checks).every(Boolean)
console.log(pass ? 'VERIFY PASS' : 'VERIFY FAIL')
process.exit(pass ? 0 : 1)
