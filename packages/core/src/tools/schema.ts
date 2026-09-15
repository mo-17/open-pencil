/**
 * Tool definition schema.
 *
 * Native Valibot inputs and execution capabilities are owned by each tool.
 * Adapters consume these contracts rather than maintaining transport-specific schemas.
 */

import * as v from 'valibot'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { Editor } from '#core/editor'
import type { FigmaAPI, FigmaNodeProxy } from '#core/figma-api'
import type { MotionAnimationExportResult, MotionExportProgress } from '#core/io/motion-export'
import type { ModuleDefinition } from '#core/plugins'

import { legacyToolInput } from './legacy-schema'

export type ParamType = 'string' | 'number' | 'boolean' | 'color' | 'string[]' | 'object' | 'array'

export interface ParamDef {
  type: ParamType
  description: string
  required?: boolean
  default?: unknown
  enum?: string[]
  min?: number
  max?: number
  /** Nested fields for a structured object parameter. Omit for an arbitrary JSON object. */
  properties?: Record<string, ParamDef>
  /** Item schema for a structured array parameter. Omit for arbitrary JSON values. */
  items?: ParamDef
  /** Preserve unknown object keys in addition to declared properties. Defaults to false. */
  additionalProperties?: boolean
  minItems?: number
  maxItems?: number
}

/** Phase 3 §3.v2: optional editor context for tools that need to push
 *  undo entries. Only the 3 lowcode mutate tools opt in today; CLI / MCP
 *  / fixture call sites pass nothing and the tool falls back to the
 *  legacy `figma.graph.updateNode` path (no undo). */
export interface ToolCtx {
  editor?: Editor
  /** Host-visible module definitions. Existing nodes keep using this registry even
   *  when installation policy prevents new instances from being created. */
  moduleRegistry?: {
    getModule: (pluginId: string, moduleType: string) => ModuleDefinition | undefined
    listModules: () => readonly ModuleDefinition[]
  }
  /** Optional host installation/enablement gate for discovery and creation only. */
  canCreateModule?: (pluginId: string, moduleType: string) => boolean
  /** Request-scoped cancellation propagated by AI and MCP adapters. */
  signal?: AbortSignal
  /** Host already owns the page-scoped post-tool layout pass. */
  deferLayout?: boolean
  /** Long-running tools report bounded, serializable progress through the active adapter. */
  onProgress?: (progress: MotionExportProgress) => void
  /** App hosts can commit an animation artifact through their native/browser save surface. */
  saveMotionExport?: (
    result: MotionAnimationExportResult,
    suggestedName: string,
    signal?: AbortSignal
  ) => Promise<boolean>
}

type ResolvedType<T extends ParamDef> = T['type'] extends 'string'
  ? string
  : T['type'] extends 'number'
    ? number
    : T['type'] extends 'boolean'
      ? boolean
      : T['type'] extends 'color'
        ? string
        : T['type'] extends 'string[]'
          ? string[]
          : T['type'] extends 'object'
            ? T extends { properties: infer P extends Record<string, ParamDef> }
              ? ResolvedParams<P> &
                  (T extends { additionalProperties: true } ? Record<string, unknown> : object)
              : Record<string, unknown>
            : T['type'] extends 'array'
              ? T extends { items: infer I extends ParamDef }
                ? ResolvedType<I>[]
                : unknown[]
              : never

type ResolvedParams<P extends Record<string, ParamDef>> = {
  [K in keyof P as P[K]['required'] extends true ? K : never]: ResolvedType<P[K]>
} & {
  [K in keyof P as P[K]['required'] extends true ? never : K]?: ResolvedType<P[K]>
}

export type ToolCapability =
  | 'document:read'
  | 'document:write'
  | 'filesystem:read'
  | 'filesystem:write'
  | 'network:access'
  | 'code:execute'

export type ToolExecution =
  | { kind: 'sync'; mutation: 'none' | 'view' | 'properties' | 'document' }
  | { kind: 'async'; mutation: 'none' | 'view' | 'document' }

export type ToolInterface = 'mcp' | 'ai' | 'webmcp'
export type ToolExposure = Partial<Record<ToolInterface, boolean>>

interface ToolMetadata {
  name: string
  description: string
  execution: ToolExecution
  /** Interface inclusion defaults to true; execution support and user permissions remain separate. */
  exposure: ToolExposure
  capabilities: readonly ToolCapability[]
  availability: 'default' | 'eval'
}

export interface ToolDef extends ToolMetadata {
  input: v.ObjectSchema<v.ObjectEntries, undefined>
  /** Legacy declaration compatibility; adapters consume input exclusively. */
  params: Record<string, ParamDef>
  readonly changesDocument: boolean
  /** Derived from execution metadata, never declared independently by a tool. */
  readonly mutates: boolean
  execute: (figma: FigmaAPI, args: Record<string, unknown>, ctx?: ToolCtx) => unknown
}

type ToolDefinitionMetadata = Omit<ToolMetadata, 'exposure' | 'capabilities' | 'availability'> &
  Partial<Pick<ToolMetadata, 'exposure' | 'capabilities' | 'availability'>>

type NativeToolDefinition<P extends v.ObjectEntries, R> = ToolDefinitionMetadata & {
  input: v.ObjectSchema<P, undefined>
  execution: ToolExecution & (R extends PromiseLike<unknown> ? { kind: 'async' } : unknown)
  execute: (figma: FigmaAPI, args: v.InferOutput<v.ObjectSchema<P, undefined>>, ctx?: ToolCtx) => R
}
type LegacyToolDefinition<P extends Record<string, ParamDef>> = {
  name: string
  description: string
  params: P
  mutates?: boolean
  changesDocument?: boolean
  execution?: ToolExecution
  exposure?: ToolExposure
  capabilities?: readonly ToolCapability[]
  availability?: ToolMetadata['availability']
  execute: (figma: FigmaAPI, args: ResolvedParams<P>, ctx?: ToolCtx) => unknown
}

export function defineTool<P extends v.ObjectEntries, R>(def: NativeToolDefinition<P, R>): ToolDef
export function defineTool<P extends Record<string, ParamDef>>(
  def: LegacyToolDefinition<P>
): ToolDef
export function defineTool(
  def:
    | NativeToolDefinition<v.ObjectEntries, unknown>
    | LegacyToolDefinition<Record<string, ParamDef>>
): ToolDef {
  const legacy = 'params' in def
  const input = legacy ? legacyToolInput(def.params) : def.input
  let mutation: ToolExecution['mutation'] = 'none'
  if (legacy) {
    if (def.mutates) mutation = 'view'
    if (def.changesDocument ?? def.mutates === true) mutation = 'document'
  }
  const execution: ToolExecution = def.execution ?? { kind: 'async', mutation }
  const changesDocument = toolChangesDocument({ execution })
  return {
    ...def,
    input,
    params: legacy ? def.params : {},
    execution,
    // Legacy extensions have not been reviewed for the browser-native interface.
    exposure: legacy ? { ...def.exposure, webmcp: false } : (def.exposure ?? {}),
    capabilities: def.capabilities ?? [changesDocument ? 'document:write' : 'document:read'],
    availability: def.availability ?? 'default',
    changesDocument,
    get mutates() {
      return execution.mutation !== 'none'
    },
    execute: (figma, args, ctx) =>
      (def.execute as ToolDef['execute'])(figma, v.parse(input, args), ctx)
  }
}

export function toolChangesDocument(def: Pick<ToolDef, 'execution'>): boolean {
  return def.execution.mutation === 'properties' || def.execution.mutation === 'document'
}

export function isToolExposed(def: Pick<ToolDef, 'exposure'>, target: ToolInterface): boolean {
  return def.exposure[target] !== false
}

export function isAtomicTool(def: ToolDef): boolean {
  return def.execution.kind === 'sync' && def.execution.mutation === 'properties'
}

export class NodeNotFoundError extends Error {
  constructor(id: string) {
    super(`Node not found: ${id}`)
    this.name = 'NodeNotFoundError'
  }
}

export function requireNode(figma: FigmaAPI, id: string): ReturnType<FigmaAPI['getNodeById']> {
  const node = figma.getNodeById(id)
  if (!node) throw new NodeNotFoundError(id)
  return node
}

export function requireNodes(figma: FigmaAPI, ids: ReadonlyArray<string>): FigmaNodeProxy[] | null {
  const nodes: FigmaNodeProxy[] = []
  for (const id of ids) {
    const node = figma.getNodeById(id)
    if (!node) return null
    nodes.push(node)
  }
  return nodes
}

export function nodeNotFound(id: string): { error: string } {
  return { error: `Node "${id}" not found` }
}

export function getRawNodeOrError(
  figma: FigmaAPI,
  id: string
): { node: SceneNode } | { error: string } {
  const node = figma.graph.getNode(id)
  return node ? { node } : nodeNotFound(id)
}

export function nodeToResult(node: FigmaNodeProxy, maxDepth?: number): Record<string, unknown> {
  return node.toJSON(maxDepth)
}

export function nodeSummary(node: FigmaNodeProxy): { id: string; name: string; type: string } {
  return { id: node.id, name: node.name, type: node.type }
}
