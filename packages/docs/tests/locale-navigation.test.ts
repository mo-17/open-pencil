import { describe, expect, it, mock } from 'bun:test'

import {
  createLocaleNavigationGuard,
  crossesLocaleBoundary,
  localeForPathname,
  type NavigationLocation
} from '../.vitepress/theme/locale-navigation'

function locationAt(pathname: string): NavigationLocation & {
  assign: ReturnType<typeof mock<(url: string) => void>>
} {
  const href = `https://openpencil.dev${pathname}`
  return {
    href,
    origin: 'https://openpencil.dev',
    pathname,
    assign: mock(() => {})
  }
}

describe('partitioned documentation locale navigation', () => {
  it('detects only supported first-path-segment locale changes', () => {
    expect(localeForPathname('/')).toBe('en')
    expect(localeForPathname('/guide/getting-started')).toBe('en')
    expect(localeForPathname('/de/guide/getting-started')).toBe('de')
    expect(localeForPathname('/zh-cn/guide/getting-started')).toBe('zh-cn')
    expect(localeForPathname('/guide/de/example')).toBe('en')
    expect(crossesLocaleBoundary('/guide/intro', '/de/guide/intro')).toBe(true)
    expect(crossesLocaleBoundary('/de/guide/intro', '/fr/guide/intro')).toBe(true)
    expect(crossesLocaleBoundary('/fr/guide/intro', '/zh-cn/guide/intro')).toBe(true)
    expect(crossesLocaleBoundary('/zh-cn/guide/intro', '/zh-cn/user-guide/')).toBe(false)
    expect(crossesLocaleBoundary('/de/guide/intro', '/de/reference/api')).toBe(false)
  })

  it('keeps same-locale navigation in the SPA and preserves an existing hook', async () => {
    const location = locationAt('/de/guide/intro')
    const previousHook = mock(async () => true)
    const guard = createLocaleNavigationGuard(previousHook, location)

    await expect(guard('/de/reference/api?tab=types#result')).resolves.toBe(true)
    expect(previousHook).toHaveBeenCalledWith('/de/reference/api?tab=types#result')
    expect(location.assign).not.toHaveBeenCalled()
  })

  it('hard-navigates across locale partitions after the existing hook allows it', async () => {
    const location = locationAt('/guide/intro')
    const previousHook = mock(async () => undefined)
    const guard = createLocaleNavigationGuard(previousHook, location)

    await expect(guard('/fr/guide/intro?tab=types#result')).resolves.toBe(false)
    expect(previousHook).toHaveBeenCalledWith('/fr/guide/intro?tab=types#result')
    expect(location.assign).toHaveBeenCalledWith(
      'https://openpencil.dev/fr/guide/intro?tab=types#result'
    )
  })

  it('respects cancellation from an existing hook before reloading', async () => {
    const location = locationAt('/guide/intro')
    const previousHook = mock(async () => false)
    const guard = createLocaleNavigationGuard(previousHook, location)

    await expect(guard('/de/guide/intro')).resolves.toBe(false)
    expect(location.assign).not.toHaveBeenCalled()
  })
})
