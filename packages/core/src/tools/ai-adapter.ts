/**
 * Adapter: tool definitions → Vercel AI SDK `tool()` objects.
 *
 * Converts ParamDef types to valibot schemas and wraps execute
 * functions with FigmaAPI instantiation.
 */

import type { valibotSchema as createValibotSchema } from '@ai-sdk/valibot'
import type { ToolSet, tool as createTool } from 'ai'
import type * as valibot from 'valibot'

import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import { abortError, isAbortError } from '#core/async-work'
import type { FigmaAPI } from '#core/figma-api'

import type { ToolCtx, ToolDef, ParamDef, ParamType } from './schema'

export interface ToolLogEntry {
  tool: string
  args: Record<string, unknown>
  result: unknown
  error?: string
  timestamp: number
  durationMs: number
  mutates: boolean
  /** For mutating tools: snapshot of target node props before execution */
  nodeBefore?: Record<string, unknown>
  /** For mutating tools: snapshot of target node props after execution */
  nodeAfter?: Record<string, unknown>
  /** Props that didn't change despite the tool reporting success */
  unchangedProps?: string[]
  /** True when this exact tool+args combo was already called in the session */
  isDuplicate?: boolean
}

export interface ToolDebugLog {
  entries: ToolLogEntry[]
  /** Detect repeated tool calls with identical args */
  duplicates: Array<{ tool: string; args: Record<string, unknown>; count: number }>
  /** Entries where mutating tool succeeded but node didn't change */
  noopMutations: ToolLogEntry[]
  /** Total bytes of tool results sent to model (rough token proxy) */
  totalResultBytes: number
}

export interface StepBudget {
  current: number
  max: number
}

export type AIAdapterExecutionStatus = 'success' | 'error' | 'aborted'

export interface AIAdapterExecutionContext {
  args: Record<string, unknown>
  signal?: AbortSignal
  status: AIAdapterExecutionStatus
  result?: unknown
  error?: unknown
}

export interface AIAdapterOptions {
  getFigma: () => FigmaAPI
  /** Share this key across adapter instances that mutate the same SceneGraph. */
  mutationKey?: object
  getToolContext?: (def: ToolDef, args: Record<string, unknown>) => ToolCtx | undefined
  onBeforeExecute?: (
    def: ToolDef,
    context: Pick<AIAdapterExecutionContext, 'args' | 'signal'>
  ) => void
  onAfterExecute?: (def: ToolDef, context: AIAdapterExecutionContext) => Promise<void> | void
  onFlashNodes?: (nodeIds: string[]) => void
  onToolLog?: (entry: ToolLogEntry) => void
  getStepBudget?: () => StepBudget
}

const STEP_WARNING_THRESHOLD = 5
const TOOL_ABORT_MESSAGE = 'Tool execution cancelled'
const MUTATION_QUEUES = new WeakMap<object, Promise<void>>()

export function serializeToolMutation<T>(mutationKey: object, run: () => Promise<T>): Promise<T> {
  const previous = MUTATION_QUEUES.get(mutationKey) ?? Promise.resolve()
  const queued = previous.then(run, run)
  MUTATION_QUEUES.set(
    mutationKey,
    queued.then(
      () => undefined,
      () => undefined
    )
  )
  return queued
}

function appendStepWarning(result: unknown, budget: StepBudget): unknown {
  const remaining = budget.max - budget.current
  if (remaining > STEP_WARNING_THRESHOLD) return result
  const warning = `⚠ ${remaining} steps remaining out of ${budget.max}. Wrap up: finish critical fixes, skip polish. User can send "continue" for more steps.`
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...result, _warning: warning }
  }
  return { result, _warning: warning }
}

function extractIdsFromArray(arr: unknown[]): string[] {
  const ids: string[] = []
  for (const item of arr) {
    if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
      ids.push(item.id)
    }
  }
  return ids
}

function extractNodeIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  if ('deleted' in result && typeof result.deleted === 'string') return []
  const ids: string[] = []
  if ('id' in result && typeof result.id === 'string') ids.push(result.id)
  if ('selection' in result && Array.isArray(result.selection))
    ids.push(...extractIdsFromArray(result.selection))
  if ('results' in result && Array.isArray(result.results))
    ids.push(...extractIdsFromArray(result.results))
  return ids
}

function captureNodeSnapshot(
  figma: FigmaAPI,
  args: Record<string, unknown>
): Record<string, unknown> | undefined {
  const targetId = args.id as string | undefined
  if (!targetId) return undefined
  const raw = figma.graph.getNode(targetId)
  if (!raw) return undefined
  return Object.fromEntries(Object.entries(structuredClone(raw)))
}

function emitToolLog(
  options: AIAdapterOptions,
  def: ToolDef,
  args: Record<string, unknown>,
  startTime: number,
  figma: FigmaAPI,
  nodeBefore: Record<string, unknown> | undefined,
  execResult: unknown,
  error?: string
): void {
  if (!options.onToolLog) return

  let nodeAfter: Record<string, unknown> | undefined
  let unchangedProps: string[] | undefined

  if (def.mutates && !error) {
    nodeAfter = captureNodeSnapshot(figma, args)
    if (nodeBefore && nodeAfter) {
      unchangedProps = detectUnchangedProps(def.name, args, nodeBefore, nodeAfter)
    }
  }

  options.onToolLog({
    tool: def.name,
    args,
    result: execResult,
    error,
    timestamp: startTime,
    durationMs: Date.now() - startTime,
    mutates: !!def.mutates,
    nodeBefore,
    nodeAfter,
    unchangedProps: unchangedProps?.length ? unchangedProps : undefined
  })
}

function isRejectedToolResult(result: unknown): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false
  if ('ok' in result && result.ok === false) return true
  return !('ok' in result && result.ok === true) && 'error' in result && result.error != null
}

interface ToolExecutionOutcome {
  context: AIAdapterExecutionContext
  primaryError?: unknown
  result?: unknown
}

async function executeToolDefinition(
  def: ToolDef,
  options: AIAdapterOptions,
  figma: FigmaAPI,
  args: Record<string, unknown>,
  hostContext: ToolCtx | undefined,
  signal: AbortSignal | undefined
): Promise<ToolExecutionOutcome> {
  try {
    options.onBeforeExecute?.(def, { args, signal })
    if (signal?.aborted) throw abortError(TOOL_ABORT_MESSAGE)
    const result = await def.execute(figma, args, { ...hostContext, signal })
    if (signal?.aborted) throw abortError(TOOL_ABORT_MESSAGE)
    return {
      context: {
        args,
        signal,
        status: isRejectedToolResult(result) ? 'error' : 'success',
        result
      },
      result
    }
  } catch (error) {
    return {
      context: {
        args,
        signal,
        status: isAbortError(error, signal) ? 'aborted' : 'error',
        error
      },
      primaryError: error
    }
  }
}

async function executeAfterHook(
  def: ToolDef,
  options: AIAdapterOptions,
  context: AIAdapterExecutionContext
): Promise<unknown> {
  try {
    await options.onAfterExecute?.(def, context)
    return undefined
  } catch (error) {
    return error
  }
}

function throwIfToolCancelled(
  signal: AbortSignal | undefined,
  primaryError: unknown,
  afterError: unknown
): void {
  if (signal?.aborted || isAbortError(primaryError, signal) || isAbortError(afterError, signal)) {
    throw abortError(TOOL_ABORT_MESSAGE)
  }
}

function finishToolExecution(
  def: ToolDef,
  options: AIAdapterOptions,
  args: Record<string, unknown>,
  startTime: number,
  figma: FigmaAPI,
  nodeBefore: Record<string, unknown> | undefined,
  outcome: ToolExecutionOutcome,
  afterError: unknown
): unknown {
  const failure = outcome.primaryError ?? afterError
  if (failure !== undefined) {
    const errorMsg = toolFailureMessage(failure)
    emitToolLog(options, def, args, startTime, figma, nodeBefore, null, errorMsg)
    return { error: errorMsg }
  }

  if (outcome.context.status === 'success' && def.mutates && options.onFlashNodes) {
    const ids = extractNodeIds(outcome.result)
    if (ids.length > 0) options.onFlashNodes(ids)
  }
  emitToolLog(options, def, args, startTime, figma, nodeBefore, outcome.result)
  const budget = options.getStepBudget?.()
  return budget ? appendStepWarning(outcome.result, budget) : outcome.result
}

function toolFailureMessage(failure: unknown): string {
  if (failure instanceof Error) return failure.message
  if (typeof failure === 'string') return failure
  if (typeof failure === 'symbol') return failure.description ?? 'Tool execution failed'
  if (typeof failure === 'function') return failure.name || 'Tool execution failed'
  try {
    return JSON.stringify(failure)
  } catch {
    return 'Tool execution failed'
  }
}

async function executeAdapterTool(
  def: ToolDef,
  options: AIAdapterOptions,
  args: Record<string, unknown>,
  execution?: { abortSignal?: AbortSignal }
): Promise<unknown> {
  const startTime = Date.now()
  const figma = options.getFigma()
  const hostContext = options.getToolContext?.(def, args)
  const signal = execution?.abortSignal ?? hostContext?.signal
  if (signal?.aborted) throw abortError(TOOL_ABORT_MESSAGE)
  const nodeBefore = def.mutates && options.onToolLog ? captureNodeSnapshot(figma, args) : undefined
  const outcome = await executeToolDefinition(def, options, figma, args, hostContext, signal)
  const afterError = await executeAfterHook(def, options, outcome.context)

  // Cancellation may arrive while the after hook is loading fonts or
  // computing layout. Never report that transaction as successful.
  throwIfToolCancelled(signal, outcome.primaryError, afterError)
  return finishToolExecution(def, options, args, startTime, figma, nodeBefore, outcome, afterError)
}

export function toolsToAI(
  tools: ToolDef[],
  options: AIAdapterOptions,
  deps: {
    v: typeof valibot
    valibotSchema: typeof createValibotSchema
    tool: typeof createTool
  }
): ToolSet {
  const { v, valibotSchema, tool } = deps
  const result: ToolSet = {}
  // Vercel AI may execute tool calls from the same model step concurrently.
  // SceneGraph mutations and their host-side after hooks (layout, fonts, undo)
  // form one transaction, so keep them in a single lane. Read-only tools can
  // still run concurrently.
  const mutationKey = options.mutationKey ?? {}

  for (const def of tools) {
    const shape: Record<string, unknown> = {}
    for (const [key, param] of Object.entries(def.params)) {
      shape[key] = paramToValibot(v, param)
    }

    const toolOpts: Record<string, unknown> = {
      description: def.description,
      inputSchema: valibotSchema(v.object(shape as Record<string, never>)),
      execute: (args: Record<string, unknown>, execution?: { abortSignal?: AbortSignal }) => {
        const run = () => executeAdapterTool(def, options, args, execution)

        return def.mutates ? serializeToolMutation(mutationKey, run) : run()
      }
    }

    if (def.name === 'export_image') {
      toolOpts.toModelOutput = ({ output }: { output: unknown }) => {
        if (output && typeof output === 'object' && 'base64' in output && 'mimeType' in output) {
          const r = output as { base64: string; mimeType: string }
          return {
            type: 'content' as const,
            value: [{ type: 'media' as const, mediaType: r.mimeType, data: r.base64 }]
          }
        }
        return { type: 'json' as const, value: output as JsonObject }
      }
    }

    result[def.name] = tool(toolOpts as never)
  }

  return result
}

/**
 * Map from tool arg names to the SceneNode property they affect.
 * Only needed where the arg name differs from the node prop name.
 */
const ARG_TO_NODE_PROP: Record<string, string> = {
  color: 'fills',
  corner_radius: 'cornerRadius',
  font_size: 'fontSize',
  font_weight: 'fontWeight',
  text: 'text',
  visible: 'visible',
  opacity: 'opacity',
  direction: 'layoutMode',
  spacing: 'itemSpacing',
  name: 'name',
  rotation: 'rotation',
  value: 'opacity',
  mode: 'blendMode'
}

/** Args that are parameters to the tool, not node properties to track */
const SKIP_ARGS: Partial<Record<string, Set<string>>> = {
  set_effects: new Set(['type', 'color', 'offset_x', 'offset_y', 'radius', 'spread']),
  set_fill: new Set(['type', 'color']),
  set_stroke: new Set(['type', 'color']),
  set_layout: new Set([
    'align',
    'counter_align',
    'padding',
    'padding_horizontal',
    'padding_vertical'
  ])
}

function detectUnchangedProps(
  toolName: string,
  args: Record<string, unknown>,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  const skipSet = SKIP_ARGS[toolName]
  const unchanged: string[] = []
  for (const [argKey, argVal] of Object.entries(args)) {
    if (argKey === 'id' || argVal === undefined) continue
    if (skipSet?.has(argKey)) continue
    const nodeProp = ARG_TO_NODE_PROP[argKey] ?? argKey
    const beforeVal = before[nodeProp]
    const afterVal = after[nodeProp]
    if (beforeVal !== undefined && afterVal !== undefined) {
      const bStr = JSON.stringify(beforeVal)
      const aStr = JSON.stringify(afterVal)
      if (bStr === aStr) {
        unchanged.push(nodeProp)
      }
    }
  }
  return unchanged
}

export function buildDebugLog(entries: ToolLogEntry[]): ToolDebugLog {
  const callCounts = new Map<
    string,
    { args: Record<string, unknown>; count: number; mutates: boolean }
  >()
  const noopMutations: ToolLogEntry[] = []
  let totalResultBytes = 0

  for (const entry of entries) {
    totalResultBytes += JSON.stringify(entry.result ?? '').length

    const key = `${entry.tool}:${JSON.stringify(entry.args)}`
    const existing = callCounts.get(key)
    if (existing) {
      existing.count++
      if (entry.mutates) entry.isDuplicate = true
    } else {
      callCounts.set(key, { args: entry.args, count: 1, mutates: entry.mutates })
    }

    if (entry.mutates && !entry.error && entry.unchangedProps?.length) {
      noopMutations.push(entry)
    }
  }

  const duplicates: ToolDebugLog['duplicates'] = []
  for (const [key, { args, count, mutates }] of callCounts) {
    if (count > 1 && mutates) {
      const tool = key.split(':')[0]
      duplicates.push({ tool, args, count })
    }
  }

  return { entries, duplicates, noopMutations, totalResultBytes }
}

function paramToValibot(v: typeof valibot, param: ParamDef): unknown {
  const requiredParam = (value: ParamDef): ParamDef => ({
    ...value,
    required: true,
    default: undefined
  })
  const objectSchema = (): unknown => {
    if (!param.properties) return v.record(v.string(), v.unknown())
    const shape: Record<string, unknown> = {}
    for (const [key, property] of Object.entries(param.properties)) {
      shape[key] = paramToValibot(v, property)
    }
    return param.additionalProperties
      ? v.objectWithRest(shape as Record<string, never>, v.unknown())
      : v.strictObject(shape as Record<string, never>)
  }
  const arraySchema = (): unknown => {
    const schema = v.array(
      param.items ? (paramToValibot(v, requiredParam(param.items)) as never) : v.unknown()
    )
    const pipes: unknown[] = [schema]
    if (param.minItems !== undefined) pipes.push(v.minLength(param.minItems))
    if (param.maxItems !== undefined) pipes.push(v.maxLength(param.maxItems))
    return pipes.length > 1 ? v.pipe(...(pipes as [never, never, ...never[]])) : schema
  }
  const typeMap: Record<ParamType, () => unknown> = {
    string: () => (param.enum ? v.picklist(param.enum as [string, ...string[]]) : v.string()),
    number: () => {
      const pipes: unknown[] = [v.number()]
      if (param.min !== undefined) pipes.push(v.minValue(param.min))
      if (param.max !== undefined) pipes.push(v.maxValue(param.max))
      return pipes.length > 1 ? v.pipe(...(pipes as [never, never, ...never[]])) : v.number()
    },
    boolean: () => v.boolean(),
    color: () => v.pipe(v.string(), v.description('Color value (hex like #ff0000 or #ff000080)')),
    'string[]': () => v.pipe(v.array(v.string()), v.minLength(1)),
    object: objectSchema,
    array: arraySchema
  }

  let schema = typeMap[param.type]()

  if (param.description && param.type !== 'color') {
    schema = v.pipe(schema as never, v.description(param.description))
  }

  if (!param.required) {
    schema = v.optional(schema as never, param.default as never)
  }

  return schema
}
