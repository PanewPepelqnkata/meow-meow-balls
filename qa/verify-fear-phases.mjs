import { bootGame, report } from './lib-game.mjs'

/**
 * Guards the BALL FEAR PHASES — the four-phase danger ladder:
 *
 *   normal → worried → scared → panic
 *
 * A ball climbs the ladder as its VISUAL TOP rises above the container's
 * wall tops (the escape risk). The phases must be REACHABLE IN NORMAL
 * PLAY and VISIBLE:
 *
 *  1. REACHABLE — the emotion system must produce all four levels for a
 *     ball that is above the rim (the unit test covers the thresholds;
 *     this covers the live wiring: the renderer's ball must actually
 *     climb the ladder in the running game).
 *  2. VISIBLE — the face must CHANGE per phase: the scared/sprite face is
 *     morphed (eyes widen, pupils shrink + pin up, the neutral mouth is
 *     replaced by the frightened O). The face must stay VISIBLE in every
 *     phase — the old fallback hid the face sprites and redrew on the
 *     shared layer, which made the face VANISH for the morph's duration.
 */
const failures = []
const { browser, page, errors } = await bootGame()

// The container starts EMPTY — drop one ball so there is a face to read.
await page.evaluate(() => {
  window.__brScene.dropAt(360)
})
await page.waitForTimeout(2500)

// Read the emotion state of a live ball + the face sprite transforms.
const readFace = () =>
  page.evaluate(() => {
    const pg = window.__brGame.scene.getScene('playground')
    const r = pg.ballRenderer
    const balls = pg.balls.getBalls()
    if (!balls.length) return null
    // The topmost ball (the one nearest the rim) is the most at risk.
    let top = balls[0]
    for (const b of balls) {
      if (b.soft.center.position.y < top.soft.center.position.y) top = b
    }
    const view = r.faces ? r.faces.view(top.id) : null
    const lvl = r.emotion.levelOf(top.id)
    return {
      id: top.id,
      y: Math.round(top.soft.center.position.y),
      radius: Math.round(top.soft.radius),
      level: lvl,
      panic: +r.emotion.panicOf(top.id).toFixed(3),
      // Face sprite geometry: the FEAR MORPH is visible in these.
      scleraLScale: view ? +view.scleraL.scaleX.toFixed(4) : null,
      pupilLScale: view ? +view.pupilL.scaleX.toFixed(4) : null,
      pupilLY: view ? Math.round(view.pupilL.y) : null,
      scleraLY: view ? Math.round(view.scleraL.y) : null,
      // Visibility: the face must NEVER be blank in a feared phase.
      scleraLVisible: view ? view.scleraL.visible : null,
      pupilLVisible: view ? view.pupilL.visible : null,
      mouthVisible: view ? view.mouth.visible : null,
    }
  })

// --- 1. The ladder is reachable: drive a ball above the rim --------------
// The wall top on the phone funnel is at stage y = 685. Move a ball's
// centre ABOVE the rim so its visual top is above the wall tops, and walk
// it up through the three feared phases.
// The phone funnel's wall tops are at stage y = 685. The emotion measure
// is the ball's VISUAL TOP (centre − radius − clearMargin) above that rim,
// over a 160px span; the levels enter at 0.18 / 0.48 / 0.80 of it.
//
// The ball's rendered TOP is not its centre (it is a 3D-ish blob), so the
// exact y for a target measure is SOLVED from the live measure: the
// relationship is linear, so two probes fix the mapping.
const phases = []
const targets = [
  ['below rim (normal)', 0],
  // Targeted comfortably ABOVE each entry threshold (0.18 / 0.48 / 0.80):
  // the measure eases toward its target, so a probe parked exactly ON a
  // threshold can read just under it.
  ['worried', 0.3],
  ['scared', 0.6],
  ['panic', 0.92],
]
for (const [label, target] of targets) {
  // Solve for the y that hits the target measure, and pin the ball there
  // every frame (it would otherwise FALL back to the floor).
  //
  // The ball is moved RIGIDLY (the same delta for every particle) — the
  // particle ring must keep its shape, because the rendered contour IS the
  // particle ring (collapsing it to a point would draw a degenerate blob).
  await page.evaluate((tgt) => {
    const pg = window.__brGame.scene.getScene('playground')
    const b = pg.balls.getBalls()[0]
    if (!b) return
    const M = window.__brModules.Matter
    const rim = pg.balls.wallTopY
    const r = b.soft.radius
    const margin = 6
    const span = 160
    // y for a target measure: the visual top (centre − r − margin) sits
    // `m * span` above the rim.
    const y = rim - tgt * span + r + margin
    const x = 360
    const pin = () => {
      const c = b.soft.center.position
      const dx = x - c.x
      const dy = y - c.y
      for (const p of b.soft.particles) {
        M.Body.setPosition(p, { x: p.position.x + dx, y: p.position.y + dy })
        M.Body.setVelocity(p, { x: 0, y: 0 })
      }
      M.Body.setPosition(b.soft.center, { x, y })
      M.Body.setVelocity(b.soft.center, { x: 0, y: 0 })
      window.__pinRaf = requestAnimationFrame(pin)
    }
    if (window.__pinRaf) cancelAnimationFrame(window.__pinRaf)
    pin()
  }, target)
  // The emotion system needs a few frames to ease + apply hysteresis, and
  // the grace period must elapse for the ball to be allowed to fear.
  await page.waitForTimeout(2200)
  const s = await readFace()
  if (s) phases.push({ label, ...s })
}

console.log('phase ladder observed:')
for (const p of phases) {
  console.log(
    `  ${p.label.padEnd(20)} level=${String(p.level).padEnd(8)} panic=${p.panic} scleraScale=${p.scleraLScale} pupilScale=${p.pupilLScale} pupilY=${p.pupilLY} scleraVisible=${p.scleraLVisible} pupilVisible=${p.pupilLVisible} mouthVisible=${p.mouthVisible}`,
  )
}

// --- assertions -----------------------------------------------------------
const byLabel = Object.fromEntries(phases.map((p) => [p.label, p]))
const normal = byLabel['below rim (normal)']
const worried = byLabel['worried']
const scared = byLabel['scared']
const panic = byLabel['panic']

if (!normal || !worried || !scared || !panic) {
  failures.push('could not read the face state for every phase')
} else {
  // 1. The ladder is reachable: each stage must report its own level.
  if (normal.level !== 'normal') failures.push(`below the rim should be 'normal', got '${normal.level}'`)
  if (worried.level !== 'worried') failures.push(`the worried stage reported '${worried.level}'`)
  if (scared.level !== 'scared') failures.push(`the scared stage reported '${scared.level}'`)
  if (panic.level !== 'panic') failures.push(`the panic stage reported '${panic.level}'`)

  // 2. The fear morph is VISIBLE: the eyes widen with the fear.
  if (!(worried.scleraLScale > normal.scleraLScale)) {
    failures.push(`the worried face did not widen (${normal.scleraLScale} -> ${worried.scleraLScale})`)
  }
  if (!(scared.scleraLScale > worried.scleraLScale)) {
    failures.push(`the scared face did not widen further (${worried.scleraLScale} -> ${scared.scleraLScale})`)
  }
  // The pupils SHRINK with the fear (dilated in the fear feel).
  if (!(scared.pupilLScale < normal.pupilLScale)) {
    failures.push(`the pupils did not shrink (${normal.pupilLScale} -> ${scared.pupilLScale})`)
  }
  // The pupils PIN UPWARD: the pupil's y rises above the sclera's centre.
  if (!(scared.pupilLY < scared.scleraLY)) {
    failures.push(`the pupils did not pin upward (sclera y ${scared.scleraLY}, pupil y ${scared.pupilLY})`)
  }
  // The neutral mouth is REPLACED by the frightened O under fear.
  if (normal.mouthVisible !== true) failures.push('the normal face has no mouth')
  if (scared.mouthVisible !== false) failures.push('the scared face kept the neutral mouth sprite')

  // 3. The face NEVER vanishes: the eyes stay visible in every phase.
  for (const p of phases) {
    if (p.scleraLVisible !== true) failures.push(`the face VANISHED in the '${p.label}' phase`)
    if (p.pupilLVisible !== true) failures.push(`the pupils VANISHED in the '${p.label}' phase`)
  }
}

if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
report(
  'ball fear phases: normal → worried → scared → panic are reachable and visible',
  failures,
  phases.map((p) => `${p.label}=${p.level}`).join(', '),
)
