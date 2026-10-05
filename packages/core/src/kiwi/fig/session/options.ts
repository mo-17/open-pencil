import type { DocumentAssemblyOptions } from '@open-pencil/fig'

import { extractImportedLowcodeProps } from '#core/kiwi/fig/node-change/lowcode-plugin-data'
import { restoreReaderMetadata, restoreOccurrenceReferences } from '#core/kiwi/fig/session/metadata'

type Handler<K extends keyof DocumentAssemblyOptions> = NonNullable<DocumentAssemblyOptions[K]>

/** A saved record the reader could not apply and skipped instead of refusing the file. */
export type FigReaderDiagnostic =
  | { kind: 'property'; diagnostic: Parameters<Handler<'onUnresolvedProperty'>>[0] }
  | { kind: 'assignment'; diagnostic: Parameters<Handler<'onUnresolvedAssignment'>>[0] }
  | { kind: 'binding'; diagnostic: Parameters<Handler<'onUnresolvedBinding'>>[0] }
  | { kind: 'component'; diagnostic: Parameters<Handler<'onMissingComponent'>>[0] }
  | { kind: 'slot-content'; diagnostic: Parameters<Handler<'onMissingSlotContent'>>[0] }

/**
 * Figma retains override and binding records that address nodes it later deleted, and
 * instances of deleted components, and the reader has no replacement to guess at. Opening
 * a file skips those records, keeps such instances childless, and reports both, including a
 * swap whose target layer is gone. A slot whose assigned content frame is gone keeps its
 * component's content. An ambiguous address means the path is wrong, not stale,
 * and still fails.
 */
export function readerSessionOptions(sink: FigReaderDiagnostic[]): DocumentAssemblyOptions {
  return {
    derivedBounds: true,
    afterMaterializeSourceFields: ['guid', 'parentIndex', 'type', 'pluginData', 'textData'],
    mapNodeProps: (change, converted) => {
      const lowcode = extractImportedLowcodeProps(change)
      return {
        ...converted,
        ...lowcode.props,
        nodeType: lowcode.nodeTypeOverride ?? converted.nodeType
      }
    },
    afterMaterialize: (graph, sources, records) =>
      graph.withNodeMutationOrigin('source-hydration', () =>
        graph.applyImportedStateDuring(() => restoreReaderMetadata(graph, sources, records))
      ),
    afterMaterializeInstance: (graph, nodes) =>
      graph.withNodeMutationOrigin('source-hydration', () =>
        graph.applyImportedStateDuring(() => restoreOccurrenceReferences(graph, nodes))
      ),
    onUnresolvedProperty: (diagnostic) => sink.push({ kind: 'property', diagnostic }),
    onUnresolvedAssignment: (diagnostic) => sink.push({ kind: 'assignment', diagnostic }),
    onUnresolvedBinding: (diagnostic) => sink.push({ kind: 'binding', diagnostic }),
    onMissingComponent: (diagnostic) => sink.push({ kind: 'component', diagnostic }),
    onMissingSlotContent: (diagnostic) => sink.push({ kind: 'slot-content', diagnostic })
  }
}
