export const PREVIEW_FRAME_PROTOCOL = 'open-pencil-preview-v2'
export type PreviewFrameTransport = 'window' | 'message-port'

export const PREVIEW_MESSAGE_LIMITS = Object.freeze({
  channelLength: 128,
  nodeIdLength: 512,
  routeLength: 2048,
  stateNameLength: 128,
  stateStringLength: 65_536,
  stateValues: 4096,
  motionEntries: 256,
  motionTimingFields: 64,
  runtimeErrorLength: 2_048,
  messageBytes: 256 * 1024
})

const EDITOR_SOURCE = 'op-lowcode-editor'
const PREVIEW_SOURCE = 'op-lowcode-preview'

interface PreviewSelectMessage {
  source: typeof PREVIEW_SOURCE
  channel: string
  type: 'select'
  id: string
}

interface PreviewNavigateMessage {
  source: typeof PREVIEW_SOURCE
  channel: string
  type: 'navigate'
  route: string
}

interface PreviewDocStateMessage {
  source: typeof PREVIEW_SOURCE
  channel: string
  type: 'docState'
  name: string
  value: unknown
}

interface PreviewMotionDebugMessage {
  source: typeof PREVIEW_SOURCE
  channel: string
  type: 'motionDebug'
  status: 'ready' | 'unavailable' | 'error'
  snapshot?: unknown
  error?: string
}

interface PreviewReadyMessage {
  source: typeof PREVIEW_SOURCE
  channel: string
  type: 'ready'
}

interface PreviewRuntimeErrorMessage {
  source: typeof PREVIEW_SOURCE
  channel: string
  type: 'runtimeError'
  message: string
}

export type PreviewInboundMessage =
  | PreviewSelectMessage
  | PreviewNavigateMessage
  | PreviewDocStateMessage
  | PreviewMotionDebugMessage
  | PreviewReadyMessage
  | PreviewRuntimeErrorMessage

export type PreviewEditorPayload =
  | { type: 'select'; id: string | null }
  | { type: 'navigate'; route: string }
  | { type: 'theme'; theme: 'light' | 'dark' }
  | { type: 'motionDebug'; enabled: boolean }
  | { type: 'docState'; name: string; value: unknown }

export type PreviewEditorMessage = PreviewEditorPayload & {
  source: typeof EDITOR_SOURCE
  channel: string
}

interface FrameBootContext {
  protocol: typeof PREVIEW_FRAME_PROTOCOL
  channel: string
  parentOrigin: string
  transport: PreviewFrameTransport
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  const prototype = typeof value === 'object' && value ? Object.getPrototypeOf(value) : undefined
  return !Array.isArray(value) && (prototype === Object.prototype || prototype === null)
}

function readDataProperties(value: Record<string, unknown>): Record<string, unknown> | null {
  if (Object.getOwnPropertySymbols(value).length > 0) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const result: Record<string, unknown> = Object.create(null)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
    result[key] = descriptor.value
  }
  return result
}

function readDenseArray(value: unknown[]): unknown[] | null {
  if (
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length
  ) {
    return null
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.keys(descriptors).length !== value.length + 1) return null
  const result: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index)
    if (!Object.hasOwn(descriptors, key)) return null
    const descriptor = descriptors[key]
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
    result.push(descriptor.value)
  }
  return result
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

export function isPreviewChannelId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= PREVIEW_MESSAGE_LIMITS.channelLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  )
}

function isCanonicalOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value === 'null') return false
  // Tauri uses a closed app-owned custom protocol on macOS/iOS. The WHATWG
  // URL serializer reports custom-scheme origins as `null`, so admit only
  // this exact authority rather than weakening the general origin check.
  if (value === 'tauri://localhost') return true
  try {
    const parsed = new URL(value)
    return parsed.origin === value && parsed.username === '' && parsed.password === ''
  } catch {
    return false
  }
}

function hasASCIIControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export function serializePreviewFrameName(
  channel: string,
  parentOrigin: string,
  transport?: PreviewFrameTransport
): string
export function serializePreviewFrameName(
  channel: string,
  parentOrigin: string,
  transport: unknown = 'window'
): string {
  if (!isPreviewChannelId(channel)) throw new Error('Invalid preview channel id')
  if (!isCanonicalOrigin(parentOrigin)) throw new Error('Invalid preview parent origin')
  if (transport !== 'window' && transport !== 'message-port') {
    throw new Error('Invalid preview frame transport')
  }
  const context: FrameBootContext = {
    protocol: PREVIEW_FRAME_PROTOCOL,
    channel,
    parentOrigin,
    transport
  }
  return JSON.stringify(context)
}

function isRoute(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PREVIEW_MESSAGE_LIMITS.routeLength &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !hasASCIIControl(value)
  )
}

function isNodeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PREVIEW_MESSAGE_LIMITS.nodeIdLength &&
    !hasASCIIControl(value)
  )
}

function isStateName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PREVIEW_MESSAGE_LIMITS.stateNameLength &&
    !hasASCIIControl(value)
  )
}

function estimatePortableValue(value: unknown): number | null {
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  let values = 0
  let bytes = 0
  while (pending.length > 0) {
    const current = pending.pop()
    values += 1
    if (values > PREVIEW_MESSAGE_LIMITS.stateValues) return null
    if (current === null || typeof current === 'boolean') {
      bytes += 8
    } else if (typeof current === 'number' && Number.isFinite(current)) {
      bytes += 8
    } else if (typeof current === 'string') {
      if (current.length > PREVIEW_MESSAGE_LIMITS.stateStringLength) return null
      bytes += current.length * 2
    } else {
      if (typeof current !== 'object') return null
      if (!Array.isArray(current) && !isPlainRecord(current)) return null
      if (seen.has(current)) return null
      seen.add(current)
      if (Array.isArray(current)) {
        const values = readDenseArray(current)
        if (!values) return null
        bytes += values.length * 8
        pending.push(...values)
      } else {
        const data = readDataProperties(current)
        if (!data) return null
        for (const [key, child] of Object.entries(data)) {
          if (key.length > PREVIEW_MESSAGE_LIMITS.stateNameLength) return null
          bytes += key.length * 2 + 8
          pending.push(child)
        }
      }
    }
    if (bytes > PREVIEW_MESSAGE_LIMITS.messageBytes) return null
  }
  return bytes
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isMotionEntry(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  const entry = readDataProperties(value)
  if (!entry || Object.keys(entry).length > 32) return false
  for (const [key, field] of Object.entries(entry)) {
    if (key.length > PREVIEW_MESSAGE_LIMITS.stateNameLength) return false
    if (
      key === 'timing' &&
      isPlainRecord(field) &&
      Object.keys(field).length > PREVIEW_MESSAGE_LIMITS.motionTimingFields
    ) {
      return false
    }
  }
  return true
}

function isMotionSnapshot(value: unknown): boolean {
  if (value === undefined) return true
  if (!isPlainRecord(value)) return false
  const data = readDataProperties(value)
  if (!data || !hasExactKeys(data, ['capturedAt', 'activeAnimationCount', 'entries'])) return false
  if (!isNullableFiniteNumber(data.capturedAt)) return false
  if (!isNullableFiniteNumber(data.activeAnimationCount)) return false
  if (!Array.isArray(data.entries)) return false
  const entries = readDenseArray(data.entries)
  return (
    entries !== null &&
    entries.length <= PREVIEW_MESSAGE_LIMITS.motionEntries &&
    entries.every(isMotionEntry) &&
    estimatePortableValue(data) !== null
  )
}

function parsePreviewRecord(value: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return null
  return readDataProperties(value)
}

function parseSelectMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewSelectMessage | null {
  if (!hasExactKeys(data, ['source', 'channel', 'type', 'id']) || !isNodeId(data.id)) return null
  return { source: PREVIEW_SOURCE, channel, type: 'select', id: data.id }
}

function parseNavigateMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewNavigateMessage | null {
  if (!hasExactKeys(data, ['source', 'channel', 'type', 'route']) || !isRoute(data.route)) {
    return null
  }
  return { source: PREVIEW_SOURCE, channel, type: 'navigate', route: data.route }
}

function parseDocStateMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewDocStateMessage | null {
  if (
    !hasExactKeys(data, ['source', 'channel', 'type', 'name', 'value']) ||
    !isStateName(data.name) ||
    estimatePortableValue(data.value) === null
  ) {
    return null
  }
  return { source: PREVIEW_SOURCE, channel, type: 'docState', name: data.name, value: data.value }
}

function motionMessageWithinLimit(
  channel: string,
  snapshot: unknown,
  error: string | undefined
): boolean {
  const snapshotBytes = snapshot === undefined ? 0 : estimatePortableValue(snapshot)
  return (
    snapshotBytes !== null &&
    snapshotBytes + (error?.length ?? 0) * 2 + channel.length * 2 + 512 <=
      PREVIEW_MESSAGE_LIMITS.messageBytes
  )
}

function parseReadyMotionMessage(
  channel: string,
  snapshot: unknown,
  error: unknown
): PreviewMotionDebugMessage | null {
  if (snapshot === undefined || error !== undefined || !isMotionSnapshot(snapshot)) return null
  if (!motionMessageWithinLimit(channel, snapshot, undefined)) return null
  return { source: PREVIEW_SOURCE, channel, type: 'motionDebug', status: 'ready', snapshot }
}

function parseUnavailableMotionMessage(
  channel: string,
  snapshot: unknown,
  error: unknown
): PreviewMotionDebugMessage | null {
  if (snapshot !== undefined || error !== undefined) return null
  return { source: PREVIEW_SOURCE, channel, type: 'motionDebug', status: 'unavailable' }
}

function parseErrorMotionMessage(
  channel: string,
  snapshot: unknown,
  error: unknown
): PreviewMotionDebugMessage | null {
  if (
    snapshot !== undefined ||
    typeof error !== 'string' ||
    error.length === 0 ||
    error.length > PREVIEW_MESSAGE_LIMITS.stateStringLength ||
    !motionMessageWithinLimit(channel, undefined, error)
  ) {
    return null
  }
  return { source: PREVIEW_SOURCE, channel, type: 'motionDebug', status: 'error', error }
}

function parseMotionDebugMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewMotionDebugMessage | null {
  if (!hasExactKeys(data, ['source', 'channel', 'type', 'status', 'snapshot', 'error'])) {
    return null
  }
  const status = data.status
  const error = data.error
  const snapshot = data.snapshot
  if (status === 'ready') return parseReadyMotionMessage(channel, snapshot, error)
  if (status === 'unavailable') return parseUnavailableMotionMessage(channel, snapshot, error)
  if (status === 'error') return parseErrorMotionMessage(channel, snapshot, error)
  return null
}

function parseReadyMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewReadyMessage | null {
  if (!hasExactKeys(data, ['source', 'channel', 'type'])) return null
  return { source: PREVIEW_SOURCE, channel, type: 'ready' }
}

function parseRuntimeErrorMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewRuntimeErrorMessage | null {
  if (
    !hasExactKeys(data, ['source', 'channel', 'type', 'message']) ||
    typeof data.message !== 'string' ||
    data.message.length === 0 ||
    data.message.length > PREVIEW_MESSAGE_LIMITS.runtimeErrorLength
  ) {
    return null
  }
  return { source: PREVIEW_SOURCE, channel, type: 'runtimeError', message: data.message }
}

export function parsePreviewInboundMessage(
  value: unknown,
  expectedChannel: string
): PreviewInboundMessage | null {
  if (!isPreviewChannelId(expectedChannel)) return null
  const data = parsePreviewRecord(value)
  if (!data || data.source !== PREVIEW_SOURCE || data.channel !== expectedChannel) {
    return null
  }
  if (data.type === 'select') return parseSelectMessage(data, expectedChannel)
  if (data.type === 'navigate') return parseNavigateMessage(data, expectedChannel)
  if (data.type === 'docState') return parseDocStateMessage(data, expectedChannel)
  if (data.type === 'motionDebug') return parseMotionDebugMessage(data, expectedChannel)
  if (data.type === 'ready') return parseReadyMessage(data, expectedChannel)
  if (data.type === 'runtimeError') return parseRuntimeErrorMessage(data, expectedChannel)
  return null
}

export function parsePreviewMessageEvent(
  event: Pick<MessageEvent, 'data' | 'origin' | 'source'>,
  expectedSource: MessageEventSource,
  expectedOrigin: string,
  expectedChannel: string
): PreviewInboundMessage | null {
  if (event.source !== expectedSource || event.origin !== expectedOrigin) return null
  return parsePreviewInboundMessage(event.data, expectedChannel)
}

function createEditorSelectMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewEditorMessage | null {
  if (!hasExactKeys(data, ['type', 'id'])) return null
  if (data.id !== null && !isNodeId(data.id)) return null
  return { source: EDITOR_SOURCE, channel, type: 'select', id: data.id }
}

function createEditorNavigateMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewEditorMessage | null {
  if (!hasExactKeys(data, ['type', 'route']) || !isRoute(data.route)) return null
  return { source: EDITOR_SOURCE, channel, type: 'navigate', route: data.route }
}

function createEditorThemeMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewEditorMessage | null {
  if (!hasExactKeys(data, ['type', 'theme'])) return null
  if (data.theme !== 'light' && data.theme !== 'dark') return null
  return { source: EDITOR_SOURCE, channel, type: 'theme', theme: data.theme }
}

function createEditorMotionMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewEditorMessage | null {
  if (!hasExactKeys(data, ['type', 'enabled']) || typeof data.enabled !== 'boolean') return null
  return { source: EDITOR_SOURCE, channel, type: 'motionDebug', enabled: data.enabled }
}

function createEditorDocStateMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewEditorMessage | null {
  if (!hasExactKeys(data, ['type', 'name', 'value']) || !isStateName(data.name)) return null
  const valueBytes = estimatePortableValue(data.value)
  if (
    valueBytes === null ||
    valueBytes + data.name.length * 2 + channel.length * 2 + 256 >
      PREVIEW_MESSAGE_LIMITS.messageBytes
  ) {
    return null
  }
  return {
    source: EDITOR_SOURCE,
    channel,
    type: 'docState',
    name: data.name,
    value: data.value
  }
}

export function createPreviewEditorMessage(
  channel: string,
  payload: unknown
): PreviewEditorMessage | null {
  if (!isPreviewChannelId(channel)) return null
  const data = parsePreviewRecord(payload)
  if (!data) return null
  if (data.type === 'select') return createEditorSelectMessage(data, channel)
  if (data.type === 'navigate') return createEditorNavigateMessage(data, channel)
  if (data.type === 'theme') return createEditorThemeMessage(data, channel)
  if (data.type === 'motionDebug') return createEditorMotionMessage(data, channel)
  if (data.type === 'docState') return createEditorDocStateMessage(data, channel)
  return null
}
