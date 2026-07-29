/* eslint-disable max-lines -- Team library CLI keeps signing and every reverified registry transition behind one trust boundary */
import { randomUUID } from 'node:crypto'
import { link, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

import { defineCommand } from 'citty'

import {
  MOTION_RECIPE_LIMITS,
  TEAM_MOTION_LIBRARY_LIMITS,
  acceptTeamMotionLibraryReview,
  createTeamMotionLibraryRegistry,
  importTeamMotionPrivateKey,
  importTeamMotionPublicKey,
  instantiateTeamMotionLibraryEntry,
  parseTeamMotionLibraryPayload,
  parseTeamMotionLibraryRegistryState,
  rejectTeamMotionLibraryReview,
  reviewTeamMotionLibraryUpdate,
  rollbackTeamMotionLibrary,
  serializeTeamMotionLibraryManifest,
  signTeamMotionLibraryManifest,
  verifyTeamMotionLibraryManifest,
  type MotionSpec,
  type SceneGraph,
  type TeamMotionLibraryInstantiation,
  type TeamMotionLibraryRegistryState,
  type VerifiedTeamMotionLibrarySnapshot
} from '@open-pencil/scene-graph'

import { bold, fmtList, ok } from '#cli/format'
import { loadDocument, populateWholeDocument, saveDocument } from '#cli/headless'

import {
  assertMotionTargetsCompatible,
  motionNodeChanges as motionChanges,
  printMotionJson as printJson,
  runMotionCommandSafely as runSafely
} from './common'

const { version: ENGINE_VERSION } = await import('../../../package.json')
const MAX_TEAM_REGISTRY_JSON_BYTES = 16_777_216

interface TeamMotionJsonArgument {
  [key: string]: unknown
}

const jsonArg = { type: 'boolean', default: false, description: 'Output JSON' } as const
const outputArg = {
  type: 'string',
  alias: 'o',
  required: true,
  description: 'Output JSON path'
} as const
const publicKeyArg = {
  type: 'string',
  required: true,
  description: 'Trusted Ed25519 public key in SPKI PEM format'
} as const

async function readBounded(path: string, maxBytes: number, label: string): Promise<Uint8Array> {
  const absolute = resolve(path)
  const info = await stat(absolute)
  if (info.size > maxBytes) throw new Error(`${label} may not exceed ${maxBytes} bytes.`)
  return new Uint8Array(await readFile(absolute))
}

async function readJson(
  path: string,
  label: string,
  maxBytes: number = TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes
): Promise<unknown> {
  const bytes = await readBounded(path, maxBytes, label)
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

async function importPrivateKey(path: string): Promise<CryptoKey> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(
    await readBounded(path, 32_768, 'Private key')
  )
  return importTeamMotionPrivateKey(text)
}

async function importPublicKey(path: string): Promise<CryptoKey> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(
    await readBounded(path, 32_768, 'Public key')
  )
  return importTeamMotionPublicKey(text)
}

async function writeJson(path: string, value: unknown): Promise<string> {
  const output = resolve(path)
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return output
}

async function verifyManifest(
  manifest: unknown,
  keyPath: string,
  expectedKeyId?: string
): Promise<VerifiedTeamMotionLibrarySnapshot> {
  return verifyTeamMotionLibraryManifest(manifest, await importPublicKey(keyPath), {
    engineVersion: ENGINE_VERSION,
    ...(expectedKeyId ? { expectedKeyId } : {})
  })
}

async function assertVerifiedRegistrySnapshot(
  snapshot: VerifiedTeamMotionLibrarySnapshot,
  key: CryptoKey,
  expectedKeyId: string
): Promise<void> {
  const verified = await verifyTeamMotionLibraryManifest(snapshot.manifest, key, {
    engineVersion: ENGINE_VERSION,
    expectedKeyId
  })
  const digestMatches = verified.verifiedDigest === snapshot.verifiedDigest
  const keyMatches = verified.verifiedKeyId === snapshot.verifiedKeyId
  if (digestMatches && keyMatches) return
  throw new Error('Verified Team Motion registry snapshot metadata does not match manifest')
}

async function verifyRegistry(
  value: unknown,
  keyPath: string,
  expectedKeyId?: string
): Promise<TeamMotionLibraryRegistryState> {
  const state = parseTeamMotionLibraryRegistryState(value)
  const key = await importPublicKey(keyPath)
  const trustedKeyId = expectedKeyId ?? state.accepted.manifest.publisher.keyId
  await assertVerifiedRegistrySnapshot(state.accepted, key, trustedKeyId)
  await Promise.all(
    state.history.map((snapshot) => assertVerifiedRegistrySnapshot(snapshot, key, trustedKeyId))
  )
  if (state.pending)
    await assertVerifiedRegistrySnapshot(state.pending.candidate, key, trustedKeyId)
  return state
}

async function readVerifiedRegistry(
  path: string,
  keyPath: string,
  expectedKeyId?: string
): Promise<TeamMotionLibraryRegistryState> {
  return verifyRegistry(
    await readJson(path, 'Team Motion registry', MAX_TEAM_REGISTRY_JSON_BYTES),
    keyPath,
    expectedKeyId
  )
}

function jsonByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

async function writeRegistryJson(
  path: string,
  state: TeamMotionLibraryRegistryState
): Promise<string> {
  const serialized = `${JSON.stringify(state, null, 2)}\n`
  if (jsonByteLength(serialized) > MAX_TEAM_REGISTRY_JSON_BYTES) {
    throw new Error(
      `Team Motion registry may not exceed ${MAX_TEAM_REGISTRY_JSON_BYTES} UTF-8 bytes.`
    )
  }
  const output = resolve(path)
  const temporary = resolve(dirname(output), `.${randomUUID()}.openpencil-registry-tmp`)
  try {
    await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, output)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
  return output
}

function parseObjectArgument(value: string | undefined, label: string): TeamMotionJsonArgument {
  if (value === undefined) return {}
  if (jsonByteLength(value) > TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes) {
    throw new Error(
      `${label} may not exceed ${TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes} UTF-8 bytes.`
    )
  }
  const parsed: unknown = JSON.parse(value)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must encode a JSON object.`)
  }
  return parsed as TeamMotionJsonArgument
}

function parseNodeIds(value: string | undefined): string[] {
  if (value === undefined) throw new Error('Preset entries require --nodes as a JSON array.')
  if (jsonByteLength(value) > TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes) {
    throw new Error(`nodes may not exceed ${TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes} UTF-8 bytes.`)
  }
  const parsed: unknown = JSON.parse(value)
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > MOTION_RECIPE_LIMITS.maxAssignments ||
    parsed.some((nodeId) => typeof nodeId !== 'string' || nodeId.length === 0)
  ) {
    throw new Error(
      `nodes must be a non-empty JSON string array of at most ${MOTION_RECIPE_LIMITS.maxAssignments} targets.`
    )
  }
  const nodeIds = [...new Set(parsed)]
  if (nodeIds.length !== parsed.length) throw new Error('nodes must not contain duplicates.')
  return nodeIds
}

function instantiationInput(args: { roles?: string; parameters?: string; tokens?: string }): {
  roleMapping?: Record<string, readonly string[]>
  parameters?: Record<string, number>
  tokens?: Record<string, number>
} {
  return {
    ...(args.roles
      ? {
          roleMapping: parseObjectArgument(args.roles, 'roles') as Record<string, readonly string[]>
        }
      : {}),
    ...(args.parameters
      ? {
          parameters: parseObjectArgument(args.parameters, 'parameters') as Record<string, number>
        }
      : {}),
    ...(args.tokens
      ? { tokens: parseObjectArgument(args.tokens, 'tokens') as Record<string, number> }
      : {})
  }
}

function documentFormat(path: string): 'fig' | 'pen' {
  const format = extname(path).slice(1).toLowerCase()
  if (format !== 'fig' && format !== 'pen') {
    throw new Error('Team Motion apply input and output must use the .fig or .pen extension.')
  }
  return format
}

function assertDocumentOutputBoundary(inputPath: string, outputPath: string): 'fig' | 'pen' {
  const input = resolve(inputPath)
  const output = resolve(outputPath)
  const inputFormat = documentFormat(input)
  const outputFormat = documentFormat(output)
  if (input === output) throw new Error('Team Motion apply output must differ from the input path.')
  if (inputFormat !== outputFormat) {
    throw new Error(
      'Team Motion apply preserves the input document format; use convert as a separate explicit step.'
    )
  }
  return outputFormat
}

async function writeDocumentNoClobber(
  inputPath: string,
  outputPath: string,
  graph: SceneGraph
): Promise<string> {
  const output = resolve(outputPath)
  const format = assertDocumentOutputBoundary(inputPath, output)
  const temporary = resolve(dirname(output), `.${randomUUID()}.openpencil-tmp`)
  try {
    await saveDocument(format, graph, temporary)
    try {
      await link(temporary, output)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        throw new Error(`Refusing to overwrite existing Team Motion output: ${output}`)
      }
      throw error
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
  return output
}

function applicationTargets(
  instantiated: TeamMotionLibraryInstantiation,
  nodes: string | undefined,
  roles: string | undefined,
  parameters: string | undefined,
  tokens: string | undefined
): Array<{ nodeId: string; motion: MotionSpec }> {
  if (instantiated.kind === 'preset') {
    if (roles !== undefined || parameters !== undefined || tokens !== undefined) {
      throw new Error(
        'Preset entries use only --nodes; --roles, --parameters, and --tokens apply to recipes.'
      )
    }
    return parseNodeIds(nodes).map((nodeId) => ({ nodeId, motion: instantiated.motion }))
  }
  if (nodes !== undefined) throw new Error('Recipe entries use --roles and do not accept --nodes.')
  return instantiated.result.assignments.map(({ nodeId, motion }) => ({ nodeId, motion }))
}

function printSnapshot(action: string, snapshot: VerifiedTeamMotionLibrarySnapshot): void {
  console.log('')
  console.log(bold(`  ${action} ${snapshot.manifest.library.name}`))
  console.log('')
  console.log(
    fmtList([
      {
        header: snapshot.manifest.library.id,
        details: {
          version: snapshot.manifest.version,
          publisher: snapshot.manifest.publisher.name,
          key: snapshot.verifiedKeyId,
          digest: snapshot.verifiedDigest,
          entries: snapshot.manifest.entries.length
        }
      }
    ])
  )
  console.log('')
}

function printRegistry(
  action: string,
  state: TeamMotionLibraryRegistryState,
  output: string
): void {
  const pending = state.pending?.diff
  console.log('')
  console.log(bold(`  ${action} ${state.accepted.manifest.library.name}`))
  console.log('')
  console.log(
    fmtList([
      {
        header: state.accepted.manifest.library.id,
        details: {
          accepted: state.accepted.manifest.version,
          pending: state.pending?.candidate.manifest.version ?? 'none',
          added: pending?.added.length ?? 0,
          updated: pending?.updated.length ?? 0,
          removed: pending?.removed.length ?? 0,
          history: state.history.length
        }
      }
    ])
  )
  console.log(ok(`Wrote ${output}`))
  console.log('')
}

const sign = defineCommand({
  meta: { description: 'Sign a bounded team Motion library payload with Ed25519' },
  args: {
    payload: { type: 'positional', required: true, description: 'Unsigned payload JSON path' },
    'private-key': {
      type: 'string',
      required: true,
      description: 'Ed25519 private key in PKCS8 PEM format'
    },
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const payload = parseTeamMotionLibraryPayload(
        await readJson(args.payload, 'Team Motion payload')
      )
      const manifest = await signTeamMotionLibraryManifest(
        payload,
        await importPrivateKey(args['private-key'])
      )
      const output = resolve(args.output)
      await writeFile(output, serializeTeamMotionLibraryManifest(manifest), 'utf8')
      if (args.json) printJson({ manifest, output })
      else {
        printSnapshot('Signed', {
          manifest,
          verifiedDigest: manifest.integrity.digest,
          verifiedKeyId: manifest.integrity.signature.keyId
        })
        console.log(ok(`Wrote ${output}`))
      }
    })
  }
})

const verify = defineCommand({
  meta: { description: 'Verify a signed team Motion manifest and engine range' },
  args: {
    manifest: { type: 'positional', required: true, description: 'Signed manifest JSON path' },
    'public-key': publicKeyArg,
    'key-id': { type: 'string', description: 'Expected trusted key id' },
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const snapshot = await verifyManifest(
        await readJson(args.manifest, 'Team Motion manifest'),
        args['public-key'],
        args['key-id']
      )
      if (args.json) printJson(snapshot)
      else printSnapshot('Verified', snapshot)
    })
  }
})

const importCommand = defineCommand({
  meta: { description: 'Verify and accept an initial team Motion library snapshot' },
  args: {
    manifest: { type: 'positional', required: true, description: 'Signed manifest JSON path' },
    'public-key': publicKeyArg,
    'key-id': { type: 'string', description: 'Expected trusted key id' },
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const snapshot = await verifyManifest(
        await readJson(args.manifest, 'Team Motion manifest'),
        args['public-key'],
        args['key-id']
      )
      const state = createTeamMotionLibraryRegistry(snapshot)
      const output = await writeRegistryJson(args.output, state)
      if (args.json) printJson({ state, output })
      else printRegistry('Imported', state, output)
    })
  }
})

const review = defineCommand({
  meta: { description: 'Verify an update and stage its deterministic diff for review' },
  args: {
    state: { type: 'positional', required: true, description: 'Registry state JSON path' },
    manifest: { type: 'positional', required: true, description: 'Candidate manifest JSON path' },
    'public-key': publicKeyArg,
    'key-id': { type: 'string', description: 'Expected trusted key id' },
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const state = await readVerifiedRegistry(args.state, args['public-key'], args['key-id'])
      const candidate = await verifyManifest(
        await readJson(args.manifest, 'Team Motion manifest'),
        args['public-key'],
        args['key-id'] ?? state.accepted.manifest.publisher.keyId
      )
      const next = reviewTeamMotionLibraryUpdate(state, candidate)
      const output = await writeRegistryJson(args.output, next)
      if (args.json) printJson({ state: next, output })
      else printRegistry('Reviewed', next, output)
    })
  }
})

function registryMutationCommand(
  description: string,
  action: string,
  mutate: (
    state: TeamMotionLibraryRegistryState,
    digest?: string
  ) => TeamMotionLibraryRegistryState,
  needsDigest = false
) {
  return defineCommand({
    meta: { description },
    args: {
      state: { type: 'positional', required: true, description: 'Registry state JSON path' },
      'public-key': publicKeyArg,
      'key-id': { type: 'string', description: 'Expected trusted key id' },
      ...(needsDigest
        ? { digest: { type: 'string', required: true, description: 'Verified history digest' } }
        : {}),
      output: outputArg,
      json: jsonArg
    },
    async run({ args }) {
      await runSafely(async () => {
        const state = await readVerifiedRegistry(args.state, args['public-key'], args['key-id'])
        const next = mutate(state, typeof args.digest === 'string' ? args.digest : undefined)
        const output = await writeRegistryJson(args.output, next)
        if (args.json) printJson({ state: next, output })
        else printRegistry(action, next, output)
      })
    }
  })
}

const accept = registryMutationCommand(
  'Explicitly accept a pending verified team Motion update',
  'Accepted',
  (state) => acceptTeamMotionLibraryReview(state)
)
const reject = registryMutationCommand(
  'Reject a pending verified team Motion update',
  'Rejected',
  (state) => rejectTeamMotionLibraryReview(state)
)
const rollback = registryMutationCommand(
  'Roll back to a verified team Motion history snapshot',
  'Rolled back',
  (state, digest) => rollbackTeamMotionLibrary(state, digest ?? ''),
  true
)

const instantiate = defineCommand({
  meta: { description: 'Instantiate a reproducible preset or recipe snapshot' },
  args: {
    state: { type: 'positional', required: true, description: 'Registry state JSON path' },
    entry: { type: 'string', required: true, description: 'Preset or recipe entry id' },
    'public-key': publicKeyArg,
    'key-id': { type: 'string', description: 'Expected trusted key id' },
    tokens: { type: 'string', description: 'Token value JSON object' },
    parameters: { type: 'string', description: 'Recipe parameter JSON object' },
    roles: { type: 'string', description: 'Recipe role-to-node-array JSON object' },
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const state = await readVerifiedRegistry(args.state, args['public-key'], args['key-id'])
      const result = instantiateTeamMotionLibraryEntry(
        state.accepted,
        args.entry,
        instantiationInput(args)
      )
      const output = await writeJson(args.output, result)
      if (args.json) printJson({ result, output })
      else {
        console.log(ok(`Instantiated ${result.entryId} to ${output}`))
      }
    })
  }
})

const apply = defineCommand({
  meta: {
    description:
      'Verify and atomically apply an accepted team Motion entry to a new .fig or source-preserving .pen output'
  },
  args: {
    file: { type: 'positional', required: true, description: 'Input .fig or .pen document' },
    state: {
      type: 'positional',
      required: true,
      description: 'Verified Team Motion registry state JSON path'
    },
    entry: { type: 'string', required: true, description: 'Accepted preset or recipe entry id' },
    'public-key': publicKeyArg,
    'key-id': { type: 'string', description: 'Expected trusted key id' },
    nodes: {
      type: 'string',
      description: 'Preset target node ids as a non-empty JSON string array'
    },
    roles: { type: 'string', description: 'Recipe role-to-node-array JSON object' },
    tokens: { type: 'string', description: 'Recipe Team token value JSON object' },
    parameters: { type: 'string', description: 'Recipe parameter override JSON object' },
    output: {
      type: 'string',
      alias: 'o',
      required: true,
      description: 'New non-overwriting output path with the same .fig or .pen format as input'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      assertDocumentOutputBoundary(args.file, args.output)
      const state = await readVerifiedRegistry(args.state, args['public-key'], args['key-id'])
      const instantiated = instantiateTeamMotionLibraryEntry(
        state.accepted,
        args.entry,
        instantiationInput(args)
      )
      const targets = applicationTargets(
        instantiated,
        args.nodes,
        args.roles,
        args.parameters,
        args.tokens
      )
      const graph = await loadDocument(resolve(args.file))
      populateWholeDocument(graph)
      const resolvedTargets = targets.map((target) => ({
        ...target,
        node: graph.getNode(target.nodeId)
      }))
      const missing = resolvedTargets.filter(({ node }) => node === undefined)
      if (missing.length > 0) {
        throw new Error(
          `Team Motion target node(s) not found: ${missing.map(({ nodeId }) => nodeId).join(', ')}`
        )
      }
      assertMotionTargetsCompatible(resolvedTargets)

      for (const { node, motion } of resolvedTargets) {
        if (node) graph.updateNode(node.id, motionChanges(node, motion))
      }
      const output = await writeDocumentNoClobber(args.file, args.output, graph)
      const report = {
        libraryId: state.accepted.manifest.library.id,
        libraryVersion: state.accepted.manifest.version,
        verifiedDigest: state.accepted.verifiedDigest,
        entryId: instantiated.entryId,
        kind: instantiated.kind,
        assignmentCount: targets.length,
        nodeIds: targets.map(({ nodeId }) => nodeId),
        output
      }
      if (args.json) printJson(report)
      else {
        console.log(
          ok(
            `Applied ${instantiated.entryId} from ${state.accepted.manifest.library.name} to ${targets.length} node(s) → ${output}`
          )
        )
      }
    })
  }
})

export default defineCommand({
  meta: { description: 'Sign, verify, review, instantiate, and apply team Motion libraries' },
  subCommands: {
    sign,
    verify,
    import: importCommand,
    review,
    accept,
    reject,
    rollback,
    instantiate,
    apply
  }
})
