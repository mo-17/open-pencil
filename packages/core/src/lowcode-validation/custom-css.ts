import type { ValidationResult } from './validate'

const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/gi
const CSS_URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi

export function validateLowcodeCustomCss(css: string): ValidationResult {
  const unsafe = unsafeLowcodeCustomCssUrls(css)
  if (unsafe.length === 0) return { ok: true }
  return { ok: false, reason: `custom CSS contains unsafe url protocol: ${unsafe[0]}` }
}

export function unsafeLowcodeCustomCssUrls(css: string): string[] {
  return lowcodeCustomCssUrls(css).filter((url) => !isSafeLowcodeCustomCssUrl(url))
}

export function lowcodeCustomCssUrls(css: string): string[] {
  const urls = new Set<string>()
  for (const match of css.matchAll(CSS_IMPORT_RE)) {
    const value = cleanCssUrl(match[1] ?? '')
    if (value) urls.add(value)
  }
  for (const match of css.matchAll(CSS_URL_RE)) {
    const value = cleanCssUrl(match[2] ?? '')
    if (value) urls.add(value)
  }
  return [...urls]
}

function cleanCssUrl(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '')
}

function isSafeLowcodeCustomCssUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (trimmed.startsWith('//')) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return /^https?:/i.test(trimmed)
  return true
}
