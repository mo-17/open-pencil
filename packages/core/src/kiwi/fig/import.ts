import { createFigRecordSession, type FigArchiveLimits } from '@open-pencil/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { registerRecordReaderSession } from '#core/kiwi/fig/session/document-state'
import { readerSessionOptions, type FigReaderDiagnostic } from '#core/kiwi/fig/session/options'
import { assertParentChainDepth } from '#core/kiwi/fig/tree-depth'

export interface FigImportOptions {
  populate?: 'all' | 'first-page' | 'none'
  maxGraphNodes?: number
  maxTreeDepth?: number
}

/** Compatibility entry point for decoded records; no independent import or population pipeline. */
export function importNodeChanges(
  nodeChanges: NodeChange[],
  blobs: Uint8Array[] = [],
  images?: Map<string, Uint8Array>,
  options: FigImportOptions = {}
): SceneGraph {
  const records = nodeChanges.filter((record) => record.phase !== 'REMOVED')
  const indexed = new Map(
    records.flatMap((record) => (record.guid ? [[guidToString(record.guid), record] as const] : []))
  )
  assertParentChainDepth(
    indexed.keys(),
    (id) => {
      const parent = indexed.get(id)?.parentIndex?.guid
      return parent ? guidToString(parent) : undefined
    },
    options.maxTreeDepth,
    '.fig node-change tree contains a cycle'
  )
  const archiveLimits: FigArchiveLimits = {
    maxGraphNodes: options.maxGraphNodes,
    maxTreeDepth: options.maxTreeDepth
  }
  const diagnostics: FigReaderDiagnostic[] = []
  const session = createFigRecordSession(records, blobs, {
    ...readerSessionOptions(diagnostics),
    images,
    archiveLimits,
    initiallyPopulateAll: options.populate !== 'none' && options.populate !== 'first-page',
    initiallyMaterializeSourceRecords:
      options.populate === 'none' || options.populate === 'first-page'
  })
  if (options.populate === 'first-page') {
    const page = session.pages.find((page) => !page.internalOnly)
    if (page) session.loadPage(page.id)
  } else if (options.populate !== 'none') {
    for (const page of session.pages) session.loadPage(page.id)
  }
  if (!session.graph.getPages(true).length) session.graph.addPage('Page 1')
  registerRecordReaderSession(records, blobs, session, diagnostics, archiveLimits)
  return session.graph
}
