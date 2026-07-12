import type { LowcodeHeadMetaKind } from '#core/scene-graph'

import type { ValidationResult } from './validate'

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
