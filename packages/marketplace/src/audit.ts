import {
  canonicalManifestBytes,
  digestCanonicalManifest,
  parseBoundedManifestArray,
  parseSha256Base64Url,
  webCryptoBuffer
} from '@open-pencil/scene-graph'

import {
  MARKETPLACE_AUDIT_ACTIONS,
  MARKETPLACE_LIMITS,
  parseMarketplaceAuditActor,
  parseMarketplaceAuditEvent,
  parseMarketplaceAuditSubject,
  parseMarketplaceTimestamp,
  type MarketplaceAuditAction,
  type MarketplaceAuditEventV1,
  type MarketplaceJsonValue
} from './types'

export interface AppendMarketplaceAuditEventInput {
  time: string
  actor: string
  action: MarketplaceAuditAction
  subject: string
  payload: MarketplaceJsonValue
}

export interface AppendMarketplaceAuditEventResult {
  events: readonly MarketplaceAuditEventV1[]
  event: MarketplaceAuditEventV1
}

const VERIFIED_CHAINS = new WeakSet()
const FORBIDDEN_PAYLOAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

interface PayloadBudget {
  entries: number
}

function stringBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function chargeEntry(budget: PayloadBudget, path: string): void {
  budget.entries++
  if (budget.entries > MARKETPLACE_LIMITS.maxAuditPayloadEntries) {
    throw new TypeError(
      `${path} exceeds the audit payload entry limit of ${MARKETPLACE_LIMITS.maxAuditPayloadEntries}`
    )
  }
}

function parsePayloadValue(
  value: unknown,
  path: string,
  depth: number,
  budget: PayloadBudget
): MarketplaceJsonValue {
  if (depth > MARKETPLACE_LIMITS.maxAuditPayloadDepth) {
    throw new TypeError(
      `${path} exceeds the audit payload depth limit of ${MARKETPLACE_LIMITS.maxAuditPayloadDepth}`
    )
  }
  chargeEntry(budget, path)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite JSON numbers`)
    return value
  }
  if (typeof value === 'string') {
    if (stringBytes(value) > MARKETPLACE_LIMITS.maxAuditPayloadStringBytes) {
      throw new TypeError(`${path} contains an oversized string`)
    }
    return value
  }
  if (Array.isArray(value)) {
    const entries = parseBoundedManifestArray(
      value,
      path,
      MARKETPLACE_LIMITS.maxAuditPayloadEntries
    )
    return Object.freeze(
      entries.map((entry, index) =>
        parsePayloadValue(entry, `${path}[${index}]`, depth + 1, budget)
      )
    )
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} must contain only JSON values`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only plain JSON objects`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) {
    throw new TypeError(`${path} must not contain symbol keys`)
  }
  const result: Record<string, MarketplaceJsonValue> = Object.create(null)
  for (const key of keys as string[]) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      throw new TypeError(`${path}.${key} is not allowed in an audit payload`)
    }
    if (stringBytes(key) > MARKETPLACE_LIMITS.maxAuditPayloadStringBytes) {
      throw new TypeError(`${path} contains an oversized key`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${path}.${key} must be an enumerable data property`)
    }
    result[key] = parsePayloadValue(descriptor.value, `${path}.${key}`, depth + 1, budget)
  }
  return Object.freeze(result)
}

export function parseMarketplaceAuditPayload(value: unknown): MarketplaceJsonValue {
  const parsed = parsePayloadValue(value, 'audit.payload', 0, { entries: 0 })
  if (canonicalManifestBytes(parsed).byteLength > MARKETPLACE_LIMITS.maxAuditPayloadBytes) {
    throw new TypeError(
      `audit.payload may not exceed ${MARKETPLACE_LIMITS.maxAuditPayloadBytes} canonical bytes`
    )
  }
  return parsed
}

export async function marketplaceAuditPayloadDigest(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseMarketplaceAuditPayload(value))
}

type MarketplaceAuditHashFields = Omit<MarketplaceAuditEventV1, 'eventHash'>

export async function marketplaceAuditEventHash(
  fields: MarketplaceAuditHashFields
): Promise<string> {
  if (
    !Number.isSafeInteger(fields.sequence) ||
    fields.sequence <= 0 ||
    fields.sequence > MARKETPLACE_LIMITS.maxAuditEvents
  ) {
    throw new TypeError('audit.sequence must be a positive bounded safe integer')
  }
  if (!MARKETPLACE_AUDIT_ACTIONS.includes(fields.action)) {
    throw new TypeError('audit.action is not supported')
  }
  return digestCanonicalManifest({
    sequence: fields.sequence,
    time: parseMarketplaceTimestamp(fields.time, 'audit.time'),
    actor: parseMarketplaceAuditActor(fields.actor),
    action: fields.action,
    subject: parseMarketplaceAuditSubject(fields.subject),
    payloadDigest: parseSha256Base64Url(fields.payloadDigest, 'audit.payloadDigest'),
    previousHash:
      fields.previousHash === null
        ? null
        : parseSha256Base64Url(fields.previousHash, 'audit.previousHash')
  })
}

function structurallyParsedEvents(value: unknown): readonly MarketplaceAuditEventV1[] {
  return Object.freeze(
    parseBoundedManifestArray(
      value,
      'marketplace.auditEvents',
      MARKETPLACE_LIMITS.maxAuditEvents
    ).map((event, index) => parseMarketplaceAuditEvent(event, `marketplace.auditEvents[${index}]`))
  )
}

export async function verifyMarketplaceAuditChain(
  value: unknown
): Promise<readonly MarketplaceAuditEventV1[]> {
  const events = structurallyParsedEvents(value)
  let previousHash: string | null = null
  let previousTime = Number.NEGATIVE_INFINITY
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1) {
      throw new TypeError('Marketplace audit sequence is not contiguous and one-based')
    }
    if (event.previousHash !== previousHash) {
      throw new TypeError(`Marketplace audit event ${event.sequence} has an invalid previousHash`)
    }
    const time = Date.parse(event.time)
    if (time < previousTime) {
      throw new TypeError('Marketplace audit timestamps must not move backwards')
    }
    const { eventHash, ...fields } = event
    const expectedHash = await marketplaceAuditEventHash(fields)
    if (eventHash !== expectedHash) {
      throw new TypeError(`Marketplace audit event ${event.sequence} has an invalid eventHash`)
    }
    previousHash = eventHash
    previousTime = time
  }
  VERIFIED_CHAINS.add(events)
  return events
}

async function verifiedEvents(value: unknown): Promise<readonly MarketplaceAuditEventV1[]> {
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.isFrozen(value) &&
    VERIFIED_CHAINS.has(value)
  ) {
    return value as readonly MarketplaceAuditEventV1[]
  }
  return verifyMarketplaceAuditChain(value)
}

export async function appendMarketplaceAuditEvent(
  value: unknown,
  input: AppendMarketplaceAuditEventInput
): Promise<AppendMarketplaceAuditEventResult> {
  const events = await verifiedEvents(value)
  if (events.length >= MARKETPLACE_LIMITS.maxAuditEvents) {
    throw new RangeError(
      `Marketplace audit chain reached its limit of ${MARKETPLACE_LIMITS.maxAuditEvents} events`
    )
  }
  const time = parseMarketplaceTimestamp(input.time, 'audit.time')
  const previous = events.at(-1)
  if (previous && Date.parse(time) < Date.parse(previous.time)) {
    throw new TypeError('Marketplace audit timestamps must not move backwards')
  }
  if (!MARKETPLACE_AUDIT_ACTIONS.includes(input.action)) {
    throw new TypeError('audit.action is not supported')
  }
  const fields = Object.freeze({
    sequence: events.length + 1,
    time,
    actor: parseMarketplaceAuditActor(input.actor),
    action: input.action,
    subject: parseMarketplaceAuditSubject(input.subject),
    payloadDigest: await marketplaceAuditPayloadDigest(input.payload),
    previousHash: previous?.eventHash ?? null
  })
  const event = parseMarketplaceAuditEvent({
    ...fields,
    eventHash: await marketplaceAuditEventHash(fields)
  })
  const next = Object.freeze([...events, event])
  VERIFIED_CHAINS.add(next)
  return Object.freeze({ events: next, event })
}

export function marketplaceAuditHead(events: readonly MarketplaceAuditEventV1[]): string | null {
  return events.at(-1)?.eventHash ?? null
}

export async function verifyMarketplaceAuditEventHash(
  event: MarketplaceAuditEventV1
): Promise<boolean> {
  const parsed = parseMarketplaceAuditEvent(event)
  const { eventHash, ...fields } = parsed
  const expected = await marketplaceAuditEventHash(fields)
  const left = new TextEncoder().encode(eventHash)
  const right = new TextEncoder().encode(expected)
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

export async function rawSha256Base64Url(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', webCryptoBuffer(bytes))
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}
