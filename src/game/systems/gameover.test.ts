import { describe, expect, it } from 'vitest'
import { GAME_OVER, isOutsideContainer } from '../../config/gameOver'
import { CONTAINER, containerBounds } from '../../config/container'
import { GameOverWatch } from './GameOverWatch'

/**
 * Phase 2.10.1 game-over regressions (spec §3): GENUINE OVERFLOW, not
 * "above the rim". A touched ball triggers game over only when its centroid
 * leaves the container past a slanted side-wall line AND drops below the
 * CURRENT wall tops, dwelling for GAME_OVER.overflowGraceMs. The pure
 * geometry predicate (isOutsideContainer) and the dwell/latch policy
 * (GameOverWatch) are tested separately.
 */

const h = CONTAINER.height
const b = () => containerBounds()

describe('isOutsideContainer: overflow geometry', () => {
  it('a ball above the wall tops is NEVER outside (arc over the open top may return)', () => {
    // Anywhere above the current wall tops — even far beyond the wall lines —
    // is open sky, not overflow.
    expect(isOutsideContainer({ x: 60, y: b().floorY - h - 1 }, h)).toBe(false)
    expect(isOutsideContainer({ x: 0, y: 100 }, h)).toBe(false)
    expect(isOutsideContainer({ x: 720, y: 100 }, h)).toBe(false)
  })

  it('a ball resting against the inner wall surface is NOT outside', () => {
    // At y = floorY - 100 the right wall line is innerRightAt(y); a centroid
    // slightly INSIDE (contact compression ≤ margin) must not count.
    const y = b().floorY - 100
    expect(isOutsideContainer({ x: b().innerRightAt(y) - 2, y }, h)).toBe(false)
    expect(isOutsideContainer({ x: b().innerLeftAt(y) + 2, y }, h)).toBe(false)
    // Beyond the margin IS outside.
    expect(isOutsideContainer({ x: b().innerRightAt(y) + GAME_OVER.outsideMargin + 1, y }, h)).toBe(true)
    expect(isOutsideContainer({ x: b().innerLeftAt(y) - GAME_OVER.outsideMargin - 1, y }, h)).toBe(true)
  })

  it('a pile rising above the rim but INSIDE the wall lines is never outside', () => {
    const yTop = b().floorY - h + 10 // just below the wall tops
    expect(isOutsideContainer({ x: 360, y: yTop }, h)).toBe(false)
    const yAbove = b().floorY - h - 50 // above the tops: open sky
    expect(isOutsideContainer({ x: 360, y: yAbove }, h)).toBe(false)
  })

  it('uses the CURRENT wall height (raised walls raise the overflow boundary)', () => {
    const y = b().floorY - (CONTAINER.height + CONTAINER.raisedHeight) / 2 // between normal and raised rims
    const xRight = b().innerRightAt(y) + GAME_OVER.outsideMargin + 1
    expect(isOutsideContainer({ x: xRight, y }, CONTAINER.height)).toBe(false) // above normal tops: not overflow yet
    expect(isOutsideContainer({ x: xRight, y }, CONTAINER.raisedHeight)).toBe(true) // below raised tops: genuine overflow
  })

  it('a ball below the floor line outside the funnel is outside (spilled)', () => {
    expect(isOutsideContainer({ x: 60, y: b().floorY - 20 }, h)).toBe(true)
    expect(isOutsideContainer({ x: 660, y: b().floorY - 20 }, h)).toBe(true)
  })
})

describe('GameOverWatch: dwell grace + latch', () => {
  it('does NOT trigger before overflowGraceMs, fires exactly at/after it', () => {
    const w = new GameOverWatch()
    for (let i = 0; i < 4; i++) expect(w.observe([7], 100)).toBe(false) // 400ms
    expect(w.observe([7], 100)).toBe(true) // 500ms ≥ grace
    expect(w.isGameOver).toBe(true)
  })

  it('a transient excursion that returns inside resets the timer (no false game over)', () => {
    const w = new GameOverWatch()
    for (let i = 0; i < 4; i++) expect(w.observe([7], 100)).toBe(false) // 400ms outside
    expect(w.observe([], 50)).toBe(false) // back inside — timer dropped
    for (let i = 0; i < 4; i++) expect(w.observe([7], 100)).toBe(false) // restart from 0 (400ms)
    expect(w.isGameOver).toBe(false) // 400 < grace: still no trigger
    expect(w.observe([7], 100)).toBe(true) // 500ms completes
  })

  it('the active spawn / untouched preview never reaches the watch (contract)', () => {
    // The scene only reports TOUCHED balls; the watch treats an empty feed as
    // "no overflow" — this documents that contract.
    const w = new GameOverWatch()
    for (let i = 0; i < 100; i++) expect(w.observe([], 1000)).toBe(false)
    expect(w.isGameOver).toBe(false)
  })

  it('each ball has its own timer; any single ball completing the dwell triggers', () => {
    const w = new GameOverWatch()
    for (let i = 0; i < 2; i++) w.observe([1, 2], 100) // both at 200ms
    w.observe([1], 300) // ball 1 reaches 500ms → fires; ball 2's timer irrelevant
    expect(w.isGameOver).toBe(true)
  })

  it('latches: no duplicate triggers after firing', () => {
    const w = new GameOverWatch()
    w.observe([3], 10_000)
    expect(w.isGameOver).toBe(true)
    for (let i = 0; i < 10; i++) expect(w.observe([3], 1000)).toBe(false)
    expect(w.isGameOver).toBe(true)
  })

  it('reset clears the latch (restart flow)', () => {
    const w = new GameOverWatch()
    w.observe([3], 10_000)
    expect(w.isGameOver).toBe(true)
    w.reset()
    expect(w.isGameOver).toBe(false)
    for (let i = 0; i < 4; i++) expect(w.observe([3], 100)).toBe(false)
    expect(w.observe([3], 100)).toBe(true)
  })
})

