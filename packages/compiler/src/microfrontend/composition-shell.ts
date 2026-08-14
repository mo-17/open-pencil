#!/usr/bin/env bun
/* eslint-disable max-lines -- emitted composition runtime stays self-contained beside its strict loader contract */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

import { build } from 'vite'

import {
  assertSafeBuildOutputDirectory,
  recordManagedBuildOutput,
  type BuildResult
} from '../build'
import { inMemoryVFS, prepareVfsRoot, type PreviewFiles } from '../vfs'
import {
  OPENPENCIL_MICROFRONTEND_ABI_V1,
  OPENPENCIL_MICROFRONTEND_COMPOSITION_FILENAME,
  OPENPENCIL_MICROFRONTEND_LIMITS
} from './constants'
import {
  microfrontendSha256Base64URL,
  parseOpenPencilMicrofrontendCompositionManifest,
  parseOpenPencilMicrofrontendRuntimeManifestJSON,
  serializeOpenPencilMicrofrontendCompositionManifest,
  serializeOpenPencilMicrofrontendRuntimeManifest
} from './manifest'
import type {
  OpenPencilMicrofrontendCompositionManifestV1,
  OpenPencilMicrofrontendRuntimeAssetV1
} from './types'

export interface CompositionShellBuildOptions {
  composition: unknown
  outDir: string
  fsRoot?: string
  base?: string
  /** Directory containing the source composition manifest. Required when the
   * composition contains manifest-relative local application coordinates. */
  sourceDir?: string
}

export interface CompositionShellBuildResult extends BuildResult {
  composition: OpenPencilMicrofrontendCompositionManifestV1
  compositionPath: string
}

interface LocalCompositionArtifact {
  path: string
  bytes: Uint8Array
}

const SHELL_RESERVED_OUTPUT_PATHS = new Set([
  '.openpencil-build-output.json',
  OPENPENCIL_MICROFRONTEND_COMPOSITION_FILENAME,
  'index.html'
])
const SAFE_COMPOSITION_BASE_SEGMENT = /^[A-Za-z0-9._~!$&'()+,;=@-]+$/

/** Parse the public path shared by the composition builder and loopback preview.
 * Keeping this contract here prevents a built shell from resolving copied local
 * manifests against a different URL root than the preview server. */
export function parseCompositionShellBase(value = '/'): string {
  const segments = value === '/' ? [] : value.slice(1, -1).split('/')
  if (
    value.length > OPENPENCIL_MICROFRONTEND_LIMITS.maxPathLength ||
    !value.startsWith('/') ||
    !value.endsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('%') ||
    value.normalize('NFC') !== value ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        !SAFE_COMPOSITION_BASE_SEGMENT.test(segment)
    )
  ) {
    throw new TypeError('Composition shell base must be a canonical root path ending in /')
  }
  return value
}

function reserveLocalOutput(
  outputs: Map<string, { bytes: Uint8Array; kind: 'asset' | 'manifest' }>,
  path: string,
  bytes: Uint8Array,
  label: string,
  kind: 'asset' | 'manifest'
): void {
  if (SHELL_RESERVED_OUTPUT_PATHS.has(path) || path.startsWith('assets/')) {
    throw new Error(`${label} collides with a composition shell output at ${path}`)
  }
  const previous = outputs.get(path)
  if (previous) {
    if (
      previous.kind !== kind ||
      kind === 'manifest' ||
      microfrontendSha256Base64URL(previous.bytes) !== microfrontendSha256Base64URL(bytes)
    ) {
      throw new Error(`${label} collides with another local artifact at ${path}`)
    }
    return
  }
  outputs.set(path, { bytes, kind })
}

function assertContainedPath(root: string, candidate: string, label: string): string {
  const unresolved = relative(root, candidate)
  if (unresolved === '..' || unresolved.startsWith(`..${sep}`) || isAbsolute(unresolved)) {
    throw new Error(`${label} resolves outside its composition directory`)
  }
  let current = root
  for (const segment of unresolved.split(sep)) {
    if (!segment) continue
    current = join(current, segment)
    if (!existsSync(current)) throw new Error(`${label} does not exist: ${candidate}`)
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} must not traverse a symbolic link`)
    }
  }
  const canonical = realpathSync(candidate)
  const path = relative(root, canonical)
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`${label} resolves outside its composition directory`)
  }
  return canonical
}

function readRegularFile(path: string, maximum: number, label: string): Uint8Array {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`)
  if (stat.size > maximum) throw new Error(`${label} exceeds ${maximum} bytes`)
  return new Uint8Array(readFileSync(path))
}

function outputPathForLocalCoordinate(path: string): string {
  if (!path.startsWith('./'))
    throw new Error('Local composition coordinates must be manifest-relative')
  return path.slice(2)
}

function localAssetCoordinate(
  manifestOutputPath: string,
  assetPath: string
): { manifestPath: string; outputPath: string } {
  const manifestPath = assetPath.startsWith('/')
    ? `./.openpencil-root/${assetPath.slice(1)}`
    : assetPath
  const result = resolve('/', dirname(manifestOutputPath), manifestPath).slice(1)
  if (!result || result.startsWith('../'))
    throw new Error('Local runtime asset path escapes output')
  return { manifestPath, outputPath: result }
}

/** Read and verify every local runtime manifest/artifact before the shell build
 * touches its output. The returned copies are immutable, digest-pinned inputs
 * for the owned build directory. */
export function collectLocalCompositionArtifacts(
  composition: OpenPencilMicrofrontendCompositionManifestV1,
  sourceDir: string | undefined
): LocalCompositionArtifact[] {
  const localApps = composition.apps.filter((app) => app.manifest.kind === 'local')
  if (localApps.length === 0) return []
  if (!sourceDir) {
    throw new Error(
      'A composition sourceDir is required when local microfrontend manifests are used'
    )
  }
  const rootPath = resolve(sourceDir)
  if (!existsSync(rootPath) || !lstatSync(rootPath).isDirectory()) {
    throw new Error(`Composition sourceDir must be an existing directory: ${sourceDir}`)
  }
  const root = realpathSync(rootPath)
  const outputs = new Map<string, { bytes: Uint8Array; kind: 'asset' | 'manifest' }>()
  for (const app of localApps) {
    if (app.manifest.kind !== 'local') continue
    const manifestOutput = outputPathForLocalCoordinate(app.manifest.path)
    const manifestCandidate = resolve(root, app.manifest.path)
    const manifestSource = assertContainedPath(
      root,
      manifestCandidate,
      `Local manifest for ${app.appId}`
    )
    const manifestBytes = readRegularFile(
      manifestSource,
      OPENPENCIL_MICROFRONTEND_LIMITS.maxRuntimeManifestJsonBytes,
      `Local manifest for ${app.appId}`
    )
    const manifest = parseOpenPencilMicrofrontendRuntimeManifestJSON(
      new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)
    )
    if (manifest.app.id !== app.appId) {
      throw new Error(`Local manifest app id ${manifest.app.id} does not match ${app.appId}`)
    }
    const rewrittenAssets: OpenPencilMicrofrontendRuntimeAssetV1[] = []
    let runtimeAssetBytes = 0
    for (const asset of [manifest.artifact.entry, ...manifest.artifact.styles]) {
      runtimeAssetBytes += asset.byteLength
      if (
        !Number.isSafeInteger(runtimeAssetBytes) ||
        runtimeAssetBytes > OPENPENCIL_MICROFRONTEND_LIMITS.maxAssetByteLength
      ) {
        throw new Error(`Local runtime ${app.appId} aggregate assets exceed the build limit`)
      }
      const assetCandidate = asset.path.startsWith('/')
        ? resolve(root, `.${asset.path}`)
        : resolve(dirname(manifestSource), asset.path)
      const assetSource = assertContainedPath(root, assetCandidate, `Local asset ${asset.path}`)
      const bytes = readRegularFile(assetSource, asset.byteLength, `Local asset ${asset.path}`)
      if (bytes.byteLength !== asset.byteLength) {
        throw new Error(`Local asset byte length does not match its manifest: ${asset.path}`)
      }
      if (microfrontendSha256Base64URL(bytes) !== asset.digest) {
        throw new Error(`Local asset SHA-256 digest does not match its manifest: ${asset.path}`)
      }
      const coordinate = localAssetCoordinate(manifestOutput, asset.path)
      reserveLocalOutput(
        outputs,
        coordinate.outputPath,
        bytes,
        `Local asset ${asset.path}`,
        'asset'
      )
      rewrittenAssets.push({ ...asset, path: coordinate.manifestPath })
    }
    const rewrittenManifest = new TextEncoder().encode(
      serializeOpenPencilMicrofrontendRuntimeManifest({
        ...manifest,
        artifact: {
          entry: rewrittenAssets[0],
          styles: rewrittenAssets.slice(1)
        }
      })
    )
    reserveLocalOutput(
      outputs,
      manifestOutput,
      rewrittenManifest,
      `Local manifest for ${app.appId}`,
      'manifest'
    )
  }
  return [...outputs].map(([path, entry]) => ({ path, bytes: entry.bytes }))
}

function writeLocalCompositionArtifacts(
  outDir: string,
  artifacts: readonly LocalCompositionArtifact[]
): void {
  for (const artifact of artifacts) {
    const destination = join(outDir, artifact.path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, artifact.bytes)
  }
}

function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const COMPOSITION_RUNTIME = String.raw`
type JSONObject = { readonly [key: string]: unknown }
type Coordinate =
  | { readonly kind: 'local'; readonly path: string }
  | { readonly kind: 'remote'; readonly url: string; readonly digest: string; readonly byteLength: number }
type CompositionApp = {
  readonly appId: string
  readonly manifest: Coordinate
  readonly routeBase: string
  readonly slotId: string
}
type RuntimeAsset = {
  readonly path: string
  readonly mediaType: 'text/javascript' | 'text/css'
  readonly byteLength: number
  readonly digest: string
}
type RuntimeManifest = {
  readonly format: 'openpencil-microfrontend'
  readonly schemaVersion: 1
  readonly abi: 'openpencil.microfrontend.v1'
  readonly app: { readonly id: string; readonly framework: 'react' | 'vue' }
  readonly artifact: {
    readonly entry: RuntimeAsset & { readonly mediaType: 'text/javascript' }
    readonly styles: readonly (RuntimeAsset & { readonly mediaType: 'text/css' })[]
  }
}
type RuntimeContext = {
  readonly appId: string
  readonly basePath: string
  readonly location: { readonly pathname: string; readonly search: string; readonly hash: string }
  readonly portalTarget: HTMLElement
  navigate(to: string): void
  readonly events: {
    publish(topic: string, payload: unknown): void
    subscribe(topic: string, handler: (payload: unknown) => void): () => void
  }
}
type RuntimeModule = {
  bootstrap(): Promise<void>
  mount(container: HTMLElement, context: RuntimeContext): Promise<void>
  update(context: RuntimeContext): Promise<void>
  unmount(): Promise<void>
}
type LoadedApp = {
  readonly module: RuntimeModule
  readonly styles: readonly string[]
}
type MountedApp = LoadedApp & {
  readonly app: CompositionApp
  readonly container: HTMLElement
  readonly shadowRoot: ShadowRoot
}

const ABI = ${JSON.stringify(OPENPENCIL_MICROFRONTEND_ABI_V1)}
const MAX_MANIFEST_BYTES = ${OPENPENCIL_MICROFRONTEND_LIMITS.maxRuntimeManifestJsonBytes}
const MAX_ASSET_BYTES = ${OPENPENCIL_MICROFRONTEND_LIMITS.maxAssetByteLength}
const MANIFEST_TIMEOUT_MS = 15_000
const ASSET_TIMEOUT_MS = 60_000
const compositionBaseURL = new URL(
  '../' + ${JSON.stringify(OPENPENCIL_MICROFRONTEND_COMPOSITION_FILENAME)},
  import.meta.url
)
const shellBaseURL = new URL('./', compositionBaseURL)
const shellBasePath = shellBaseURL.pathname === '/' ? '/' : shellBaseURL.pathname.replace(/\/$/, '')
const loaded = new Map<string, Promise<LoadedApp>>()
const mountedBySlot = new Map<string, MountedApp>()
const eventHandlers = new Map<string, Set<(payload: unknown) => void>>()

function record(value: unknown, label: string): JSONObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(label + ' must be an object')
  }
  return value as JSONObject
}

function exactKeys(value: JSONObject, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(label + ' has unsupported or missing fields')
  }
}

function text(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 31 || codePoint === 127
    })
  ) {
    throw new TypeError(label + ' must be bounded non-empty text')
  }
  return value
}

function identity(value: unknown, label: string): string {
  const result = text(value, label)
  if (result.length > 128 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(result)) {
    throw new TypeError(label + ' must be a canonical module identity')
  }
  return result
}

function stableSemver(value: unknown, label: string): string {
  const result = text(value, label)
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(result)
  if (!match || !match.slice(1).map(Number).every(Number.isSafeInteger)) {
    throw new TypeError(label + ' must be a stable semantic version')
  }
  return result
}

function digest(value: unknown, label: string): string {
  const result = text(value, label)
  if (!/^[A-Za-z0-9_-]{43}$/.test(result)) {
    throw new TypeError(label + ' must be a canonical SHA-256 base64url digest')
  }
  const padded = result.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (result.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new TypeError(label + ' must be a canonical SHA-256 base64url digest')
  }
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (decoded.byteLength !== 32 || encodeBase64URL(decoded) !== result) {
    throw new TypeError(label + ' must be a canonical SHA-256 base64url digest')
  }
  return result
}

function runtimeRoute(value: unknown, label: string): string {
  const result = text(value, label)
  if (
    result.length > 512 ||
    !result.startsWith('/') ||
    result.startsWith('//') ||
    result.includes('\\') ||
    result.includes('#') ||
    result.includes('%') ||
    (result.length > 1 && result.endsWith('/'))
  ) {
    throw new TypeError(label + ' must be a canonical root route pattern')
  }
  if (result === '/') return result
  const segments = result.slice(1).split('/')
  if (
    segments.some((segment, index) => {
      if (!segment || segment === '.' || segment === '..') return true
      if (segment === '*') return index !== segments.length - 1
      if (segment.startsWith(':')) return !/^:[A-Za-z_][A-Za-z0-9_]*\??$/.test(segment)
      return !/^[A-Za-z0-9._~!$&'()+,;=@-]+$/.test(segment)
    })
  ) {
    throw new TypeError(label + ' contains an unsafe or malformed route segment')
  }
  return result
}

function routeCollisionKey(route: string): string {
  if (route === '/') return route
  return route
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      return segment.endsWith('?') ? ':?' : ':'
    })
    .join('/')
}

function byteLength(value: unknown, label: string, maximum = MAX_ASSET_BYTES): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(label + ' must be a bounded byte length')
  }
  return value as number
}

function safeAssetPath(value: unknown, label: string): string {
  const result = text(value, label)
  if (
    (!result.startsWith('/') && !result.startsWith('./')) ||
    result.includes('\\') ||
    result.includes('?') ||
    result.includes('#') ||
    result.includes('%') ||
    result.startsWith('//') ||
    result.endsWith('/')
  ) {
    throw new TypeError(label + ' must be a safe local path')
  }
  const segments = result.replace(/^\//, '').replace(/^\.\//, '').split('/')
  if (
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9_@.+-]+$/.test(segment)
    )
  ) {
    throw new TypeError(label + ' must be a canonical local path')
  }
  return result
}

function parseAsset(value: unknown, mediaType: RuntimeAsset['mediaType'], label: string): RuntimeAsset {
  const source = record(value, label)
  exactKeys(source, ['path', 'mediaType', 'byteLength', 'digest'], label)
  if (source.mediaType !== mediaType) throw new TypeError(label + '.mediaType is invalid')
  return {
    path: safeAssetPath(source.path, label + '.path'),
    mediaType,
    byteLength: byteLength(source.byteLength, label + '.byteLength'),
    digest: digest(source.digest, label + '.digest')
  }
}

function parseRuntimeManifest(value: unknown, expectedAppId: string): RuntimeManifest {
  const source = record(value, 'runtime manifest')
  exactKeys(source, ['format', 'schemaVersion', 'abi', 'app', 'artifact', 'routes'], 'runtime manifest')
  if (source.format !== 'openpencil-microfrontend' || source.schemaVersion !== 1 || source.abi !== ABI) {
    throw new TypeError('Runtime manifest format, version, or ABI is unsupported')
  }
  const app = record(source.app, 'runtime manifest.app')
  exactKeys(app, ['id', 'name', 'version', 'framework'], 'runtime manifest.app')
  if (identity(app.id, 'runtime manifest.app.id') !== expectedAppId) {
    throw new TypeError('Runtime manifest app id does not match the composition')
  }
  if (app.framework !== 'react' && app.framework !== 'vue') {
    throw new TypeError('Runtime manifest framework is unsupported')
  }
  if (text(app.name, 'runtime manifest.app.name').length > 128) {
    throw new TypeError('runtime manifest.app.name exceeds 128 characters')
  }
  stableSemver(app.version, 'runtime manifest.app.version')
  if (!Array.isArray(source.routes) || source.routes.length === 0 || source.routes.length > 128) {
    throw new TypeError('Runtime manifest routes must be a bounded non-empty array')
  }
  const routes = source.routes.map((route, index) =>
    runtimeRoute(route, 'runtime manifest.routes[' + index + ']')
  )
  if (new Set(routes.map(routeCollisionKey)).size !== routes.length) {
    throw new TypeError('Runtime manifest routes must be unique without equivalent patterns')
  }
  const artifact = record(source.artifact, 'runtime manifest.artifact')
  exactKeys(artifact, ['entry', 'styles'], 'runtime manifest.artifact')
  if (!Array.isArray(artifact.styles) || artifact.styles.length > 64) {
    throw new TypeError('Runtime manifest styles are invalid')
  }
  const entry = parseAsset(artifact.entry, 'text/javascript', 'runtime manifest.artifact.entry') as RuntimeAsset & { mediaType: 'text/javascript' }
  const styles = artifact.styles.map((style, index) =>
    parseAsset(style, 'text/css', 'runtime manifest.artifact.styles[' + index + ']')
  ) as readonly (RuntimeAsset & { mediaType: 'text/css' })[]
  if (new Set([entry.path, ...styles.map((style) => style.path)]).size !== styles.length + 1) {
    throw new TypeError('Runtime manifest asset paths must be unique')
  }
  const totalAssetBytes = styles.reduce(
    (total, style) => total + style.byteLength,
    entry.byteLength
  )
  if (!Number.isSafeInteger(totalAssetBytes) || totalAssetBytes > MAX_ASSET_BYTES) {
    throw new TypeError('Runtime manifest aggregate assets exceed the application limit')
  }
  return {
    format: 'openpencil-microfrontend',
    schemaVersion: 1,
    abi: ABI,
    app: { id: expectedAppId, framework: app.framework },
    artifact: {
      entry,
      styles
    }
  }
}

function encodeBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const result = await crypto.subtle.digest('SHA-256', copy.buffer)
  return encodeBase64URL(new Uint8Array(result))
}

async function readResponse(
  url: URL,
  maximum: number,
  expectedLength?: number,
  expectedDigest?: string,
  timeoutMilliseconds = ASSET_TIMEOUT_MS
): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(new DOMException('Microfrontend fetch timed out', 'TimeoutError')),
    timeoutMilliseconds
  )
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal
    })
    if (!response.ok) throw new Error('Fetch failed for ' + url.href + ': HTTP ' + response.status)
    if (response.url && new URL(response.url).href !== url.href) {
      throw new Error('Refusing a redirected microfrontend resource')
    }
    const declared = response.headers.get('content-length')
    const contentEncoding = response.headers.get('content-encoding')?.trim().toLowerCase()
    if (declared !== null && (!contentEncoding || contentEncoding === 'identity')) {
      const parsed = Number(declared)
      if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
        throw new Error('Resource Content-Length is invalid or exceeds its limit')
      }
      if (expectedLength !== undefined && parsed !== expectedLength) {
        throw new Error('Resource Content-Length does not match its manifest')
      }
    }
    if (!response.body) throw new Error('Resource response has no body')
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maximum || (expectedLength !== undefined && total > expectedLength)) {
        throw new Error('Resource body exceeds its manifest or runtime limit')
      }
      chunks.push(next.value)
    }
    if (expectedLength !== undefined && total !== expectedLength) {
      throw new Error('Resource byte length does not match its manifest')
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (expectedDigest !== undefined && (await sha256(bytes)) !== expectedDigest) {
      throw new Error('Resource SHA-256 digest does not match its manifest')
    }
    return bytes
  } catch (error) {
    if (reader) await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function decodeUTF8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(label + ' must contain valid UTF-8')
  }
}

function manifestURL(app: CompositionApp): URL {
  return app.manifest.kind === 'remote'
    ? new URL(app.manifest.url)
    : new URL(app.manifest.path, compositionBaseURL)
}

function runtimeAssetURL(path: string, manifest: URL): URL {
  return new URL(path, manifest)
}

function isRuntimeModule(value: unknown): value is RuntimeModule {
  if (value === null || typeof value !== 'object') return false
  const exports = ['bootstrap', 'mount', 'update', 'unmount'] as const
  const ownKeys = Reflect.ownKeys(value)
  const keys = ownKeys.filter((key): key is string => typeof key === 'string')
  if (
    keys.length !== exports.length ||
    keys.some((key) => !exports.includes(key as typeof exports[number])) ||
    ownKeys.some((key) => typeof key === 'symbol' && key !== Symbol.toStringTag)
  ) {
    return false
  }
  return exports.every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    return Boolean(
      descriptor?.enumerable &&
      'value' in descriptor &&
      typeof descriptor.value === 'function'
    )
  })
}

async function importRuntime(bytes: Uint8Array): Promise<RuntimeModule> {
  const blobURL = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))
  try {
    const candidate: unknown = await import(/* @vite-ignore */ blobURL)
    if (!isRuntimeModule(candidate)) throw new TypeError('Microfrontend module does not implement the v1 lifecycle ABI')
    return candidate
  } finally {
    URL.revokeObjectURL(blobURL)
  }
}

async function loadApp(app: CompositionApp): Promise<LoadedApp> {
  const existing = loaded.get(app.appId)
  if (existing) return existing
  const pending = (async () => {
    const url = manifestURL(app)
    const manifestBytes =
      app.manifest.kind === 'remote'
        ? await readResponse(url, app.manifest.byteLength, app.manifest.byteLength, app.manifest.digest, MANIFEST_TIMEOUT_MS)
        : await readResponse(url, MAX_MANIFEST_BYTES, undefined, undefined, MANIFEST_TIMEOUT_MS)
    const manifest = parseRuntimeManifest(
      JSON.parse(decodeUTF8(manifestBytes, 'Runtime manifest')),
      app.appId
    )
    const entry = await readResponse(
      runtimeAssetURL(manifest.artifact.entry.path, url),
      manifest.artifact.entry.byteLength,
      manifest.artifact.entry.byteLength,
      manifest.artifact.entry.digest
    )
    const styles: string[] = []
    for (const style of manifest.artifact.styles) {
      styles.push(
        decodeUTF8(
          await readResponse(
            runtimeAssetURL(style.path, url),
            style.byteLength,
            style.byteLength,
            style.digest
          ),
          'Microfrontend stylesheet'
        )
      )
    }
    const module = await importRuntime(entry)
    try {
      await module.bootstrap()
    } catch (error) {
      try {
        await module.unmount()
      } catch (cleanupError) {
        console.error('[OpenPencil composition] failed bootstrap cleanup', app.appId, cleanupError)
      }
      throw error
    }
    return { module, styles }
  })()
  loaded.set(app.appId, pending)
  try {
    return await pending
  } catch (error) {
    loaded.delete(app.appId)
    throw error
  }
}

const events = {
  publish(topic: string, payload: unknown): void {
    for (const handler of eventHandlers.get(topic) ?? []) handler(payload)
  },
  subscribe(topic: string, handler: (payload: unknown) => void): () => void {
    let handlers = eventHandlers.get(topic)
    if (!handlers) {
      handlers = new Set()
      eventHandlers.set(topic, handlers)
    }
    handlers.add(handler)
    return () => {
      handlers?.delete(handler)
      if (handlers?.size === 0) eventHandlers.delete(topic)
    }
  }
}

function compositionPathname(): string {
  if (shellBasePath === '/') return location.pathname
  if (location.pathname === shellBasePath) return '/'
  if (location.pathname.startsWith(shellBasePath + '/')) {
    return location.pathname.slice(shellBasePath.length) || '/'
  }
  return location.pathname
}

function deployedRouteBase(routeBase: string): string {
  if (shellBasePath === '/') return routeBase
  return routeBase === '/' ? shellBasePath : shellBasePath + routeBase
}

function navigationURL(to: string): URL {
  const candidate = new URL(to, location.href)
  if (candidate.origin !== location.origin) {
    throw new TypeError('Microfrontends may navigate only within the shell origin')
  }
  const pathname =
    shellBasePath !== '/' &&
    candidate.pathname !== shellBasePath &&
    !candidate.pathname.startsWith(shellBasePath + '/')
      ? shellBasePath + (candidate.pathname === '/' ? '' : candidate.pathname)
      : candidate.pathname
  return new URL(pathname + candidate.search + candidate.hash, location.origin)
}

function contextFor(app: CompositionApp, portalTarget: HTMLElement): RuntimeContext {
  return {
    appId: app.appId,
    basePath: deployedRouteBase(app.routeBase),
    location: { pathname: location.pathname, search: location.search, hash: location.hash },
    portalTarget,
    navigate(to: string): void {
      const target = navigationURL(to)
      history.pushState(null, '', target.pathname + target.search + target.hash)
    },
    events
  }
}

function routeMatches(pathname: string, routeBase: string): boolean {
  if (routeBase === '/') return true
  return pathname === routeBase || pathname.startsWith(routeBase + '/')
}

function selectedApp(slotId: string): CompositionApp | undefined {
  return (COMPOSITION.apps as readonly CompositionApp[])
    .filter((app) => app.slotId === slotId && routeMatches(compositionPathname(), app.routeBase))
    .sort((left, right) => right.routeBase.length - left.routeBase.length)[0]
}

async function unmount(slotId: string): Promise<void> {
  const mounted = mountedBySlot.get(slotId)
  if (!mounted) return
  mountedBySlot.delete(slotId)
  try {
    await mounted.module.unmount()
  } catch (error) {
    loaded.delete(mounted.app.appId)
    throw error
  } finally {
    mounted.shadowRoot.replaceChildren()
  }
}

function showSlotError(slotId: string, appId: string, error: unknown): void {
  const container = document.querySelector<HTMLElement>('[data-openpencil-slot="' + CSS.escape(slotId) + '"]')
  if (container) {
    container.dataset.openpencilError = 'true'
    const shadowRoot = container.shadowRoot ?? container.attachShadow({ mode: 'open' })
    shadowRoot.replaceChildren()
    const message = document.createElement('p')
    message.dataset.openpencilErrorMessage = 'true'
    message.textContent = 'Unable to load ' + appId
    shadowRoot.append(message)
  }
  console.error('[OpenPencil composition]', appId, error)
}

async function mount(slotId: string, app: CompositionApp): Promise<void> {
  const container = document.querySelector<HTMLElement>('[data-openpencil-slot="' + CSS.escape(slotId) + '"]')
  if (!container) throw new Error('Composition slot container is missing: ' + slotId)
  container.removeAttribute('data-openpencil-error')
  container.setAttribute('aria-busy', 'true')
  try {
    const runtime = await loadApp(app)
    const shadowRoot = container.shadowRoot ?? container.attachShadow({ mode: 'open' })
    shadowRoot.replaceChildren()
    for (const css of runtime.styles) {
      const style = document.createElement('style')
      style.dataset.openpencilMicrofrontendStyle = app.appId
      style.textContent = css
      shadowRoot.append(style)
    }
    const mountRoot = document.createElement('div')
    mountRoot.dataset.openpencilMicrofrontendMount = app.appId
    const portalTarget = document.createElement('div')
    portalTarget.dataset.openpencilMicrofrontendPortal = app.appId
    shadowRoot.append(mountRoot, portalTarget)
    try {
      await runtime.module.mount(mountRoot, contextFor(app, portalTarget))
    } catch (error) {
      try {
        await runtime.module.unmount()
      } catch (cleanupError) {
        console.error('[OpenPencil composition] failed mount cleanup', app.appId, cleanupError)
      }
      loaded.delete(app.appId)
      shadowRoot.replaceChildren()
      throw error
    }
    mountedBySlot.set(slotId, { ...runtime, app, container, shadowRoot })
  } finally {
    container.removeAttribute('aria-busy')
  }
}

async function reconcileSlot(slotId: string): Promise<void> {
  const desired = selectedApp(slotId)
  const current = mountedBySlot.get(slotId)
  if (current?.app.appId === desired?.appId) {
    try {
      const portalTarget = current.shadowRoot.querySelector<HTMLElement>('[data-openpencil-microfrontend-portal]')
      if (!portalTarget) throw new Error('Mounted microfrontend portal target is missing')
      await current.module.update(contextFor(current.app, portalTarget))
    } catch (error) {
      try {
        await unmount(slotId)
      } catch (cleanupError) {
        console.error('[OpenPencil composition] failed update cleanup', current.app.appId, cleanupError)
      }
      loaded.delete(current.app.appId)
      showSlotError(slotId, current.app.appId, error)
    }
    return
  }
  try {
    await unmount(slotId)
  } catch (error) {
    showSlotError(slotId, current?.app.appId ?? desired?.appId ?? slotId, error)
    return
  }
  if (!desired) return
  try {
    await mount(slotId, desired)
  } catch (error) {
    showSlotError(slotId, desired.appId, error)
  }
}

let reconciling = false
let reconcileRequested = false
async function scheduleReconcile(): Promise<void> {
  reconcileRequested = true
  if (reconciling) return
  reconciling = true
  try {
    while (reconcileRequested) {
      reconcileRequested = false
      await Promise.all(COMPOSITION.slots.map((slot) => reconcileSlot(slot.id)))
    }
  } finally {
    reconciling = false
  }
}

type HistoryRegistry = {
  readonly listeners: Set<() => void>
  readonly originalPush: History['pushState']
  readonly originalReplace: History['replaceState']
  readonly patchedPush: History['pushState']
  readonly patchedReplace: History['replaceState']
  readonly popstate: () => void
}
const historyRegistryKey = '__openpencilMicrofrontendHistoryV1__'

function subscribeNavigation(listener: () => void): () => void {
  const owner = window as Window & { [historyRegistryKey]?: HistoryRegistry }
  let registry = owner[historyRegistryKey]
  if (!registry) {
    const listeners = new Set<() => void>()
    const originalPush = history.pushState
    const originalReplace = history.replaceState
    const notify = (): void => {
      for (const current of listeners) current()
    }
    const patchedPush: History['pushState'] = function (data, unused, url) {
      originalPush.call(history, data, unused, url)
      notify()
    }
    const patchedReplace: History['replaceState'] = function (data, unused, url) {
      originalReplace.call(history, data, unused, url)
      notify()
    }
    history.pushState = patchedPush
    history.replaceState = patchedReplace
    window.addEventListener('popstate', notify)
    registry = { listeners, originalPush, originalReplace, patchedPush, patchedReplace, popstate: notify }
    owner[historyRegistryKey] = registry
  }
  registry.listeners.add(listener)
  return () => {
    const current = owner[historyRegistryKey]
    if (!current) return
    current.listeners.delete(listener)
    if (current.listeners.size > 0) return
    window.removeEventListener('popstate', current.popstate)
    if (history.pushState === current.patchedPush) history.pushState = current.originalPush
    if (history.replaceState === current.patchedReplace) history.replaceState = current.originalReplace
    delete owner[historyRegistryKey]
  }
}

const disposeNavigation = subscribeNavigation(() => void scheduleReconcile())
window.addEventListener('pagehide', disposeNavigation, { once: true })
void scheduleReconcile()
`

/** Generate the standalone, framework-neutral shell VFS without writing it. */
export function createCompositionShellProject(value: unknown): PreviewFiles {
  const composition = parseOpenPencilMicrofrontendCompositionManifest(value)
  const slots = composition.slots
    .map(
      (slot) =>
        `    <section class="openpencil-slot" data-openpencil-slot="${escapeHTML(slot.id)}"></section>`
    )
    .join('\n')
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHTML(composition.composition.name)}</title>
  </head>
  <body>
    <main id="openpencil-composition">
${slots}
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`
  const css = `:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color-scheme: light dark; }
* { box-sizing: border-box; }
html, body, #openpencil-composition { min-height: 100%; margin: 0; }
#openpencil-composition { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); }
.openpencil-slot { min-width: 0; min-height: 0; position: relative; container-type: inline-size; contain: layout paint; isolation: isolate; overflow: clip; }
.openpencil-slot[aria-busy="true"]::after { content: "Loading…"; display: grid; min-height: 8rem; place-items: center; }
.openpencil-slot[data-openpencil-error="true"] { display: grid; min-height: 8rem; place-items: center; color: #b42318; }
`
  const runtime =
    `import './index.css'\n\nconst COMPOSITION = ${JSON.stringify(composition)} as const\n` +
    COMPOSITION_RUNTIME
  return new Map([
    ['index.html', html],
    ['src/main.ts', runtime],
    ['src/index.css', css]
  ])
}

/** Build a deployable route/slot composition shell around local or remote manifests. */
export async function buildCompositionShell(
  options: CompositionShellBuildOptions
): Promise<CompositionShellBuildResult> {
  const composition = parseOpenPencilMicrofrontendCompositionManifest(options.composition)
  const base = parseCompositionShellBase(options.base)
  const files = createCompositionShellProject(composition)
  const localArtifacts = collectLocalCompositionArtifacts(composition, options.sourceDir)
  assertSafeBuildOutputDirectory(options.outDir)

  const workspaceRoot = options.fsRoot ?? process.cwd()
  const { scanRoot, vfsPrefix } = prepareVfsRoot(workspaceRoot, 'react')
  const vfs = inMemoryVFS({ files }, vfsPrefix)
  await build({
    root: scanRoot,
    base,
    configFile: false,
    envFile: false,
    logLevel: 'warn',
    plugins: [vfs],
    build: {
      outDir: options.outDir,
      emptyOutDir: true,
      rollupOptions: { input: vfsPrefix + 'index.html' }
    }
  })
  writeFileSync(
    join(options.outDir, OPENPENCIL_MICROFRONTEND_COMPOSITION_FILENAME),
    serializeOpenPencilMicrofrontendCompositionManifest(composition)
  )
  writeLocalCompositionArtifacts(options.outDir, localArtifacts)
  const result = recordManagedBuildOutput(options.outDir)
  return {
    ...result,
    composition,
    compositionPath: OPENPENCIL_MICROFRONTEND_COMPOSITION_FILENAME
  }
}
