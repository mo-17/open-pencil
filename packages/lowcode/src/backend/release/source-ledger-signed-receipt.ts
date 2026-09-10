import {
  canonicalManifestBytes,
  digestCanonicalManifest,
  parseSignedManifestIntegrity,
  signedManifestBytes,
  type SignedManifestIntegrity
} from '@open-pencil/scene-graph'

import {
  digestBackendSourceLedgerAppliedPrefixV1,
  digestBackendSourceLedgerBindingSubjectV1,
  digestBackendSourceLedgerCIAttestationV1,
  parseBackendSourceLedgerBindingReceiptV1,
  type BackendSourceLedgerBindingReceiptV1
} from './source-ledger-binding'
import { compareReleaseTimestamps, exactRecord } from './validation'

export const BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_VERSION = 1 as const
export const BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_FORMAT =
  'openpencil.backend-source-ledger-signed-receipt' as const

/**
 * Shared portable input bound. Nested receipt strings and arrays retain the stricter limits from
 * the source-ledger binding parser, including the 256-entry applied-migration prefix.
 */
export const BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_LIMITS = Object.freeze({
  maxJsonBytes: 256 * 1024
})

const PAYLOAD_KEYS = ['format', 'version', 'receipt'] as const
const SIGNED_RECEIPT_KEYS = [...PAYLOAD_KEYS, 'integrity'] as const

/** Canonical data covered by the SHA-256 digest and future Host signature verification. */
export interface BackendSourceLedgerSignedReceiptPayloadV1 {
  readonly format: typeof BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_FORMAT
  readonly version: typeof BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_VERSION
  readonly receipt: BackendSourceLedgerBindingReceiptV1
}

/**
 * Portable signed-envelope data only. `keyId` is a locator, not a trust root; a production Host
 * must select its public key independently and verify the Ed25519 signature outside this module.
 */
export interface BackendSourceLedgerSignedReceiptV1 extends BackendSourceLedgerSignedReceiptPayloadV1 {
  readonly integrity: SignedManifestIntegrity
}

/** A successful result proves shape and canonical digest consistency, and nothing more. */
export interface BackendSourceLedgerSignedReceiptStructuralResultV1 {
  readonly structurallyValid: true
  readonly signedReceipt: BackendSourceLedgerSignedReceiptV1
  readonly payloadDigest: string
}

function signedReceiptPayload(
  value: BackendSourceLedgerSignedReceiptV1
): BackendSourceLedgerSignedReceiptPayloadV1 {
  return Object.freeze({
    format: value.format,
    version: value.version,
    receipt: value.receipt
  })
}

function containsUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }
  return false
}

function assertPortableUnicodeStrings(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (containsUnpairedSurrogate(value)) {
      throw new TypeError(`${path} must contain Unicode scalar values only`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPortableUnicodeStrings(entry, `${path}[${index}]`))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assertPortableUnicodeStrings(entry, `${path}.${key}`)
    }
  }
}

function parsePayload(value: unknown, path: string): BackendSourceLedgerSignedReceiptPayloadV1 {
  const source = exactRecord(value, path, PAYLOAD_KEYS)
  if (source.format !== BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  const payload = Object.freeze({
    format: BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_FORMAT,
    version: BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_VERSION,
    receipt: parseBackendSourceLedgerBindingReceiptV1(source.receipt, `${path}.receipt`)
  })
  assertPortableUnicodeStrings(payload, path)
  return payload
}

function freezeIntegrity(value: unknown, path: string): SignedManifestIntegrity {
  const integrity = parseSignedManifestIntegrity(value, path)
  return Object.freeze({
    algorithm: integrity.algorithm,
    digest: integrity.digest,
    signature: Object.freeze({
      algorithm: integrity.signature.algorithm,
      keyId: integrity.signature.keyId,
      value: integrity.signature.value
    })
  })
}

function parseEnvelopeShape(value: unknown, path: string): BackendSourceLedgerSignedReceiptV1 {
  const source = exactRecord(value, path, SIGNED_RECEIPT_KEYS)
  const payload = parsePayload(
    {
      format: source.format,
      version: source.version,
      receipt: source.receipt
    },
    path
  )
  return Object.freeze({
    ...payload,
    integrity: freezeIntegrity(source.integrity, `${path}.integrity`)
  })
}

function boundedCanonicalBytes(value: unknown, path: string): Uint8Array {
  const bytes = canonicalManifestBytes(value)
  if (bytes.byteLength > BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_LIMITS.maxJsonBytes) {
    throw new TypeError(
      `${path} may not exceed ${BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_LIMITS.maxJsonBytes} canonical bytes`
    )
  }
  return bytes
}

async function assertReceiptConsistency(
  receipt: BackendSourceLedgerBindingReceiptV1,
  path: string
): Promise<void> {
  const [subjectDigest, attestationDigest, appliedPrefixDigest] = await Promise.all([
    digestBackendSourceLedgerBindingSubjectV1(receipt.subject),
    digestBackendSourceLedgerCIAttestationV1(receipt.attestation),
    digestBackendSourceLedgerAppliedPrefixV1(receipt.subject.staging.appliedMigrationIds)
  ])
  if (
    receipt.subjectDigest !== subjectDigest ||
    receipt.attestationDigest !== attestationDigest ||
    receipt.subject.staging.appliedPrefixDigest !== appliedPrefixDigest
  ) {
    throw new TypeError(`${path} contains an internal canonical digest mismatch`)
  }
  if (
    receipt.attestation.subjectDigest !== subjectDigest ||
    receipt.attestation.sourceLedgerDigest !== receipt.subject.sourceLedgerDigest ||
    receipt.attestation.stagingProjectRef !== receipt.subject.projectRef
  ) {
    throw new TypeError(`${path}.attestation does not bind the exact receipt subject`)
  }
  if (
    compareReleaseTimestamps(
      receipt.attestation.attestedAt,
      receipt.recordedAt,
      `${path}.attestation.attestedAt`,
      `${path}.recordedAt`
    ) > 0
  ) {
    throw new TypeError(`${path}.attestation must not postdate the receipt`)
  }
}

export async function canonicalBackendSourceLedgerSignedReceiptPayloadV1Bytes(
  value: unknown
): Promise<Uint8Array> {
  const payload = parsePayload(value, '$.payload')
  await assertReceiptConsistency(payload.receipt, '$.payload.receipt')
  return boundedCanonicalBytes(payload, '$.payload')
}

export async function digestBackendSourceLedgerSignedReceiptPayloadV1(
  value: unknown
): Promise<string> {
  const payload = parsePayload(value, '$.payload')
  await assertReceiptConsistency(payload.receipt, '$.payload.receipt')
  boundedCanonicalBytes(payload, '$.payload')
  return digestCanonicalManifest(payload)
}

/**
 * Parse strict portable data and check canonical SHA-256 linkage only. This function does not
 * accept a public key, verify the Ed25519 signature, authenticate CI provenance, or grant any
 * database, execution, source-ledger, receipt, or release authority.
 */
export async function parseBackendSourceLedgerSignedReceiptV1(
  value: unknown,
  path = '$.signedReceipt'
): Promise<BackendSourceLedgerSignedReceiptStructuralResultV1> {
  const signedReceipt = parseEnvelopeShape(value, path)
  const payload = signedReceiptPayload(signedReceipt)
  boundedCanonicalBytes(payload, `${path}.payload`)
  boundedCanonicalBytes(signedReceipt, path)
  await assertReceiptConsistency(signedReceipt.receipt, `${path}.receipt`)
  const payloadDigest = await digestCanonicalManifest(payload)
  if (payloadDigest !== signedReceipt.integrity.digest) {
    throw new TypeError(`${path}.integrity.digest does not match the canonical payload`)
  }
  return Object.freeze({
    structurallyValid: true as const,
    signedReceipt,
    payloadDigest
  })
}

/** Exact bytes a future fixed-trust-root verifier must authenticate with Ed25519. */
export async function canonicalBackendSourceLedgerSignedReceiptSigningV1Bytes(
  value: unknown
): Promise<Uint8Array> {
  const parsed = await parseBackendSourceLedgerSignedReceiptV1(value)
  const payload = signedReceiptPayload(parsed.signedReceipt)
  return signedManifestBytes(payload, parsed.payloadDigest)
}

export async function canonicalBackendSourceLedgerSignedReceiptV1Bytes(
  value: unknown
): Promise<Uint8Array> {
  const parsed = await parseBackendSourceLedgerSignedReceiptV1(value)
  return boundedCanonicalBytes(parsed.signedReceipt, '$.signedReceipt')
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}

/**
 * Decode only the unique canonical UTF-8 JSON representation. Requiring byte equality after strict
 * parsing rejects duplicate keys, insignificant whitespace, and alternate escape spellings before
 * a future cross-language Host verifier sees the envelope.
 */
export async function parseBackendSourceLedgerSignedReceiptV1Bytes(
  value: Uint8Array
): Promise<BackendSourceLedgerSignedReceiptStructuralResultV1> {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError('$.signedReceiptBytes must be a Uint8Array')
  }
  if (
    value.byteLength === 0 ||
    value.byteLength > BACKEND_SOURCE_LEDGER_SIGNED_RECEIPT_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('$.signedReceiptBytes exceeds the bounded canonical JSON size')
  }
  const input = Uint8Array.from(value)
  let decoded: unknown
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input))
  } catch {
    throw new TypeError('$.signedReceiptBytes must contain canonical UTF-8 JSON')
  }
  const parsed = await parseBackendSourceLedgerSignedReceiptV1(decoded)
  const canonical = boundedCanonicalBytes(parsed.signedReceipt, '$.signedReceipt')
  if (!equalBytes(input, canonical)) {
    throw new TypeError('$.signedReceiptBytes must use the unique canonical JSON encoding')
  }
  return parsed
}
