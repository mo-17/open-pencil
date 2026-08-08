import { stableNameSuffix } from '#compiler/ir/stable-name'

const DART_KEYWORDS = new Set([
  'abstract',
  'as',
  'assert',
  'async',
  'await',
  'base',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'covariant',
  'default',
  'deferred',
  'do',
  'dynamic',
  'else',
  'enum',
  'export',
  'extends',
  'extension',
  'external',
  'factory',
  'false',
  'final',
  'finally',
  'for',
  'Function',
  'get',
  'hide',
  'if',
  'implements',
  'import',
  'in',
  'interface',
  'is',
  'late',
  'library',
  'mixin',
  'new',
  'null',
  'of',
  'on',
  'operator',
  'part',
  'required',
  'rethrow',
  'return',
  'sealed',
  'set',
  'show',
  'static',
  'super',
  'switch',
  'sync',
  'this',
  'throw',
  'true',
  'try',
  'typedef',
  'var',
  'void',
  'when',
  'while',
  'with',
  'yield'
])

const RUNTIME_IDENTIFIERS = new Set([
  'build',
  'context',
  'createState',
  'createElement',
  'activate',
  'deactivate',
  'didChangeDependencies',
  'didUpdateWidget',
  'hashCode',
  'noSuchMethod',
  'reassemble',
  'toString',
  'dispose',
  'initState',
  'mounted',
  'runtimeType',
  'setState',
  'widget',
  'debugDescribeChildren',
  'debugFillProperties',
  'OpenPencilDocumentState',
  'OpenPencilRuntime'
])

const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i

export function dartString(value: string): string {
  return escapeJsonUnsafe(JSON.stringify(wellFormedString(value))).replaceAll('$', '\\$')
}

export function yamlString(value: string): string {
  return escapeJsonUnsafe(JSON.stringify(wellFormedString(value)))
}

export function dartPackageName(value: string): string {
  let name = snakeCase(value, 'openpencil_flutter_app')
  if (/^\d/.test(name)) name = `openpencil_${name}`
  if (DART_KEYWORDS.has(name)) name = `openpencil_${name}`
  const needsHash = hasNonAscii(value) || name.length > 64
  if (needsHash) name = withStableSuffix(name, value, 64, '_')
  return name || 'openpencil_flutter_app'
}

export function portableDartFileName(value: string, fallback = 'page'): string {
  let name = snakeCase(value, fallback)
  if (name === '.' || name === '..' || WINDOWS_DEVICE_NAME.test(name)) name = `${fallback}_${name}`
  if (hasNonAscii(value) || name.length > 80) {
    name = withStableSuffix(name, value, 80, '_')
  }
  return `${name}.dart`
}

export function dartClassName(value: string, fallback = 'OpenPencilWidget'): string {
  const words = asciiWords(value)
  let name = words.map(capitalize).join('') || fallback
  if (/^\d/.test(name)) name = `OpenPencil${name}`
  if (DART_KEYWORDS.has(name)) name = `${name}Widget`
  if (hasNonAscii(value) || name.length > 96) {
    name = withStableSuffix(name, value, 96, '')
  }
  return name
}

export function dartIdentifier(value: string, fallback = 'value'): string {
  const words = asciiWords(value)
  let name = words.length
    ? `${words[0].toLowerCase()}${words.slice(1).map(capitalize).join('')}`
    : fallback
  if (!/^[A-Za-z_]/.test(name)) name = `${fallback}${capitalize(name)}`
  if (DART_KEYWORDS.has(name) || RUNTIME_IDENTIFIERS.has(name)) name = `${name}Value`
  if (hasNonAscii(value) || name.length > 96) {
    name = withStableSuffix(name, value, 96, '')
  }
  return name
}

export function allocateDartIdentifier(
  value: string,
  used: Set<string>,
  fallback = 'value'
): string {
  const base = dartIdentifier(value, fallback)
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    const marker = String(suffix++)
    candidate = `${base.slice(0, 96 - marker.length)}${marker}`
  }
  used.add(candidate)
  return candidate
}

export function portableFileKey(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

function snakeCase(value: string, fallback: string): string {
  const words = asciiWords(value)
  const normalized = words
    .map((word) => word.toLowerCase())
    .join('_')
    .replace(/_+/g, '_')
  return normalized || fallback
}

function asciiWords(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9_]+/)
    .flatMap((part) => part.split('_'))
    .filter(Boolean)
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`
}

function withStableSuffix(
  value: string,
  source: string,
  maxLength: number,
  separator: string
): string {
  const suffix = `${separator}${stableNameSuffix(source)}`
  return `${value.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`
}

function escapeJsonUnsafe(value: string): string {
  let escaped = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    escaped += isUnsafeJsonCodePoint(codePoint)
      ? `\\u${codePoint.toString(16).padStart(4, '0')}`
      : character
  }
  return escaped
}

function isUnsafeJsonCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff
  )
}

function hasNonAscii(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) return true
  }
  return false
}

function wellFormedString(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1]
        index++
      } else {
        result += '\ufffd'
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += '\ufffd'
    } else {
      result += value[index]
    }
  }
  return result
}
