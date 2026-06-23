import { extname, resolve } from 'node:path'

import { defineCommand } from 'citty'

import {
  acceptLibraryUpdate,
  checkLibraryUpdates,
  importLibraryComponent,
  publishLibraryComponent,
  type LibraryManifest,
  type LibraryRef,
  type LibraryUpdateCheck,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/core/scene-graph'

import { requireFile } from '#cli/app-client'
import { bold, fmtList, ok, printError } from '#cli/format'
import { loadDocument, saveDocument } from '#cli/headless'

function documentFormat(file: string): string {
  const ext = extname(file).slice(1).toLowerCase()
  return ext || 'fig'
}

async function readManifest(file: string): Promise<LibraryManifest> {
  return JSON.parse(await Bun.file(file).text()) as LibraryManifest
}

async function writeManifest(file: string, manifest: LibraryManifest): Promise<void> {
  await Bun.write(file, `${JSON.stringify(manifest, null, 2)}\n`)
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

function printJson(data: unknown): void {
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
    printJson({ ...result, output })
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
      printJson({ ...result, documentOutput })
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
      printJson({ checks })
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

export default defineCommand({
  meta: { description: 'Publish, import, check, and accept team library components' },
  subCommands: {
    publish,
    import: importCmd,
    check,
    accept
  }
})
