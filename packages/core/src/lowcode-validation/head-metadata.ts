import type { LowcodeHeadMetaKind, LowcodeHeadMetadata } from '@open-pencil/scene-graph'

import { validateLowcodeCustomCss } from './custom-css'
import type { ValidationResult } from './validate'

export function compactLowcodeHeadMetadata(
  value: LowcodeHeadMetadata | undefined
): LowcodeHeadMetadata | undefined {
  if (!value) return undefined
  const meta = value.meta
    ?.map((entry) => ({
      kind: entry.kind,
      key: entry.key.trim(),
      content: entry.content.trim()
    }))
    .filter(
      (entry) =>
        entry.key !== '' &&
        entry.content !== '' &&
        validateLowcodeHeadMeta(entry.kind, entry.key, entry.content).ok
    )
  const link = value.link
    ?.map((entry) => ({
      rel: entry.rel.trim(),
      href: entry.href.trim(),
      ...(entry.as?.trim() ? { as: entry.as.trim() } : {}),
      ...(entry.type?.trim() ? { type: entry.type.trim() } : {}),
      ...(entry.media?.trim() ? { media: entry.media.trim() } : {}),
      ...(entry.crossorigin ? { crossorigin: entry.crossorigin } : {})
    }))
    .filter(
      (entry) => entry.rel !== '' && entry.href !== '' && isSafeLowcodeHeadLinkHref(entry.href)
    )
  const styles = value.styles
    ?.map((style) => style.trim())
    .filter((style) => style !== '' && validateLowcodeCustomCss(style).ok)
  const compacted: LowcodeHeadMetadata = {}
  if (meta?.length) compacted.meta = meta
  if (link?.length) compacted.link = link
  if (styles?.length) compacted.styles = styles
  return Object.keys(compacted).length > 0 ? compacted : undefined
}

export function isSafeLowcodeHeadLinkHref(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('//')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return /^(https?|mailto|tel):/i.test(trimmed)
  }
  return true
}

export function validateLowcodeHeadMeta(
  kind: LowcodeHeadMetaKind,
  key: string,
  content: string
): ValidationResult {
  if (kind !== 'httpEquiv' || key.trim().toLowerCase() !== 'refresh') return { ok: true }
  const url = refreshUrl(content)
  if (!url || isSafeRefreshUrl(url)) return { ok: true }
  return { ok: false, reason: `http-equiv refresh url must be http(s) or relative: ${url}` }
}

export function unsafeLowcodeHeadMetaRefreshUrl(
  kind: LowcodeHeadMetaKind,
  key: string,
  content: string
): string | undefined {
  const url =
    kind === 'httpEquiv' && key.trim().toLowerCase() === 'refresh' ? refreshUrl(content) : undefined
  return url && !isSafeRefreshUrl(url) ? url : undefined
}

function refreshUrl(content: string): string | undefined {
  const match = content.match(/(?:^|;)\s*url\s*=\s*(.+)\s*$/i)
  const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  return value || undefined
}

function isSafeRefreshUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('//')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return /^https?:/i.test(trimmed)
  return true
}
