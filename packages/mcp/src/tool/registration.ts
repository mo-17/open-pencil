import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'

import type {
  McpServer,
  StandardSchemaWithJSON,
  ServerContext,
  ServerNotification,
  ToolAnnotations
} from '@modelcontextprotocol/server'
// eslint-disable-next-line open-pencil/no-mixed-case-acronym-identifiers -- Upstream export spelling.
import { toStandardJsonSchema as toStandardJSONSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import type {
  MotionAnimationEncoder,
  MotionExportProgress
} from '@open-pencil/core/io/motion-export'
import { ALL_TOOLS, CODEGEN_PROMPT, isToolExposed } from '@open-pencil/core/tools'

import type { RPCJSONObject } from '#mcp/json'
import {
  discoverFfmpegMotionEncoders,
  encodeMotionPNGSequenceToolResult
} from '#mcp/motion-export/index'
import { MAX_RESULT_BYTES, fail, getDomainFailure, ok, resultTooLargeMessage } from '#mcp/result'
import type { MCPResult } from '#mcp/result'
import { prepareRootScopedRPCRequest, type RootScopedRPCSender } from '#mcp/root-scoped-rpc'
import { createToolDescriptors } from '#mcp/tool/manifest'
import type { ToolDescriptor, ToolEffect, ToolPolicy } from '#mcp/tool/metadata'
import { resolveSafePath, writeToolOutput } from '#mcp/tool/output'
import { isToolEnabled } from '#mcp/tool/policy'
import { SELECTION_SCOPE_FILE_OUTPUT_ERROR } from '#mcp/tool/scope'

export type RPCSender = RootScopedRPCSender

export interface ToolRequestExtra {
  signal?: AbortSignal
  _meta?: { progressToken?: string | number }
  sendNotification?: (notification: ServerNotification) => Promise<void>
}

/** SDK v2 request context is nested; retain the host's bounded request facade. */
export function toolRequestExtra(
  context?: ServerContext | ToolRequestExtra
): ToolRequestExtra | undefined {
  if (!context || !('mcpReq' in context)) return context
  return {
    signal: context.mcpReq.signal,
    _meta: context.mcpReq._meta,
    sendNotification: (notification) => context.mcpReq.notify(notification)
  }
}

function failUnlessAborted(error: unknown, meta?: Record<string, unknown>) {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    if (error instanceof Error) throw error
    const abort = new Error('MCP request cancelled', { cause: error })
    abort.name = 'AbortError'
    throw abort
  }
  return fail(error, meta)
}

function isMotionExportProgress(value: unknown): value is MotionExportProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (
    'phase' in value &&
    typeof value.phase === 'string' &&
    'completed' in value &&
    typeof value.completed === 'number' &&
    'total' in value &&
    typeof value.total === 'number'
  )
}

function motionProgressReporter(
  extra: ToolRequestExtra | undefined
): ((progress: unknown) => void) | undefined {
  const token = extra?._meta?.progressToken
  const sendNotification = extra?.sendNotification
  if (token === undefined || !sendNotification) return undefined
  return (value) => {
    if (!isMotionExportProgress(value)) return
    void sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken: token,
        progress: value.completed,
        total: value.total,
        message: `Motion export ${value.phase}`
      }
    }).catch(() => undefined)
  }
}

const automationTargetSchema = {
  document_id: v.optional(
    v.pipe(v.string(), v.description('Optional OpenPencil document/tab ID to target'))
  ),
  page_id: v.optional(
    v.pipe(v.string(), v.description('Optional page ID to target within the document'))
  )
}

// ToolDef outputs are intentionally heterogeneous today. Advertising an open
// object still lets the SDK validate that every successful call supplies
// structuredContent without pretending that a narrower per-tool contract exists.
const toolOutputSchema = toStandardJSONSchema(v.looseObject({}))

function splitAutomationTarget(args: Record<string, unknown>): {
  target: { document_id?: string; page_id?: string }
  args: Record<string, unknown>
} {
  const { document_id, page_id, ...rest } = args
  const target: { document_id?: string; page_id?: string } = {}
  if (typeof document_id === 'string') target.document_id = document_id
  if (typeof page_id === 'string') target.page_id = page_id
  return { target, args: rest }
}

type RPCResponse = {
  ok?: boolean
  result?: unknown
  target?: unknown
  error?: string
}

async function sendCommand(
  sendRPC: RPCSender,
  command: string,
  args: Record<string, unknown>
): Promise<RPCResponse> {
  const res = (await sendRPC({ command, args })) as RPCResponse
  if (res.ok === false) throw new Error(res.error)
  return res
}

function withTarget<T extends object>(body: T, res: RPCResponse): T & { target?: unknown } {
  return res.target ? { ...body, target: res.target } : body
}

/** Who sends a session's tool calls: any MCP client, or an ACP or Pi harness chat in the app. */
export const MCP_AGENT_KINDS = ['mcp', 'acp', 'harness'] as const
export type MCPAgentKind = (typeof MCP_AGENT_KINDS)[number]

/** The session tool calls come from, so the app can show the client as an agent at work. */
export interface MCPAgentSession {
  id: string
  kind: MCPAgentKind
}

export interface RegisterToolsOptions {
  policy: ToolPolicy
  mcpRoot?: string | null
  sendRPC: RPCSender
  agentSession?: MCPAgentSession
}

interface PreparedMotionToolCall {
  readonly args: Record<string, unknown>
  readonly encoder?: MotionAnimationEncoder
}

async function prepareMotionToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<PreparedMotionToolCall> {
  if (toolName !== 'export_motion_animation' || (args.format !== 'webm' && args.format !== 'mp4')) {
    return { args }
  }
  const format = args.format
  const ffmpeg = await discoverFfmpegMotionEncoders()
  const encoder = ffmpeg.encoders.find((candidate) => candidate.format === format)
  if (!encoder) {
    throw new Error(
      `Motion export format "${format}" is unavailable: ${
        ffmpeg.reason ?? `FFmpeg does not list a ${format} encoder`
      }`
    )
  }
  return { args: { ...args, format: 'png-sequence' }, encoder }
}

interface CompleteToolCallOptions {
  toolName: string
  requestedPath: string | null
  resolvedRoot: string | null
  prepared: PreparedMotionToolCall
  response: unknown
  signal?: AbortSignal
  onProgress?: (progress: unknown) => void
  target: { document_id?: string; page_id?: string }
  startedAt: number
  requestBytes: number
}

interface RPCToolResponse {
  ok?: boolean
  result?: unknown
  error?: string
  meta?: Record<string, unknown>
  target?: Record<string, unknown>
}

function stringifyJSON(value: unknown): string | undefined {
  return JSON.stringify(value)
}

function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(stringifyJSON(value) ?? '', 'utf8')
  } catch {
    return 0
  }
}

function callMeta(
  options: CompleteToolCallOptions,
  response: RPCToolResponse,
  result: unknown
): Record<string, unknown> {
  return {
    openpencil: {
      tool: options.toolName,
      durationMs: Date.now() - options.startedAt,
      requestBytes: options.requestBytes,
      resultBytes: jsonBytes(result),
      requestedTarget: options.target,
      ...(response.target ? { resolvedTarget: response.target } : {}),
      ...(response.meta ? { mutation: response.meta } : {})
    }
  }
}

function attachMeta(result: MCPResult, meta: Record<string, unknown>): MCPResult {
  return { ...result, _meta: { ...result._meta, ...meta } }
}

function imageToolResult(toolName: string, result: RPCJSONObject): MCPResult | undefined {
  if (!('base64' in result) || !('mimeType' in result)) return undefined
  const base64 = String(result.base64)
  const bytes = Buffer.byteLength(base64, 'utf8')
  if (bytes > MAX_RESULT_BYTES) {
    return fail(
      new Error(
        resultTooLargeMessage(
          `Image from "${toolName}"`,
          bytes,
          'Export a smaller region or lower the scale/resolution.'
        )
      )
    )
  }
  return {
    content: [
      {
        type: 'image',
        data: base64,
        mimeType: result.mimeType as string
      }
    ],
    structuredContent: {
      mimeType: result.mimeType,
      byteLength: Buffer.byteLength(base64, 'base64')
    }
  }
}

async function completeToolCall(options: CompleteToolCallOptions): Promise<MCPResult> {
  const { toolName, requestedPath, resolvedRoot, prepared, signal, onProgress } = options
  const response = options.response as RPCToolResponse
  if (response.ok === false) {
    return fail(
      response.error ?? 'OpenPencil RPC failed',
      callMeta(options, response, response.result)
    )
  }
  const domainFailure = getDomainFailure(response.result)
  if (domainFailure) {
    return fail(domainFailure.error, callMeta(options, response, response.result))
  }

  const result = prepared.encoder
    ? ((await encodeMotionPNGSequenceToolResult(
        response.result,
        prepared.encoder,
        signal,
        onProgress
      )) as RPCJSONObject)
    : (response.result as RPCJSONObject | undefined)
  const meta = callMeta(options, response, result)
  if (result && requestedPath && resolvedRoot) {
    const written = await writeToolOutput(toolName, result, requestedPath, resolvedRoot, signal)
    if (written) return attachMeta(written, meta)
  }
  const image = result && imageToolResult(toolName, result)
  return image ? attachMeta(image, meta) : ok(result, toolName, meta)
}

function toolAnnotations(effect: ToolEffect): ToolAnnotations {
  return {
    readOnlyHint: effect === 'read',
    destructiveHint: effect === 'write'
  }
}

function descriptorByName(descriptors: readonly ToolDescriptor[]): Map<string, ToolDescriptor> {
  return new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]))
}

export function registerTools(mcpServer: McpServer, options: RegisterToolsOptions): void {
  const { policy, sendRPC, agentSession } = options
  // Sent with each tool call: the session, and the client's name once it has introduced itself.
  const agent = () =>
    agentSession
      ? {
          session: agentSession.id,
          kind: agentSession.kind,
          client: mcpServer.server.getClientVersion()?.name
        }
      : undefined
  const resolvedRoot = options.mcpRoot ? resolve(options.mcpRoot) : null
  const descriptors = descriptorByName(createToolDescriptors(resolvedRoot !== null))
  const register = <Args>(
    name: string,
    toolOptions: {
      description?: string
      inputSchema: v.GenericSchema<unknown, Args>
      outputSchema?: typeof toolOutputSchema
    },
    handler: (args: Args, extra?: ToolRequestExtra) => MCPResult | Promise<MCPResult>
  ) => {
    const descriptor = descriptors.get(name)
    if (!descriptor) throw new Error(`Missing MCP tool descriptor for "${name}"`)
    if (!isToolEnabled(descriptor, policy)) return
    mcpServer.registerTool<typeof toolOutputSchema, StandardSchemaWithJSON<unknown, Args>>(
      name,
      {
        description: toolOptions.description ?? descriptor.description,
        inputSchema: toStandardJSONSchema(toolOptions.inputSchema),
        outputSchema: toolOutputSchema,
        annotations: toolAnnotations(descriptor.effect),
        _meta: { 'openpencil/capabilities': descriptor.capabilities }
      },
      (args, context) => handler(args, toolRequestExtra(context))
    )
  }

  for (const def of ALL_TOOLS) {
    if (!isToolExposed(def, 'mcp')) continue
    register(
      def.name,
      {
        description: def.description,
        inputSchema: v.strictObject({
          ...def.input.entries,
          ...automationTargetSchema
        })
      },
      async (args: Record<string, unknown>, extra?: ToolRequestExtra) => {
        const startedAt = Date.now()
        let requestBytes = jsonBytes(args)
        let target: { document_id?: string; page_id?: string } = {}
        try {
          const split = splitAutomationTarget(args)
          target = split.target
          const toolArgs = split.args
          if (policy.scope === 'selection' && toolArgs.path !== undefined)
            return fail(new Error(SELECTION_SCOPE_FILE_OUTPUT_ERROR))
          const requestedPath = typeof toolArgs.path === 'string' ? toolArgs.path : null
          if (def.name === 'export_motion_animation' && requestedPath && !resolvedRoot) {
            return fail(
              new Error(
                'export_motion_animation requires OPENPENCIL_MCP_ROOT so output can be written safely'
              )
            )
          }
          const prepared = await prepareMotionToolCall(def.name, toolArgs)
          requestBytes = jsonBytes({ target, args: prepared.args })
          const onProgress =
            def.name === 'export_motion_animation' ? motionProgressReporter(extra) : undefined
          const result = await sendRPC(
            {
              command: 'tool',
              args: {
                ...target,
                name: def.name,
                args: prepared.args,
                agent: agent(),
                ...(policy.scope === 'selection' ? { scope: policy.scope } : {})
              }
            },
            { signal: extra?.signal, onProgress }
          )
          return await completeToolCall({
            toolName: def.name,
            requestedPath,
            resolvedRoot,
            prepared,
            response: result,
            signal: extra?.signal,
            onProgress,
            target,
            startedAt,
            requestBytes
          })
        } catch (e) {
          return failUnlessAborted(e, {
            openpencil: {
              tool: def.name,
              durationMs: Date.now() - startedAt,
              requestBytes,
              requestedTarget: target
            }
          })
        }
      }
    )
  }

  register(
    'list_documents',
    {
      description:
        'List open OpenPencil documents/tabs with their IDs, file paths, current pages, and pages.',
      inputSchema: v.strictObject({})
    },
    async (_args: Record<string, never>, extra?: ToolRequestExtra) => {
      try {
        const result = await sendRPC(
          { command: 'list_documents', args: {} },
          { signal: extra?.signal }
        )
        const res = result as {
          ok?: boolean
          result?: unknown
          error?: string
        }
        if (res.ok === false) return fail(res.error ?? 'OpenPencil RPC failed')
        return ok(res.result ?? {})
      } catch (e) {
        return failUnlessAborted(e)
      }
    }
  )

  register(
    'save_file',
    {
      description: resolvedRoot
        ? 'Save the current document to disk. If path is provided, it must be inside the configured MCP root.'
        : 'Save the current document to disk. Uses the existing file path if available, otherwise prompts for a location.',
      inputSchema: resolvedRoot
        ? v.strictObject({
            path: v.optional(
              v.pipe(
                v.string(),
                v.minLength(1),
                v.description('Path for the .fig file, absolute or relative to the MCP root')
              )
            ),
            ...automationTargetSchema
          })
        : v.strictObject({ ...automationTargetSchema })
    },
    async (
      args: { path?: string; document_id?: string; page_id?: string },
      extra?: ToolRequestExtra
    ) => {
      try {
        const { target } = splitAutomationTarget(args)
        const preparedSave = await prepareRootScopedRPCRequest(
          {
            command: 'save_file',
            args: {
              ...target,
              ...(args.path === undefined ? {} : { path: args.path })
            }
          },
          resolvedRoot,
          sendRPC,
          { signal: extra?.signal },
          { markPathlessSaveForRevalidation: true }
        )
        const result = await sendRPC(preparedSave.body, {
          signal: extra?.signal
        })
        const res = result as {
          ok?: boolean
          result?: unknown
          target?: unknown
          error?: string
        }
        if (res.ok === false) return fail(res.error ?? 'OpenPencil RPC failed')
        const response: { saved: true; path?: string; target?: unknown } = {
          saved: true
        }
        if (preparedSave.safePath) response.path = preparedSave.safePath.resolved
        if (res.target) response.target = res.target
        return ok(response)
      } catch (e) {
        return failUnlessAborted(e)
      }
    }
  )

  if (resolvedRoot) {
    register(
      'open_file',
      {
        description: 'Open a .fig or .pen file from inside the configured MCP root.',
        inputSchema: v.strictObject({
          path: v.pipe(
            v.string(),
            v.minLength(1),
            v.description('Path to the design file, absolute or relative to the MCP root')
          ),
          ...automationTargetSchema
        }),
        outputSchema: toolOutputSchema
      },
      async (
        args: { path: string; document_id?: string; page_id?: string },
        extra?: ToolRequestExtra
      ) => {
        try {
          const safe = await resolveSafePath(args.path, resolvedRoot)
          const { target } = splitAutomationTarget(args)
          const result = await sendRPC(
            {
              command: 'open_file',
              args: { ...target, path: safe.realPath }
            },
            { signal: extra?.signal }
          )
          const res = result as {
            ok?: boolean
            result?: unknown
            target?: unknown
            error?: string
          }
          if (res.ok === false) return fail(res.error ?? 'OpenPencil RPC failed')
          const response: { opened: true; target?: unknown } = { opened: true }
          if (res.target) response.target = res.target
          return ok(response)
        } catch (e) {
          return failUnlessAborted(e)
        }
      }
    )

    register(
      'new_document',
      {
        description:
          'Create a new empty document with an optional save path inside the configured MCP root.',
        inputSchema: v.strictObject({
          path: v.optional(
            v.pipe(
              v.string(),
              v.minLength(1),
              v.description('Path for the new file, absolute or relative to the MCP root')
            )
          ),
          ...automationTargetSchema
        }),
        outputSchema: toolOutputSchema
      },
      async (
        args: { path?: string; document_id?: string; page_id?: string },
        extra?: ToolRequestExtra
      ) => {
        try {
          const safePath =
            args.path !== undefined ? await resolveSafePath(args.path, resolvedRoot) : undefined
          const { target } = splitAutomationTarget(args)
          const result = await sendRPC(
            {
              command: 'new_document',
              args: { ...target, path: safePath?.realPath }
            },
            { signal: extra?.signal }
          )
          const res = result as {
            ok?: boolean
            result?: unknown
            target?: unknown
            error?: string
          }
          if (res.ok === false) return fail(res.error ?? 'OpenPencil RPC failed')
          const response: { created: true; target?: unknown } = {
            created: true
          }
          if (res.target) response.target = res.target
          return ok(response)
        } catch (e) {
          return failUnlessAborted(e)
        }
      }
    )
  }

  const closeEntries = {
    unsaved: v.optional(
      v.pipe(
        v.picklist(['error', 'save', 'discard']),
        v.description(
          'What to do with unsaved changes: "error" (default) fails, "save" saves first, "discard" drops them'
        )
      )
    ),
    ...automationTargetSchema
  }

  register(
    'close_file',
    {
      inputSchema: resolvedRoot
        ? v.strictObject({
            ...closeEntries,
            path: v.optional(
              v.pipe(
                v.string(),
                v.minLength(1),
                v.description(
                  'With unsaved "save": .fig path for a document never saved, inside the MCP root'
                )
              )
            )
          })
        : v.strictObject(closeEntries)
    },
    async (args: {
      unsaved?: 'error' | 'save' | 'discard'
      path?: string
      document_id?: string
      page_id?: string
    }) => {
      try {
        const safePath =
          args.path !== undefined && resolvedRoot
            ? await resolveSafePath(args.path, resolvedRoot)
            : undefined
        const { target } = splitAutomationTarget(args)
        const rpcArgs: Record<string, unknown> = { ...target }
        if (args.unsaved) rpcArgs.unsaved = args.unsaved
        if (safePath) rpcArgs.path = safePath.realPath
        const res = await sendCommand(sendRPC, 'close_file', rpcArgs)
        const closed = (res.result as { closed?: boolean } | undefined)?.closed === true
        return ok(withTarget({ closed }, res))
      } catch (e) {
        return fail(e)
      }
    }
  )

  register(
    'activate_document',
    {
      inputSchema: v.strictObject({
        document_id: v.pipe(v.string(), v.description('Document/tab ID from list_documents')),
        page_id: automationTargetSchema.page_id
      })
    },
    async (args: { document_id: string; page_id?: string }) => {
      try {
        const { target } = splitAutomationTarget(args)
        const res = await sendCommand(sendRPC, 'activate_document', target)
        return ok(withTarget({ activated: true }, res))
      } catch (e) {
        return fail(e)
      }
    }
  )

  for (const command of ['undo', 'redo'] as const) {
    register(
      command,
      { inputSchema: v.strictObject({ ...automationTargetSchema }) },
      async (args) => {
        try {
          const { target } = splitAutomationTarget(args)
          const res = await sendCommand(sendRPC, command, target)
          return ok(withTarget({ ...(res.result as RPCJSONObject | undefined) }, res))
        } catch (e) {
          return fail(e)
        }
      }
    )
  }

  register('get_settings', { inputSchema: v.strictObject({}) }, async () => {
    try {
      const res = await sendCommand(sendRPC, 'get_settings', {})
      return ok(res.result ?? {})
    } catch (e) {
      return fail(e)
    }
  })

  register(
    'update_settings',
    {
      inputSchema: v.strictObject({
        settings: v.pipe(
          v.record(v.string(), v.unknown()),
          v.description(
            'Partial settings, e.g. {"appearance":{"theme":"light"},"editing":{"snapping":{"pixelGrid":false}}}. Unknown keys and invalid values are rejected.'
          )
        )
      })
    },
    async (args: { settings: Record<string, unknown> }) => {
      try {
        // Echo only the applied patch: with get_settings disabled, writing must not read.
        await sendCommand(sendRPC, 'update_settings', {
          settings: args.settings
        })
        return ok({ updated: args.settings })
      } catch (e) {
        return fail(e)
      }
    }
  )

  register(
    'get_codegen_prompt',
    {
      description:
        'Get design-to-code generation guidelines. Call before generating frontend code.',
      inputSchema: v.strictObject({})
    },
    async () => ok({ prompt: CODEGEN_PROMPT })
  )
}
