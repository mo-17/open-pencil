import { describe, expect, test } from 'bun:test'

import {
  buildReactApplicationNavigation,
  buildVueApplicationNavigation
} from '@open-pencil/compiler/adapters/application-navigation/source'

import { asDouble } from '#tests/helpers/doubles'

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

interface ReactBackRuntime {
  ApplicationNavigationTracker(): null
  useApplicationBack(): (fallback: string) => Promise<void>
}

/** Native history changes now; the route's layout commit is deliberately controlled later. */
function delayedReactCommitFixture() {
  const browser = windowFixture()
  browser.history.state.key = 'home'
  const calls: unknown[][] = []
  const cleanups: Array<() => void> = []
  let location = { pathname: '/home', search: '', hash: '', key: 'home' }
  let mode = 'POP'
  const effect = (fn: () => undefined | (() => void)) => {
    const remove = fn()
    if (remove) cleanups.push(remove)
  }
  const runtime = asDouble<ReactBackRuntime>(
    new Function(
      'window',
      'crypto',
      'useCallback',
      'useEffect',
      'useLayoutEffect',
      'useLocation',
      'useNavigate',
      'useNavigationType',
      `${compiledRuntime(buildReactApplicationNavigation())}; return { ApplicationNavigationTracker, useApplicationBack }`
    )(
      browser,
      { randomUUID: () => 'delayed-react-session' },
      (fn: unknown) => fn,
      effect,
      effect,
      () => location,
      () =>
        (...args: unknown[]) => {
          calls.push(args)
        },
      () => mode
    )
  )
  runtime.ApplicationNavigationTracker()
  const initialState = { ...browser.history.state }
  return {
    browser,
    calls,
    runtime,
    initialState,
    native(position: number, path: string, key: string) {
      browser.history.state = { idx: position, key, usr: { retained: true } }
      browser.location.href = new URL(path, 'https://example.test').href
    },
    commit(path: string, key: string, action: 'PUSH' | 'REPLACE' | 'POP') {
      const url = new URL(path, 'https://example.test')
      location = { pathname: url.pathname, search: url.search, hash: url.hash, key }
      mode = action
      runtime.ApplicationNavigationTracker()
    },
    unmount() {
      cleanups[0]?.()
    }
  }
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
    const committedHome = browser.history.state
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
    // Complete the mocked native Back before testing a new Motion-gated request.
    browser.history.state = committedHome
    location = { pathname: '/home', search: '', hash: '', key: 'home' }
    mode = 'POP'
    runtime.ApplicationNavigationTracker()
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
    expect(release).toBeTypeOf('function')
    browser.history.state = { idx: 42 }
    location = { pathname: '/other', search: '', hash: '', key: 'other' }
    mode = 'PUSH'
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

  test('React native PUSH before layout commit coalesces rapid Back without replacing the new entry', async () => {
    const f = delayedReactCommitFixture()
    f.native(41, '/products/42', 'products')
    const back = f.runtime.useApplicationBack()
    const first = back('/home?category=fallback#top')
    const second = back('/home?category=fallback#top')
    await Promise.resolve()
    expect(f.calls).toEqual([])
    expect(f.browser.history.state.idx).toBe(41)
    f.commit('/products/42', 'products', 'PUSH')
    // React's repeated commit cannot reopen the same Back claim or invalidate its snapshot.
    f.commit('/products/42', 'products', 'PUSH')
    await Promise.all([first, second])
    expect(f.calls).toEqual([[-1]])
    expect(f.browser.history.length).toBe(900)
    expect(f.browser.history.state.usr).toEqual({ retained: true })
  })

  test('React native REPLACE before layout commit still replaces fallback at the application boundary', async () => {
    const f = delayedReactCommitFixture()
    f.native(40, '/products/42?mode=edit#form', 'details')
    const back = f.runtime.useApplicationBack()
    const first = back('/home?category=fallback#top')
    const second = back('/home?category=fallback#top')
    expect(f.calls).toEqual([])
    f.commit('/products/42?mode=edit#form', 'details', 'REPLACE')
    await Promise.all([first, second])
    expect(f.calls).toEqual([['/home?category=fallback#top', { replace: true }]])
    expect(f.browser.history.length).toBe(900)
  })

  test('an unowned POP never becomes an owned predecessor merely because native idx increased', async () => {
    const f = delayedReactCommitFixture()
    f.native(41, '/products/42', 'products')
    f.commit('/products/42', 'products', 'PUSH')
    f.native(42, '/external-host', 'foreign')
    const request = f.runtime.useApplicationBack()('/home?category=fallback#top')
    expect(f.calls).toEqual([])
    f.commit('/external-host', 'foreign', 'POP')
    await request
    expect(f.calls).toEqual([['/home?category=fallback#top', { replace: true }]])
  })

  test('a different route commit cancels queued Back instead of navigating from a stale native entry', async () => {
    const f = delayedReactCommitFixture()
    f.native(41, '/products/42', 'products')
    const pending = f.runtime.useApplicationBack()('/home')
    f.native(42, '/another-page', 'another')
    f.commit('/another-page', 'another', 'PUSH')
    await pending
    expect(f.calls).toEqual([])
    await f.runtime.useApplicationBack()('/home')
    expect(f.calls).toEqual([['/home', { replace: true }]])
  })

  test('tracker unmount cancels its only pending commit and releases Back for a later mounted route', async () => {
    const f = delayedReactCommitFixture()
    f.native(41, '/products/42', 'products')
    const pending = f.runtime.useApplicationBack()('/home')
    f.unmount()
    await pending
    expect(f.calls).toEqual([])
    f.browser.history.state = f.initialState
    f.browser.location.href = 'https://example.test/home'
    f.commit('/home', 'home', 'POP')
    await f.runtime.useApplicationBack()('/home?category=fallback#top')
    expect(f.calls).toEqual([['/home?category=fallback#top', { replace: true }]])
  })

  test('a stale Motion continuation cannot release the Back claim of a newer route', async () => {
    const f = delayedReactCommitFixture()
    f.native(41, '/products/42', 'products')
    f.commit('/products/42', 'products', 'PUSH')
    const releases: Array<() => void> = []
    Object.assign(f.browser, {
      __OPENPENCIL_MOTION_RUNTIME__: {
        pageExit: () =>
          new Promise<void>((resolve) => {
            releases.push(resolve)
          })
      }
    })
    const first = f.runtime.useApplicationBack()('/home')
    await Promise.resolve()
    f.native(42, '/products/43', 'next-products')
    f.commit('/products/43', 'next-products', 'PUSH')
    const second = f.runtime.useApplicationBack()('/home')
    await Promise.resolve()
    expect(releases).toHaveLength(2)
    releases[0]?.()
    await first
    const duplicate = f.runtime.useApplicationBack()('/home')
    await Promise.resolve()
    expect(releases).toHaveLength(2)
    releases[1]?.()
    await Promise.all([second, duplicate])
    expect(f.calls).toEqual([[-1]])
  })
})
