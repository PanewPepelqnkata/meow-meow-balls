import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDrunkoTestRoute, isEarthTestRoute, isPirateTestRoute, themeFor, tier9Theme } from './runVariant'

function visit(pathname: string, search = ''): void {
  vi.stubGlobal('window', { location: { pathname, search } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isDrunkoTestRoute', () => {
  it('is false outside the browser', () => {
    vi.stubGlobal('window', undefined)
    expect(isDrunkoTestRoute()).toBe(false)
  })

  it.each([
    '/drunko',
    '/drunko/',
    '/drunko///',
    '/preview/drunko',
    '/preview/drunko//',
    '/pirate_ball',
    '/pirate_ball/',
    '/preview/pirate_ball',
    '/earth',
    '/earth/',
    '/preview/earth',
  ])('recognizes the sandbox path %s', (pathname) => {
    visit(pathname)
    expect(isDrunkoTestRoute()).toBe(true)
  })

  it.each(['/pirate_ball', '/pirate_ball/', '/preview/pirate_ball'])(
    'recognizes the pirate_ball path %s via isPirateTestRoute',
    (pathname) => {
      visit(pathname)
      expect(isPirateTestRoute()).toBe(true)
    },
  )
  it.each(['/earth', '/earth/', '/preview/earth'])('deals Earth on %s', (pathname) => {
    visit(pathname, '?theme=shark&test=1')
    expect(isEarthTestRoute()).toBe(true)
    expect(themeFor(11)).toBe('earth')
  })
  it.each(['/', '/preview', '/drunkos', '/not-drunko', '/drunko/play', '/Drunko', '/drunko.html'])(
    'does not treat the production path %s as a sandbox',
    (pathname) => {
      visit(pathname, '?theme=drunko&test=9')
      expect(isDrunkoTestRoute()).toBe(false)
    },
  )
})

describe('tier9Theme route precedence', () => {
  it.each(['/drunko', '/drunko/', '/preview/drunko'])('pins %s despite conflicting QA flags', (pathname) => {
    visit(pathname, '?theme=shark&test=1')
    expect(tier9Theme()).toBe('drunko')
  })
  it.each(['/pirate_ball', '/pirate_ball/', '/preview/pirate_ball'])(
    'pins %s to pirate despite conflicting QA flags',
    (pathname) => {
      visit(pathname, '?theme=shark&test=1')
      expect(tier9Theme()).toBe('pirate')
    },
  )

  it.each(['shark', 'pig', 'drunko', 'robo', 'pirate'] as const)('preserves the production %s override', (theme) => {
    visit('/', `?theme=${theme}`)
    expect(tier9Theme()).toBe(theme)
  })

  it('preserves the seeded production theme when no valid override is present', () => {
    vi.stubGlobal('window', undefined)
    const seededTheme = tier9Theme()
    visit('/', '?theme=unknown')
    expect(tier9Theme()).toBe(seededTheme)
  })
})
