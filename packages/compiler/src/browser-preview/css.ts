import type { BrowserPreviewAssetRegistry } from './assets'
import { failBrowserPreview } from './error'
import { BROWSER_PREVIEW_LIMITS } from './limits'
import { dirname, joinRelativePath, safeAssetReference } from './path'

const encoder = new TextEncoder()
const SAFE_FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_-]*$/
const RESOURCE_PREFIX = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/|\/)/
const BLOCKED_RESOURCE_FUNCTIONS = new Set([
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade'
])

export interface BrowserPreviewCSSSource {
  path: string
  content: string
}

export interface BrowserPreviewCSSRewrite {
  content: string
  dataURLs: readonly string[]
  reviewedDataURLBytes: number
}

interface CSSURLToken {
  end: number
  value: string
}

function assertCSSOutputLimit(outputBytes: number, reviewedDataURLBytes: number): void {
  const plainCSSBytes = Math.max(0, outputBytes - reviewedDataURLBytes)
  if (
    outputBytes > BROWSER_PREVIEW_LIMITS.maxAssetExpandedCSSBytes ||
    plainCSSBytes > BROWSER_PREVIEW_LIMITS.maxCSSBytes
  ) {
    failBrowserPreview(
      'browser-preview-css-output-limit',
      'Browser preview stylesheet exceeds the output byte limit.'
    )
  }
}

function identifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_-]/.test(value)
}

function cssSyntaxError(): never {
  failBrowserPreview(
    'browser-preview-css-url-unsafe',
    'Browser preview blocked unsafe stylesheet resource syntax.'
  )
}

function skipComment(source: string, start: number): number {
  const end = source.indexOf('*/', start + 2)
  if (end === -1) cssSyntaxError()
  return end + 2
}

function readEscape(source: string, start: number): { value: string; end: number } {
  if (start >= source.length) cssSyntaxError()
  const hex = source.slice(start).match(/^[0-9A-Fa-f]{1,6}/)?.[0]
  if (hex) {
    const codePoint = Number.parseInt(hex, 16)
    if (codePoint === 0 || codePoint > 0x10ffff) cssSyntaxError()
    let end = start + hex.length
    if (/\s/.test(source[end] ?? '')) end += 1
    return { value: String.fromCodePoint(codePoint), end }
  }
  const escaped = source[start]
  if (escaped === '\n' || escaped === '\r') cssSyntaxError()
  return { value: escaped, end: start + 1 }
}

function readIdentifier(source: string, start: number): { value: string; end: number } {
  let value = ''
  let index = start
  while (index < source.length) {
    if (identifierCharacter(source[index])) {
      value += source[index++]
      continue
    }
    if (source[index] !== '\\') break
    const escaped = readEscape(source, index + 1)
    value += escaped.value
    index = escaped.end
  }
  return { value, end: index }
}

function readString(source: string, start: number): { value: string; end: number } {
  const quote = source[start]
  let value = ''
  for (let index = start + 1; index < source.length; ) {
    const character = source[index]
    if (character === quote) return { value, end: index + 1 }
    if (character === '\\') {
      const escaped = readEscape(source, index + 1)
      value += escaped.value
      index = escaped.end
      continue
    }
    value += character
    index += 1
  }
  return cssSyntaxError()
}

function quotedURL(source: string, start: number, quote: string): CSSURLToken {
  let index = start
  const valueStart = start
  while (index < source.length && source[index] !== quote) {
    if (source[index] === '\\' || source.startsWith('/*', index)) cssSyntaxError()
    index += 1
  }
  if (source[index] !== quote) cssSyntaxError()
  const value = source.slice(valueStart, index)
  index += 1
  while (/\s/.test(source[index] ?? '')) index += 1
  if (source[index] !== ')') cssSyntaxError()
  return { value, end: index + 1 }
}

function unquotedURL(source: string, start: number): CSSURLToken {
  let index = start
  const valueStart = start
  while (index < source.length && source[index] !== ')') {
    if (
      source[index] === '\\' ||
      source[index] === '"' ||
      source[index] === "'" ||
      source[index] === '(' ||
      source.startsWith('/*', index)
    ) {
      cssSyntaxError()
    }
    index += 1
  }
  if (source[index] !== ')') cssSyntaxError()
  const value = source.slice(valueStart, index).trim()
  if (/\s/.test(value)) cssSyntaxError()
  return { value, end: index + 1 }
}

function readURL(source: string, openParenthesis: number): CSSURLToken {
  let index = openParenthesis + 1
  while (/\s/.test(source[index] ?? '')) index += 1
  if (source[index] === '"' || source[index] === "'") {
    const quote = source[index++]
    return quotedURL(source, index, quote)
  }
  return unquotedURL(source, index)
}

function resolveURL(
  value: string,
  sourcePaths: readonly string[],
  files: ReadonlyMap<string, string | Uint8Array>,
  registry: BrowserPreviewAssetRegistry,
  allowedDataURLs: ReadonlySet<string>
): string {
  if (SAFE_FRAGMENT.test(value) || allowedDataURLs.has(value)) return value
  if (!safeAssetReference(value)) cssSyntaxError()
  const matches = new Map<string, Uint8Array>()
  for (const sourcePath of sourcePaths) {
    const candidate = joinRelativePath(dirname(sourcePath), value)
    if (!candidate) continue
    const content = files.get(candidate)
    if (content instanceof Uint8Array) matches.set(candidate, content)
  }
  if (matches.size !== 1) {
    failBrowserPreview(
      matches.size === 0
        ? 'browser-preview-css-asset-missing'
        : 'browser-preview-css-asset-ambiguous',
      matches.size === 0
        ? 'Browser preview stylesheet asset is missing or is not binary.'
        : 'Browser preview stylesheet asset reference is ambiguous.'
    )
  }
  const match = matches.entries().next()
  if (match.done) cssSyntaxError()
  return registry.dataURL(match.value[0], match.value[1])
}

export function rewriteBrowserPreviewCSSURLs(
  source: string,
  sourcePaths: readonly string[],
  files: ReadonlyMap<string, string | Uint8Array>,
  registry: BrowserPreviewAssetRegistry,
  allowedDataURLs: ReadonlySet<string> = new Set()
): BrowserPreviewCSSRewrite {
  if (encoder.encode(source).byteLength > BROWSER_PREVIEW_LIMITS.maxAssetExpandedCSSBytes) {
    failBrowserPreview(
      'browser-preview-css-limit',
      'Browser preview stylesheet exceeds the processing byte limit.'
    )
  }
  let index = 0
  let copiedUntil = 0
  let output = ''
  let outputBytes = 0
  let urlCount = 0
  const dataURLs = new Set<string>()
  let reviewedDataURLBytes = 0
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      index = skipComment(source, index)
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      const value = readString(source, index)
      if (RESOURCE_PREFIX.test(value.value.trim())) cssSyntaxError()
      index = value.end
      continue
    }
    if (!identifierCharacter(source[index]) && source[index] !== '\\') {
      index += 1
      continue
    }
    const identifierStart = index
    const identifier = readIdentifier(source, index)
    index = identifier.end
    while (/\s/.test(source[index] ?? '')) index += 1
    if (source[index] !== '(') continue
    const functionName = identifier.value.toLowerCase()
    if (BLOCKED_RESOURCE_FUNCTIONS.has(functionName)) {
      failBrowserPreview(
        'browser-preview-css-resource-unsupported',
        'Browser preview blocked an unsupported stylesheet resource function.'
      )
    }
    if (functionName !== 'url') continue
    urlCount += 1
    if (urlCount > BROWSER_PREVIEW_LIMITS.maxCSSURLs) {
      failBrowserPreview(
        'browser-preview-css-url-limit',
        'Browser preview stylesheet URL count exceeds the processing limit.'
      )
    }
    const token = readURL(source, index)
    const replacement = resolveURL(
      valueOrEmpty(token.value),
      sourcePaths,
      files,
      registry,
      allowedDataURLs
    )
    if (replacement.startsWith('data:')) {
      dataURLs.add(replacement)
      const replacementBytes = encoder.encode(replacement).byteLength
      reviewedDataURLBytes += replacementBytes
    }
    const prefix = source.slice(copiedUntil, identifierStart)
    const rewrittenURL = `url(${JSON.stringify(replacement)})`
    output += prefix + rewrittenURL
    outputBytes += encoder.encode(prefix).byteLength + encoder.encode(rewrittenURL).byteLength
    assertCSSOutputLimit(outputBytes, reviewedDataURLBytes)
    copiedUntil = token.end
    index = token.end
  }
  const suffix = source.slice(copiedUntil)
  output += suffix
  outputBytes += encoder.encode(suffix).byteLength
  assertCSSOutputLimit(outputBytes, reviewedDataURLBytes)
  return {
    content: output,
    dataURLs: [...dataURLs],
    reviewedDataURLBytes
  }
}

function valueOrEmpty(value: string): string {
  if (value.length === 0) cssSyntaxError()
  return value
}
