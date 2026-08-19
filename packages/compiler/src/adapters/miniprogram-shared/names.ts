import { stableNameSuffix } from '#compiler/ir/stable-name'

import { ECMASCRIPT_RESERVED_IDENTIFIERS } from '@open-pencil/lowcode'

const UNSAFE_PORTABLE_NAMES = new Set([
  '.',
  '..',
  '__proto__',
  'constructor',
  'prototype',
  'app',
  'project',
  'sitemap'
])

// Mini-program output also spans older embedded JS and WXS-like runtimes, so
// retain the legacy Java-inspired words in addition to the canonical current
// ECMAScript/strict-mode list owned by @open-pencil/lowcode.
const LEGACY_EMBEDDED_RESERVED_IDENTIFIERS = [
  'abstract',
  'boolean',
  'byte',
  'char',
  'double',
  'final',
  'float',
  'goto',
  'int',
  'long',
  'native',
  'short',
  'synchronized',
  'throws',
  'transient',
  'volatile'
] as const
const ECMASCRIPT_RESERVED_WORDS = new Set<string>([
  ...ECMASCRIPT_RESERVED_IDENTIFIERS,
  ...LEGACY_EMBEDDED_RESERVED_IDENTIFIERS
])
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i

/** A deterministic, portable lower-case name for generated mini-program paths. */
export function safeMiniProgramName(value: string, fallback = 'item', maxLength = 72): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
  const base = normalized || fallback
  const guarded =
    UNSAFE_PORTABLE_NAMES.has(base) || WINDOWS_DEVICE_NAME.test(base) ? `${fallback}-${base}` : base
  if (guarded.length <= maxLength) return guarded
  const suffix = stableNameSuffix(guarded)
  return `${guarded.slice(0, Math.max(1, maxLength - suffix.length - 1))}-${suffix}`
}

/** Allocate a portable name with case-insensitive collision handling. */
export function uniqueMiniProgramName(
  value: string,
  used: Set<string>,
  fallback = 'item',
  maxLength = 72
): string {
  const base = safeMiniProgramName(value, fallback, maxLength)
  let candidate = base
  let sequence = 2
  while (used.has(portableMiniProgramPathKey(candidate))) {
    const suffix = `-${sequence++}`
    candidate = `${base.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`
  }
  used.add(portableMiniProgramPathKey(candidate))
  return candidate
}

/** A safe JavaScript/WXS identifier; unsafe authored names never become executable source. */
export function safeMiniProgramIdentifier(value: string, fallback = 'value'): string {
  const normalized = value.replace(/[^A-Za-z0-9_$]+/g, '_')
  const prefixed = /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`
  if (
    !prefixed ||
    prefixed === '_' ||
    UNSAFE_PORTABLE_NAMES.has(prefixed) ||
    ECMASCRIPT_RESERVED_WORDS.has(prefixed)
  ) {
    return `${fallback}_${stableNameSuffix(value)}`
  }
  return prefixed.length <= 80 ? prefixed : `${prefixed.slice(0, 64)}_${stableNameSuffix(prefixed)}`
}

/** Allocate a unique JavaScript identifier after authored-name normalization. */
export function uniqueMiniProgramIdentifier(
  value: string,
  used: Set<string>,
  fallback = 'value'
): string {
  const base = safeMiniProgramIdentifier(value, fallback)
  let candidate = base
  let sequence = 2
  while (used.has(candidate)) candidate = `${base}_${sequence++}`
  used.add(candidate)
  return candidate
}

export function stableMiniProgramClassName(sourceId: string): string {
  return `op-${stableNameSuffix(sourceId)}`
}

export function portableMiniProgramPathKey(path: string): string {
  return path.normalize('NFC').toLowerCase()
}
