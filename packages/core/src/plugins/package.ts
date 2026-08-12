import {
  assertSignedManifestVerificationPolicy,
  createSignedManifestIntegrity,
  parseExactManifestRecord,
  verifySignedManifestIntegrity
} from '@open-pencil/scene-graph'

import {
  PLUGIN_MANIFEST_LIMITS,
  parsePluginManifest,
  parsePluginManifestPayload,
  parseVersionedPluginManifest,
  parseVersionedPluginManifestPayload,
  type PluginManifest,
  type PluginManifestPayload,
  type PluginManifestV1
} from './manifest'

export interface VerifiedPluginPackage {
  manifest: PluginManifest
  verifiedDigest: string
  verifiedKeyId: string
}

export type VerifiedPluginPackageV1 = Omit<VerifiedPluginPackage, 'manifest'> & {
  manifest: PluginManifestV1
}

/** @deprecated Use `VerifiedPluginPackage`, whose manifest is versioned. */
export type VersionedVerifiedPluginPackage = VerifiedPluginPackage

export interface PluginPackageVerificationOptions {
  engineVersion?: string
  expectedKeyId?: string
}

const SNAPSHOT_KEYS = new Set(['manifest', 'verifiedDigest', 'verifiedKeyId'])

export function parsePluginPackageJSON(source: string): PluginManifestV1 {
  return parsePluginManifest(decodePluginPackageJSON(source))
}

export function parsePluginPackageBytes(source: Uint8Array): PluginManifestV1 {
  return parsePluginPackageJSON(decodePluginPackageBytes(source))
}

function decodePluginPackageJSON(source: string): unknown {
  if (typeof source !== 'string') throw new TypeError('Plugin package JSON must be a string')
  if (new TextEncoder().encode(source).byteLength > PLUGIN_MANIFEST_LIMITS.maxJsonBytes) {
    throw new TypeError(
      `Plugin package JSON may not exceed ${PLUGIN_MANIFEST_LIMITS.maxJsonBytes} bytes`
    )
  }
  try {
    return JSON.parse(source)
  } catch {
    throw new TypeError('Plugin package must contain valid JSON')
  }
}

function decodePluginPackageBytes(source: Uint8Array): string {
  if (source.byteLength > PLUGIN_MANIFEST_LIMITS.maxJsonBytes) {
    throw new TypeError(
      `Plugin package may not exceed ${PLUGIN_MANIFEST_LIMITS.maxJsonBytes} bytes`
    )
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(source)
  } catch {
    throw new TypeError('Plugin package must contain valid UTF-8')
  }
}

export function parseVersionedPluginPackageJSON(source: string): PluginManifest {
  return parseVersionedPluginManifest(decodePluginPackageJSON(source))
}

export function parseVersionedPluginPackageBytes(source: Uint8Array): PluginManifest {
  return parseVersionedPluginPackageJSON(decodePluginPackageBytes(source))
}

export async function signPluginManifest(
  value: unknown,
  privateKey: CryptoKey
): Promise<PluginManifestV1> {
  const payload = parsePluginManifestPayload(value)
  return parsePluginManifest(await signParsedPluginManifest(payload, privateKey))
}

async function signParsedPluginManifest<TPayload extends PluginManifestPayload>(
  payload: TPayload,
  privateKey: CryptoKey
): Promise<TPayload & { integrity: PluginManifest['integrity'] }> {
  return {
    ...payload,
    integrity: await createSignedManifestIntegrity(payload, payload.publisher.keyId, privateKey)
  }
}

export async function signVersionedPluginManifest(
  value: unknown,
  privateKey: CryptoKey
): Promise<PluginManifest> {
  const payload = parseVersionedPluginManifestPayload(value)
  return parseVersionedPluginManifest(await signParsedPluginManifest(payload, privateKey))
}

async function verifyManifestIntegrity(
  manifest: PluginManifest,
  publicKey: CryptoKey,
  options: PluginPackageVerificationOptions
): Promise<{ digest: string; verifiedKeyId: string }> {
  assertSignedManifestVerificationPolicy(publicKey, manifest.integrity.signature.keyId, options, {
    engineRange: manifest.engineRange,
    label: 'Plugin',
    maxEngineRangeLength: PLUGIN_MANIFEST_LIMITS.maxEngineRangeLength
  })
  const { integrity, ...payload } = manifest
  const digest = await verifySignedManifestIntegrity(
    payload,
    integrity,
    publicKey,
    'Plugin manifest'
  )
  return { digest, verifiedKeyId: integrity.signature.keyId }
}

export async function verifyPluginPackage(
  value: unknown,
  publicKey: CryptoKey,
  options: PluginPackageVerificationOptions = {}
): Promise<VerifiedPluginPackageV1> {
  const manifest = parsePluginManifest(value)
  const verified = await verifyManifestIntegrity(manifest, publicKey, options)
  return {
    manifest,
    verifiedDigest: verified.digest,
    verifiedKeyId: verified.verifiedKeyId
  }
}

export async function verifyVersionedPluginPackage(
  value: unknown,
  publicKey: CryptoKey,
  options: PluginPackageVerificationOptions = {}
): Promise<VerifiedPluginPackage> {
  const manifest = parseVersionedPluginManifest(value)
  const verified = await verifyManifestIntegrity(manifest, publicKey, options)
  return {
    manifest,
    verifiedDigest: verified.digest,
    verifiedKeyId: verified.verifiedKeyId
  }
}

/**
 * Validates a persisted snapshot's shape and metadata. This does not repeat public-key verification.
 */
export function parseVerifiedPluginPackageSnapshot(value: unknown): VerifiedPluginPackage {
  const source = parseExactManifestRecord(value, 'plugin snapshot', SNAPSHOT_KEYS)
  const manifest = parseVersionedPluginManifest(source.manifest)
  if (
    source.verifiedDigest !== manifest.integrity.digest ||
    source.verifiedKeyId !== manifest.integrity.signature.keyId
  ) {
    throw new TypeError('Verified plugin snapshot metadata does not match its manifest')
  }
  return {
    manifest,
    verifiedDigest: source.verifiedDigest,
    verifiedKeyId: source.verifiedKeyId
  }
}
