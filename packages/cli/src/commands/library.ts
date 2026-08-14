import { isIP } from 'node:net'
import { extname, resolve } from 'node:path'

import { defineCommand } from 'citty'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { REMOTE_FIG_ARCHIVE_LIMITS } from '@open-pencil/fig'
import { REMOTE_PEN_PARSE_LIMITS } from '@open-pencil/pen'
import {
  acceptLibraryUpdate,
  checkLibraryUpdates,
  encodeBase64URL,
  importLibraryComponent,
  parseRemoteComponentLibraryDescriptor,
  publishLibraryComponent,
  REMOTE_COMPONENT_LIBRARY_FORMAT,
  REMOTE_COMPONENT_LIBRARY_SCHEMA_VERSION,
  validateLibraryArtifact,
  webCryptoBuffer,
  type LibraryManifest,
  type LibraryRef,
  type LibraryUpdateCheck,
  type RemoteComponentLibraryDescriptor,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import { requireFile } from '#cli/app-client'
import { bold, fmtList, ok, printError } from '#cli/format'
import { loadDocument, saveDocument } from '#cli/headless'

const MAX_REMOTE_ARTIFACT_BYTES = 64 * 1024 * 1024
const MAX_REMOTE_URL_LENGTH = 2048
const remoteArtifactIO = new IORegistry(BUILTIN_IO_FORMATS)
const SPECIAL_USE_HOST_SUFFIXES = [
  '.alt',
  '.arpa',
  '.example',
  '.home',
  '.internal',
  '.invalid',
  '.lan',
  '.local',
  '.localhost',
  '.onion',
  '.test'
] as const

type RemoteLibraryArtifactFormat = 'fig' | 'pen'

interface RemoteLibraryManifestV1 extends RemoteComponentLibraryDescriptor {
  format: typeof REMOTE_COMPONENT_LIBRARY_FORMAT
  schemaVersion: typeof REMOTE_COMPONENT_LIBRARY_SCHEMA_VERSION
  source: { kind: 'url'; ref: string }
  artifact: {
    format: RemoteLibraryArtifactFormat
    mediaType: 'application/octet-stream' | 'application/json'
    byteLength: number
    integrity: { algorithm: 'SHA-256'; digest: string }
  }
}

function documentFormat(file: string): string {
  const ext = extname(file).slice(1).toLowerCase()
  return ext || 'fig'
}

async function readManifest(file: string): Promise<LibraryManifest> {
  return JSON.parse(await Bun.file(file).text()) as LibraryManifest
}

async function readRemoteLibraryDescriptor(
  file: string
): Promise<RemoteComponentLibraryDescriptor> {
  const value = JSON.parse(await Bun.file(file).text()) as unknown
  return parseRemoteComponentLibraryDescriptor(value, 'manifest', { allowExtraKeys: true })
}

async function writeManifest(file: string, manifest: LibraryManifest): Promise<void> {
  await Bun.write(file, `${JSON.stringify(manifest, null, 2)}\n`)
}

function remoteArtifactFormat(file: string): RemoteLibraryArtifactFormat {
  const format = documentFormat(file)
  if (format !== 'fig' && format !== 'pen') {
    printError('Remote component-library artifacts must use the .fig or .pen extension.')
    process.exit(1)
  }
  return format
}

function parsePublicArtifactURL(value: string, format: RemoteLibraryArtifactFormat): string {
  if (value.length > MAX_REMOTE_URL_LENGTH) {
    printError(`Artifact URL must be at most ${MAX_REMOTE_URL_LENGTH} characters.`)
    process.exit(1)
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    printError('Artifact URL must be an absolute canonical public HTTPS URL.')
    process.exit(1)
  }
  const hostname = url.hostname.toLowerCase()
  if (hasUnsafeArtifactURLParts(url, value) || hasInvalidPublicHostname(hostname)) {
    printError(
      'Artifact URL must be canonical public HTTPS without credentials, query, fragment, custom port, IP, or private hostname.'
    )
    process.exit(1)
  }
  if (!url.pathname.toLowerCase().endsWith(`.${format}`)) {
    printError(`Artifact URL pathname must end in .${format}.`)
    process.exit(1)
  }
  return url.href
}

function hasUnsafeArtifactURLParts(url: URL, original: string): boolean {
  return [
    url.protocol !== 'https:',
    Boolean(url.username),
    Boolean(url.password),
    url.href.includes('#'),
    url.href.includes('?'),
    Boolean(url.port),
    url.href !== original
  ].includes(true)
}

function hasInvalidPublicHostname(hostname: string): boolean {
  const addressHost = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  const labels = hostname.split('.')
  return [
    hostname.startsWith('xn--'),
    hostname.includes('.xn--'),
    !hostname.includes('.'),
    hostname.endsWith('.'),
    isIP(addressHost) !== 0,
    labels.some(hasInvalidHostnameLabel),
    /^\d+$/.test(labels.at(-1) ?? ''),
    SPECIAL_USE_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix)
    )
  ].includes(true)
}

function hasInvalidHostnameLabel(label: string): boolean {
  return [
    label.length === 0,
    label.length > 63,
    label.startsWith('-'),
    label.endsWith('-'),
    !/^[a-z0-9-]+$/.test(label)
  ].includes(true)
}

async function artifactDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', webCryptoBuffer(bytes))
  return encodeBase64URL(new Uint8Array(digest))
}

function remoteArtifactMediaType(
  format: RemoteLibraryArtifactFormat
): RemoteLibraryManifestV1['artifact']['mediaType'] {
  return format === 'fig' ? 'application/octet-stream' : 'application/json'
}

function parseSource(kind: string, ref?: string): LibraryRef['source'] | undefined {
  if (!ref) return undefined
  if (kind !== 'file' && kind !== 'url') {
    printError(`Invalid source kind "${kind}". Use file or url.`)
    process.exit(1)
  }
  return { kind, ref }
}

function isPublishableComponent(node: SceneNode | undefined): boolean {
  return node?.type === 'COMPONENT' || node?.type === 'COMPONENT_SET'
}

function resolveComponentRef(graph: SceneGraph, ref: string): string {
  const direct = graph.getNode(ref)
  if (isPublishableComponent(direct)) return ref

  const matches = [...graph.getAllNodes()].filter(
    (node) =>
      isPublishableComponent(node) && (node.name === ref || node.libraryComponentKey === ref)
  )
  if (matches.length === 1) return matches[0].id
  if (matches.length > 1) {
    printError(`Component reference "${ref}" matched multiple components. Use a node id.`)
    process.exit(1)
  }
  return ref
}

function printJSON(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

function printChecks(checks: LibraryUpdateCheck[]): void {
  if (checks.length === 0) {
    console.log('No imported components from this library.')
    return
  }
  console.log('')
  console.log(bold(`  ${checks.length} imported component(s)`))
  console.log('')
  console.log(
    fmtList(
      checks.map((check) => ({
        header: `${check.componentKey}: ${check.status}`,
        details: {
          current: check.currentVersion ?? 'missing',
          latest: check.latestVersion ?? 'missing',
          cached: check.cachedNodeId ?? 'missing'
        }
      }))
    )
  )
  console.log('')
}

const consumerFileArg = {
  type: 'positional',
  description: 'Consumer document file path',
  required: true
} as const

const libraryFileArg = {
  type: 'positional',
  description: 'Library document file path',
  required: true
} as const

const manifestArg = {
  type: 'string',
  description: 'Library manifest JSON path',
  required: true
} as const

const componentKeyArg = {
  type: 'string',
  description: 'Component key',
  required: true
} as const

const outputArg = {
  type: 'string',
  alias: 'o',
  description: 'Output consumer document path',
  required: true
} as const

const jsonArg = { type: 'boolean', description: 'Output as JSON' } as const

interface LibraryDocumentArgs {
  file: string
  library: string
  manifest: string
  component: string
  output: string
  json?: boolean
}

interface LibraryMutationSuccess {
  component: { key: string }
  warnings?: string[]
}

type LibraryMutationResult = LibraryMutationSuccess | { error: string }

async function loadLibraryDocuments(args: LibraryDocumentArgs): Promise<{
  targetGraph: SceneGraph
  sourceGraph: SceneGraph
  manifest: LibraryManifest
}> {
  const targetGraph = await loadDocument(requireFile(args.file))
  const sourceGraph = await loadDocument(requireFile(args.library))
  const manifest = await readManifest(requireFile(args.manifest))
  return { targetGraph, sourceGraph, manifest }
}

async function saveConsumerDocument(args: LibraryDocumentArgs, graph: SceneGraph): Promise<string> {
  const output = resolve(args.output)
  await saveDocument(documentFormat(output), graph, output)
  return output
}

async function finishConsumerMutation(
  args: LibraryDocumentArgs,
  graph: SceneGraph,
  result: LibraryMutationResult,
  successMessage: (componentKey: string, output: string) => string
): Promise<void> {
  if ('error' in result) {
    printError(result.error)
    process.exit(1)
  }
  const output = await saveConsumerDocument(args, graph)
  if (args.json) {
    printJSON({ ...result, output })
    return
  }
  console.log(ok(successMessage(result.component.key, output)))
  if (result.warnings && result.warnings.length > 0) {
    console.log('')
    console.log(fmtList(result.warnings.map((warning) => ({ header: warning }))))
  }
}

const publish = defineCommand({
  meta: { description: 'Publish a component manifest entry from a library document' },
  args: {
    file: {
      type: 'positional',
      description: 'Library document file path',
      required: true
    },
    component: {
      type: 'string',
      description: 'Component or component-set id, name, or library component key to publish',
      required: true
    },
    'library-id': {
      type: 'string',
      description: 'Stable library id',
      required: true
    },
    'library-name': {
      type: 'string',
      description: 'Human readable library name'
    },
    'component-key': {
      type: 'string',
      description: 'Stable component key'
    },
    'source-kind': {
      type: 'string',
      description: 'Source reference kind: file or url',
      default: 'file'
    },
    'source-ref': {
      type: 'string',
      description: 'Source reference stored in the manifest'
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Write manifest JSON to this path'
    },
    'document-output': {
      type: 'string',
      description: 'Write the library document with publish metadata to this path'
    },
    json: jsonArg
  },
  async run({ args }) {
    const file = requireFile(args.file)
    const graph = await loadDocument(file)
    const source = parseSource(args['source-kind'], args['source-ref'] ?? file)
    const result = publishLibraryComponent(graph, {
      componentId: resolveComponentRef(graph, args.component),
      libraryId: args['library-id'],
      libraryName: args['library-name'],
      componentKey: args['component-key'],
      source
    })
    if ('error' in result) {
      printError(result.error)
      process.exit(1)
    }
    if (args.output) await writeManifest(resolve(args.output), result.manifest)
    const documentOutput = args['document-output'] ? resolve(args['document-output']) : undefined
    if (documentOutput) await saveDocument(documentFormat(documentOutput), graph, documentOutput)
    if (args.json) {
      printJSON({ ...result, documentOutput })
      return
    }

    console.log('')
    console.log(bold(`  Published ${result.component.name}`))
    console.log('')
    console.log(
      fmtList([
        {
          header: result.component.key,
          details: {
            library: result.manifest.libraryId,
            version: result.component.version
          }
        }
      ])
    )
    if (args.output) console.log(ok(`Wrote manifest to ${resolve(args.output)}`))
    if (documentOutput) console.log(ok(`Wrote library document to ${documentOutput}`))
    console.log('')
  }
})

const importCmd = defineCommand({
  meta: { description: 'Import a library component into a consumer document' },
  args: {
    file: consumerFileArg,
    library: libraryFileArg,
    manifest: manifestArg,
    component: componentKeyArg,
    output: outputArg,
    parent: {
      type: 'string',
      description: 'Target parent id (default: first page)'
    },
    json: jsonArg
  },
  async run({ args }) {
    const { targetGraph, sourceGraph, manifest } = await loadLibraryDocuments(args)
    const result = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest,
      componentKey: args.component,
      parentId: args.parent
    })
    await finishConsumerMutation(
      args,
      targetGraph,
      result,
      (key, output) => `Imported ${key} into ${output}`
    )
  }
})

const check = defineCommand({
  meta: { description: 'Check imported library components against a manifest' },
  args: {
    file: consumerFileArg,
    manifest: manifestArg,
    json: jsonArg
  },
  async run({ args }) {
    const targetGraph = await loadDocument(requireFile(args.file))
    const manifest = await readManifest(requireFile(args.manifest))
    const checks = checkLibraryUpdates({ targetGraph, manifest })
    if (args.json) {
      printJSON({ checks })
      return
    }
    printChecks(checks)
  }
})

const accept = defineCommand({
  meta: { description: 'Accept a library component update into a consumer document' },
  args: {
    file: consumerFileArg,
    library: libraryFileArg,
    manifest: manifestArg,
    component: componentKeyArg,
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    const { targetGraph, sourceGraph, manifest } = await loadLibraryDocuments(args)
    const result = acceptLibraryUpdate({
      sourceGraph,
      targetGraph,
      manifest,
      componentKey: args.component
    })
    await finishConsumerMutation(
      args,
      targetGraph,
      result,
      (key, output) => `Accepted ${key} update into ${output}`
    )
  }
})

const remotePrepare = defineCommand({
  meta: {
    description:
      'Bind a published library artifact to a public HTTPS URL and emit a digest-pinned remote manifest'
  },
  args: {
    file: {
      type: 'positional',
      description: 'Published .fig or .pen library artifact path',
      required: true
    },
    manifest: manifestArg,
    'artifact-url': {
      type: 'string',
      description: 'Canonical public HTTPS URL where the artifact will be hosted',
      required: true
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Write the remote manifest JSON to this path',
      required: true
    },
    json: jsonArg
  },
  async run({ args }) {
    const file = requireFile(args.file)
    const format = remoteArtifactFormat(file)
    const artifactURL = parsePublicArtifactURL(args['artifact-url'], format)
    const bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
    const maximumArtifactBytes =
      format === 'pen' ? REMOTE_PEN_PARSE_LIMITS.maxBytes : MAX_REMOTE_ARTIFACT_BYTES
    if (bytes.byteLength < 1 || bytes.byteLength > maximumArtifactBytes) {
      printError(
        `Remote ${format} library artifact must be between 1 byte and ${maximumArtifactBytes} bytes.`
      )
      process.exit(1)
    }

    const { graph: sourceGraph } = await remoteArtifactIO.readDocumentAs(
      format,
      { name: file, mimeType: remoteArtifactMediaType(format), data: bytes },
      format === 'fig'
        ? {
            populate: 'all',
            archiveLimits: REMOTE_FIG_ARCHIVE_LIMITS,
            allowMainThreadFallback: true
          }
        : {
            populate: 'all',
            penLimits: REMOTE_PEN_PARSE_LIMITS,
            allowMainThreadFallback: true
          }
    )
    let manifest: RemoteComponentLibraryDescriptor
    try {
      manifest = await readRemoteLibraryDescriptor(requireFile(args.manifest))
    } catch (error) {
      printError(error)
      process.exit(1)
    }
    const validation = validateLibraryArtifact(sourceGraph, manifest)
    if (!validation.ok) {
      printError(
        `Library artifact does not match its manifest: ${validation.issues
          .map((issue) => issue.message)
          .join('; ')}`
      )
      process.exit(1)
    }

    const remoteManifest: RemoteLibraryManifestV1 = {
      format: REMOTE_COMPONENT_LIBRARY_FORMAT,
      schemaVersion: REMOTE_COMPONENT_LIBRARY_SCHEMA_VERSION,
      libraryId: manifest.libraryId,
      name: manifest.name,
      components: structuredClone(manifest.components),
      source: { kind: 'url', ref: artifactURL },
      artifact: {
        format,
        mediaType: remoteArtifactMediaType(format),
        byteLength: bytes.byteLength,
        integrity: { algorithm: 'SHA-256', digest: await artifactDigest(bytes) }
      }
    }
    const output = resolve(args.output)
    await Bun.write(output, `${JSON.stringify(remoteManifest, null, 2)}\n`)
    if (args.json) {
      printJSON({ manifest: remoteManifest, output })
      return
    }
    console.log(ok(`Wrote digest-pinned remote library manifest to ${output}`))
  }
})

const remote = defineCommand({
  meta: { description: 'Prepare remote component-library distribution artifacts' },
  subCommands: { prepare: remotePrepare }
})

export default defineCommand({
  meta: { description: 'Publish, import, check, accept, and distribute library components' },
  subCommands: {
    publish,
    import: importCmd,
    check,
    accept,
    remote
  }
})
