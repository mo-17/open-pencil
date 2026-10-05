import type { NodeChange, StyleReference } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'

import { parseFigBuffer, type ParseFigBufferOptions } from '../archive'
import { createOccurrenceInterpreter } from '../instance-overrides/interpret'
import type { InterpretInstanceOptions } from '../instance-overrides/occurrence/types'
import {
  bySavedPosition,
  createSourceIndex,
  type SourceIndex
} from '../instance-overrides/source-index'
import { symbolOverridesOf } from '../instance-overrides/types'
import { cloneRecord } from '../node-change/clone'
import { applyStyleRefsToFields } from '../node-change/style/refs'
import {
  resolveDocumentBindingReferences,
  type BindingReferenceDiagnostic
} from './bindings/references'
import { planComponentConstruction } from './components'
import { collectSceneDependencies } from './dependency-closure'
import { inheritComponentPropertyDefinitions } from './property-inheritance'

/** Indexed source document. Resources remain separate from scene occurrences. */
export function createDocumentReader(source: readonly NodeChange[], pageIds?: ReadonlySet<string>) {
  return createReader(source, 'copy', pageIds)
}

/** Parse into exclusively owned records; callers never receive the mutable source index. */
export function createArchiveDocumentReader(
  bytes: ArrayBuffer,
  pageIds?: ReadonlySet<string>,
  options: ParseFigBufferOptions = {}
) {
  const parsed = parseFigBuffer(bytes, options)
  return {
    figKiwiVersion: parsed.figKiwiVersion,
    figSchemaDeflated: parsed.figSchemaDeflated,
    objectAnimations: parsed.objectAnimations,
    reader: createReader(parsed.nodeChanges, 'transfer', pageIds),
    blobs: parsed.blobs,
    images: parsed.images
  }
}

function createReader(
  source: readonly NodeChange[],
  ownership: 'copy' | 'transfer',
  pageIds?: ReadonlySet<string>
) {
  const bindingDiagnostics: BindingReferenceDiagnostic[] = []
  const liveSource = source.filter((node) => node.phase !== 'REMOVED')
  const changes = resolveDocumentBindingReferences(
    liveSource,
    (diagnostic) => bindingDiagnostics.push(diagnostic),
    ownership
  )
  // One index over these records serves inheritance, style lookup, the dependency closure
  // and component planning.
  const index = createSourceIndex(changes)
  inheritComponentPropertyDefinitions(changes, index.sources)
  const styles = index.sources
  const assets = new Map<string, string>()
  for (const node of changes)
    if (node.guid && typeof node.key === 'string') {
      const id = guidToString(node.guid)
      assets.set(node.key, id)
      if (typeof node.version === 'string') assets.set(`${node.key}@${node.version}`, id)
    }
  const resolveStyles = (node: NodeChange, isOverride = false): void => {
    applyStyleRefsToFields(styles, node, assets, isOverride)
    for (const override of symbolOverridesOf(node)) resolveStyles(override as NodeChange, true)
  }
  for (const node of changes) resolveStyles(node)
  return createScopedReader(
    changes,
    bindingDiagnostics,
    pageIds,
    createSharedReaderState(changes, index, assets)
  )
}

/**
 * Everything a scoped reader needs that does not depend on which pages are selected. Only
 * the page's own subset varies, so the whole-document work happens once per document.
 */
interface SharedReaderState {
  index: SourceIndex
  assets: ReadonlyMap<string, string>
  sourceInterpreter: ReturnType<typeof createOccurrenceInterpreter>
}

function createSharedReaderState(
  changes: readonly NodeChange[],
  index: SourceIndex,
  assets: ReadonlyMap<string, string>
) {
  let sourceInterpreter: SharedReaderState['sourceInterpreter'] | undefined
  return {
    index,
    assets,
    get sourceInterpreter() {
      sourceInterpreter ??= createOccurrenceInterpreter(
        changes.filter((change) => change.type !== 'VARIABLE' && change.type !== 'VARIABLE_SET')
      )
      return sourceInterpreter
    }
  }
}

function createScopedReader(
  changes: NodeChange[],
  bindingDiagnostics: BindingReferenceDiagnostic[],
  pageIds: ReadonlySet<string> | undefined,
  shared: SharedReaderState
) {
  const resources = changes.filter(
    (change) => change.type === 'VARIABLE' || change.type === 'VARIABLE_SET'
  )
  const closure = collectSceneDependencies(changes, pageIds, shared.index)
  // Deleted components are interpreted per instance; broken hierarchy is not recoverable.
  if (closure.missingIds.size)
    throw new Error(`Missing reachable sources: ${[...closure.missingIds].join(', ')}`)
  const sceneChanges = changes.filter(
    (change) =>
      change.type !== 'VARIABLE' &&
      change.type !== 'VARIABLE_SET' &&
      (change.type === 'CANVAS' ||
        (change.guid &&
          (closure.contentIds.has(guidToString(change.guid)) ||
            closure.ancestorIds.has(guidToString(change.guid)))))
  )
  const sourceInterpreter = shared.sourceInterpreter
  const interpreter = createOccurrenceInterpreter(sceneChanges)
  const pages = changes
    .filter((change) => change.type === 'CANVAS')
    .toSorted(bySavedPosition)
    .map((page) => {
      if (!page.guid) throw new Error('Page has no GUID')
      return {
        id: guidToString(page.guid),
        name: page.name ?? '',
        position: page.parentIndex?.position ?? null,
        internalOnly: page.internalOnly === true
      }
    })
  const knownPageIds = new Set(pages.map((page) => page.id))
  return {
    resolveStyleReference: (reference: StyleReference): string | null => {
      if (reference.guid) return guidToString(reference.guid)
      const { key, version } = reference.assetRef
      return (
        (version ? shared.assets.get(`${key}@${version}`) : undefined) ??
        shared.assets.get(key) ??
        null
      )
    },
    selectPages(ids: ReadonlySet<string>) {
      return createScopedReader(changes, bindingDiagnostics, ids, shared)
    },
    /** Read authored records through the same index, before instance expansion. */
    sourceChildren(id: string): NodeChange[] {
      return cloneRecord([...(shared.index.children.get(id) ?? [])])
    },
    sourceRecord(id: string): NodeChange | undefined {
      return cloneRecord(shared.index.sources.get(id))
    },
    get sourceRecords() {
      return cloneRecord(changes)
    },
    /** A detached projection for hosts that only need a small set of authored fields. */
    sourceRecordsFor(fields: readonly (keyof NodeChange)[]): NodeChange[] {
      return changes.map(
        (change) =>
          cloneRecord(
            Object.fromEntries(
              fields
                .filter((field) => Object.hasOwn(change, field))
                .map((field) => [field, change[field]])
            )
          ) as NodeChange
      )
    },
    get documentRecord() {
      return cloneRecord(changes.find((change) => change.type === 'DOCUMENT'))
    },
    dependencyClosure: closure,
    pages,
    get resources() {
      return structuredClone(resources)
    },
    bindingDiagnostics,
    readPage(id: string, options: InterpretInstanceOptions = {}) {
      if (!knownPageIds.has(id)) throw new Error(`Unknown page ${id}`)
      const page = interpreter.page(id, options)
      // A slot content frame is read through the instance assigning it, never as a layer.
      page.children = page.children.filter((child) => child.properties.isSlotContent !== true)
      return page
    },
    planComponents(
      roots: readonly ReturnType<typeof interpreter.page>[],
      options: InterpretInstanceOptions = {}
    ) {
      return planComponentConstruction(
        changes,
        roots,
        (id) => sourceInterpreter.component(id, options),
        shared.index.sources
      )
    },
    readComponent: sourceInterpreter.component
  }
}
