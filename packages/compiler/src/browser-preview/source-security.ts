import { findCodePenSecretKinds } from '@open-pencil/lowcode'

import { isBrowserPreviewFontPath } from './assets'
import { BrowserPreviewBuildError, failBrowserPreview } from './error'
import { BROWSER_PREVIEW_LIMITS } from './limits'
import { normalizeRelativePath } from './path'
import type { BrowserPreviewBuildInput, BrowserPreviewDiagnostic } from './types'

const encoder = new TextEncoder()
const binaryDecoder = new TextDecoder('latin1')
const PACKAGE_SPECIFIER =
  /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[A-Za-z0-9._-]+)*$/
const HOST_PATH =
  /(?:file:\/\/|(?:^|[\s"'`])\/(?:Users|home|root|private|Volumes)\/|(?:^|[\s"'`])[A-Za-z]:\\(?:Users|Documents and Settings)\\)/m

export interface ValidatedBrowserPreviewInput {
  files: Map<string, string | Uint8Array>
  inputBytes: number
  assetCount: number
}

function validateTarget(target: unknown): void {
  if (target !== 'react' && target !== 'vue') {
    failBrowserPreview(
      'browser-preview-target-invalid',
      'Browser preview target must be React or Vue.'
    )
  }
}

export function isSafeBrowserPackageSpecifier(specifier: string): boolean {
  if (
    !PACKAGE_SPECIFIER.test(specifier) ||
    specifier.includes('?') ||
    specifier.includes('#') ||
    specifier.includes('\\')
  ) {
    return false
  }
  return specifier.split('/').every((part) => part !== '.' && part !== '..')
}

function wordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$]/.test(value)
}

function dynamicImportAt(source: string, start: number): boolean {
  if (
    !source.startsWith('import', start) ||
    wordCharacter(source[start - 1]) ||
    wordCharacter(source[start + 6])
  ) {
    return false
  }
  let index = start + 6
  while (/\s/.test(source[index] ?? '')) index += 1
  return source[index] === '('
}

/** Ignores comments and string literals while conservatively detecting import(...). */
// eslint-disable-next-line complexity -- This bounded lexer must track comments, strings, and templates together.
export function hasBrowserDynamicImport(source: string): boolean {
  type State = 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment'
  const states: State[] = ['code']
  const templateExpressionDepth: number[] = []
  for (let index = 0; index < source.length; index++) {
    const state = states.at(-1)
    const char = source[index]
    const next = source[index + 1]
    if (state === 'line-comment') {
      if (char === '\n') states.pop()
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        states.pop()
        index += 1
      }
      continue
    }
    if (state === 'single' || state === 'double') {
      if (char === '\\') index += 1
      else if ((state === 'single' && char === "'") || (state === 'double' && char === '"')) {
        states.pop()
      }
      continue
    }
    if (state === 'template') {
      if (char === '\\') index += 1
      else if (char === '`') states.pop()
      else if (char === '$' && next === '{') {
        states.push('code')
        templateExpressionDepth.push(1)
        index += 1
      }
      continue
    }
    if (char === '/' && next === '/') {
      states.push('line-comment')
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      states.push('block-comment')
      index += 1
      continue
    }
    if (char === "'") {
      states.push('single')
      continue
    }
    if (char === '"') {
      states.push('double')
      continue
    }
    if (char === '`') {
      states.push('template')
      continue
    }
    if (templateExpressionDepth.length > 0) {
      const last = templateExpressionDepth.length - 1
      if (char === '{') templateExpressionDepth[last] += 1
      if (char === '}') {
        templateExpressionDepth[last] -= 1
        if (templateExpressionDepth[last] === 0) {
          templateExpressionDepth.pop()
          states.pop()
          continue
        }
      }
    }
    if (dynamicImportAt(source, index)) return true
  }
  return false
}

function validateChannel(channel: string): void {
  if (
    typeof channel !== 'string' ||
    encoder.encode(channel).byteLength > BROWSER_PREVIEW_LIMITS.maxChannelBytes ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(channel)
  ) {
    failBrowserPreview(
      'browser-preview-channel-invalid',
      'Browser preview channel must be a 16-128 byte URL-safe identifier.'
    )
  }
}

function validateWasmURL(wasmURL: string): void {
  if (
    typeof wasmURL !== 'string' ||
    wasmURL.length === 0 ||
    encoder.encode(wasmURL).byteLength > BROWSER_PREVIEW_LIMITS.maxWasmURLBytes ||
    hasASCIIWhitespaceOrControl(wasmURL) ||
    wasmURL.includes('\\')
  ) {
    failBrowserPreview(
      'browser-preview-wasm-url-invalid',
      'Browser preview esbuild WASM URL is invalid.'
    )
  }
  const relative =
    (wasmURL.startsWith('/') && !wasmURL.startsWith('//')) ||
    wasmURL.startsWith('./') ||
    wasmURL.startsWith('../')
  if (typeof location === 'undefined') {
    if (relative) return
    failBrowserPreview(
      'browser-preview-wasm-origin-invalid',
      'Browser preview esbuild WASM origin cannot be verified outside a browser Worker.'
    )
  }
  let parsed: URL
  try {
    parsed = new URL(wasmURL, location.href)
  } catch {
    failBrowserPreview(
      'browser-preview-wasm-url-invalid',
      'Browser preview esbuild WASM URL must be relative or use same-origin HTTP(S)/Blob.'
    )
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'blob:') {
    failBrowserPreview(
      'browser-preview-wasm-url-invalid',
      'Browser preview esbuild WASM URL uses a blocked protocol.'
    )
  }
  if (parsed.origin !== location.origin) {
    failBrowserPreview(
      'browser-preview-wasm-origin-invalid',
      'Browser preview esbuild WASM must load from the editor origin.'
    )
  }
}

function hasASCIIWhitespaceOrControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x20 || code === 0x7f) return true
  }
  return false
}

function scanForSecrets(files: ReadonlyMap<string, string | Uint8Array>): void {
  const diagnostics: BrowserPreviewDiagnostic[] = []
  for (const [path, content] of files) {
    const source = typeof content === 'string' ? content : binaryDecoder.decode(content)
    if (HOST_PATH.test(source)) {
      diagnostics.push({
        code: 'browser-preview-local-path-detected',
        severity: 'error',
        path,
        message: 'Browser preview blocked a generated artifact containing a local filesystem path.'
      })
    }
    for (const kind of findCodePenSecretKinds(source)) {
      diagnostics.push({
        code: 'browser-preview-secret-detected',
        severity: 'error',
        path,
        message: `Browser preview blocked ${kind} in a generated artifact.`
      })
      if (diagnostics.length >= BROWSER_PREVIEW_LIMITS.maxDiagnostics) break
    }
    if (diagnostics.length >= BROWSER_PREVIEW_LIMITS.maxDiagnostics) break
  }
  if (diagnostics.length > 0) failBrowserPreviewDiagnostics(diagnostics)
}

function failBrowserPreviewDiagnostics(diagnostics: readonly BrowserPreviewDiagnostic[]): never {
  throw new BrowserPreviewBuildError(diagnostics)
}

export function validateBrowserPreviewInput(
  input: BrowserPreviewBuildInput
): ValidatedBrowserPreviewInput {
  validateTarget(input.target)
  validateChannel(input.channel)
  validateWasmURL(input.wasmURL)
  if (!(input.files instanceof Map)) {
    failBrowserPreview(
      'browser-preview-files-invalid',
      'Browser preview input files must be a detached Map snapshot.'
    )
  }
  if (input.files.size === 0 || input.files.size > BROWSER_PREVIEW_LIMITS.maxFiles) {
    failBrowserPreview(
      'browser-preview-file-limit',
      'Browser preview generated file count is outside the supported limit.'
    )
  }
  let inputBytes = 0
  let assetCount = 0
  const files = new Map<string, string | Uint8Array>()
  for (const [path, content] of input.files) {
    const safePath = normalizeRelativePath(path)
    if (
      safePath !== path ||
      encoder.encode(path).byteLength > BROWSER_PREVIEW_LIMITS.maxPathBytes
    ) {
      failBrowserPreview(
        'browser-preview-path-invalid',
        'Browser preview blocked an unsafe generated project path.',
        path
      )
    }
    let byteLength = -1
    if (typeof content === 'string') byteLength = encoder.encode(content).byteLength
    else if (content instanceof Uint8Array) byteLength = content.byteLength
    const fontAsset = content instanceof Uint8Array && isBrowserPreviewFontPath(path)
    let maximum = BROWSER_PREVIEW_LIMITS.maxBinaryFileBytes
    if (typeof content === 'string') maximum = BROWSER_PREVIEW_LIMITS.maxTextFileBytes
    else if (fontAsset) maximum = BROWSER_PREVIEW_LIMITS.maxFontFileBytes
    if (byteLength < 0 || byteLength > maximum) {
      if (fontAsset && byteLength > BROWSER_PREVIEW_LIMITS.maxFontFileBytes) {
        failBrowserPreview(
          'browser-preview-font-size-limit',
          `Browser preview font assets must be ${BROWSER_PREVIEW_LIMITS.maxFontFileBytes / 1024 / 1024} MiB or smaller.`,
          path
        )
      }
      failBrowserPreview(
        'browser-preview-file-size-limit',
        'Browser preview blocked an oversized or invalid generated file.',
        path
      )
    }
    inputBytes += byteLength
    if (!Number.isSafeInteger(inputBytes) || inputBytes > BROWSER_PREVIEW_LIMITS.maxInputBytes) {
      failBrowserPreview(
        'browser-preview-input-limit',
        'Browser preview generated input exceeds the aggregate byte limit.'
      )
    }
    if (content instanceof Uint8Array) assetCount += 1
    files.set(path, content)
  }
  if (assetCount > BROWSER_PREVIEW_LIMITS.maxAssets) {
    failBrowserPreview(
      'browser-preview-asset-count-limit',
      'Browser preview generated assets exceed the supported count.'
    )
  }
  scanForSecrets(files)
  return { files, inputBytes, assetCount }
}
