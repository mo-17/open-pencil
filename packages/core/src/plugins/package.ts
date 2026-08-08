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
  type PluginManifestV1
} from './manifest'

export interface VerifiedPluginPackage {
  manifest: PluginManifestV1
  verifiedDigest: string
  verifiedKeyId: string
}

export interface PluginPackageVerificationOptions {
  engineVersion?: string
  expectedKeyId?: string
}

const SNAPSHOT_KEYS = new Set(['manifest', 'verifiedDigest', 'verifiedKeyId'])

export function parsePluginPackageJson(source: string): PluginManifestV1 {
  if (typeof source !== 'string') throw new TypeError('Plugin package JSON must be a string')
  if (new TextEncoder().encode(source).byteLength > PLUGIN_MANIFEST_LIMITS.maxJsonBytes) {
    throw new TypeError(
      `Plugin package JSON may not exceed ${PLUGIN_MANIFEST_LIMITS.maxJsonBytes} bytes`
    )
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new TypeError('Plugin package must contain valid JSON')
  }
  return parsePluginManifest(value)
}

export function parsePluginPackageBytes(source: Uint8Array): PluginManifestV1 {
  if (source.byteLength > PLUGIN_MANIFEST_LIMITS.maxJsonBytes) {
    throw new TypeError(
      `Plugin package may not exceed ${PLUGIN_MANIFEST_LIMITS.maxJsonBytes} bytes`
    )
  }
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(source)
  } catch {
    throw new TypeError('Plugin package must contain valid UTF-8')
  }
  return parsePluginPackageJson(decoded)
}

export async function signPluginManifest(
  value: unknown,
  privateKey: CryptoKey
): Promise<PluginManifestV1> {
  const payload = parsePluginManifestPayload(value)
  return parsePluginManifest({
    ...payload,
    integrity: await createSignedManifestIntegrity(payload, payload.publisher.keyId, privateKey)
  })
}

export async function verifyPluginPackage(
  value: unknown,
  publicKey: CryptoKey,
  options: PluginPackageVerificationOptions = {}
): Promise<VerifiedPluginPackage> {
  const manifest = parsePluginManifest(value)
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
  return { manifest, verifiedDigest: digest, verifiedKeyId: integrity.signature.keyId }
}

/**
 * Validates a persisted snapshot's shape and metadata. This does not repeat public-key verification.
 */
export function parseVerifiedPluginPackageSnapshot(value: unknown): VerifiedPluginPackage {
  const source = parseExactManifestRecord(value, 'plugin snapshot', SNAPSHOT_KEYS)
  const manifest = parsePluginManifest(source.manifest)
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
