/**
 * Tool definition schema.
 *
 * Each tool is defined once with typed params and an execute function
 * that operates on FigmaAPI. Adapters for AI chat (valibot), CLI (citty),
 * and MCP (JSON Schema) are generated from these definitions.
 */

import type { SceneNode } from '@open-pencil/scene-graph'

import type { Editor } from '#core/editor'
import type { FigmaAPI, FigmaNodeProxy } from '#core/figma-api'
import type { MotionAnimationExportResult, MotionExportProgress } from '#core/io/motion-export'
import type { ModuleDefinition } from '#core/plugins'

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

export interface ToolDef {
  name: string
  description: string
  mutates?: boolean
  params: Record<string, ParamDef>
  execute: (figma: FigmaAPI, args: Record<string, unknown>, ctx?: ToolCtx) => unknown
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

export function defineTool<P extends Record<string, ParamDef>>(def: {
  name: string
  description: string
  mutates?: boolean
  params: P
  execute: (figma: FigmaAPI, args: ResolvedParams<P>, ctx?: ToolCtx) => unknown
}): ToolDef {
  return def as ToolDef
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
