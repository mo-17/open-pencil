import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'

import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerNotification, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import type {
  MotionAnimationEncoder,
  MotionExportProgress
} from '@open-pencil/core/io/motion-export'
import { ALL_TOOLS, CODEGEN_PROMPT } from '@open-pencil/core/tools'

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
import { paramToZod } from '#mcp/tool/schema'

export type RPCSender = RootScopedRPCSender

export interface ToolRequestExtra {
  signal?: AbortSignal
  _meta?: { progressToken?: string | number }
  sendNotification?: (notification: ServerNotification) => Promise<void>
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
  document_id: z.string().describe('Optional OpenPencil document/tab ID to target').optional(),
  page_id: z.string().describe('Optional page ID to target within the document').optional()
}

// ToolDef outputs are intentionally heterogeneous today. Advertising an open
// object still lets the SDK validate that every successful call supplies
// structuredContent without pretending that a narrower per-tool contract exists.
const toolOutputSchema = z.looseObject({})

function splitAutomationTarget(args: Record<string, unknown>): {
  target: { document_id?: string; page_id?: string }
  args: Record<string, unknown>
} {
  const { document_id, page_id, ...rest } = args
  return {
    target: {
      ...(typeof document_id === 'string' ? { document_id } : {}),
      ...(typeof page_id === 'string' ? { page_id } : {})
    },
    args: rest
  }
}

export interface RegisterToolsOptions {
  policy: ToolPolicy
  mcpRoot?: string | null
  sendRPC: RPCSender
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
  const { policy, sendRPC } = options
  const resolvedRoot = options.mcpRoot ? resolve(options.mcpRoot) : null
  const descriptors = descriptorByName(createToolDescriptors(resolvedRoot !== null))
  const register = <InputArgs extends z.ZodObject>(
    name: string,
    toolOptions: {
      description: string
      inputSchema: InputArgs
      outputSchema?: typeof toolOutputSchema
    },
    handler: ToolCallback<InputArgs>
  ) => {
    const descriptor = descriptors.get(name)
    if (!descriptor) throw new Error(`Missing MCP tool descriptor for "${name}"`)
    if (!isToolEnabled(descriptor, policy)) return
    mcpServer.registerTool(
      name,
      {
        ...toolOptions,
        annotations: toolAnnotations(descriptor.effect),
        _meta: { 'openpencil/capabilities': descriptor.capabilities }
      },
      handler
    )
  }

  for (const def of ALL_TOOLS) {
    const shape: Record<string, z.ZodType> = {}
    for (const [key, param] of Object.entries(def.params)) {
      shape[key] = paramToZod(param)
    }
    register(
      def.name,
      {
        description: def.description,
        inputSchema: z.object({ ...shape, ...automationTargetSchema }),
        outputSchema: toolOutputSchema
      },
      async (args: Record<string, unknown>, extra?: ToolRequestExtra) => {
        const startedAt = Date.now()
        let requestBytes = jsonBytes(args)
        let target: { document_id?: string; page_id?: string } = {}
        try {
          const split = splitAutomationTarget(args)
          target = split.target
          const toolArgs = split.args
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
                args: prepared.args
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
      inputSchema: z.object({}),
      outputSchema: toolOutputSchema
    },
    async (_args: Record<string, never>, extra?: ToolRequestExtra) => {
      try {
        const result = await sendRPC(
          { command: 'list_documents', args: {} },
          { signal: extra?.signal }
        )
        const res = result as { ok?: boolean; result?: unknown; error?: string }
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
        ? z.object({
            path: z
              .string()
              .min(1)
              .describe('Path for the .fig file, absolute or relative to the MCP root')
              .optional(),
            ...automationTargetSchema
          })
        : z.object({ ...automationTargetSchema }),
      outputSchema: toolOutputSchema
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
            args: { ...target, ...(args.path === undefined ? {} : { path: args.path }) }
          },
          resolvedRoot,
          sendRPC,
          { signal: extra?.signal },
          { markPathlessSaveForRevalidation: true }
        )
        const result = await sendRPC(preparedSave.body, { signal: extra?.signal })
        const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
        if (res.ok === false) return fail(res.error ?? 'OpenPencil RPC failed')
        return ok({
          saved: true,
          ...(preparedSave.safePath ? { path: preparedSave.safePath.resolved } : {}),
          ...(res.target ? { target: res.target } : {})
        })
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
        inputSchema: z.object({
          path: z
            .string()
            .min(1)
            .describe('Path to the design file, absolute or relative to the MCP root'),
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
          const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
          if (res.ok === false) return fail(res.error ?? 'OpenPencil RPC failed')
          return ok({ opened: true, ...(res.target ? { target: res.target } : {}) })
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
        inputSchema: z.object({
          path: z
            .string()
            .min(1)
            .describe('Path for the new file, absolute or relative to the MCP root')
            .optional(),
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
          const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
          if (res.ok === false) return fail(res.error ?? 'OpenPencil RPC failed')
          return ok({ created: true, ...(res.target ? { target: res.target } : {}) })
        } catch (e) {
          return failUnlessAborted(e)
        }
      }
    )
  }

  register(
    'get_codegen_prompt',
    {
      description:
        'Get design-to-code generation guidelines. Call before generating frontend code.',
      inputSchema: z.object({}),
      outputSchema: toolOutputSchema
    },
    async () => ok({ prompt: CODEGEN_PROMPT })
  )
}
