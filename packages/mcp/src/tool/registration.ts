import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type {
  MotionAnimationEncoder,
  MotionExportProgress
} from '@open-pencil/core/io/motion-export'
import { ALL_TOOLS, CODEGEN_PROMPT } from '@open-pencil/core/tools'

import type { RpcJsonObject } from '#mcp/json'
import {
  discoverFfmpegMotionEncoders,
  encodeMotionPngSequenceToolResult
} from '#mcp/motion-export/index'
import { MAX_RESULT_BYTES, fail, ok, resultTooLargeMessage } from '#mcp/result'
import { resolveSafePath, writeToolOutput } from '#mcp/tool/output'
import { paramToZod } from '#mcp/tool/schema'

export type RpcSender = (
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal; onProgress?: (progress: unknown) => void }
) => Promise<unknown>

export interface ToolRequestExtra {
  signal?: AbortSignal
  _meta?: { progressToken?: string | number }
  sendNotification?: (notification: Record<string, unknown>) => Promise<void>
}

function failUnlessAborted(error: unknown) {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    if (error instanceof Error) throw error
    const abort = new Error('MCP request cancelled', { cause: error })
    abort.name = 'AbortError'
    throw abort
  }
  return fail(error)
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
  enableEval: boolean
  mcpRoot?: string | null
  sendRpc: RpcSender
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

export function registerTools(mcpServer: McpServer, options: RegisterToolsOptions) {
  const { enableEval, sendRpc } = options
  const resolvedRoot = options.mcpRoot ? resolve(options.mcpRoot) : null
  const register = mcpServer.registerTool.bind(mcpServer) as (...a: unknown[]) => void

  for (const def of ALL_TOOLS) {
    if (!enableEval && def.name === 'eval') continue
    const shape: Record<string, z.ZodType> = {}
    for (const [key, param] of Object.entries(def.params)) {
      shape[key] = paramToZod(param)
    }
    register(
      def.name,
      {
        description: def.description,
        inputSchema: z.object({ ...shape, ...automationTargetSchema })
      },
      async (args: Record<string, unknown>, extra?: ToolRequestExtra) => {
        try {
          const { target, args: toolArgs } = splitAutomationTarget(args)
          const requestedPath = typeof toolArgs.path === 'string' ? toolArgs.path : null
          if (def.name === 'export_motion_animation' && requestedPath && !resolvedRoot) {
            return fail(
              new Error(
                'export_motion_animation requires OPENPENCIL_MCP_ROOT so output can be written safely'
              )
            )
          }
          const prepared = await prepareMotionToolCall(def.name, toolArgs)
          const onProgress =
            def.name === 'export_motion_animation' ? motionProgressReporter(extra) : undefined
          const result = await sendRpc(
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
          const res = result as { ok?: boolean; result?: unknown; error?: string }
          if (res.ok === false) return fail(new Error(res.error))
          const r = prepared.encoder
            ? ((await encodeMotionPngSequenceToolResult(
                res.result,
                prepared.encoder,
                extra?.signal,
                onProgress
              )) as RpcJsonObject)
            : (res.result as RpcJsonObject | undefined)
          const filePath = requestedPath
          if (r && filePath && resolvedRoot) {
            const written = await writeToolOutput(
              def.name,
              r,
              filePath,
              resolvedRoot,
              extra?.signal
            )
            if (written) return written
          }
          if (r && 'base64' in r && 'mimeType' in r) {
            const base64 = String(r.base64)
            const bytes = Buffer.byteLength(base64, 'utf8')
            if (bytes > MAX_RESULT_BYTES) {
              return fail(
                new Error(
                  resultTooLargeMessage(
                    `Image from "${def.name}"`,
                    bytes,
                    'Export a smaller region or lower the scale/resolution.'
                  )
                )
              )
            }
            return {
              content: [
                {
                  type: 'image' as const,
                  data: base64,
                  mimeType: r.mimeType as string
                }
              ]
            }
          }
          return ok(r, def.name)
        } catch (e) {
          return failUnlessAborted(e)
        }
      }
    )
  }

  register(
    'list_documents',
    {
      description:
        'List open OpenPencil documents/tabs with their IDs, file paths, current pages, and pages.',
      inputSchema: z.object({})
    },
    async (_args: Record<string, never>, extra?: ToolRequestExtra) => {
      try {
        const result = await sendRpc(
          { command: 'list_documents', args: {} },
          { signal: extra?.signal }
        )
        const res = result as { ok?: boolean; result?: unknown; error?: string }
        if (res.ok === false) return fail(new Error(res.error))
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
        ? `Save the current document to disk. If path is provided, it must be inside ${resolvedRoot}.`
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
        : z.object({ ...automationTargetSchema })
    },
    async (
      args: { path?: string; document_id?: string; page_id?: string },
      extra?: ToolRequestExtra
    ) => {
      try {
        const safePath =
          args.path !== undefined && resolvedRoot
            ? await resolveSafePath(args.path, resolvedRoot)
            : undefined
        const { target } = splitAutomationTarget(args)
        const result = await sendRpc(
          {
            command: 'save_file',
            args: { ...target, path: safePath?.realPath }
          },
          { signal: extra?.signal }
        )
        const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
        if (res.ok === false) return fail(new Error(res.error))
        return ok({
          saved: true,
          ...(safePath ? { path: safePath.resolved } : {}),
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
        description: `Open a .fig or .pen file from disk into a new tab. Path must be inside ${resolvedRoot}.`,
        inputSchema: z.object({
          path: z
            .string()
            .min(1)
            .describe('Path to the design file, absolute or relative to the MCP root'),
          ...automationTargetSchema
        })
      },
      async (
        args: { path: string; document_id?: string; page_id?: string },
        extra?: ToolRequestExtra
      ) => {
        try {
          const safe = await resolveSafePath(args.path, resolvedRoot)
          const { target } = splitAutomationTarget(args)
          const result = await sendRpc(
            {
              command: 'open_file',
              args: { ...target, path: safe.realPath }
            },
            { signal: extra?.signal }
          )
          const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
          if (res.ok === false) return fail(new Error(res.error))
          return ok({ opened: true, ...(res.target ? { target: res.target } : {}) })
        } catch (e) {
          return failUnlessAborted(e)
        }
      }
    )

    register(
      'new_document',
      {
        description: `Create a new empty document. Optionally set a save path inside ${resolvedRoot}.`,
        inputSchema: z.object({
          path: z
            .string()
            .min(1)
            .describe('Path for the new file, absolute or relative to the MCP root')
            .optional(),
          ...automationTargetSchema
        })
      },
      async (
        args: { path?: string; document_id?: string; page_id?: string },
        extra?: ToolRequestExtra
      ) => {
        try {
          const safePath =
            args.path !== undefined ? await resolveSafePath(args.path, resolvedRoot) : undefined
          const { target } = splitAutomationTarget(args)
          const result = await sendRpc(
            {
              command: 'new_document',
              args: { ...target, path: safePath?.realPath }
            },
            { signal: extra?.signal }
          )
          const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
          if (res.ok === false) return fail(new Error(res.error))
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
      inputSchema: z.object({})
    },
    async () => ok({ prompt: CODEGEN_PROMPT })
  )
}
