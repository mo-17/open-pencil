/* eslint-disable max-lines -- Signed Team Motion verification, registry transitions, and atomic apply share one trust boundary */
import {
  TEAM_MOTION_LIBRARY_LIMITS,
  acceptTeamMotionLibraryReview,
  createTeamMotionLibraryRegistry,
  importTeamMotionPublicKey,
  instantiateTeamMotionLibraryEntry,
  parseTeamMotionLibraryRegistryState,
  rejectTeamMotionLibraryReview,
  reviewTeamMotionLibraryUpdate as reviewTeamMotionLibraryUpdateState,
  rollbackTeamMotionLibrary,
  verifyTeamMotionLibraryManifest,
  type TeamMotionLibraryInstantiation,
  type TeamMotionLibraryRegistryState,
  type VerifiedTeamMotionLibrarySnapshot
} from '@open-pencil/scene-graph'

import { defineTool, type ToolCtx } from '#core/tools/schema'

import { applyMotionToTargets, validateMotionNodeCapabilities, type MotionTarget } from './motion'

type TeamMotionToolResult<T> = { ok: true; data: T } | { ok: false; error: string }
type TeamMotionRegistryAction = 'accept' | 'reject' | 'rollback'

interface ManagedTeamMotionRegistry {
  action: TeamMotionRegistryAction
  libraryId: string
  acceptedVersion: string
  acceptedDigest: string
  pendingVersion: string | null
  history: Array<{ version: string; digest: string }>
  registryJson: string
}

interface TeamMotionJsonObject {
  [key: string]: unknown
}

const MAX_TEAM_TOOL_INPUT_BYTES = TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes
const MAX_TEAM_REGISTRY_TOOL_INPUT_BYTES = 16_777_216
const MAX_TEAM_PUBLIC_KEY_BYTES = 32_768

function fail<T = never>(error: string): TeamMotionToolResult<T> {
  return { ok: false, error }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isJsonObject(value: unknown): value is TeamMotionJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonText(
  value: string,
  field: string,
  maxBytes: number = MAX_TEAM_TOOL_INPUT_BYTES
): TeamMotionToolResult<unknown> {
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    return fail(`${field} must not exceed ${maxBytes} UTF-8 bytes`)
  }
  try {
    return { ok: true, data: JSON.parse(value) as unknown }
  } catch (error) {
    return fail(`${field} must be valid JSON: ${errorMessage(error)}`)
  }
}

async function trustedPublicKey(publicKeyPem: string): Promise<CryptoKey> {
  if (new TextEncoder().encode(publicKeyPem).byteLength > MAX_TEAM_PUBLIC_KEY_BYTES) {
    throw new Error(`publicKeyPem must not exceed ${MAX_TEAM_PUBLIC_KEY_BYTES} UTF-8 bytes`)
  }
  return importTeamMotionPublicKey(publicKeyPem)
}

function parseOptionalObject(
  value: string | undefined,
  field: string
): TeamMotionToolResult<TeamMotionJsonObject | undefined> {
  if (value === undefined) return { ok: true, data: undefined }
  const parsed = parseJsonText(value, field)
  if (!parsed.ok) return parsed
  if (!isJsonObject(parsed.data)) {
    return fail(`${field} must encode a JSON object`)
  }
  return { ok: true, data: parsed.data }
}

async function verifiedManifest(
  manifestJson: string,
  publicKeyPem: string,
  engineVersion: string,
  expectedKeyId?: string
): Promise<TeamMotionToolResult<VerifiedTeamMotionLibrarySnapshot>> {
  const parsed = parseJsonText(manifestJson, 'manifestJson')
  if (!parsed.ok) return parsed
  try {
    const publicKey = await trustedPublicKey(publicKeyPem)
    return {
      ok: true,
      data: await verifyTeamMotionLibraryManifest(parsed.data, publicKey, {
        engineVersion,
        ...(expectedKeyId ? { expectedKeyId } : {})
      })
    }
  } catch (error) {
    return fail(`Team Motion library verification failed: ${errorMessage(error)}`)
  }
}

async function verifiedRegistryState(
  registryJson: string,
  publicKeyPem: string,
  engineVersion: string,
  expectedKeyId?: string
): Promise<TeamMotionToolResult<TeamMotionLibraryRegistryState>> {
  const parsed = parseJsonText(registryJson, 'registryJson', MAX_TEAM_REGISTRY_TOOL_INPUT_BYTES)
  if (!parsed.ok) return parsed
  try {
    const state = parseTeamMotionLibraryRegistryState(parsed.data)
    const publicKey = await trustedPublicKey(publicKeyPem)
    const trustedKeyId = expectedKeyId ?? state.accepted.manifest.publisher.keyId
    const verifySnapshot = async (snapshot: VerifiedTeamMotionLibrarySnapshot) => {
      const verified = await verifyTeamMotionLibraryManifest(snapshot.manifest, publicKey, {
        engineVersion,
        expectedKeyId: trustedKeyId
      })
      if (
        verified.verifiedDigest !== snapshot.verifiedDigest ||
        verified.verifiedKeyId !== snapshot.verifiedKeyId
      ) {
        throw new Error('Verified registry snapshot metadata changed during verification')
      }
    }
    await verifySnapshot(state.accepted)
    for (const snapshot of state.history) await verifySnapshot(snapshot)
    if (state.pending) await verifySnapshot(state.pending.candidate)
    return { ok: true, data: state }
  } catch (error) {
    return fail(`Team Motion registry verification failed: ${errorMessage(error)}`)
  }
}

function serializeRegistry(state: TeamMotionLibraryRegistryState): TeamMotionToolResult<string> {
  const registryJson = JSON.stringify(state)
  const byteLength = new TextEncoder().encode(registryJson).byteLength
  if (byteLength > MAX_TEAM_REGISTRY_TOOL_INPUT_BYTES) {
    return fail(
      `Resulting Team Motion registry exceeds ${MAX_TEAM_REGISTRY_TOOL_INPUT_BYTES} UTF-8 bytes`
    )
  }
  return { ok: true, data: registryJson }
}

function registryAction(
  action: string,
  digest: string | undefined
): TeamMotionToolResult<{ action: TeamMotionRegistryAction; digest?: string }> {
  if (action !== 'accept' && action !== 'reject' && action !== 'rollback') {
    return fail(`Unknown Team Motion registry action: ${action}`)
  }
  if (action === 'rollback') {
    if (!digest) return fail('digest is required for a rollback transition')
    return { ok: true, data: { action, digest } }
  }
  if (digest !== undefined) return fail('digest applies only to a rollback transition')
  return { ok: true, data: { action } }
}

function transitionRegistry(
  current: TeamMotionLibraryRegistryState,
  action: TeamMotionRegistryAction,
  digest?: string
): TeamMotionToolResult<TeamMotionLibraryRegistryState> {
  if ((action === 'accept' || action === 'reject') && !current.pending) {
    return fail(`Cannot ${action}: the Team Motion registry has no pending review`)
  }
  if (
    action === 'rollback' &&
    !current.history.some((snapshot) => snapshot.verifiedDigest === digest)
  ) {
    return fail('Cannot rollback: digest is not present in cryptographically verified history')
  }
  try {
    switch (action) {
      case 'accept':
        return { ok: true, data: acceptTeamMotionLibraryReview(current) }
      case 'reject':
        return { ok: true, data: rejectTeamMotionLibraryReview(current) }
      case 'rollback':
        return { ok: true, data: rollbackTeamMotionLibrary(current, digest ?? '') }
      default:
        return fail('Unknown Team Motion registry transition')
    }
  } catch (error) {
    return fail(`Team Motion registry transition failed: ${errorMessage(error)}`)
  }
}

function managedRegistryResult(
  action: TeamMotionRegistryAction,
  state: TeamMotionLibraryRegistryState,
  registryJson: string
): ManagedTeamMotionRegistry {
  return {
    action,
    libraryId: state.accepted.manifest.library.id,
    acceptedVersion: state.accepted.manifest.version,
    acceptedDigest: state.accepted.verifiedDigest,
    pendingVersion: state.pending?.candidate.manifest.version ?? null,
    history: state.history.map((snapshot) => ({
      version: snapshot.manifest.version,
      digest: snapshot.verifiedDigest
    })),
    registryJson
  }
}

function entryId(entry: VerifiedTeamMotionLibrarySnapshot['manifest']['entries'][number]): string {
  return entry.kind === 'preset' ? entry.preset.id : entry.recipe.id
}

export const verifyTeamMotionLibrary = defineTool({
  name: 'verify_team_motion_library',
  description:
    'Parse and cryptographically verify one bounded signed Team Motion library manifest against an Ed25519 public key, trusted key id, and explicit OpenPencil engine version. Returns a summary only and never stores or applies untrusted content.',
  params: {
    manifestJson: {
      type: 'string',
      description: 'Strict JSON-encoded openpencil-team-motion-library v1 manifest',
      required: true
    },
    publicKeyPem: {
      type: 'string',
      description: 'Trusted Ed25519 public key in SPKI PEM form',
      required: true
    },
    engineVersion: {
      type: 'string',
      description: 'Current OpenPencil semantic version used to enforce the manifest engine range',
      required: true
    },
    expectedKeyId: {
      type: 'string',
      description: 'Optional trusted publisher key id that must match the signed manifest'
    }
  },
  execute: async (
    _figma,
    { manifestJson, publicKeyPem, engineVersion, expectedKeyId }
  ): Promise<
    TeamMotionToolResult<{
      publisherId: string
      libraryId: string
      version: string
      engineRange: string
      verifiedDigest: string
      verifiedKeyId: string
      entryIds: string[]
      tokenCount: number
    }>
  > => {
    const verified = await verifiedManifest(
      manifestJson,
      publicKeyPem,
      engineVersion,
      expectedKeyId
    )
    if (!verified.ok) return verified
    const { manifest, verifiedDigest, verifiedKeyId } = verified.data
    return {
      ok: true,
      data: {
        publisherId: manifest.publisher.id,
        libraryId: manifest.library.id,
        version: manifest.version,
        engineRange: manifest.engineRange,
        verifiedDigest,
        verifiedKeyId,
        entryIds: manifest.entries.map(entryId),
        tokenCount: manifest.tokens?.length ?? 0
      }
    }
  }
})

export const reviewTeamMotionLibraryUpdate = defineTool({
  name: 'review_team_motion_library_update',
  description:
    'Verify an accepted and candidate Team Motion manifest with the same trusted Ed25519 key, enforce engine compatibility and immutable library identity, then return a deterministic add/update/remove diff plus a pending registry JSON snapshot without accepting, persisting, or applying it.',
  params: {
    acceptedManifestJson: {
      type: 'string',
      description:
        'Bootstrap form: currently accepted signed manifest JSON. Provide exactly one of acceptedManifestJson or registryJson.'
    },
    registryJson: {
      type: 'string',
      description:
        'Continuation form: existing verified registry JSON whose accepted/history state must be preserved. Provide exactly one current-state input.'
    },
    candidateManifestJson: {
      type: 'string',
      description: 'Candidate signed Team Motion manifest JSON to review',
      required: true
    },
    publicKeyPem: {
      type: 'string',
      description: 'Trusted Ed25519 public key in SPKI PEM form',
      required: true
    },
    engineVersion: {
      type: 'string',
      description: 'Current OpenPencil semantic version used for both engine-range checks',
      required: true
    },
    expectedKeyId: {
      type: 'string',
      description: 'Optional trusted publisher key id required on both manifests'
    }
  },
  execute: async (
    _figma,
    {
      acceptedManifestJson,
      registryJson: currentRegistryJson,
      candidateManifestJson,
      publicKeyPem,
      engineVersion,
      expectedKeyId
    }
  ): Promise<
    TeamMotionToolResult<{
      libraryId: string
      acceptedDigest: string
      candidateDigest: string
      fromVersion: string | null
      toVersion: string
      added: string[]
      updated: string[]
      removed: string[]
      registryJson: string
    }>
  > => {
    if ((acceptedManifestJson === undefined) === (currentRegistryJson === undefined)) {
      return fail('Provide exactly one of acceptedManifestJson or registryJson')
    }
    let current: TeamMotionToolResult<TeamMotionLibraryRegistryState>
    if (currentRegistryJson !== undefined) {
      current = await verifiedRegistryState(
        currentRegistryJson,
        publicKeyPem,
        engineVersion,
        expectedKeyId
      )
    } else {
      const accepted = await verifiedManifest(
        acceptedManifestJson ?? '',
        publicKeyPem,
        engineVersion,
        expectedKeyId
      )
      current = accepted.ok
        ? { ok: true, data: createTeamMotionLibraryRegistry(accepted.data) }
        : accepted
    }
    if (!current.ok) return current
    const candidate = await verifiedManifest(
      candidateManifestJson,
      publicKeyPem,
      engineVersion,
      expectedKeyId
    )
    if (!candidate.ok) return candidate
    try {
      const registry = reviewTeamMotionLibraryUpdateState(current.data, candidate.data)
      if (!registry.pending) return fail('Candidate does not create a pending Team Motion review')
      const registryJson = serializeRegistry(registry)
      if (!registryJson.ok) return registryJson
      return {
        ok: true,
        data: {
          libraryId: registry.accepted.manifest.library.id,
          acceptedDigest: current.data.accepted.verifiedDigest,
          candidateDigest: candidate.data.verifiedDigest,
          ...registry.pending.diff,
          registryJson: registryJson.data
        }
      }
    } catch (error) {
      return fail(`Team Motion update review failed: ${errorMessage(error)}`)
    }
  }
})

export const manageTeamMotionLibraryRegistry = defineTool({
  name: 'manage_team_motion_library_registry',
  description:
    'Purely transform one bounded Team Motion registry by explicitly accepting or rejecting its pending review, or rolling back to a digest already present in verified history. Re-verifies every accepted, history, and pending signature plus engine/key constraints before the transition, returns JSON for the caller to persist explicitly, and never reads or writes local settings.',
  params: {
    registryJson: {
      type: 'string',
      description:
        'Strict JSON-encoded Team Motion registry state returned by review or prior manage',
      required: true
    },
    publicKeyPem: {
      type: 'string',
      description: 'Trusted Ed25519 public key in SPKI PEM form',
      required: true
    },
    engineVersion: {
      type: 'string',
      description: 'Current OpenPencil semantic version used to reverify every registry snapshot',
      required: true
    },
    expectedKeyId: {
      type: 'string',
      description: 'Optional trusted publisher key id required on every registry snapshot'
    },
    action: {
      type: 'string',
      enum: ['accept', 'reject', 'rollback'],
      description: 'Explicit registry transition to perform',
      required: true
    },
    digest: {
      type: 'string',
      description:
        'Required only for rollback; must identify a cryptographically verified history item'
    }
  },
  execute: async (
    _figma,
    { registryJson, publicKeyPem, engineVersion, expectedKeyId, action, digest }
  ): Promise<TeamMotionToolResult<ManagedTeamMotionRegistry>> => {
    const requested = registryAction(action, digest)
    if (!requested.ok) return requested

    const verified = await verifiedRegistryState(
      registryJson,
      publicKeyPem,
      engineVersion,
      expectedKeyId
    )
    if (!verified.ok) return verified
    const next = transitionRegistry(verified.data, requested.data.action, requested.data.digest)
    if (!next.ok) return next
    const nextRegistryJson = serializeRegistry(next.data)
    if (!nextRegistryJson.ok) return nextRegistryJson
    return {
      ok: true,
      data: managedRegistryResult(requested.data.action, next.data, nextRegistryJson.data)
    }
  }
})

function inputForInstantiation(
  roleMappingJson: string | undefined,
  parametersJson: string | undefined,
  tokensJson: string | undefined
): TeamMotionToolResult<{
  roleMapping?: Record<string, readonly string[]>
  parameters?: Record<string, number>
  tokens?: Record<string, number>
}> {
  const roleMapping = parseOptionalObject(roleMappingJson, 'roleMappingJson')
  if (!roleMapping.ok) return roleMapping
  const parameters = parseOptionalObject(parametersJson, 'parametersJson')
  if (!parameters.ok) return parameters
  const tokens = parseOptionalObject(tokensJson, 'tokensJson')
  if (!tokens.ok) return tokens
  return {
    ok: true,
    data: {
      ...(roleMapping.data
        ? { roleMapping: roleMapping.data as Record<string, readonly string[]> }
        : {}),
      ...(parameters.data ? { parameters: parameters.data as Record<string, number> } : {}),
      ...(tokens.data ? { tokens: tokens.data as Record<string, number> } : {})
    }
  }
}

function targetsForInstantiation(
  instantiated: TeamMotionLibraryInstantiation,
  nodeIds: string[] | undefined
): TeamMotionToolResult<MotionTarget[]> {
  if (instantiated.kind === 'preset') {
    const ids = [...new Set(nodeIds)]
    if (ids.length === 0) return fail('Preset entries require at least one nodeIds target')
    return {
      ok: true,
      data: ids.map((nodeId) => ({ nodeId, motion: instantiated.motion }))
    }
  }
  if (nodeIds && nodeIds.length > 0) {
    return fail('Recipe entries use roleMappingJson; nodeIds applies only to preset entries')
  }
  return {
    ok: true,
    data: instantiated.result.assignments.map(({ nodeId, motion }) => ({ nodeId, motion }))
  }
}

export const applyTeamMotionLibraryEntry = defineTool({
  name: 'apply_team_motion_library_entry',
  mutates: true,
  description:
    'Verify either one signed Team Motion manifest or a registry and its accepted/history/pending snapshots, instantiate one bounded accepted preset or parameterized recipe entry, validate every target before mutation, and apply complete MotionSpec snapshots atomically. Never persists Team settings. Presets use nodeIds; recipes use explicit roleMappingJson.',
  params: {
    manifestJson: {
      type: 'string',
      description:
        'Direct signed-manifest form. Provide exactly one of manifestJson or registryJson.'
    },
    registryJson: {
      type: 'string',
      description:
        'Accepted-registry form. Re-verifies every snapshot and applies only registry.accepted. Provide exactly one signed source.'
    },
    publicKeyPem: {
      type: 'string',
      description: 'Trusted Ed25519 public key in SPKI PEM form',
      required: true
    },
    engineVersion: {
      type: 'string',
      description: 'Current OpenPencil semantic version used to enforce the manifest engine range',
      required: true
    },
    expectedKeyId: {
      type: 'string',
      description: 'Optional trusted publisher key id that must match the signed manifest'
    },
    entryId: {
      type: 'string',
      description: 'Preset or recipe entry id in the verified manifest',
      required: true
    },
    nodeIds: {
      type: 'string[]',
      description: 'Target Scene node ids for a preset entry'
    },
    roleMappingJson: {
      type: 'string',
      description: 'Recipe role id to Scene node id array mapping as strict JSON'
    },
    parametersJson: {
      type: 'string',
      description: 'Optional bounded numeric recipe parameter overrides as JSON'
    },
    tokensJson: {
      type: 'string',
      description: 'Optional bounded Team library token values as JSON'
    }
  },
  execute: async (
    figma,
    {
      manifestJson,
      registryJson,
      publicKeyPem,
      engineVersion,
      expectedKeyId,
      entryId: requestedEntryId,
      nodeIds,
      roleMappingJson,
      parametersJson,
      tokensJson
    },
    ctx?: ToolCtx
  ): Promise<
    TeamMotionToolResult<{
      libraryId: string
      libraryVersion: string
      verifiedDigest: string
      entryId: string
      kind: 'preset' | 'recipe'
      nodeIds: string[]
      assignmentCount: number
    }>
  > => {
    if ((manifestJson === undefined) === (registryJson === undefined)) {
      return fail('Provide exactly one of manifestJson or registryJson')
    }
    let verified: TeamMotionToolResult<VerifiedTeamMotionLibrarySnapshot>
    if (registryJson !== undefined) {
      const state = await verifiedRegistryState(
        registryJson,
        publicKeyPem,
        engineVersion,
        expectedKeyId
      )
      verified = state.ok ? { ok: true, data: state.data.accepted } : state
    } else {
      verified = await verifiedManifest(
        manifestJson ?? '',
        publicKeyPem,
        engineVersion,
        expectedKeyId
      )
    }
    if (!verified.ok) return verified
    const input = inputForInstantiation(roleMappingJson, parametersJson, tokensJson)
    if (!input.ok) return input
    let instantiated: TeamMotionLibraryInstantiation
    try {
      instantiated = instantiateTeamMotionLibraryEntry(verified.data, requestedEntryId, input.data)
    } catch (error) {
      return fail(`Team Motion entry instantiation failed: ${errorMessage(error)}`)
    }
    const targets = targetsForInstantiation(instantiated, nodeIds)
    if (!targets.ok) return targets
    const missing = targets.data
      .map(({ nodeId }) => nodeId)
      .filter((nodeId) => !figma.graph.getNode(nodeId))
    if (missing.length > 0) {
      return fail(`Team Motion target node(s) not found: ${[...new Set(missing)].join(', ')}`)
    }
    for (const target of targets.data) {
      const node = figma.graph.getNode(target.nodeId)
      if (!node || !target.motion) continue
      const capability = validateMotionNodeCapabilities(node, target.motion)
      if (!capability.ok) return capability
    }
    applyMotionToTargets(figma, targets.data, 'AI: apply_team_motion_library_entry', ctx)
    const appliedNodeIds = targets.data.map(({ nodeId }) => nodeId)
    return {
      ok: true,
      data: {
        libraryId: verified.data.manifest.library.id,
        libraryVersion: verified.data.manifest.version,
        verifiedDigest: verified.data.verifiedDigest,
        entryId: instantiated.entryId,
        kind: instantiated.kind,
        nodeIds: appliedNodeIds,
        assignmentCount: appliedNodeIds.length
      }
    }
  }
})
