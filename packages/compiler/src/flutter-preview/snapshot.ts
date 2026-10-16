import * as v from 'valibot'

import type { PortableSceneGraphData } from '@open-pencil/core/io/formats/fig'
import {
  SceneGraph,
  serializeInstanceOverrideState,
  deserializeInstanceOverrideState,
  type SceneNode,
  type Variable,
  type VariableCollection
} from '@open-pencil/scene-graph'

import { compile, withDefaults } from '../index'
import type { CompilerOutput } from '../types'
import { decodePreviewImage, encodePreviewImage, previewBinaryLength } from './binary'
import { validatePreviewComponents, validatePreviewDependencies } from './dependencies'
import { cloneFlutterPreviewJSON } from './json'
import { FLUTTER_PREVIEW_SNAPSHOT_LIMITS as LIMITS, invalidFlutterPreviewSnapshot } from './limits'
import type { flutterPreviewNodeSchema } from './node-schema'
import { flutterPreviewSnapshotSchema } from './schema'

/** The wire representation is JSON; runtime classes and binary arrays are restored separately. */
export type FlutterPreviewJSONNode = v.InferOutput<typeof flutterPreviewNodeSchema>
export type FlutterPreviewGraphData = Omit<PortableSceneGraphData, 'nodes' | 'images'> & {
  nodes: Array<[string, FlutterPreviewJSONNode]>
  /** Canonical base64 strings; native tools receive no renderer-selected output files. */
  images: Array<[string, string]>
}
export interface FlutterPreviewSnapshot {
  version: 1
  pageIds: string[]
  graph: FlutterPreviewGraphData
}

function uniqueEntries(entries: readonly (readonly [string, unknown])[]): void {
  if (new Set(entries.map(([id]) => id)).size !== entries.length) invalidFlutterPreviewSnapshot()
}

function validateNodeEdges(nodes: Map<string, FlutterPreviewJSONNode>, rootId: string): void {
  const children = new Map([...nodes].map(([id, node]) => [id, new Set(node.childIds)]))
  for (const [id, node] of nodes) {
    if (id !== node.id || new Set(node.childIds).size !== node.childIds.length)
      return invalidFlutterPreviewSnapshot()
    if (id !== rootId && (!node.parentId || !children.get(node.parentId)?.has(id)))
      return invalidFlutterPreviewSnapshot()
    for (const childId of node.childIds) {
      if (nodes.get(childId)?.parentId !== id) return invalidFlutterPreviewSnapshot()
    }
    if (
      node.componentId &&
      !['COMPONENT', 'COMPONENT_SET'].includes(nodes.get(node.componentId)?.type ?? '')
    )
      return invalidFlutterPreviewSnapshot()
  }
}

function validateReachableNodes(nodes: Map<string, FlutterPreviewJSONNode>, rootId: string): void {
  const visited = new Set<string>()
  const pending = [{ id: rootId, depth: 0 }]
  while (pending.length) {
    const current = pending.pop()
    if (!current || visited.has(current.id) || current.depth > LIMITS.maxDepth)
      return invalidFlutterPreviewSnapshot()
    visited.add(current.id)
    const node = nodes.get(current.id)
    if (!node) return invalidFlutterPreviewSnapshot()
    for (const id of node.childIds) pending.push({ id, depth: current.depth + 1 })
  }
  if (visited.size !== nodes.size) return invalidFlutterPreviewSnapshot()
}

function validateHierarchy(snapshot: FlutterPreviewSnapshot): void {
  const nodes = new Map(snapshot.graph.nodes)
  const root = nodes.get(snapshot.graph.rootId)
  if (root?.parentId !== null) return invalidFlutterPreviewSnapshot()
  validateNodeEdges(nodes, root.id)
  validateReachableNodes(nodes, root.id)
  for (const node of nodes.values()) {
    if (node.lowcodeApplication !== undefined && node.id !== root.id)
      return invalidFlutterPreviewSnapshot()
    if (node.lowcodeApplication?.enabled && node.type !== 'FRAME')
      return invalidFlutterPreviewSnapshot()
    if (
      node.lowcodeApplicationPage !== undefined &&
      (node.type !== 'CANVAS' || node.parentId !== root.id)
    )
      return invalidFlutterPreviewSnapshot()
  }
  validatePreviewComponents(nodes)
  if (new Set(snapshot.pageIds).size !== snapshot.pageIds.length)
    return invalidFlutterPreviewSnapshot()
  for (const pageId of snapshot.pageIds) {
    const page = nodes.get(pageId)
    if (page?.type !== 'CANVAS' || page.parentId !== root.id || page.internalOnly)
      return invalidFlutterPreviewSnapshot()
  }
}

function validateVariableValues(
  variable: Variable,
  collection: VariableCollection,
  variables: Map<string, Variable>
): void {
  const modes = new Set(collection.modes.map((mode) => mode.modeId))
  for (const [mode, value] of Object.entries(variable.valuesByMode)) {
    if (!modes.has(mode)) return invalidFlutterPreviewSnapshot()
    if (typeof value === 'object' && 'aliasId' in value) {
      if (variables.get(value.aliasId)?.type !== variable.type)
        return invalidFlutterPreviewSnapshot()
    } else if (variable.type === 'COLOR') {
      if (typeof value !== 'object') return invalidFlutterPreviewSnapshot()
    } else {
      const scalarType = { FLOAT: 'number', STRING: 'string', BOOLEAN: 'boolean' }[variable.type]
      if (typeof value !== scalarType) return invalidFlutterPreviewSnapshot()
    }
  }
}

function validateVariables(graph: FlutterPreviewGraphData): void {
  const variables = new Map(graph.variables)
  const collections = new Map(graph.variableCollections)
  for (const [id, variable] of variables) {
    const collection = collections.get(variable.collectionId)
    if (variable.id !== id || !collection || !collection.variableIds.includes(id))
      return invalidFlutterPreviewSnapshot()
    validateVariableValues(variable, collection, variables)
  }
  for (const [id, collection] of collections) {
    const modes = new Set(collection.modes.map((mode) => mode.modeId))
    if (
      collection.id !== id ||
      modes.size !== collection.modes.length ||
      !modes.has(collection.defaultModeId)
    )
      return invalidFlutterPreviewSnapshot()
    if (new Set(collection.variableIds).size !== collection.variableIds.length)
      return invalidFlutterPreviewSnapshot()
    for (const variableId of collection.variableIds) {
      if (variables.get(variableId)?.collectionId !== id) return invalidFlutterPreviewSnapshot()
    }
  }
  for (const [id, modeId] of graph.activeMode) {
    if (!collections.get(id)?.modes.some((mode) => mode.modeId === modeId))
      return invalidFlutterPreviewSnapshot()
  }
  // Conservative across modes: no alias cycle or deep chain can reach a recursive resolver.
  validatePreviewDependencies(
    new Map(
      [...variables].map(([id, variable]) => [
        id,
        new Set(
          Object.values(variable.valuesByMode).flatMap((value) =>
            typeof value === 'object' && 'aliasId' in value ? [value.aliasId] : []
          )
        )
      ])
    )
  )
}

function validateResources(snapshot: FlutterPreviewSnapshot): void {
  const graph = snapshot.graph
  for (const entries of [
    graph.nodes,
    graph.images,
    graph.variables,
    graph.variableCollections,
    graph.activeMode
  ])
    uniqueEntries(entries)
  let bytes = 0
  for (const [, encoded] of graph.images) {
    bytes += decodePreviewImage(encoded).byteLength
    if (bytes > LIMITS.maxTotalImageBytes) return invalidFlutterPreviewSnapshot()
  }
  validateVariables(graph)
  for (const [, node] of graph.nodes) {
    uniqueEntries(node.instanceOverrides.self)
    uniqueEntries(node.instanceOverrides.descendants)
    for (const [, entries] of node.instanceOverrides.descendants) uniqueEntries(entries)
  }
}

/** Validates and detaches untrusted JSON before any compiler or graph operation. */
export function validateFlutterPreviewSnapshot(input: unknown): FlutterPreviewSnapshot {
  try {
    const result = v.safeParse(flutterPreviewSnapshotSchema, cloneFlutterPreviewJSON(input))
    if (!result.success) return invalidFlutterPreviewSnapshot()
    const snapshot: FlutterPreviewSnapshot = result.output
    validateHierarchy(snapshot)
    validateResources(snapshot)
    return snapshot
  } catch {
    return invalidFlutterPreviewSnapshot()
  }
}

/** Matches the existing portable SceneGraph projection, without format-owned lazy FIG state. */
export function captureFlutterPreviewSnapshot(
  graph: SceneGraph,
  pageIds: string[]
): FlutterPreviewSnapshot {
  try {
    if (graph.nodes.size > LIMITS.maxNodes || graph.images.size > LIMITS.maxImages)
      return invalidFlutterPreviewSnapshot()
    let imageBytes = 0
    const images = [...graph.images].map(([id, image]): [string, string] => {
      imageBytes += previewBinaryLength(image)
      if (imageBytes > LIMITS.maxTotalImageBytes) return invalidFlutterPreviewSnapshot()
      return [id, encodePreviewImage(image)]
    })
    return validateFlutterPreviewSnapshot(
      cloneFlutterPreviewJSON(
        {
          version: 1,
          pageIds,
          graph: {
            rootId: graph.rootId,
            nodes: [...graph.nodes].map(([id, node]) => [
              id,
              {
                ...node,
                // FIG import uses an empty string for ordinary nodes without a master.
                // Keep INSTANCE references and untrusted wire IDs strictly validated.
                componentId:
                  node.type !== 'INSTANCE' && node.componentId === '' ? null : node.componentId,
                instanceOverrides: serializeInstanceOverrideState(node.instanceOverrides)
              }
            ]),
            images,
            variables: [...graph.variables],
            variableCollections: [...graph.variableCollections],
            activeMode: [...graph.activeMode],
            documentColorSpace: graph.documentColorSpace
          }
        },
        true
      )
    )
  } catch {
    return invalidFlutterPreviewSnapshot()
  }
}

function restoreNode(graph: SceneGraph, node: FlutterPreviewJSONNode): SceneNode {
  const restored = graph.createNodeWithId(node.id, node.type, node.parentId)
  // Rehydrate the complete validated data envelope through the public node factory.
  // Optional lowcode behavior is still normalized by the compiler's reviewed validators.
  Object.assign(restored, node)
  restored.fillGeometry = node.fillGeometry.map((path) => ({
    ...path,
    commandsBlob: Uint8Array.from(path.commandsBlob)
  }))
  restored.strokeGeometry = node.strokeGeometry.map((path) => ({
    ...path,
    commandsBlob: Uint8Array.from(path.commandsBlob)
  }))
  restored.textPicture = node.textPicture === null ? null : Uint8Array.from(node.textPicture)
  restored.instanceOverrides = deserializeInstanceOverrideState(node.instanceOverrides)
  restored.derivedTextGlyphs =
    node.derivedTextGlyphs?.map((glyph) => ({
      ...glyph,
      commandsBlob: Uint8Array.from(glyph.commandsBlob)
    })) ?? null
  return restored
}

/** The only compilation authority is the reviewed Flutter adapter and these fixed options. */
export function compileFlutterPreviewSnapshot(
  input: FlutterPreviewSnapshot
): Pick<CompilerOutput, 'files' | 'warnings'> {
  const snapshot = validateFlutterPreviewSnapshot(input)
  try {
    const graph = new SceneGraph()
    graph.rootId = snapshot.graph.rootId
    graph.nodes.clear()
    for (const [, node] of snapshot.graph.nodes) restoreNode(graph, node)
    graph.images = new Map(
      snapshot.graph.images.map(([id, image]) => [id, decodePreviewImage(image)])
    )
    graph.variables = new Map(snapshot.graph.variables)
    graph.variableCollections = new Map(snapshot.graph.variableCollections)
    graph.activeMode = new Map(snapshot.graph.activeMode)
    graph.documentColorSpace = snapshot.graph.documentColorSpace
    graph.instanceIndex = new Map()
    graph.rebuildInstanceIndex()
    graph.clearAbsPosCache()
    const output = compile({
      graph,
      pageIds: snapshot.pageIds,
      options: withDefaults({
        target: 'flutter',
        router: 'flutter-router',
        packageName: 'openpencil_flutter_preview',
        productName: 'OpenPencil Preview',
        // This local debug preview always keeps node identity keys for Flutter hot reload.
        devMode: true,
        backendCompilationMode: 'source-only-prototype'
      })
    })
    return { files: output.files, warnings: output.warnings }
  } catch {
    throw new TypeError('Flutter preview compilation failed.')
  }
}
