import type { SessionUpdate, ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'

import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export interface MapResult {
  chunks: UIMessageChunk[]
  textStarted: boolean
}

interface AccumulatedToolCall {
  toolCallId: string
  title?: string | null
  kind?: ToolCall['kind'] | null
  status?: ToolCall['status'] | null
  rawInput?: unknown
  rawOutput?: unknown
  content?: JSONObject[]
  hidden: boolean
  started: boolean
  inputEmitted: boolean
  terminalEmitted: boolean
}

export interface ACPUpdateMapper {
  map: (update: SessionUpdate) => UIMessageChunk[]
  interrupt: (errorText: string) => UIMessageChunk[]
  finish: () => UIMessageChunk[]
}

interface ToolErrorEnvelope {
  error?: unknown
  message?: unknown
  type?: unknown
  text?: unknown
  content?: unknown
  result?: unknown
  data?: unknown
  cause?: unknown
}

function isToolErrorEnvelope(value: unknown): value is ToolErrorEnvelope {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorTextFromString(value: string, depth: number): string | undefined {
  const text = value.trim()
  if (!text) return undefined
  const looksLikeJSON =
    (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))
  if (!looksLikeJSON) return text
  try {
    return errorTextFromUnknown(JSON.parse(text), depth + 1) ?? text
  } catch {
    return text
  }
}

function errorTextFromItems(items: unknown[], depth: number): string | undefined {
  for (const item of items) {
    const text = errorTextFromUnknown(item, depth + 1)
    if (text) return text
  }
  return undefined
}

function errorTextFromEnvelope(record: ToolErrorEnvelope, depth: number): string | undefined {
  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim()
  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim()
  if (record.type === 'text' && typeof record.text === 'string') {
    return errorTextFromUnknown(record.text, depth + 1)
  }
  for (const nested of [record.content, record.result, record.data, record.cause]) {
    const text = errorTextFromUnknown(nested, depth + 1)
    if (text) return text
  }
  return undefined
}

function errorTextFromUnknown(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value === null || value === undefined) return undefined
  if (typeof value === 'string') return errorTextFromString(value, depth)
  if (Array.isArray(value)) return errorTextFromItems(value, depth)
  if (isToolErrorEnvelope(value)) return errorTextFromEnvelope(value, depth)
  return undefined
}

function toolErrorText(update: { content?: unknown; rawOutput?: unknown }): string {
  const content = Array.isArray(update.content) ? (update.content as JSONObject[]) : undefined
  return errorTextFromUnknown(update.rawOutput) ?? textFromContent(content) ?? 'Tool call failed'
}

function terminalToolChunk(update: ToolCall | ToolCallUpdate): UIMessageChunk | undefined {
  if (update.status === 'completed') {
    return {
      type: 'tool-output-available',
      toolCallId: update.toolCallId,
      output: update.rawOutput ?? textFromContent(update.content ?? undefined),
      providerExecuted: true
    }
  }
  if (update.status === 'failed') {
    return {
      type: 'tool-output-error',
      toolCallId: update.toolCallId,
      errorText: toolErrorText(update),
      providerExecuted: true
    }
  }
  return undefined
}

export function mapUpdate(
  update: SessionUpdate,
  textId: string,
  textStarted: boolean,
  reasoningId = `reasoning-${textId}`
): MapResult {
  const chunks: UIMessageChunk[] = []

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      if (update.content.type === 'text' && update.content.text) {
        if (!textStarted) {
          chunks.push({ type: 'text-start', id: textId })
          textStarted = true
        }
        chunks.push({
          type: 'text-delta',
          id: textId,
          delta: update.content.text
        })
      } else if (update.content.type !== 'text') {
        console.warn('[ACP] Unhandled content type:', update.content.type)
      }
      break
    }
    case 'agent_thought_chunk': {
      if (update.content.type === 'text' && update.content.text.trim()) {
        chunks.push({ type: 'reasoning-start', id: reasoningId })
        chunks.push({
          type: 'reasoning-delta',
          id: reasoningId,
          delta: update.content.text
        })
        chunks.push({ type: 'reasoning-end', id: reasoningId })
      }
      break
    }
    case 'tool_call': {
      if (!update.title) {
        console.warn('[ACP] Tool call without title:', update.toolCallId)
      }
      const toolName = update.title || 'unknown'
      chunks.push({
        type: 'tool-input-start',
        toolCallId: update.toolCallId,
        toolName,
        providerExecuted: true,
        title: update.title
      })
      if (update.rawInput) {
        chunks.push({
          type: 'tool-input-available',
          toolCallId: update.toolCallId,
          toolName,
          input: update.rawInput,
          providerExecuted: true,
          title: update.title
        })
      }
      const terminalChunk = terminalToolChunk(update)
      if (terminalChunk) chunks.push(terminalChunk)
      break
    }
    case 'tool_call_update': {
      const terminalChunk = terminalToolChunk(update)
      if (terminalChunk) chunks.push(terminalChunk)
      break
    }
  }

  return { chunks, textStarted }
}

function updatePhase(update: SessionUpdate): string | undefined {
  const metadata = (
    update as SessionUpdate & {
      _meta?: { codex?: { phase?: unknown } }
    }
  )._meta
  return typeof metadata?.codex?.phase === 'string' ? metadata.codex.phase : undefined
}

function isInternalGuardian(update: ToolCall | ToolCallUpdate): boolean {
  return (
    update.toolCallId.startsWith('guardian_assessment:') ||
    ('title' in update && update.title === 'Guardian Review' && update.kind === 'think')
  )
}

function mergeToolCall(state: AccumulatedToolCall, update: ToolCall | ToolCallUpdate): void {
  if (update.title !== undefined) state.title = update.title
  if (update.kind !== undefined) state.kind = update.kind
  if (update.status !== undefined) {
    if (update.status !== state.status) state.terminalEmitted = false
    state.status = update.status
  }
  if (update.rawInput !== undefined) {
    state.rawInput = update.rawInput
    state.inputEmitted = false
    state.terminalEmitted = false
  }
  if (update.rawOutput !== undefined) {
    state.rawOutput = update.rawOutput
    state.terminalEmitted = false
  }
  if (update.content !== undefined) {
    state.content = update.content as JSONObject[]
    state.terminalEmitted = false
  }
  state.hidden ||= isInternalGuardian(update)
}

function toolName(state: AccumulatedToolCall): string {
  return state.title || 'unknown'
}

function emitToolStart(state: AccumulatedToolCall, chunks: UIMessageChunk[]): void {
  if (state.started) return
  state.started = true
  chunks.push({
    type: 'tool-input-start',
    toolCallId: state.toolCallId,
    toolName: toolName(state),
    providerExecuted: true,
    title: state.title ?? undefined
  })
}

function emitToolInput(state: AccumulatedToolCall, chunks: UIMessageChunk[]): void {
  if (state.inputEmitted || state.rawInput === undefined) return
  state.inputEmitted = true
  chunks.push({
    type: 'tool-input-available',
    toolCallId: state.toolCallId,
    toolName: toolName(state),
    input: state.rawInput,
    providerExecuted: true,
    title: state.title ?? undefined
  })
}

function emitToolTerminal(state: AccumulatedToolCall, chunks: UIMessageChunk[]): void {
  if (state.terminalEmitted || (state.status !== 'completed' && state.status !== 'failed')) return
  state.terminalEmitted = true
  if (state.status === 'completed') {
    chunks.push({
      type: 'tool-output-available',
      toolCallId: state.toolCallId,
      output: state.rawOutput ?? textFromContent(state.content),
      providerExecuted: true
    })
  } else {
    chunks.push({
      type: 'tool-output-error',
      toolCallId: state.toolCallId,
      errorText: toolErrorText(state),
      providerExecuted: true
    })
  }
}

/**
 * Stateful ACP mapper used for a complete prompt stream. It preserves the
 * chronological text/tool order, accumulates partial tool updates, and hides
 * Codex's internal Guardian approval records from the user-facing tool list.
 */
export function createACPUpdateMapper(baseId: string): ACPUpdateMapper {
  const tools = new Map<string, AccumulatedToolCall>()
  let textId: string | null = null
  let textStarted = false
  let textSegment = 0
  let reasoningSegment = 0
  let reasoningId: string | null = null
  let phase: string | undefined

  function closeText(chunks: UIMessageChunk[]): void {
    if (!textStarted || !textId) return
    chunks.push({ type: 'text-end', id: textId })
    textStarted = false
    textId = null
    phase = undefined
  }

  function closeReasoning(chunks: UIMessageChunk[]): void {
    if (!reasoningId) return
    chunks.push({ type: 'reasoning-end', id: reasoningId })
    reasoningId = null
  }

  function mapMessage(update: SessionUpdate): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    closeReasoning(chunks)
    const nextPhase = updatePhase(update)
    if (textStarted && nextPhase !== phase && (nextPhase !== undefined || phase !== undefined)) {
      closeText(chunks)
    }
    if (!textId) textId = `${baseId}-text-${textSegment++}`
    if (!textStarted) phase = nextPhase
    const result = mapUpdate(update, textId, textStarted)
    textStarted = result.textStarted
    chunks.push(...result.chunks)
    return chunks
  }

  function mapTool(update: ToolCall | ToolCallUpdate): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    const toolChunks: UIMessageChunk[] = []
    const existing = tools.get(update.toolCallId)
    const state =
      existing ??
      ({
        toolCallId: update.toolCallId,
        hidden: isInternalGuardian(update),
        started: false,
        inputEmitted: false,
        terminalEmitted: false
      } satisfies AccumulatedToolCall)
    mergeToolCall(state, update)
    tools.set(update.toolCallId, state)
    if (state.hidden) return chunks

    emitToolStart(state, toolChunks)
    emitToolInput(state, toolChunks)
    emitToolTerminal(state, toolChunks)
    if (toolChunks.length > 0) {
      closeReasoning(chunks)
      closeText(chunks)
    }
    chunks.push(...toolChunks)
    return chunks
  }

  return {
    map(update: SessionUpdate): UIMessageChunk[] {
      if (update.sessionUpdate === 'agent_message_chunk') return mapMessage(update)
      if (update.sessionUpdate === 'agent_thought_chunk') {
        if (update.content.type !== 'text' || !update.content.text.trim()) return []
        const chunks: UIMessageChunk[] = []
        closeText(chunks)
        if (!reasoningId) {
          reasoningId = `${baseId}-reasoning-${reasoningSegment++}`
          chunks.push({ type: 'reasoning-start', id: reasoningId })
        }
        chunks.push({
          type: 'reasoning-delta',
          id: reasoningId,
          delta: update.content.text
        })
        return chunks
      }
      if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
        return mapTool(update)
      }
      return []
    },
    interrupt(errorText: string): UIMessageChunk[] {
      const chunks: UIMessageChunk[] = []
      closeReasoning(chunks)
      closeText(chunks)
      for (const state of tools.values()) {
        if (state.hidden || !state.started || state.terminalEmitted) continue
        state.terminalEmitted = true
        chunks.push({
          type: 'tool-output-error',
          toolCallId: state.toolCallId,
          errorText,
          providerExecuted: true
        })
      }
      return chunks
    },
    finish(): UIMessageChunk[] {
      const chunks: UIMessageChunk[] = []
      closeReasoning(chunks)
      closeText(chunks)
      tools.clear()
      return chunks
    }
  }
}

export function textFromContent(content: JSONObject[] | undefined): string | undefined {
  if (!content) return undefined
  const parts: string[] = []
  for (const c of content) {
    if (c.type !== 'content') continue
    const inner = c.content as JSONObject | undefined
    if (inner?.type === 'text' && typeof inner.text === 'string') {
      parts.push(inner.text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}
