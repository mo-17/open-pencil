import { mkdir, open, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { canonicalManifestJSON, parseExactManifestRecord } from '@open-pencil/scene-graph'

import { MARKETPLACE_LIMITS, parseMarketplaceState, type MarketplaceStateV1 } from '../types'
import {
  MARKETPLACE_PUBLICATION_REQUEST_LIMITS,
  assertMarketplacePublicationRequestState,
  parseMarketplacePublicationRequest,
  parseMarketplacePublicationRequestJSON,
  serializeMarketplacePublicationRequest,
  type MarketplacePublicationRequestV1
} from './request'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export const MARKETPLACE_PUBLICATION_HANDOFF_FORMAT =
  'openpencil-marketplace-publication-handoff' as const
export const MARKETPLACE_PUBLICATION_HANDOFF_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_PUBLICATION_HANDOFF_LIMITS = Object.freeze({
  maxJsonBytes:
    MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxJsonBytes +
    MARKETPLACE_LIMITS.maxStateJsonBytes +
    1024 * 1024,
  maxRequestJsonBytes: MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxJsonBytes,
  maxStateJsonBytes: MARKETPLACE_LIMITS.maxStateJsonBytes
})

export interface MarketplacePublicationHandoffV1 {
  readonly format: typeof MARKETPLACE_PUBLICATION_HANDOFF_FORMAT
  readonly schemaVersion: typeof MARKETPLACE_PUBLICATION_HANDOFF_SCHEMA_VERSION
  readonly requestJson: string
  readonly stateJson: string
}

export interface OpenedMarketplacePublicationHandoff {
  readonly handoff: MarketplacePublicationHandoffV1
  readonly request: MarketplacePublicationRequestV1
  readonly state: MarketplaceStateV1
}

export interface MarketplacePublicationHandoffFileHandle {
  writeFile(value: string, encoding: 'utf8'): Promise<unknown>
  sync(): Promise<unknown>
  close(): Promise<unknown>
}

export interface MarketplacePublicationHandoffFileOperations {
  mkdir(
    path: string,
    options: { readonly recursive: true; readonly mode: number }
  ): Promise<unknown>
  open(
    path: string,
    flags: 'wx' | 'r',
    mode?: number
  ): Promise<MarketplacePublicationHandoffFileHandle>
  unlink(path: string): Promise<unknown>
}

const DEFAULT_FILE_OPERATIONS: MarketplacePublicationHandoffFileOperations = {
  mkdir,
  open,
  unlink
}

const HANDOFF_KEYS = new Set(['format', 'schemaVersion', 'requestJson', 'stateJson'])

async function syncDirectory(
  path: string,
  operations: MarketplacePublicationHandoffFileOperations
): Promise<void> {
  const handle = await operations.open(path, 'r')
  let syncFailed = false
  let failure: unknown
  try {
    await handle.sync()
  } catch (cause) {
    syncFailed = true
    failure = cause
  }
  try {
    await handle.close()
  } catch (cause) {
    if (syncFailed) {
      throw new AggregateError([failure, cause], `Failed to sync and close directory ${path}`)
    }
    throw cause
  }
  if (syncFailed) {
    throw new Error(
      failure instanceof Error ? failure.message : `Failed to sync directory ${path}`,
      { cause: failure }
    )
  }
}

function createdDirectorySyncPaths(firstCreatedValue: string, parent: string): readonly string[] {
  const firstCreated = resolve(firstCreatedValue)
  const suffix = relative(firstCreated, parent)
  if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new Error('Recursive handoff directory creation escaped its requested parent')
  }
  const paths = [dirname(firstCreated), firstCreated]
  let current = firstCreated
  for (const part of suffix.split(sep).filter(Boolean)) {
    current = join(current, part)
    paths.push(current)
  }
  return [...new Set(paths)]
}

function embeddedJSON(value: unknown, path: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    encoder.encode(value).byteLength > maximum
  ) {
    throw new TypeError(`${path} must be non-empty bounded JSON text`)
  }
  return value
}

function exactStateJSON(value: unknown): {
  readonly json: string
  readonly state: MarketplaceStateV1
} {
  const json = embeddedJSON(
    value,
    'marketplacePublicationHandoff.stateJson',
    MARKETPLACE_PUBLICATION_HANDOFF_LIMITS.maxStateJsonBytes
  )
  let decoded: unknown
  try {
    decoded = JSON.parse(json)
  } catch {
    throw new TypeError('marketplacePublicationHandoff.stateJson must contain valid JSON')
  }
  const state = parseMarketplaceState(decoded)
  if (canonicalManifestJSON(state) !== json) {
    throw new TypeError('marketplacePublicationHandoff.stateJson must use exact canonical JSON')
  }
  return Object.freeze({ json, state })
}

export function openMarketplacePublicationHandoff(
  value: unknown
): OpenedMarketplacePublicationHandoff {
  const source = parseExactManifestRecord(
    value,
    'marketplacePublicationHandoff',
    HANDOFF_KEYS,
    HANDOFF_KEYS
  )
  if (source.format !== MARKETPLACE_PUBLICATION_HANDOFF_FORMAT) {
    throw new TypeError(
      `marketplacePublicationHandoff.format must be ${MARKETPLACE_PUBLICATION_HANDOFF_FORMAT}`
    )
  }
  if (source.schemaVersion !== MARKETPLACE_PUBLICATION_HANDOFF_SCHEMA_VERSION) {
    throw new TypeError(
      `marketplacePublicationHandoff.schemaVersion must be ${MARKETPLACE_PUBLICATION_HANDOFF_SCHEMA_VERSION}`
    )
  }
  const requestJSON = embeddedJSON(
    source.requestJson,
    'marketplacePublicationHandoff.requestJson',
    MARKETPLACE_PUBLICATION_HANDOFF_LIMITS.maxRequestJsonBytes
  )
  const request = parseMarketplacePublicationRequestJSON(requestJSON)
  const exactState = exactStateJSON(source.stateJson)
  assertMarketplacePublicationRequestState(request, exactState.state)
  const handoff = Object.freeze({
    format: MARKETPLACE_PUBLICATION_HANDOFF_FORMAT,
    schemaVersion: MARKETPLACE_PUBLICATION_HANDOFF_SCHEMA_VERSION,
    requestJson: requestJSON,
    stateJson: exactState.json
  })
  return Object.freeze({ handoff, request, state: exactState.state })
}

export function createMarketplacePublicationHandoff(input: {
  readonly request: unknown
  readonly state: unknown
}): MarketplacePublicationHandoffV1 {
  const request = parseMarketplacePublicationRequest(input.request)
  const state = parseMarketplaceState(input.state)
  assertMarketplacePublicationRequestState(request, state)
  return openMarketplacePublicationHandoff({
    format: MARKETPLACE_PUBLICATION_HANDOFF_FORMAT,
    schemaVersion: MARKETPLACE_PUBLICATION_HANDOFF_SCHEMA_VERSION,
    requestJson: serializeMarketplacePublicationRequest(request),
    stateJson: canonicalManifestJSON(state)
  }).handoff
}

export function serializeMarketplacePublicationHandoff(value: unknown): string {
  return canonicalManifestJSON(openMarketplacePublicationHandoff(value).handoff)
}

export function marketplacePublicationHandoffBytes(value: unknown): Uint8Array {
  return encoder.encode(serializeMarketplacePublicationHandoff(value))
}

export function parseMarketplacePublicationHandoffJSON(
  value: string
): MarketplacePublicationHandoffV1 {
  if (
    typeof value !== 'string' ||
    encoder.encode(value).byteLength > MARKETPLACE_PUBLICATION_HANDOFF_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('Marketplace publication handoff JSON exceeds its byte limit')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    throw new TypeError('Marketplace publication handoff must contain valid JSON')
  }
  const opened = openMarketplacePublicationHandoff(decoded)
  if (canonicalManifestJSON(opened.handoff) !== value) {
    throw new TypeError('Marketplace publication handoff must use exact canonical JSON')
  }
  return opened.handoff
}

export function parseMarketplacePublicationHandoffBytes(
  value: Uint8Array
): MarketplacePublicationHandoffV1 {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError('Marketplace publication handoff must be bytes')
  }
  if (value.byteLength > MARKETPLACE_PUBLICATION_HANDOFF_LIMITS.maxJsonBytes) {
    throw new TypeError('Marketplace publication handoff JSON exceeds its byte limit')
  }
  let text: string
  try {
    text = decoder.decode(value)
  } catch {
    throw new TypeError('Marketplace publication handoff must contain valid UTF-8')
  }
  return parseMarketplacePublicationHandoffJSON(text)
}

export async function writeMarketplacePublicationHandoffFile(
  path: string,
  value: unknown,
  operations: MarketplacePublicationHandoffFileOperations = DEFAULT_FILE_OPERATIONS
): Promise<string> {
  const absolute = resolve(path)
  const parent = dirname(absolute)
  const text = serializeMarketplacePublicationHandoff(value)
  const firstCreated = await operations.mkdir(parent, { recursive: true, mode: 0o700 })
  if (typeof firstCreated === 'string') {
    for (const directoryPath of createdDirectorySyncPaths(firstCreated, parent)) {
      await syncDirectory(directoryPath, operations)
    }
  }
  let created = false
  let file: MarketplacePublicationHandoffFileHandle | null = null
  try {
    file = await operations.open(absolute, 'wx', 0o600)
    created = true
    await file.writeFile(text, 'utf8')
    await file.sync()
    await file.close()
    file = null
    await syncDirectory(parent, operations)
    return absolute
  } catch (cause) {
    const cleanupFailures: unknown[] = []
    await file?.close().catch((error: unknown) => cleanupFailures.push(error))
    if (created) {
      let removed = false
      try {
        await operations.unlink(absolute)
        removed = true
      } catch (error) {
        cleanupFailures.push(error)
      }
      if (removed) {
        await syncDirectory(parent, operations).catch((error: unknown) =>
          cleanupFailures.push(error)
        )
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [cause, ...cleanupFailures],
        'Publication handoff write failed and durable cleanup could not be confirmed'
      )
    }
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`publication handoff output already exists: ${absolute}`)
    }
    throw cause
  }
}
