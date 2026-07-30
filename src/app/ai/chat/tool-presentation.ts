import { INTERRUPTED_TOOL_ERROR } from '@/app/ai/chat/interruption'

type ToolPartLike = {
  state: string
  output?: unknown
  errorText?: unknown
}

export type ToolPresentationState = 'pending' | 'done' | 'error' | 'cancelled' | 'denied'

type UnknownRecord = Record<string, unknown>

const outputErrorCache = new WeakMap<object, string | null>()

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function normalizeObjectError(value: object): string | null {
  const record = asRecord(value)
  if (record && typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim()
  }
  try {
    const text = JSON.stringify(value, null, 2)
    return text === '{}' || text === '[]' ? null : text
  } catch {
    return 'Tool call failed'
  }
}

function normalizeError(value: unknown): string | null {
  if (value === null || value === undefined || value === false || value === 0) return null
  if (typeof value === 'string') return value.trim() || null
  if (value instanceof Error) return value.message.trim() || value.name
  if (typeof value === 'object') return normalizeObjectError(value)
  if (value === true) return 'Tool call failed'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'symbol') return value.description?.trim() || 'Tool call failed'
  if (typeof value === 'function') return value.name || 'Tool call failed'
  return 'Tool call failed'
}

function errorFromJsonText(value: string): string | null {
  const text = value.trim()
  if (!text.startsWith('{') || !text.endsWith('}')) return null
  try {
    const record = asRecord(JSON.parse(text))
    if (!record) return null
    return (
      normalizeError(record.error) ||
      (record.ok === false ? normalizeError(record.message) || 'Tool call failed' : null)
    )
  } catch {
    return null
  }
}

function errorFromMcpResult(value: UnknownRecord): string | null {
  const directError = normalizeError(value.error)
  if (directError) return directError

  const structuredContent = asRecord(value.structuredContent)
  if (structuredContent) {
    const structuredError = normalizeError(structuredContent.error)
    if (structuredError) return structuredError
  }

  const textItems = Array.isArray(value.content)
    ? value.content
        .map(asRecord)
        .filter((item): item is UnknownRecord => item !== null)
        .filter((item) => item.type === 'text' && typeof item.text === 'string')
    : []

  for (const item of textItems) {
    const jsonError = errorFromJsonText(item.text as string)
    if (jsonError) return jsonError
  }

  if (value.ok === false) return normalizeError(value.message) || 'Tool call failed'
  if (value.isError === true) {
    for (const item of textItems) {
      const text = normalizeError(item.text)
      if (text) return text
    }
    return 'Tool call failed'
  }

  return null
}

export function toolOutputErrorText(output: unknown): string | null {
  const record = asRecord(output)
  if (!record) return null
  if (outputErrorCache.has(record)) return outputErrorCache.get(record) ?? null

  const result = asRecord(record.result)
  const error = errorFromMcpResult(record) || (result ? errorFromMcpResult(result) : null)
  outputErrorCache.set(record, error)
  return error
}

export function toolErrorText(part: ToolPartLike): string | null {
  if (part.state === 'output-error') return normalizeError(part.errorText) || 'Tool call failed'
  if (part.state === 'output-available') return toolOutputErrorText(part.output)
  return null
}

export function hasErrorOutput(part: ToolPartLike): boolean {
  return part.state === 'output-available' && toolErrorText(part) !== null
}

export function toolState(part: ToolPartLike): ToolPresentationState {
  if (part.state === 'output-denied') return 'denied'
  const error = toolErrorText(part)
  if (error === INTERRUPTED_TOOL_ERROR) return 'cancelled'
  if (error !== null) return 'error'
  if (part.state === 'output-available') return 'done'
  return 'pending'
}
