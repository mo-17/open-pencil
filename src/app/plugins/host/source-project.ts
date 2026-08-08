export function safeSourceProjectPackageName(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
  if (normalized) {
    const safeBase = NPM_RESERVED_PACKAGE_NAMES.has(normalized)
      ? `openpencil-${normalized}`
      : normalized
    const suffix =
      containsNonAscii(value) || safeBase.length > 128 ? `-${stableSourceNameSuffix(value)}` : ''
    return `${safeBase.slice(0, 128 - suffix.length).replace(/[-._]+$/g, '')}${suffix}`
  }
  return /[\p{L}\p{N}]/u.test(value)
    ? `openpencil-app-${stableSourceNameSuffix(value)}`
    : 'openpencil-app'
}

export function safeSourceProjectProductName(value: string): string {
  const normalized = Array.from(value.normalize('NFC'))
    .filter((character) => !/[\p{Cc}\p{Cf}]/u.test(character))
    .join('')
    .trim()
  return Array.from(normalized).slice(0, 128).join('') || 'OpenPencil App'
}

const NPM_RESERVED_PACKAGE_NAMES = new Set(['favicon.ico', 'node_modules'])

function containsNonAscii(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) return true
  }
  return false
}

function stableSourceNameSuffix(value: string): string {
  let hash = 0x811c9dc5
  for (const character of value.normalize('NFKC')) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
