import { createHash, randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'

import { parseExactManifestRecord } from '@open-pencil/scene-graph'

import {
  MARKETPLACE_REQUEST_AUTH_LIMITS,
  signMarketplaceRequest,
  type MarketplaceSignedRequestHeaders
} from './auth'
import {
  MARKETPLACE_RELEASE_CHANNELS,
  parseCreateMarketplacePublisherInput,
  parseMarketplaceIdentity,
  parseMarketplaceReason,
  parseMarketplaceTimestamp,
  parseRegisterMarketplacePublisherKeyInput
} from './types'

export const MARKETPLACE_PUBLISHER_SIGNED_ENVELOPE_FORMAT =
  'openpencil.marketplace.publisher-signed-envelope' as const
export const MARKETPLACE_PUBLISHER_SIGNED_ENVELOPE_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_PUBLISHER_REQUEST_OPERATIONS = [
  'publisher.register',
  'ownership.request',
  'key.rotate',
  'submission.validate',
  'submission.create',
  'submission.revise',
  'submission.withdraw'
] as const

export type MarketplacePublisherRequestOperation =
  (typeof MARKETPLACE_PUBLISHER_REQUEST_OPERATIONS)[number]

export interface MarketplacePublisherSignedEnvelopeV1 {
  readonly format: typeof MARKETPLACE_PUBLISHER_SIGNED_ENVELOPE_FORMAT
  readonly schemaVersion: typeof MARKETPLACE_PUBLISHER_SIGNED_ENVELOPE_SCHEMA_VERSION
  readonly operation: MarketplacePublisherRequestOperation
  readonly method: 'POST'
  readonly target: string
  readonly bodyEncoding: 'base64url'
  readonly body: string
  readonly headers: MarketplaceSignedRequestHeaders
}

export interface ParsedMarketplacePublisherSignedEnvelopeV1 extends Omit<
  MarketplacePublisherSignedEnvelopeV1,
  'body'
> {
  readonly body: Uint8Array
}

export interface CreateMarketplacePublisherSignedEnvelopeInput {
  readonly operation: MarketplacePublisherRequestOperation
  readonly audience: string
  readonly publisherId: string
  readonly keyId: string
  readonly body: Uint8Array
  readonly submissionId?: string
  readonly timestamp?: string
  readonly nonce?: string
}

const ENVELOPE_KEYS = new Set([
  'format',
  'schemaVersion',
  'operation',
  'method',
  'target',
  'bodyEncoding',
  'body',
  'headers'
])
const HEADER_KEYS = new Set(['audience', 'publisherId', 'keyId', 'timestamp', 'nonce', 'signature'])
const REGISTRATION_KEYS = new Set(['publisher', 'key'])
const OWNERSHIP_KEYS = new Set(['pluginId', 'publisherId'])
const SUBMISSION_KEYS = new Set([
  'id',
  'publisherId',
  'channel',
  'manifest',
  'listing',
  'runtimePackage'
])
const SUBMISSION_REQUIRED_KEYS = new Set(['id', 'publisherId', 'channel', 'manifest', 'listing'])
const REVISION_KEYS = new Set([
  'publisherId',
  'expectedRevision',
  'manifest',
  'listing',
  'runtimePackage'
])
const REVISION_REQUIRED_KEYS = new Set(['publisherId', 'expectedRevision', 'manifest', 'listing'])
const WITHDRAW_KEYS = new Set(['reason'])
const OPERATION_SET = new Set<string>(MARKETPLACE_PUBLISHER_REQUEST_OPERATIONS)
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function operation(value: unknown): MarketplacePublisherRequestOperation {
  if (typeof value !== 'string' || !OPERATION_SET.has(value)) {
    throw new TypeError('Publisher request operation is not supported')
  }
  return value as MarketplacePublisherRequestOperation
}

function canonicalBase64URL(value: unknown, path: string, expectedBytes?: number): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`${path} must be canonical base64url text`)
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64url'))
  if (
    Buffer.from(bytes).toString('base64url') !== value ||
    (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)
  ) {
    throw new TypeError(`${path} must be canonical base64url text`)
  }
  return bytes
}

function bodyJSON(body: Uint8Array): unknown {
  if (!(body instanceof Uint8Array) || body.byteLength === 0) {
    throw new TypeError('Publisher request body must be non-empty raw bytes')
  }
  if (body.byteLength > MARKETPLACE_REQUEST_AUTH_LIMITS.maxBodyBytes) {
    throw new TypeError('Publisher request body exceeds the byte limit')
  }
  try {
    return JSON.parse(decoder.decode(body)) as unknown
  } catch {
    throw new TypeError('Publisher request body must contain valid UTF-8 JSON')
  }
}

function channel(value: unknown): void {
  if (
    typeof value !== 'string' ||
    !MARKETPLACE_RELEASE_CHANNELS.includes(value as (typeof MARKETPLACE_RELEASE_CHANNELS)[number])
  ) {
    throw new TypeError('Publisher request submission channel is not supported')
  }
}

function positiveRevision(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError('Publisher request expectedRevision must be a positive safe integer')
  }
}

function exactTarget(
  requestOperation: MarketplacePublisherRequestOperation,
  submissionId?: string
): string {
  const submissionOperation =
    requestOperation === 'submission.revise' || requestOperation === 'submission.withdraw'
  if (!submissionOperation && submissionId !== undefined) {
    throw new TypeError(
      `Publisher request operation ${requestOperation} does not accept a submission id`
    )
  }
  switch (requestOperation) {
    case 'publisher.register':
      return '/v1/publishers/register'
    case 'ownership.request':
      return '/v1/ownerships'
    case 'key.rotate':
      return '/v1/publisher-keys'
    case 'submission.validate':
      return '/v1/submissions/validate'
    case 'submission.create':
      return '/v1/submissions'
    case 'submission.revise':
    case 'submission.withdraw': {
      const id = parseMarketplaceIdentity(submissionId, 'Publisher request submission id')
      return `/v1/submissions/${encodeURIComponent(id)}/${
        requestOperation === 'submission.revise' ? 'revise' : 'withdraw'
      }`
    }
    default:
      throw new TypeError(
        `Publisher request operation ${String(requestOperation)} is not supported`
      )
  }
}

function targetSubmissionId(
  requestOperation: MarketplacePublisherRequestOperation,
  target: string
): string | undefined {
  if (requestOperation !== 'submission.revise' && requestOperation !== 'submission.withdraw') {
    return undefined
  }
  const suffix = requestOperation === 'submission.revise' ? 'revise' : 'withdraw'
  const matched = new RegExp(`^/v1/submissions/([^/?#]+)/${suffix}$`).exec(target)
  if (!matched) throw new TypeError('Publisher signed envelope target is invalid')
  let decoded: string
  try {
    decoded = decodeURIComponent(matched[1])
  } catch {
    throw new TypeError('Publisher signed envelope target is invalid')
  }
  const id = parseMarketplaceIdentity(decoded, 'Publisher signed envelope submission id')
  if (target !== exactTarget(requestOperation, id)) {
    throw new TypeError('Publisher signed envelope target is not canonical')
  }
  return id
}

function validateBody(
  requestOperation: MarketplacePublisherRequestOperation,
  body: Uint8Array,
  publisherIdValue: string,
  keyIdValue: string
): void {
  const publisherId = parseMarketplaceIdentity(publisherIdValue, 'Publisher request publisher id')
  const keyId = parseMarketplaceIdentity(keyIdValue, 'Publisher request key id')
  const value = bodyJSON(body)
  switch (requestOperation) {
    case 'publisher.register': {
      const source = parseExactManifestRecord(
        value,
        'Publisher registration request',
        REGISTRATION_KEYS
      )
      const publisher = parseCreateMarketplacePublisherInput(source.publisher)
      const key = parseRegisterMarketplacePublisherKeyInput(source.key)
      if (publisher.id !== publisherId || key.publisherId !== publisherId || key.keyId !== keyId) {
        throw new TypeError('Publisher registration does not match its signer and initial key')
      }
      if (key.predecessorKeyId !== null) {
        throw new TypeError('Publisher registration initial key must not have a predecessor')
      }
      return
    }
    case 'ownership.request': {
      const source = parseExactManifestRecord(value, 'Publisher ownership request', OWNERSHIP_KEYS)
      parseMarketplaceIdentity(source.pluginId, 'Publisher ownership request plugin id')
      if (
        parseMarketplaceIdentity(source.publisherId, 'Publisher ownership request publisher id') !==
        publisherId
      ) {
        throw new TypeError('Publisher ownership request publisher does not match its signer')
      }
      return
    }
    case 'key.rotate': {
      const key = parseRegisterMarketplacePublisherKeyInput(value)
      if (key.publisherId !== publisherId || key.predecessorKeyId !== keyId) {
        throw new TypeError('Publisher key rotation does not match its signer and predecessor')
      }
      return
    }
    case 'submission.validate':
    case 'submission.create': {
      const source = parseExactManifestRecord(
        value,
        'Publisher submission request',
        SUBMISSION_KEYS,
        SUBMISSION_REQUIRED_KEYS
      )
      parseMarketplaceIdentity(source.id, 'Publisher submission request id')
      if (
        parseMarketplaceIdentity(
          source.publisherId,
          'Publisher submission request publisher id'
        ) !== publisherId
      ) {
        throw new TypeError('Publisher submission request publisher does not match its signer')
      }
      channel(source.channel)
      return
    }
    case 'submission.revise': {
      const source = parseExactManifestRecord(
        value,
        'Publisher submission revision',
        REVISION_KEYS,
        REVISION_REQUIRED_KEYS
      )
      if (
        parseMarketplaceIdentity(
          source.publisherId,
          'Publisher submission revision publisher id'
        ) !== publisherId
      ) {
        throw new TypeError('Publisher submission revision publisher does not match its signer')
      }
      positiveRevision(source.expectedRevision)
      return
    }
    case 'submission.withdraw': {
      const source = parseExactManifestRecord(
        value,
        'Publisher submission withdrawal',
        WITHDRAW_KEYS
      )
      parseMarketplaceReason(source.reason, 'Publisher submission withdrawal reason')
    }
  }
}

function signedHeaders(value: unknown): MarketplaceSignedRequestHeaders {
  const source = parseExactManifestRecord(value, 'Publisher signed envelope headers', HEADER_KEYS)
  const timestamp = parseMarketplaceTimestamp(
    source.timestamp,
    'Publisher signed envelope timestamp'
  )
  if (
    typeof source.nonce !== 'string' ||
    source.nonce.length < 16 ||
    source.nonce.length > MARKETPLACE_REQUEST_AUTH_LIMITS.maxNonceLength ||
    !/^[A-Za-z0-9_-]+$/.test(source.nonce)
  ) {
    throw new TypeError('Publisher signed envelope nonce is invalid')
  }
  canonicalBase64URL(source.signature, 'Publisher signed envelope signature', 64)
  return Object.freeze({
    audience: parseMarketplaceIdentity(source.audience, 'Publisher signed envelope audience'),
    publisherId: parseMarketplaceIdentity(
      source.publisherId,
      'Publisher signed envelope publisher id'
    ),
    keyId: parseMarketplaceIdentity(source.keyId, 'Publisher signed envelope key id'),
    timestamp,
    nonce: source.nonce,
    signature: source.signature as string
  })
}

export function parseMarketplacePublisherSignedEnvelope(
  value: unknown
): ParsedMarketplacePublisherSignedEnvelopeV1 {
  const source = parseExactManifestRecord(value, 'Publisher signed envelope', ENVELOPE_KEYS)
  if (
    source.format !== MARKETPLACE_PUBLISHER_SIGNED_ENVELOPE_FORMAT ||
    source.schemaVersion !== MARKETPLACE_PUBLISHER_SIGNED_ENVELOPE_SCHEMA_VERSION ||
    source.method !== 'POST' ||
    source.bodyEncoding !== 'base64url' ||
    typeof source.target !== 'string'
  ) {
    throw new TypeError('Publisher signed envelope schema is not supported')
  }
  const requestOperation = operation(source.operation)
  const headers = signedHeaders(source.headers)
  const body = canonicalBase64URL(source.body, 'Publisher signed envelope body')
  if (body.byteLength > MARKETPLACE_REQUEST_AUTH_LIMITS.maxBodyBytes) {
    throw new TypeError('Publisher signed envelope body exceeds the byte limit')
  }
  const submissionId = targetSubmissionId(requestOperation, source.target)
  if (source.target !== exactTarget(requestOperation, submissionId)) {
    throw new TypeError('Publisher signed envelope target is invalid')
  }
  validateBody(requestOperation, body, headers.publisherId, headers.keyId)
  return Object.freeze({
    format: MARKETPLACE_PUBLISHER_SIGNED_ENVELOPE_FORMAT,
    schemaVersion: MARKETPLACE_PUBLISHER_SIGNED_ENVELOPE_SCHEMA_VERSION,
    operation: requestOperation,
    method: 'POST',
    target: source.target,
    bodyEncoding: 'base64url',
    body,
    headers
  })
}

export async function createMarketplacePublisherSignedEnvelope(
  input: CreateMarketplacePublisherSignedEnvelopeInput,
  privateKey: CryptoKey
): Promise<MarketplacePublisherSignedEnvelopeV1> {
  const requestOperation = operation(input.operation)
  const publisherId = parseMarketplaceIdentity(input.publisherId, 'Publisher request publisher id')
  const keyId = parseMarketplaceIdentity(input.keyId, 'Publisher request key id')
  const target = exactTarget(requestOperation, input.submissionId)
  validateBody(requestOperation, input.body, publisherId, keyId)
  const timestamp = parseMarketplaceTimestamp(
    input.timestamp ?? new Date().toISOString(),
    'Publisher request timestamp'
  )
  const nonce = input.nonce ?? randomBytes(24).toString('base64url')
  const headers = await signMarketplaceRequest(
    {
      audience: parseMarketplaceIdentity(input.audience, 'Publisher request audience'),
      publisherId,
      keyId,
      method: 'POST',
      url: `http://marketplace.invalid${target}`,
      timestamp,
      nonce,
      body: input.body
    },
    privateKey
  )
  return Object.freeze({
    format: MARKETPLACE_PUBLISHER_SIGNED_ENVELOPE_FORMAT,
    schemaVersion: MARKETPLACE_PUBLISHER_SIGNED_ENVELOPE_SCHEMA_VERSION,
    operation: requestOperation,
    method: 'POST',
    target,
    bodyEncoding: 'base64url',
    body: Buffer.from(input.body).toString('base64url'),
    headers
  })
}

export async function writeMarketplacePublisherSignedEnvelope(
  path: string,
  value: MarketplacePublisherSignedEnvelopeV1
): Promise<void> {
  parseMarketplacePublisherSignedEnvelope(value)
  const file = await open(path, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`, { encoding: 'utf8' })
    await file.sync()
  } finally {
    await file.close()
  }
}

export function marketplacePublisherRequestBodyDigest(body: Uint8Array): string {
  if (
    !(body instanceof Uint8Array) ||
    body.byteLength > MARKETPLACE_REQUEST_AUTH_LIMITS.maxBodyBytes
  ) {
    throw new TypeError('Publisher request body exceeds the byte limit')
  }
  return createHash('sha256').update(body).digest('base64url')
}

export const MARKETPLACE_PUBLISHER_REQUEST_MAX_BODY_BYTES =
  MARKETPLACE_REQUEST_AUTH_LIMITS.maxBodyBytes

export const MARKETPLACE_PUBLISHER_REQUEST_ENVELOPE_MAX_BYTES =
  Math.ceil((MARKETPLACE_REQUEST_AUTH_LIMITS.maxBodyBytes * 4) / 3) + 16 * 1024

export function marketplacePublisherRequestUTF8ByteLength(value: string): number {
  return encoder.encode(value).byteLength
}
