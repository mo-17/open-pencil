import type { Router } from 'vitepress'

import { DEFAULT_DOCS_LOCALE, LOCALE_PREFIXES } from '../locale-constants'

const LOCALIZED_PATH_PREFIXES = new Set<string>(LOCALE_PREFIXES)

export interface NavigationLocation {
  readonly href: string
  readonly origin: string
  readonly pathname: string
  assign(url: string): void
}

export function localeForPathname(pathname: string): string {
  const firstSegment = pathname.split('/').find(Boolean)
  if (!firstSegment || !LOCALIZED_PATH_PREFIXES.has(firstSegment)) return DEFAULT_DOCS_LOCALE
  return firstSegment
}

export function crossesLocaleBoundary(fromPathname: string, toPathname: string): boolean {
  return localeForPathname(fromPathname) !== localeForPathname(toPathname)
}

export function createLocaleNavigationGuard(
  previousHook: Router['onBeforeRouteChange'],
  location: NavigationLocation
): NonNullable<Router['onBeforeRouteChange']> {
  return async (to) => {
    const previousResult = await previousHook?.(to)
    if (previousResult === false) return false

    const target = new URL(to, location.href)
    if (
      target.origin === location.origin &&
      crossesLocaleBoundary(location.pathname, target.pathname)
    ) {
      location.assign(target.href)
      return false
    }

    return previousResult
  }
}
