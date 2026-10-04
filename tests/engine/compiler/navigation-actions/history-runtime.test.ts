import { describe, expect, test } from 'bun:test'

import {
  buildReactApplicationNavigation,
  buildVueApplicationNavigation
} from '@open-pencil/compiler/adapters/application-navigation/source'

type BrowserHistoryState = Record<string, unknown>

function windowFixture(position = 40) {
  const browser = {
    location: { href: 'https://example.test/home' },
    history: {
      length: 900,
      state: {
        idx: position,
        position,
        key: 'entry',
        usr: { existing: true },
        routerValue: 'retained'
      } as BrowserHistoryState,
      writes: 0,
      replaceState(state: Record<string, unknown>) {
        this.state = state
        this.writes += 1
      }
    }
  }
  return browser
}

function trackerFixture() {
  const browser = windowFixture()
  const source = buildReactApplicationNavigation()
  const tracker = source.slice(
    source.indexOf('const markerKey'),
    source.indexOf('\nconst tracker = createTracker()')
  )
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(tracker)
  const createTracker = new Function('window', 'crypto', `${javascript}; return createTracker`)(
    browser,
    { randomUUID: () => 'session-a' }
  )
  return { browser, tracker: createTracker() }
}

function compiledRuntime(source: string): string {
  return new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source.replace(/^import .*\n/gm, '').replace(/export function/g, 'function')
  )
}

describe('Application Back history boundary', () => {
  test('uses session-owned entries and keeps router metadata; host history length grants no authority', () => {
    const { browser, tracker } = trackerFixture()
    tracker.commit(40, '/home?filter=active#top', 'home', 'POP')
    expect(tracker.canBack(tracker.snapshot())).toBe(false)
    expect(browser.history.state.usr).toEqual({ existing: true })
    expect(browser.history.state.routerValue).toBe('retained')
    tracker.commit(40, '/home?filter=active#top', 'home', 'POP')
    expect(browser.history.writes).toBe(1)
    browser.history.state = { idx: 41, usr: { detail: true } }
    tracker.commit(41, '/details/42?mode=view', 'detail', 'PUSH')
    expect(tracker.canBack(tracker.snapshot())).toBe(true)
    browser.history.state = { idx: 41 }
    tracker.commit(41, '/details/42/edit#form', 'edit', 'REPLACE')
    expect(tracker.canBack(tracker.snapshot())).toBe(true)
  })

  test('unknown POP or another session clears prior authority', () => {
    const { browser, tracker } = trackerFixture()
    tracker.commit(40, '/home', 'home', 'POP')
    browser.history.state = { idx: 41 }
    tracker.commit(41, '/details', 'detail', 'PUSH')
    browser.history.state = {
      idx: 40,
      __openpencil_application_nav: { session: 'other', position: 40, href: '/home', key: 'home' }
    }
    tracker.commit(40, '/home', 'home', 'POP')
    expect(tracker.canBack(tracker.snapshot())).toBe(false)
    browser.history.state = { idx: 41 }
    tracker.commit(41, '/details', 'detail', 'POP')
    expect(tracker.canBack(tracker.snapshot())).toBe(false)
  })

  test('known POP and forward retain only the contiguous application chain', () => {
    const { browser, tracker } = trackerFixture()
    tracker.commit(40, '/home', 'home', 'POP')
    const first = browser.history.state
    browser.history.state = { idx: 41 }
    tracker.commit(41, '/details', 'detail', 'PUSH')
    const second = browser.history.state
    browser.history.state = first
    tracker.commit(40, '/home', 'home', 'POP')
    expect(tracker.canBack(tracker.snapshot())).toBe(false)
    browser.history.state = second
    tracker.commit(41, '/details', 'detail', 'POP')
    expect(tracker.canBack(tracker.snapshot())).toBe(true)
  })

  test('React Back replaces concrete fallback without a trusted predecessor, and does not run stale after Motion await', async () => {
    const browser = windowFixture()
    const calls: unknown[][] = []
    let location = { pathname: '/home', search: '', hash: '', key: 'home' }
    let mode = 'POP'
    const runtime = new Function(
      'window',
      'crypto',
      'useCallback',
      'useEffect',
      'useLayoutEffect',
      'useLocation',
      'useNavigate',
      'useNavigationType',
      `${compiledRuntime(buildReactApplicationNavigation())}; return {ApplicationNavigationTracker, useApplicationBack}`
    )(
      browser,
      { randomUUID: () => 'session' },
      (fn: unknown) => fn,
      (fn: () => void) => fn(),
      (fn: () => void) => fn(),
      () => location,
      () =>
        (...args: unknown[]) =>
          calls.push(args),
      () => mode
    )
    runtime.ApplicationNavigationTracker()
    await runtime.useApplicationBack()('/home?filter=active#top')
    expect(calls).toEqual([['/home?filter=active#top', { replace: true }]])
    calls.length = 0
    for (const invalid of [
      'https://example.test',
      '//example.test',
      '/:id',
      '/wild/*',
      '/\\bad',
      '/\n'
    ])
      await runtime.useApplicationBack()(invalid)
    expect(calls).toEqual([])
    browser.history.state = { idx: 41 }
    location = { pathname: '/details', search: '', hash: '', key: 'detail' }
    mode = 'PUSH'
    runtime.ApplicationNavigationTracker()
    await runtime.useApplicationBack()('/home')
    await runtime.useApplicationBack()('/home')
    expect(calls).toEqual([[-1]])
    calls.length = 0
    let release: (() => void) | undefined
    Object.assign(browser, {
      __OPENPENCIL_MOTION_RUNTIME__: {
        pageExit: () =>
          new Promise<void>((resolve) => {
            release = resolve
          })
      }
    })
    const pending = runtime.useApplicationBack()('/home')
    browser.history.state = { idx: 42 }
    location = { pathname: '/other', search: '', hash: '', key: 'other' }
    runtime.ApplicationNavigationTracker()
    release?.()
    await pending
    expect(calls).toEqual([])
  })

  test('React/Vue Back is safe without a browser', async () => {
    const calls: unknown[] = []
    const react = new Function(
      'window',
      'crypto',
      'useCallback',
      'useEffect',
      'useLayoutEffect',
      'useNavigate',
      `${compiledRuntime(buildReactApplicationNavigation())}; return useApplicationBack`
    )(
      undefined,
      undefined,
      (fn: unknown) => fn,
      () => undefined,
      () => undefined,
      () => (value: unknown) => calls.push(value)
    )
    await react()('/home')
    const vue = new Function(
      'window',
      'crypto',
      `${compiledRuntime(buildVueApplicationNavigation())}; return createApplicationBack`
    )(undefined, undefined)
    await vue({ replace: (value: unknown) => calls.push(value) })('/home')
    expect(calls).toEqual([])
  })

  test('Vue tracks its own position and uses replacement fallback rather than host Back', async () => {
    const browser = windowFixture()
    const calls: unknown[] = []
    let committed: (() => void) | undefined
    const router = {
      currentRoute: { value: { fullPath: '/home' } },
      afterEach(fn: () => void) {
        committed = fn
        return () => undefined
      },
      isReady: () => Promise.resolve(),
      replace: (value: unknown) => {
        calls.push(['replace', value])
        return Promise.resolve()
      },
      back: () => calls.push(['back'])
    }
    const runtime = new Function(
      'window',
      'crypto',
      `${compiledRuntime(buildVueApplicationNavigation())}; return {installApplicationNavigation, createApplicationBack}`
    )(browser, { randomUUID: () => 'vue-session' })
    runtime.installApplicationNavigation(router)
    await Promise.resolve()
    const back = runtime.createApplicationBack(router)
    await back('/home?filter=all')
    expect(calls).toEqual([['replace', '/home?filter=all']])
    calls.length = 0
    browser.history.state = { position: 41 }
    router.currentRoute.value.fullPath = '/details'
    committed?.()
    await back('/home')
    await back('/home')
    expect(calls).toEqual([['back']])
  })
})
