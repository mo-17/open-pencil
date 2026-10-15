import type { DocumentAssemblyOptions } from '@open-pencil/fig'

import { extractImportedLowcodeProps } from '#core/kiwi/fig/node-change/lowcode-plugin-data'
import { restoreReaderMetadata, restoreOccurrenceReferences } from '#core/kiwi/fig/session/metadata'

type Handler<K extends keyof DocumentAssemblyOptions> = NonNullable<DocumentAssemblyOptions[K]>

/** A saved record the reader could not apply and skipped instead of refusing the file. */
export type FigReaderDiagnostic =
  | {
      kind: 'property'
      diagnostic: Parameters<Handler<'onUnresolvedProperty'>>[0]
    }
  | {
      kind: 'assignment'
      diagnostic: Parameters<Handler<'onUnresolvedAssignment'>>[0]
    }
  | {
      kind: 'binding'
      diagnostic: Parameters<Handler<'onUnresolvedBinding'>>[0]
    }
  | {
      kind: 'component'
      diagnostic: Parameters<Handler<'onMissingComponent'>>[0]
    }
  | {
      kind: 'slot-content'
      diagnostic: Parameters<Handler<'onMissingSlotContent'>>[0]
    }

/** Each sink's entries, so a record reported again is not listed twice. */
const reported = new WeakMap<FigReaderDiagnostic[], Set<string>>()

/**
 * Opening a file, recovering a page, and every save read records through sessions that share
 * one sink, so the same skipped record can reach it more than once.
 */
function report(sink: FigReaderDiagnostic[], entry: FigReaderDiagnostic): void {
  let keys = reported.get(sink)
  if (!keys) {
    keys = new Set(sink.map((existing) => JSON.stringify(existing)))
    reported.set(sink, keys)
  }
  const key = JSON.stringify(entry)
  if (keys.has(key)) return
  keys.add(key)
  sink.push(entry)
}

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
    sourceDependencies: (change, hasSource) => {
      if (change.type !== 'DOCUMENT' && change.type !== 'CANVAS') return []
      const { props } = extractImportedLowcodeProps(change)
      const references: string[] = []
      if (change.type === 'DOCUMENT') {
        const policy = props.lowcodeApplication
        if (policy?.startPageId) references.push(policy.startPageId)
        if (policy?.shell) references.push(policy.shell.frameNodeId, policy.shell.slotNodeId)
      } else if (props.lowcodeApplicationPage?.entryNodeId)
        references.push(props.lowcodeApplicationPage.entryNodeId)
      // Absent references retain the existing invalid/inert policy diagnostics; a
      // not-yet-loaded source is reachable without inventing a replacement identity.
      return references.filter(hasSource)
    },
    afterMaterializeSourceFields: ['guid', 'parentIndex', 'type', 'pluginData', 'textData'],
    mapNodeProps: (change, converted) => {
      const lowcode = extractImportedLowcodeProps(change)
      return {
        ...converted,
        ...lowcode.props,
        nodeType: lowcode.nodeTypeOverride ?? converted.nodeType
      }
    },
    afterMaterialize: (graph, sources, records, newSourceNodeIds) =>
      graph.withNodeMutationOrigin('source-hydration', () =>
        graph.applyImportedStateDuring(() =>
          restoreReaderMetadata(graph, sources, records, newSourceNodeIds)
        )
      ),
    afterMaterializeInstance: (graph, nodes, sources) =>
      graph.withNodeMutationOrigin('source-hydration', () =>
        graph.applyImportedStateDuring(() => restoreOccurrenceReferences(graph, nodes, sources))
      ),
    onUnresolvedProperty: (diagnostic) => report(sink, { kind: 'property', diagnostic }),
    onUnresolvedAssignment: (diagnostic) => report(sink, { kind: 'assignment', diagnostic }),
    onUnresolvedBinding: (diagnostic) => report(sink, { kind: 'binding', diagnostic }),
    onMissingComponent: (diagnostic) => report(sink, { kind: 'component', diagnostic }),
    onMissingSlotContent: (diagnostic) => report(sink, { kind: 'slot-content', diagnostic })
  }
}
