import type { SceneGraph, SceneNode, Variable, VariableCollection } from '@open-pencil/scene-graph'

import type { PenDocument, PenNode } from './convert'
import { PEN_MOTION_CONTRACT_FIELDS, type PenMotionContractField } from './metadata'
import { isPlainPenRecord } from './record'

interface PenTextStyle {
  indent: string | number
  newline: '\n' | '\r\n'
  trailingNewline: boolean
}

export interface PenSourceContext {
  document: PenDocument
  pageId: string
  mappedEntityIds: Set<string>
  parentById: Map<string, string | null>
  childOrderByParent: Map<string | null, string[]>
  documentFingerprint: string
  structureFingerprint: string
  textStyle: PenTextStyle
}

const PEN_SOURCE_CONTEXTS = new WeakMap<SceneGraph, PenSourceContext>()

function detectTextStyle(json: string): PenTextStyle {
  const newline = json.includes('\r\n') ? '\r\n' : '\n'
  const firstIndent = json.match(/\r?\n([ \t]+)\S/)
  const indentText = firstIndent?.[1] ?? ''
  const indent = indentText.includes('\t') ? '\t' : indentText.length || 2
  return { indent, newline, trailingNewline: /\r?\n$/.test(json) }
}

function sortedMapEntries<T>(map: ReadonlyMap<string, T>): Array<[string, T]> {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function variableSnapshot(variable: Variable): unknown {
  return {
    ...variable,
    valuesByMode: Object.fromEntries(
      Object.entries(variable.valuesByMode).sort(([left], [right]) => left.localeCompare(right))
    )
  }
}

function collectionSnapshot(collection: VariableCollection): unknown {
  return {
    ...collection,
    modes: collection.modes.map((mode) => ({ ...mode })),
    variableIds: [...collection.variableIds]
  }
}

function documentFingerprint(graph: SceneGraph, pageId: string): string {
  const root = graph.getNode(graph.rootId)
  const page = graph.getNode(pageId)
  return JSON.stringify({
    variables: sortedMapEntries(graph.variables).map(([id, value]) => [
      id,
      variableSnapshot(value)
    ]),
    collections: sortedMapEntries(graph.variableCollections).map(([id, value]) => [
      id,
      collectionSnapshot(value)
    ]),
    activeMode: sortedMapEntries(graph.activeMode),
    documentColorSpace: graph.documentColorSpace,
    rootSeo: root?.lowcodeSeoMetadata ?? null,
    pageSeo: page?.lowcodeSeoMetadata ?? null
  })
}

function structureFingerprint(graph: SceneGraph): string {
  return JSON.stringify(
    [...graph.getAllNodes()]
      .map((node) => ({
        id: node.id,
        type: node.type,
        parentId: node.parentId,
        childIds: [...node.childIds]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  )
}

function collectSourceStructure(
  graph: SceneGraph,
  nodes: PenNode[],
  parentId: string | null,
  mappedEntityIds: Set<string>,
  parentById: Map<string, string | null>,
  childOrderByParent: Map<string | null, string[]>
): void {
  const mappedChildren: string[] = []
  for (const node of nodes) {
    if (graph.getNode(node.id)) {
      mappedEntityIds.add(node.id)
      parentById.set(node.id, parentId)
      mappedChildren.push(node.id)
    }
    if (node.children) {
      collectSourceStructure(
        graph,
        node.children,
        graph.getNode(node.id) ? node.id : parentId,
        mappedEntityIds,
        parentById,
        childOrderByParent
      )
    }
  }
  childOrderByParent.set(parentId, mappedChildren)
}

export function registerPenSource(graph: SceneGraph, document: PenDocument, json: string): void {
  const page = graph.getPages(true).at(0)
  if (!page) throw new Error('Cannot register .pen source without a page')

  const mappedEntityIds = new Set<string>()
  const parentById = new Map<string, string | null>()
  const childOrderByParent = new Map<string | null, string[]>()
  collectSourceStructure(
    graph,
    document.children,
    null,
    mappedEntityIds,
    parentById,
    childOrderByParent
  )

  PEN_SOURCE_CONTEXTS.set(graph, {
    document: structuredClone(document),
    pageId: page.id,
    mappedEntityIds,
    parentById,
    childOrderByParent,
    documentFingerprint: documentFingerprint(graph, page.id),
    structureFingerprint: structureFingerprint(graph),
    textStyle: detectTextStyle(json)
  })
}

export function getPenSourceContext(graph: SceneGraph): PenSourceContext | undefined {
  return PEN_SOURCE_CONTEXTS.get(graph)
}

export function clonePenSourceDocument(context: PenSourceContext): PenDocument {
  return structuredClone(context.document)
}

function hasInstanceAncestor(graph: SceneGraph, node: SceneNode): boolean {
  let parentId = node.parentId
  while (parentId) {
    const parent = graph.getNode(parentId)
    if (!parent) return false
    if (parent.type === 'INSTANCE') return true
    parentId = parent.parentId
  }
  return false
}

function currentSerializableIds(graph: SceneGraph, context: PenSourceContext): Set<string> {
  const ids = new Set<string>()
  for (const node of graph.getAllNodes()) {
    if (node.id === graph.rootId || node.id === context.pageId) continue
    if (hasInstanceAncestor(graph, node)) continue
    ids.add(node.id)
  }
  return ids
}

function sourceParentId(context: PenSourceContext, node: SceneNode): string | null {
  return node.parentId === context.pageId ? null : node.parentId
}

function equalJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalJsonValue(value, right[index]))
    )
  }
  if (!isPlainPenRecord(left) || !isPlainPenRecord(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && equalJsonValue(left[key], right[key]))
  )
}

function hasDerivedInstanceMotionOverride(node: SceneNode, mayWriteMotion: boolean): boolean {
  if (!mayWriteMotion || node.type !== 'INSTANCE') {
    return false
  }
  const editedContracts = PEN_MOTION_CONTRACT_FIELDS.filter((field) =>
    node.source.editedFields.includes(field)
  )
  if (editedContracts.length === 0) return false
  const keys = Object.keys(node.overrides)
  if (
    keys.length === 0 ||
    keys.some((key) => !PEN_MOTION_CONTRACT_FIELDS.includes(key as PenMotionContractField))
  ) {
    return false
  }
  return keys.every((key) => {
    const field = key as PenMotionContractField
    const value = node[field]
    return value === undefined
      ? node.overrides[field] === null
      : equalJsonValue(node.overrides[field], value)
  })
}

function assertSameStructure(graph: SceneGraph, context: PenSourceContext): void {
  const currentIds = currentSerializableIds(graph, context)
  if (
    currentIds.size !== context.mappedEntityIds.size ||
    [...currentIds].some((id) => !context.mappedEntityIds.has(id))
  ) {
    throw new Error('The .pen structure changed; save as .fig to preserve non-Motion edits')
  }

  for (const id of context.mappedEntityIds) {
    const node = graph.getNode(id)
    if (!node) throw new Error(`The .pen source node ${id} was removed; save as .fig instead`)
    if (sourceParentId(context, node) !== context.parentById.get(id)) {
      throw new Error(`The .pen source node ${id} was reparented; save as .fig instead`)
    }
  }

  for (const [parentId, expectedOrder] of context.childOrderByParent) {
    const parent = parentId ? graph.getNode(parentId) : graph.getNode(context.pageId)
    if (!parent) throw new Error('The .pen source hierarchy is no longer available')
    const currentOrder = parent.childIds.filter((id) => context.mappedEntityIds.has(id))
    if (JSON.stringify(currentOrder) !== JSON.stringify(expectedOrder)) {
      throw new Error('The .pen node order changed; save as .fig to preserve the edit')
    }
  }
}

function assertOnlyMotionFieldsEdited(graph: SceneGraph, context: PenSourceContext): void {
  for (const node of graph.getAllNodes()) {
    const mayWriteMotion = context.mappedEntityIds.has(node.id)
    const mayWriteDerivedOverride = hasDerivedInstanceMotionOverride(node, mayWriteMotion)
    const unsupported = node.source.editedFields.filter(
      (field) =>
        !(
          mayWriteMotion &&
          (PEN_MOTION_CONTRACT_FIELDS.includes(field as PenMotionContractField) ||
            (field === 'overrides' && mayWriteDerivedOverride))
        )
    )
    if (unsupported.length > 0) {
      throw new Error(
        `The .pen source node ${node.id} has unsupported edits (${unsupported.join(', ')}); save as .fig instead`
      )
    }
  }
}

export function assertPenMotionWriteSafe(graph: SceneGraph): PenSourceContext {
  const context = PEN_SOURCE_CONTEXTS.get(graph)
  if (!context) {
    throw new Error(
      'Writing .pen currently requires a graph imported from .pen; use .fig for new documents'
    )
  }
  const pages = graph.getPages(true)
  if (pages.length !== 1 || pages[0]?.id !== context.pageId) {
    throw new Error('The .pen page structure changed; save as .fig instead')
  }
  assertSameStructure(graph, context)
  if (structureFingerprint(graph) !== context.structureFingerprint) {
    throw new Error('The .pen instance or node structure changed; save as .fig instead')
  }
  assertOnlyMotionFieldsEdited(graph, context)
  if (documentFingerprint(graph, context.pageId) !== context.documentFingerprint) {
    throw new Error('The .pen document metadata or variables changed; save as .fig instead')
  }
  return context
}

export function stringifyPenSource(document: PenDocument, context: PenSourceContext): string {
  let output = JSON.stringify(document, null, context.textStyle.indent)
  if (context.textStyle.newline === '\r\n') output = output.replaceAll('\n', '\r\n')
  if (context.textStyle.trailingNewline) output += context.textStyle.newline
  return output
}
