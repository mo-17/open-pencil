import { compile as compileTailwind } from 'tailwindcss'

import type { BrowserPreviewAssetRegistry } from './assets'
import { rewriteBrowserPreviewCSSURLs, type BrowserPreviewCSSSource } from './css'
import { failBrowserPreview } from './error'
import { BROWSER_PREVIEW_LIMITS } from './limits'
import type {
  BrowserPreviewBuildInput,
  BrowserPreviewDiagnostic,
  BrowserPreviewTailwindCompile
} from './types'

const encoder = new TextEncoder()
const SAFE_CANDIDATE = /^[!A-Za-z0-9_@#$%&*+,./:=[\]()-]+$/

function addCandidates(value: string, candidates: Set<string>): void {
  for (const raw of value.split(/\s+/)) {
    const candidate = raw.replace(/^["']+|[,"']+$/g, '')
    if (
      candidate.length === 0 ||
      encoder.encode(candidate).byteLength > BROWSER_PREVIEW_LIMITS.maxTailwindCandidateBytes ||
      !SAFE_CANDIDATE.test(candidate)
    ) {
      continue
    }
    candidates.add(candidate)
    if (candidates.size > BROWSER_PREVIEW_LIMITS.maxTailwindCandidates) {
      failBrowserPreview(
        'browser-preview-tailwind-candidate-limit',
        'Browser preview Tailwind candidates exceed the supported limit.'
      )
    }
  }
}

function skipComment(source: string, start: number): number {
  if (source[start + 1] === '/') {
    const newline = source.indexOf('\n', start + 2)
    return newline === -1 ? source.length : newline + 1
  }
  const end = source.indexOf('*/', start + 2)
  return end === -1 ? source.length : end + 2
}

function quotedLiteral(source: string, start: number): { value: string; end: number } {
  const quote = source[start]
  let value = ''
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) return { value, end: index + 1 }
    value += source[index++]
  }
  return { value: '', end: source.length }
}

function templateLiteral(
  source: string,
  start: number,
  candidates: Set<string>
): { dynamic: boolean; end: number } {
  let chunk = ''
  let dynamic = false
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === '`') {
      addCandidates(chunk, candidates)
      return { dynamic, end: index + 1 }
    }
    if (source.startsWith('${', index)) {
      addCandidates(chunk, candidates)
      chunk = ''
      dynamic = true
      index += 2
      continue
    }
    chunk += source[index++]
  }
  return { dynamic, end: source.length }
}

function extractCandidates(files: ReadonlyMap<string, string | Uint8Array>): {
  candidates: readonly string[]
  dynamic: boolean
} {
  const candidates = new Set<string>()
  let dynamic = false
  for (const [path, source] of files) {
    if (typeof source !== 'string' || !path.startsWith('src/')) continue
    let index = 0
    while (index < source.length) {
      if (source.startsWith('//', index) || source.startsWith('/*', index)) {
        index = skipComment(source, index)
        continue
      }
      if (source[index] === '"' || source[index] === "'") {
        const literal = quotedLiteral(source, index)
        addCandidates(literal.value, candidates)
        index = literal.end
        continue
      }
      if (source[index] === '`') {
        const literal = templateLiteral(source, index, candidates)
        dynamic ||= literal.dynamic
        index = literal.end
        continue
      }
      index += 1
    }
    dynamic ||= /\bclassName\s*=\s*\{/.test(source)
  }
  return { candidates: [...candidates].sort(), dynamic }
}

function skipWhitespace(source: string, start: number): number {
  let index = start
  while (/\s/.test(source[index] ?? '')) index += 1
  return index
}

function inlineSourceEnd(source: string, start: number): number {
  let index = skipWhitespace(source, start)
  if (source.slice(index, index + 6).toLowerCase() !== 'inline') unsafeDirective()
  index = skipWhitespace(source, index + 6)
  if (source[index++] !== '(') unsafeDirective()
  index = skipWhitespace(source, index)
  const quote = source[index++]
  if (quote !== '"' && quote !== "'") unsafeDirective()
  while (index < source.length && source[index] !== quote) {
    if (source[index] === '\\' || source[index] === '{' || source[index] === '}') unsafeDirective()
    index += 1
  }
  if (source[index++] !== quote) unsafeDirective()
  index = skipWhitespace(source, index)
  if (source[index++] !== ')') unsafeDirective()
  index = skipWhitespace(source, index)
  if (source[index++] !== ';') unsafeDirective()
  return index
}

function unsafeDirective(): never {
  failBrowserPreview(
    'browser-preview-tailwind-directive-unsafe',
    'Browser preview blocked an unsafe Tailwind source directive.'
  )
}

function stripTailwindSourceDirectives(source: string): string {
  let index = 0
  let copiedUntil = 0
  let output = ''
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      index = skipComment(source, index)
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      index = quotedLiteral(source, index).end
      continue
    }
    if (source[index] !== '@') {
      index += 1
      continue
    }
    const directiveStart = index++
    const nameStart = index
    while (/[A-Za-z-]/.test(source[index] ?? '')) index += 1
    const name = source.slice(nameStart, index).toLowerCase()
    if (name === 'plugin' || name === 'config') unsafeDirective()
    if (name !== 'source') continue
    index = inlineSourceEnd(source, index)
    output += source.slice(copiedUntil, directiveStart)
    copiedUntil = index
  }
  return output + source.slice(copiedUntil)
}

async function defaultTailwindStylesheet(): Promise<string> {
  const stylesheet = (await import('tailwindcss/index.css?raw')) as Readonly<{ default?: unknown }>
  if (typeof stylesheet.default !== 'string') {
    failBrowserPreview(
      'browser-preview-tailwind-runtime-unavailable',
      'Browser preview could not load the pinned Tailwind 4 browser stylesheet.'
    )
  }
  return stylesheet.default
}

export async function buildBrowserPreviewCSS(
  input: BrowserPreviewBuildInput,
  sources: readonly BrowserPreviewCSSSource[],
  files: ReadonlyMap<string, string | Uint8Array>,
  registry: BrowserPreviewAssetRegistry
): Promise<{
  css: string
  diagnostics: BrowserPreviewDiagnostic[]
  reviewedDataURLBytes: number
}> {
  if (sources.length === 0) return { css: '', diagnostics: [], reviewedDataURLBytes: 0 }
  const extracted = extractCandidates(files)
  const allowedDataURLs = new Set<string>()
  const ordered = [...sources].sort((left, right) => left.path.localeCompare(right.path))
  const prepared = ordered.map((source) => {
    const stripped = stripTailwindSourceDirectives(source.content)
    const rewritten = rewriteBrowserPreviewCSSURLs(stripped, [source.path], files, registry)
    for (const value of rewritten.dataURLs) allowedDataURLs.add(value)
    return rewritten.content
  })
  const stylesheet = input.tailwindStylesheet ?? (await defaultTailwindStylesheet())
  const tailwind: BrowserPreviewTailwindCompile = input.tailwindCompile ?? compileTailwind
  const compiler = await tailwind(prepared.join('\n'), {
    async loadStylesheet(id) {
      if (id !== 'tailwindcss') {
        failBrowserPreview(
          'browser-preview-stylesheet-import-unsupported',
          'Browser preview supports only the pinned Tailwind stylesheet import.'
        )
      }
      return { path: 'tailwindcss/index.css', base: '', content: stylesheet }
    }
  })
  const built = compiler.build(extracted.candidates)
  const rewritten = rewriteBrowserPreviewCSSURLs(
    built,
    ordered.map((source) => source.path),
    files,
    registry,
    allowedDataURLs
  )
  const diagnostics: BrowserPreviewDiagnostic[] = extracted.dynamic
    ? [
        {
          code: 'browser-preview-dynamic-tailwind-candidates-omitted',
          severity: 'warning',
          message:
            'Dynamic Tailwind class expressions cannot be fully discovered; bounded static candidates were compiled.'
        }
      ]
    : []
  return {
    css: rewritten.content,
    diagnostics,
    reviewedDataURLBytes: rewritten.reviewedDataURLBytes
  }
}
