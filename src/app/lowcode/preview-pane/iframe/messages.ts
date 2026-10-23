/* oxlint-disable eslint/max-lines -- Preview protocol parsers intentionally share one exact-shape boundary. */
import * as v from 'valibot'

import type { Vector } from '@open-pencil/scene-graph/primitives'

export const PREVIEW_FRAME_PROTOCOL = 'open-pencil-preview-v2'
export type PreviewFrameTransport = 'window' | 'message-port'
export const PREVIEW_WEBDRIVER_AUTOMATION_STORAGE_KEY = 'open-pencil:webdriver-preview-automation'

export const PREVIEW_MESSAGE_LIMITS = Object.freeze({
  channelLength: 128,
  nodeIdLength: 512,
  routeLength: 2048,
  stateNameLength: 128,
  stateStringLength: 65_536,
  stateValues: 4096,
  motionEntries: 256,
  motionTimingFields: 64,
  adaptationItems: 128,
  runtimeErrorLength: 2_048,
  automationRequestIdLength: 128,
  automationLocatorLength: 512,
  automationInputLength: 4_096,
  automationTextLength: 8_192,
  automationTimeoutMs: 15_000,
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

export interface PreviewPageSessionEntry {
  pageId: string
  pathname: string
  search: string
  values: Record<string, unknown>
  scroll: Vector
}

export interface PreviewPageSessionSnapshot {
  version: 1
  entries: PreviewPageSessionEntry[]
}

interface PreviewPageSessionMessage {
  source: typeof PREVIEW_SOURCE
  channel: string
  type: 'pageSession'
  snapshot: PreviewPageSessionSnapshot
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

export type PreviewTextScale = 1 | 1.3 | 1.6 | 2
export type PreviewAdaptationDiagnosticKind =
  | 'horizontal-overflow'
  | 'text-clipping'
  | 'fixed-height-risk'

export interface PreviewAdaptationDiagnosticItem {
  nodeId: string
  kind: PreviewAdaptationDiagnosticKind
}

export interface PreviewAdaptationMessage {
  source: typeof PREVIEW_SOURCE
  channel: string
  type: 'adaptation'
  revision: number
  items: PreviewAdaptationDiagnosticItem[]
  truncated: boolean
}

export type PreviewAutomationLocator = 'testId' | 'buttonText' | 'placeholder' | 'body'
export type PreviewAutomationAction = 'click' | 'set' | 'wait' | 'read-safe-text'
export type PreviewAutomationStatus =
  | 'clicked'
  | 'set'
  | 'matched'
  | 'read'
  | 'rejected'
  | 'timeout'
export type PreviewAutomationError =
  | 'ambiguous-target'
  | 'forbidden-target'
  | 'invalid-request'
  | 'not-found'
  | 'not-visible'
  | 'operation-failed'
  | 'scan-limit'
  | null

interface PreviewAutomationResultMessage {
  source: typeof PREVIEW_SOURCE
  channel: string
  type: 'automationResult'
  requestId: string
  ok: boolean
  status: PreviewAutomationStatus
  text: string | null
  error: PreviewAutomationError
}

export type PreviewInboundMessage =
  | PreviewSelectMessage
  | PreviewNavigateMessage
  | PreviewDocStateMessage
  | PreviewPageSessionMessage
  | PreviewMotionDebugMessage
  | PreviewReadyMessage
  | PreviewRuntimeErrorMessage
  | PreviewAdaptationMessage
  | PreviewAutomationResultMessage

export type PreviewAutomationPayload =
  | {
      type: 'automation'
      requestId: string
      action: 'click'
      by: Exclude<PreviewAutomationLocator, 'body' | 'placeholder'>
      locator: string
    }
  | {
      type: 'automation'
      requestId: string
      action: 'set'
      by: Extract<PreviewAutomationLocator, 'testId' | 'placeholder'>
      locator: string
      value: string
    }
  | {
      type: 'automation'
      requestId: string
      action: 'wait'
      by: PreviewAutomationLocator
      locator: string
      text: string | null
      timeoutMs: number
    }
  | {
      type: 'automation'
      requestId: string
      action: 'read-safe-text'
      by: PreviewAutomationLocator
      locator: string
    }

export type PreviewEditorPayload =
  | { type: 'textEdit'; command: 'selectAll' | 'undo' | 'redo' }
  | { type: 'select'; id: string | null }
  | { type: 'navigate'; route: string; replace?: boolean }
  | { type: 'theme'; theme: 'light' | 'dark' }
  | { type: 'motionDebug'; enabled: boolean }
  | { type: 'docState'; name: string; value: unknown }
  | { type: 'pageSession'; snapshot: PreviewPageSessionSnapshot }
  | { type: 'adaptation'; revision: number; textScale: PreviewTextScale; diagnostics: boolean }
  | PreviewAutomationPayload

export type PreviewEditorMessage = PreviewEditorPayload & {
  source: typeof EDITOR_SOURCE
  channel: string
}

interface FrameBootContext {
  protocol: typeof PREVIEW_FRAME_PROTOCOL
  channel: string
  parentOrigin: string
  transport: PreviewFrameTransport
  automation?: true
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
  transport?: PreviewFrameTransport,
  automation?: boolean
): string
export function serializePreviewFrameName(
  channel: string,
  parentOrigin: string,
  transport: unknown = 'window',
  automation: unknown = false
): string {
  if (!isPreviewChannelId(channel)) throw new Error('Invalid preview channel id')
  if (!isCanonicalOrigin(parentOrigin)) throw new Error('Invalid preview parent origin')
  if (transport !== 'window' && transport !== 'message-port') {
    throw new Error('Invalid preview frame transport')
  }
  if (typeof automation !== 'boolean') throw new Error('Invalid preview automation capability')
  const context: FrameBootContext = {
    protocol: PREVIEW_FRAME_PROTOCOL,
    channel,
    parentOrigin,
    transport,
    ...(automation ? { automation: true } : {})
  }
  return JSON.stringify(context)
}

function isAutomationRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= PREVIEW_MESSAGE_LIMITS.automationRequestIdLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  )
}

function isAutomationLocator(value: unknown): value is PreviewAutomationLocator {
  return value === 'testId' || value === 'buttonText' || value === 'placeholder' || value === 'body'
}

function isBoundedAutomationText(
  value: unknown,
  maximum: number,
  allowEmpty = false
): value is string {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximum &&
    !hasASCIIControl(value)
  )
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

const pageSessionEntrySchema = v.strictObject({
  pageId: v.pipe(
    v.string(),
    v.check((value: string) => isNodeId(value))
  ),
  pathname: v.pipe(
    v.string(),
    v.check((value) => isRoute(value) && !/[?#]/.test(value))
  ),
  search: v.pipe(
    v.string(),
    v.maxLength(PREVIEW_MESSAGE_LIMITS.routeLength),
    v.check(
      (value) =>
        (!value || value.startsWith('?')) && !value.includes('#') && !hasASCIIControl(value)
    )
  ),
  values: v.record(
    v.pipe(
      v.string(),
      v.check((value: string) => isStateName(value))
    ),
    v.unknown()
  ),
  scroll: v.strictObject({
    x: v.pipe(v.number(), v.finite(), v.minValue(0)),
    y: v.pipe(v.number(), v.finite(), v.minValue(0))
  })
})

const pageSessionSnapshotSchema = v.strictObject({
  version: v.literal(1),
  entries: v.pipe(v.array(pageSessionEntrySchema), v.maxLength(64))
})

/** Data-only preflight precedes schema access, including nested descriptors. */
export function parsePreviewPageSessionSnapshot(value: unknown): PreviewPageSessionSnapshot | null {
  const bytes = estimatePortableValue(value)
  if (bytes === null || bytes + 1024 > PREVIEW_MESSAGE_LIMITS.messageBytes) return null
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength + 1024 >
    PREVIEW_MESSAGE_LIMITS.messageBytes
  )
    return null
  const parsed = v.safeParse(pageSessionSnapshotSchema, value)
  if (!parsed.success) return null
  const keys = new Set<string>()
  for (const entry of parsed.output.entries) {
    if (entry.pathname.length + entry.search.length > PREVIEW_MESSAGE_LIMITS.routeLength)
      return null
    const key = JSON.stringify([entry.pageId, entry.pathname, entry.search])
    if (keys.has(key)) return null
    keys.add(key)
  }
  return structuredClone(parsed.output)
}

function parsePageSessionMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewPageSessionMessage | null {
  if (!hasExactKeys(data, ['source', 'channel', 'type', 'snapshot'])) return null
  const snapshot = parsePreviewPageSessionSnapshot(data.snapshot)
  return snapshot ? { source: PREVIEW_SOURCE, channel, type: 'pageSession', snapshot } : null
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

function isAdaptationRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPreviewTextScale(value: unknown): value is PreviewTextScale {
  return value === 1 || value === 1.3 || value === 1.6 || value === 2
}

function isAdaptationDiagnosticKind(value: unknown): value is PreviewAdaptationDiagnosticKind {
  return (
    value === 'horizontal-overflow' || value === 'text-clipping' || value === 'fixed-height-risk'
  )
}

function isAdaptationNodeId(value: unknown): value is string {
  if (!isNodeId(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0x80 && code <= 0x9f) return false
  }
  return true
}

function parseAdaptationItems(value: unknown): PreviewAdaptationDiagnosticItem[] | null {
  if (!Array.isArray(value) || value.length > PREVIEW_MESSAGE_LIMITS.adaptationItems) return null
  const entries = readDenseArray(value)
  if (!entries) return null
  const items: PreviewAdaptationDiagnosticItem[] = []
  for (const entry of entries) {
    const data = parsePreviewRecord(entry)
    if (
      !data ||
      !hasExactKeys(data, ['nodeId', 'kind']) ||
      !isAdaptationNodeId(data.nodeId) ||
      !isAdaptationDiagnosticKind(data.kind)
    ) {
      return null
    }
    items.push({ nodeId: data.nodeId, kind: data.kind })
  }
  return items
}

function parseAdaptationMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewAdaptationMessage | null {
  if (
    !hasExactKeys(data, ['source', 'channel', 'type', 'revision', 'items', 'truncated']) ||
    !isAdaptationRevision(data.revision) ||
    typeof data.truncated !== 'boolean'
  ) {
    return null
  }
  const items = parseAdaptationItems(data.items)
  if (!items) return null
  return {
    source: PREVIEW_SOURCE,
    channel,
    type: 'adaptation',
    revision: data.revision,
    items,
    truncated: data.truncated
  }
}

function isAutomationStatus(value: unknown): value is PreviewAutomationStatus {
  return (
    value === 'clicked' ||
    value === 'set' ||
    value === 'matched' ||
    value === 'read' ||
    value === 'rejected' ||
    value === 'timeout'
  )
}

function isAutomationError(value: unknown): value is PreviewAutomationError {
  return (
    value === null ||
    value === 'ambiguous-target' ||
    value === 'forbidden-target' ||
    value === 'invalid-request' ||
    value === 'not-found' ||
    value === 'not-visible' ||
    value === 'operation-failed' ||
    value === 'scan-limit'
  )
}

const SUCCESSFUL_AUTOMATION_STATUSES = new Set<PreviewAutomationStatus>([
  'clicked',
  'set',
  'matched',
  'read'
])

function validAutomationResultState(
  ok: boolean,
  status: PreviewAutomationStatus,
  text: string | null,
  error: PreviewAutomationError
): boolean {
  if (SUCCESSFUL_AUTOMATION_STATUSES.has(status)) {
    if (!ok || error !== null) return false
    return status === 'read' ? text !== null : text === null
  }
  return !ok && error !== null && text === null
}

function parseAutomationResultMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewAutomationResultMessage | null {
  if (
    !hasExactKeys(data, [
      'source',
      'channel',
      'type',
      'requestId',
      'ok',
      'status',
      'text',
      'error'
    ]) ||
    !isAutomationRequestId(data.requestId) ||
    typeof data.ok !== 'boolean' ||
    !isAutomationStatus(data.status) ||
    (data.text !== null &&
      !isBoundedAutomationText(data.text, PREVIEW_MESSAGE_LIMITS.automationTextLength, true)) ||
    !isAutomationError(data.error)
  ) {
    return null
  }
  if (!validAutomationResultState(data.ok, data.status, data.text, data.error)) {
    return null
  }
  return {
    source: PREVIEW_SOURCE,
    channel,
    type: 'automationResult',
    requestId: data.requestId,
    ok: data.ok,
    status: data.status,
    text: data.text,
    error: data.error
  }
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
  if (data.type === 'pageSession') return parsePageSessionMessage(data, expectedChannel)
  if (data.type === 'motionDebug') return parseMotionDebugMessage(data, expectedChannel)
  if (data.type === 'ready') return parseReadyMessage(data, expectedChannel)
  if (data.type === 'runtimeError') return parseRuntimeErrorMessage(data, expectedChannel)
  if (data.type === 'adaptation') return parseAdaptationMessage(data, expectedChannel)
  if (data.type === 'automationResult') {
    return parseAutomationResultMessage(data, expectedChannel)
  }
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
  const hasReplace = Object.hasOwn(data, 'replace')
  if (
    !hasExactKeys(data, hasReplace ? ['type', 'route', 'replace'] : ['type', 'route']) ||
    !isRoute(data.route) ||
    (hasReplace && typeof data.replace !== 'boolean')
  )
    return null
  return {
    source: EDITOR_SOURCE,
    channel,
    type: 'navigate',
    route: data.route,
    ...(hasReplace ? { replace: data.replace as boolean } : {})
  }
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

function createEditorPageSessionMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewEditorMessage | null {
  if (!hasExactKeys(data, ['type', 'snapshot'])) return null
  const snapshot = parsePreviewPageSessionSnapshot(data.snapshot)
  return snapshot ? { source: EDITOR_SOURCE, channel, type: 'pageSession', snapshot } : null
}

function createEditorAdaptationMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewEditorMessage | null {
  if (
    !hasExactKeys(data, ['type', 'revision', 'textScale', 'diagnostics']) ||
    !isAdaptationRevision(data.revision) ||
    !isPreviewTextScale(data.textScale) ||
    typeof data.diagnostics !== 'boolean'
  ) {
    return null
  }
  return {
    source: EDITOR_SOURCE,
    channel,
    type: 'adaptation',
    revision: data.revision,
    textScale: data.textScale,
    diagnostics: data.diagnostics
  }
}

function validAutomationLocator(by: unknown, locator: unknown): by is PreviewAutomationLocator {
  if (!isAutomationLocator(by) || typeof locator !== 'string') return false
  if (by === 'body') return locator === ''
  return isBoundedAutomationText(locator, PREVIEW_MESSAGE_LIMITS.automationLocatorLength)
}

function validAutomationClick(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(data, ['type', 'requestId', 'action', 'by', 'locator']) &&
    (data.by === 'testId' || data.by === 'buttonText') &&
    validAutomationLocator(data.by, data.locator)
  )
}

function validAutomationSet(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(data, ['type', 'requestId', 'action', 'by', 'locator', 'value']) &&
    (data.by === 'testId' || data.by === 'placeholder') &&
    validAutomationLocator(data.by, data.locator) &&
    typeof data.value === 'string' &&
    data.value.length <= PREVIEW_MESSAGE_LIMITS.automationInputLength
  )
}

function validAutomationWait(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(data, ['type', 'requestId', 'action', 'by', 'locator', 'text', 'timeoutMs']) &&
    validAutomationLocator(data.by, data.locator) &&
    (data.text === null ||
      isBoundedAutomationText(data.text, PREVIEW_MESSAGE_LIMITS.automationInputLength)) &&
    Number.isSafeInteger(data.timeoutMs) &&
    (data.timeoutMs as number) >= 0 &&
    (data.timeoutMs as number) <= PREVIEW_MESSAGE_LIMITS.automationTimeoutMs
  )
}

function validAutomationRead(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(data, ['type', 'requestId', 'action', 'by', 'locator']) &&
    validAutomationLocator(data.by, data.locator)
  )
}

function automationEditorMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewEditorMessage {
  return { source: EDITOR_SOURCE, channel, ...data } as PreviewEditorMessage
}

function createEditorAutomationMessage(
  data: Record<string, unknown>,
  channel: string
): PreviewEditorMessage | null {
  if (!isAutomationRequestId(data.requestId)) return null
  if (data.action === 'click' && validAutomationClick(data)) {
    return automationEditorMessage(data, channel)
  }
  if (data.action === 'set' && validAutomationSet(data)) {
    return automationEditorMessage(data, channel)
  }
  if (data.action === 'wait' && validAutomationWait(data)) {
    return automationEditorMessage(data, channel)
  }
  if (data.action === 'read-safe-text' && validAutomationRead(data)) {
    return automationEditorMessage(data, channel)
  }
  return null
}

export function createPreviewEditorMessage(
  channel: string,
  payload: unknown
): PreviewEditorMessage | null {
  if (!isPreviewChannelId(channel)) return null
  const data = parsePreviewRecord(payload)
  if (!data) return null
  if (data.type === 'select') return createEditorSelectMessage(data, channel)
  if (
    data.type === 'textEdit' &&
    hasExactKeys(data, ['type', 'command']) &&
    (data.command === 'selectAll' || data.command === 'undo' || data.command === 'redo')
  ) {
    return { source: EDITOR_SOURCE, channel, type: 'textEdit', command: data.command }
  }
  if (data.type === 'navigate') return createEditorNavigateMessage(data, channel)
  if (data.type === 'theme') return createEditorThemeMessage(data, channel)
  if (data.type === 'motionDebug') return createEditorMotionMessage(data, channel)
  if (data.type === 'docState') return createEditorDocStateMessage(data, channel)
  if (data.type === 'pageSession') return createEditorPageSessionMessage(data, channel)
  if (data.type === 'adaptation') return createEditorAdaptationMessage(data, channel)
  if (data.type === 'automation') return createEditorAutomationMessage(data, channel)
  return null
}
