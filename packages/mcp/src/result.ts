import { Buffer } from 'node:buffer'

export type MCPContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export type MCPResult = {
  content: MCPContent[]
  /** Machine-readable result for MCP clients that support structured tool output. */
  structuredContent?: Record<string, unknown>
  /** Request-scoped diagnostics that should not be copied into model-visible text. */
  _meta?: Record<string, unknown>
  isError?: boolean
}

export const MAX_RESULT_BYTES = 900_000

export function resultTooLargeMessage(kind: string, bytes: number, hint: string): string {
  return `${kind} is too large (${Math.round(bytes / 1024)}KB, limit ${Math.round(
    MAX_RESULT_BYTES / 1024
  )}KB). ${hint}`
}

function normalizedData(data: unknown): unknown {
  return data === undefined ? null : data
}

function stringifyJson(value: unknown): string | undefined {
  return JSON.stringify(value)
}

function isStructuredContent(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStructuredContent(data: unknown): Record<string, unknown> {
  const normalized = normalizedData(data)
  return isStructuredContent(normalized) ? normalized : { result: normalized }
}

export function ok(data: unknown, toolName?: string, meta?: Record<string, unknown>): MCPResult {
  const normalized = normalizedData(data)
  let text: string
  try {
    // Keep text for older MCP clients, but avoid duplicating pretty-print whitespace now
    // that capable clients can consume structuredContent directly.
    text = JSON.stringify(normalized)
  } catch (error) {
    return fail(
      new Error(`${toolName ? `Result from "${toolName}"` : 'Result'} is not JSON-serializable`, {
        cause: error
      })
    )
  }
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > MAX_RESULT_BYTES) {
    return fail(
      new Error(
        resultTooLargeMessage(
          toolName ? `Result from "${toolName}"` : 'Result',
          bytes,
          'Narrow the request with depth/root_id/node_types, get_node, or find_nodes.'
        )
      )
    )
  }
  return {
    content: [{ type: 'text', text }],
    structuredContent: toStructuredContent(normalized),
    ...(meta ? { _meta: meta } : {})
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  try {
    return stringifyJson(error) ?? String(error)
  } catch {
    return String(error)
  }
}

export function fail(e: unknown, meta?: Record<string, unknown>): MCPResult {
  const msg = errorMessage(e)
  const error = { error: msg }
  return {
    content: [{ type: 'text', text: JSON.stringify(error) }],
    structuredContent: error,
    ...(meta ? { _meta: meta } : {}),
    isError: true
  }
}

export interface DomainFailure {
  error: unknown
}

/** Detect the two failure envelopes currently returned by core tools. */
export function getDomainFailure(value: unknown): DomainFailure | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result = value as { ok?: unknown; error?: unknown }
  if (result.ok === false) {
    return { error: result.error ?? 'Tool execution failed' }
  }
  if (Object.hasOwn(result, 'error') && result.error !== undefined && result.error !== null) {
    return { error: result.error }
  }
  return undefined
}
