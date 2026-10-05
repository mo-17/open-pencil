import { readFile, writeFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

import {
  BUILTIN_IO_FORMATS,
  IORegistry,
  ORDINARY_FIG_ARCHIVE_LIMITS,
  initCanvasKit
} from '@open-pencil/core/io'
import { populateAllFigPages, populateFigPage } from '@open-pencil/core/io/formats/fig'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { assertFigArchiveByteLength } from '@open-pencil/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { printError } from '#cli/format'

export { initCanvasKit }

const io = new IORegistry(BUILTIN_IO_FORMATS)

export async function loadDocument(filePath: string): Promise<SceneGraph> {
  if (/\.fig$/i.test(filePath)) {
    assertFigArchiveByteLength((await stat(filePath)).size, ORDINARY_FIG_ARCHIVE_LIMITS)
  }
  const bytes = new Uint8Array(await readFile(filePath))
  const { graph } = await io.readDocument({ name: filePath, data: bytes })
  graph.preserveSourceMetadataDuring(() => computeAllLayouts(graph))
  return graph
}

/** `--write` and `--output` for commands that change a headless document. */
export const documentWriteOptions = {
  write: { type: 'boolean', alias: 'w', description: 'Write changes back to the input file' },
  output: { type: 'string', alias: 'o', description: 'Write to a different file', required: false }
} as const

/** Save a headless document as `.fig`, as `eval --write` and `diff apply --write` do. */
export async function writeFigDocument(graph: SceneGraph, filePath: string): Promise<void> {
  const result = await io.writeDocument('fig', graph)
  await writeFile(filePath, result.data as Uint8Array)
}

export function populateDocumentPage(graph: SceneGraph, pageId: string): boolean {
  const changed = populateFigPage(graph, pageId)
  if (changed) computeAllLayouts(graph, pageId)
  return changed
}

export function populateWholeDocument(graph: SceneGraph): boolean {
  const changed = populateAllFigPages(graph)
  if (changed) computeAllLayouts(graph)
  return changed
}

function pageNameFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const page = (args as { page?: unknown }).page
  return typeof page === 'string' ? page : undefined
}

function populateRequestedPage(graph: SceneGraph, pageName?: string): void {
  const pages = graph.getPages()
  const page = pageName ? pages.find((candidate) => candidate.name === pageName) : pages[0]
  if (page) populateDocumentPage(graph, page.id)
}

export function prepareDocumentForRPC(graph: SceneGraph, command: string, args?: unknown): void {
  if (command === 'pages' || command === 'variables') return
  if (command === 'tree') {
    populateRequestedPage(graph, pageNameFromArgs(args))
    return
  }
  if (command === 'find' || command === 'query') {
    const pageName = pageNameFromArgs(args)
    if (pageName) populateRequestedPage(graph, pageName)
    else populateWholeDocument(graph)
    return
  }
  populateWholeDocument(graph)
}

export async function saveDocument(
  format: string,
  graph: SceneGraph,
  filePath: string
): Promise<void> {
  const result = await io.writeDocument(format, graph)
  await Bun.write(filePath, result.data)
}

export function requirePage(graph: SceneGraph, pageName?: string) {
  const pages = graph.getPages()
  const page = pageName ? pages.find((p) => p.name === pageName) : pages[0]
  if (!page) {
    const available = pages.map((p) => `"${p.name}"`).join(', ')
    printError(
      pageName
        ? `Page "${pageName}" not found. Available pages: ${available || 'none'}.`
        : 'Document has no pages.'
    )
    process.exit(1)
  }
  return page
}

/** Select a native writer from the owned registry; preserve .pen's source-write guard. */
export async function writeDocumentForPath(graph: SceneGraph, filePath: string): Promise<void> {
  const extension = extname(filePath).slice(1).toLowerCase()
  const format =
    io.listWritableFormats().find((candidate) => candidate.extensions.includes(extension))?.id ??
    'fig'
  await saveDocument(format, graph, filePath)
}
