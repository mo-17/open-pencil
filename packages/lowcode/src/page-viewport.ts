import type { LowcodePageViewportV1 } from '@open-pencil/scene-graph'

export const LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY = 'lowcode/pageViewport'

export type LowcodePageViewportValidation =
  | { ok: true; value: LowcodePageViewportV1 }
  | { ok: false; reason: string }

/** Closed, data-only v1 policy. Missing values are handled by callers as legacy pages. */
export function validateLowcodePageViewport(value: unknown): LowcodePageViewportValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'Page viewport must be a v1 policy object.' }
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) {
    return { ok: false, reason: 'Page viewport must be a plain data object.' }
  }
  const entries: Partial<Record<string, PropertyDescriptor>> =
    Object.getOwnPropertyDescriptors(value)
  if (
    Reflect.ownKeys(value).length !== 2 ||
    !entries.version ||
    !entries.mode ||
    !Object.hasOwn(entries.version, 'value') ||
    !Object.hasOwn(entries.mode, 'value')
  ) {
    return { ok: false, reason: 'Page viewport accepts only version and mode data fields.' }
  }
  if (entries.version.value !== 1) {
    return { ok: false, reason: 'Page viewport version is unsupported.' }
  }
  const mode: unknown = entries.mode.value
  if (mode !== 'responsive' && mode !== 'fit-width' && mode !== 'fixed') {
    return { ok: false, reason: 'Page viewport mode is unsupported.' }
  }
  return { ok: true, value: { version: 1, mode } }
}
