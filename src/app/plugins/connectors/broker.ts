/* eslint-disable max-lines -- Execution gates, bounded transport, and audit must stay one boundary. */
import {
  parsePluginObjectParameterValue,
  resolvePluginConnectorOriginTemplate,
  type PluginConnectorContractV1,
  type PluginConnectorOperationV1,
  type PluginConnectorOperationRequestV1,
  type PluginParameterValue
} from '@open-pencil/core/plugins'
import type { JsonValue } from '@open-pencil/scene-graph/primitives'

import type { InstalledAppPlugin } from '@/app/plugins/types'
import type { CredentialResolver } from '@/app/settings/credentials'
import { credentialKey } from '@/app/settings/credentials/reference'

import type { ConnectorAuditEvent, ConnectorAuditOutcome, ConnectorAuditSink } from './audit'
import type { ConnectorAuthorizationRegistry } from './authorization'
import {
  createConnectorMutationAttemptId,
  parseConnectorMutationAttemptId
} from './mutation-attempt'
import type { ConnectorHostAdapterRegistry } from './registry'
import {
  CONNECTOR_EXECUTION_LIMITS,
  ConnectorExecutionError,
  type ConnectorExecutionErrorCode,
  type ConnectorExecutionResult,
  type ConnectorFetch,
  type ConnectorHostAdapter,
  type ConnectorParameterObject,
  type ExecuteConnectorRequest,
  type PreparedConnectorRequest
} from './types'

const TEXT_ENCODER = new TextEncoder()
const RESERVED_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'host',
  'origin',
  'referer',
  'connection',
  'content-length'
])

export interface CreateConnectorExecutionBrokerOptions {
  readonly adapters: ConnectorHostAdapterRegistry
  readonly authorization: ConnectorAuthorizationRegistry
  readonly credentialResolver: CredentialResolver
  readonly audit: ConnectorAuditSink
  readonly fetch?: ConnectorFetch
  readonly now?: () => number
}

interface ExecutionMetrics {
  requestDispatched: boolean
  requestBytes: number
  responseBytes: number
  httpStatus?: number
}

interface ExecutionClock {
  readonly signal: AbortSignal
  readonly timedOut: () => boolean
  readonly dispose: () => void
}

type ExecutableConnectorOperation = PluginConnectorOperationV1 & {
  readonly request: PluginConnectorOperationRequestV1
}

interface ReviewedConnectorInvocation {
  readonly contract: PluginConnectorContractV1
  readonly adapter: ConnectorHostAdapter
  readonly operation: ExecutableConnectorOperation
  readonly parameters: ConnectorParameterObject
  readonly packageDigest: string
  readonly mutationAttemptId?: string
}

interface ActiveConnectorInvocation {
  readonly invocation: ReviewedConnectorInvocation
  readonly controller: AbortController
}

interface MergedExecutionSignal {
  readonly signal: AbortSignal
  readonly dispose: () => void
}

function executionError(
  code: ConnectorExecutionErrorCode,
  message: string,
  cause?: unknown
): ConnectorExecutionError {
  return new ConnectorExecutionError(code, message, cause === undefined ? undefined : { cause })
}

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error(typeof value === 'string' ? value : 'Connector execution failed')
}

function boundedTimeout(value: number | undefined): number {
  const timeout = value ?? CONNECTOR_EXECUTION_LIMITS.defaultTimeoutMs
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > CONNECTOR_EXECUTION_LIMITS.maxTimeoutMs
  ) {
    throw new TypeError(
      `Connector timeout must be between 1 and ${CONNECTOR_EXECUTION_LIMITS.maxTimeoutMs}ms`
    )
  }
  return timeout
}

function createExecutionClock(signal: AbortSignal | undefined, timeoutMs: number): ExecutionClock {
  const controller = new AbortController()
  let timeoutReached = false
  const abort = () => controller.abort(signal?.reason ?? new Error('Connector execution aborted'))
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    timeoutReached = true
    controller.abort(new Error('Connector execution timed out'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}

function mergeExecutionSignals(
  ...signals: readonly (AbortSignal | undefined)[]
): MergedExecutionSignal {
  const controller = new AbortController()
  const available = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  const abort = (event: Event) => {
    const source = event.currentTarget as AbortSignal
    if (!controller.signal.aborted) {
      controller.abort(source.reason ?? new Error('Connector execution aborted'))
    }
  }
  for (const signal of available) {
    if (signal.aborted) {
      controller.abort(signal.reason ?? new Error('Connector execution aborted'))
      break
    }
    signal.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of available) signal.removeEventListener('abort', abort)
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw executionError('aborted', 'Connector execution was aborted')
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw asError(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(asError(signal.reason ?? new Error('Connector execution aborted')))
    signal.addEventListener('abort', abort, { once: true })
    void promise
      .then((value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
        return undefined
      })
      .catch((cause: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(asError(cause))
        return undefined
      })
  })
}

function requireInstalledDeclaration(
  plugin: InstalledAppPlugin | null,
  contract: PluginConnectorContractV1,
  adapters: ConnectorHostAdapterRegistry
): InstalledAppPlugin {
  if (!plugin || plugin.package.manifest.plugin.id !== contract.pluginId) {
    throw executionError('plugin-not-installed', `Plugin is not installed: ${contract.pluginId}`)
  }
  if (!plugin.enabled) {
    throw executionError('plugin-disabled', `Plugin is disabled: ${contract.pluginId}`)
  }
  if (plugin.blockedReason) {
    throw executionError('plugin-blocked', `Plugin is blocked: ${contract.pluginId}`)
  }
  const manifest = plugin.package.manifest
  const declared =
    manifest.schemaVersion === 2
      ? manifest.contributions.connectors?.find(
          (entry) => entry.connectorId === contract.connectorId
        )
      : undefined
  const compatibility = declared ? adapters.contracts.inspect(declared) : undefined
  if (!compatibility?.ok || compatibility.contract !== contract) {
    throw executionError(
      'connector-not-declared',
      `Connector is not declared by the installed plugin: ${contract.connectorId}`
    )
  }
  return plugin
}

function requireOperation(
  contract: PluginConnectorContractV1,
  operationId: string
): ExecutableConnectorOperation {
  const operation = contract.operations.find((entry) => entry.operationId === operationId)
  if (!operation) {
    throw executionError(
      'authority-mismatch',
      `Connector operation is not declared: ${operationId}`
    )
  }
  if (!operation.request) {
    throw executionError(
      'authority-mismatch',
      `Connector operation has no executable request authority: ${operationId}`
    )
  }
  return operation as ExecutableConnectorOperation
}

function validatedParameters(
  operation: PluginConnectorOperationV1,
  value: PluginParameterValue
): ConnectorParameterObject {
  try {
    return parsePluginObjectParameterValue(
      value,
      operation.parameters.schema,
      operation.parameters.maxBytes,
      'Connector operation parameters'
    ) as ConnectorParameterObject
  } catch (cause) {
    throw executionError('invalid-parameters', 'Connector operation parameters are invalid', cause)
  }
}

async function requireMutationConfirmation(
  request: ExecuteConnectorRequest,
  contract: PluginConnectorContractV1,
  operation: PluginConnectorOperationV1,
  signal: AbortSignal | undefined
): Promise<void> {
  if (operation.kind !== 'mutation') return
  if (!request.confirmMutation) {
    throw executionError(
      'mutation-confirmation-required',
      `Connector mutation requires confirmation: ${operation.operationId}`
    )
  }
  let confirmed: boolean
  try {
    const pending = Promise.resolve(
      request.confirmMutation({
        pluginId: contract.pluginId,
        connectorId: contract.connectorId,
        operationId: operation.operationId,
        operationName: operation.name
      })
    )
    confirmed = signal ? await abortable(pending, signal) : await pending
  } catch (cause) {
    if (signal?.aborted) {
      throw executionError('aborted', 'Connector mutation confirmation was aborted', cause)
    }
    throw executionError('mutation-denied', 'Connector mutation could not be confirmed', cause)
  }
  if (!confirmed) {
    throw executionError(
      'mutation-denied',
      `Connector mutation was denied: ${operation.operationId}`
    )
  }
}

async function validateResolvedCredential(
  adapter: ConnectorHostAdapter,
  contract: PluginConnectorContractV1,
  operation: PluginConnectorOperationV1,
  slot: PluginConnectorContractV1['credentialSlots'][number],
  value: string,
  signal: AbortSignal
): Promise<void> {
  if (!adapter.validateCredential) return
  let accepted: boolean
  try {
    accepted = await abortable(
      Promise.resolve(adapter.validateCredential({ contract, operation, slot, value, signal })),
      signal
    )
  } catch (cause) {
    if (signal.aborted) throw cause
    throw executionError(
      'credential-unavailable',
      `Credential could not be validated: ${slot.slotId}`,
      cause
    )
  }
  if (!accepted) {
    throw executionError('credential-unavailable', `Credential was rejected: ${slot.slotId}`)
  }
}

function credentialHeaderName(slot: PluginConnectorContractV1['credentialSlots'][number]): string {
  if (slot.kind !== 'api-key') return 'authorization'
  if (slot.injection) return slot.injection.name
  throw executionError(
    'unsupported-credential',
    `API key injection is not declared for credential slot: ${slot.slotId}`
  )
}

async function resolvedCredentialValue(
  request: ExecuteConnectorRequest,
  contract: PluginConnectorContractV1,
  operation: PluginConnectorOperationV1,
  slot: PluginConnectorContractV1['credentialSlots'][number],
  adapter: ConnectorHostAdapter,
  resolver: CredentialResolver,
  signal: AbortSignal
): Promise<string | undefined> {
  const reference = request.credentialRefs?.[slot.slotId]
  if (!reference) {
    if (slot.required) {
      throw executionError('credential-missing', `Credential is not configured: ${slot.slotId}`)
    }
    return undefined
  }
  try {
    credentialKey(reference)
  } catch (cause) {
    throw executionError(
      'credential-unavailable',
      `Credential reference is invalid: ${slot.slotId}`,
      cause
    )
  }
  if (reference.integrationId !== contract.pluginId || reference.field !== slot.slotId) {
    throw executionError(
      'credential-unavailable',
      `Credential reference does not match connector slot: ${slot.slotId}`
    )
  }
  let value: string | null
  try {
    value = await abortable(resolver.resolve(reference), signal)
  } catch (cause) {
    throw executionError(
      'credential-unavailable',
      `Credential could not be resolved: ${slot.slotId}`,
      cause
    )
  }
  if (!value) {
    if (slot.required) {
      throw executionError('credential-missing', `Credential is not configured: ${slot.slotId}`)
    }
    return undefined
  }
  if (/\p{Cc}/u.test(value)) {
    throw executionError(
      'credential-unavailable',
      `Credential contains invalid characters: ${slot.slotId}`
    )
  }
  if (TEXT_ENCODER.encode(value).byteLength > CONNECTOR_EXECUTION_LIMITS.maxHeaderValueLength) {
    throw executionError('credential-unavailable', `Credential is too large: ${slot.slotId}`)
  }
  await validateResolvedCredential(adapter, contract, operation, slot, value, signal)
  return value
}

async function credentialHeaders(
  request: ExecuteConnectorRequest,
  contract: PluginConnectorContractV1,
  operation: PluginConnectorOperationV1,
  adapter: ConnectorHostAdapter,
  resolver: CredentialResolver,
  signal: AbortSignal
): Promise<Headers> {
  const headers = new Headers()
  for (const slotId of operation.credentialSlots) {
    const slot = contract.credentialSlots.find((entry) => entry.slotId === slotId)
    if (!slot) throw executionError('authority-mismatch', `Unknown credential slot: ${slotId}`)
    const name = credentialHeaderName(slot)
    const value = await resolvedCredentialValue(
      request,
      contract,
      operation,
      slot,
      adapter,
      resolver,
      signal
    )
    if (value === undefined) continue
    const headerValue = slot.kind === 'api-key' ? value : `Bearer ${value}`
    if (
      TEXT_ENCODER.encode(headerValue).byteLength > CONNECTOR_EXECUTION_LIMITS.maxHeaderValueLength
    ) {
      throw executionError('credential-unavailable', `Credential is too large: ${slotId}`)
    }
    if (headers.has(name)) {
      throw executionError(
        'unsupported-credential',
        `An operation cannot inject more than one credential into header: ${name}`
      )
    }
    headers.set(name, headerValue)
  }
  return headers
}

export function resolveConnectorOperationOrigin(
  operation: PluginConnectorOperationV1,
  parameters: ConnectorParameterObject
): string {
  if (!operation.request) {
    throw executionError('authority-mismatch', 'Connector operation request authority is missing')
  }
  if (operation.request.origin) return operation.request.origin
  if (!operation.request.originTemplate) {
    throw executionError('authority-mismatch', 'Connector request origin authority is missing')
  }
  try {
    return resolvePluginConnectorOriginTemplate(operation.request.originTemplate, parameters)
  } catch (cause) {
    throw executionError('invalid-parameters', 'Connector origin parameters are invalid', cause)
  }
}

export function resolveConnectorOperationPath(
  operation: PluginConnectorOperationV1,
  parameters: ConnectorParameterObject
): string {
  if (!operation.request) {
    throw executionError('authority-mismatch', 'Connector operation request authority is missing')
  }
  return operation.request.pathTemplate.replace(/\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g, (_, key) => {
    const value = parameters[key]
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw executionError(
        'invalid-parameters',
        `Connector path parameter is missing or invalid: ${key}`
      )
    }
    if (typeof value === 'string' && value.length === 0) {
      throw executionError('invalid-parameters', `Connector path parameter is empty: ${key}`)
    }
    return encodeURIComponent(String(value))
  })
}

function exactDataRecord(value: unknown, path: string): Readonly<Record<string, string>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw executionError('adapter-failed', `${path} must be a plain record`)
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length > CONNECTOR_EXECUTION_LIMITS.maxHeaders ||
    keys.some((key) => typeof key !== 'string')
  ) {
    throw executionError('adapter-failed', `${path} exceeds the header limit`)
  }
  const result: Record<string, string> = Object.create(null) as Record<string, string>
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw executionError('adapter-failed', `${path} must contain data properties only`)
    }
    if (
      key.length === 0 ||
      key.length > CONNECTOR_EXECUTION_LIMITS.maxHeaderNameLength ||
      typeof descriptor.value !== 'string' ||
      TEXT_ENCODER.encode(descriptor.value).byteLength >
        CONNECTOR_EXECUTION_LIMITS.maxHeaderValueLength ||
      /[\r\n]/.test(descriptor.value)
    ) {
      throw executionError('adapter-failed', `${path} contains an invalid header`)
    }
    const normalized = key.toLowerCase()
    if (RESERVED_HEADERS.has(normalized) || normalized.startsWith('sec-')) {
      throw executionError('adapter-failed', `Connector adapter cannot set reserved header: ${key}`)
    }
    result[key] = descriptor.value
  }
  return result
}

function requestBody(value: string | Uint8Array | undefined): BodyInit | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  if (!(value instanceof Uint8Array)) {
    throw executionError('adapter-failed', 'Connector request body must be text or bytes')
  }
  return value as BodyInit
}

function bodyBytes(value: string | Uint8Array | undefined): number {
  return typeof value === 'string'
    ? TEXT_ENCODER.encode(value).byteLength
    : (value?.byteLength ?? 0)
}

function validatedPreparedRequest(
  prepared: PreparedConnectorRequest,
  operation: PluginConnectorOperationV1,
  parameters: ConnectorParameterObject,
  credentialHeaders: Headers
): Readonly<{ url: string; headers: Headers; body?: BodyInit; requestBytes: number }> {
  if (!operation.request) throw executionError('authority-mismatch', 'Request authority is missing')
  let url: URL
  try {
    url = new URL(prepared.url)
  } catch (cause) {
    throw executionError('adapter-failed', 'Connector adapter returned an invalid URL', cause)
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.origin !== resolveConnectorOperationOrigin(operation, parameters) ||
    url.pathname !== resolveConnectorOperationPath(operation, parameters)
  ) {
    throw executionError('authority-mismatch', 'Connector request exceeds reviewed URL authority')
  }
  const headers = new Headers(exactDataRecord(prepared.headers ?? {}, 'Connector request headers'))
  for (const [name, value] of credentialHeaders) {
    if (headers.has(name)) {
      throw executionError(
        'adapter-failed',
        `Connector adapter cannot set credential header: ${name}`
      )
    }
    headers.set(name, value)
  }
  const requestBytes = bodyBytes(prepared.body)
  if (requestBytes > CONNECTOR_EXECUTION_LIMITS.maxRequestBytes) {
    throw executionError('request-too-large', 'Connector request exceeds the body limit')
  }
  if (operation.request.method === 'GET' && requestBytes > 0) {
    throw executionError('adapter-failed', 'GET connector operations cannot send a request body')
  }
  const body = requestBody(prepared.body)
  return Object.freeze({
    url: url.href,
    headers,
    ...(body === undefined ? {} : { body }),
    requestBytes
  })
}

async function boundedResponse(response: Response, maximum: number, signal: AbortSignal) {
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > maximum) {
    throw executionError('response-too-large', 'Connector response exceeds the body limit')
  }
  if (!response.body) return { bytes: new Uint8Array(), byteLength: 0 }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    let chunk = await reader.read()
    while (!chunk.done) {
      if (signal.aborted) throw signal.reason
      byteLength += chunk.value.byteLength
      if (byteLength > maximum) {
        await reader.cancel()
        throw executionError('response-too-large', 'Connector response exceeds the body limit')
      }
      chunks.push(chunk.value)
      chunk = await reader.read()
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, byteLength }
}

function decodedResponse(bytes: Uint8Array): unknown {
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return source === '' ? {} : JSON.parse(source)
  } catch (cause) {
    throw executionError('invalid-response', 'Connector response is not valid UTF-8 JSON', cause)
  }
}

function validatedResponse(value: unknown, operation: PluginConnectorOperationV1): JsonValue {
  try {
    return parsePluginObjectParameterValue(
      value,
      operation.result.schema,
      operation.result.maxBytes,
      'Connector operation result'
    ) as JsonValue
  } catch (cause) {
    throw executionError(
      'invalid-response',
      'Connector response does not match its contract',
      cause
    )
  }
}

function auditOutcome(code: ConnectorExecutionErrorCode): ConnectorAuditOutcome {
  if (code === 'outcome-unknown') return 'outcome-unknown'
  return code === 'aborted' || code === 'mutation-denied' ? 'cancelled' : 'failed'
}

function protectedExecutionError(
  cause: unknown,
  invocation: ReviewedConnectorInvocation | undefined,
  metrics: ExecutionMetrics
): ConnectorExecutionError {
  const thrown =
    cause instanceof ConnectorExecutionError
      ? cause
      : executionError('adapter-failed', 'Connector execution failed', cause)
  if (
    invocation?.operation.kind === 'mutation' &&
    metrics.requestDispatched &&
    thrown.code !== 'outcome-unknown'
  ) {
    return executionError(
      'outcome-unknown',
      'Connector mutation was dispatched, but its remote outcome could not be verified',
      thrown
    )
  }
  return thrown
}

function reviewedContract(
  adapters: ConnectorHostAdapterRegistry,
  value: unknown
): PluginConnectorContractV1 {
  const compatibility = adapters.contracts.inspect(value)
  if (compatibility.ok) return compatibility.contract
  const code =
    compatibility.status === 'host-adapter-unavailable'
      ? 'adapter-unavailable'
      : 'authority-mismatch'
  throw executionError(code, compatibility.reason)
}

function reviewedInvocation(
  options: CreateConnectorExecutionBrokerOptions,
  request: ExecuteConnectorRequest,
  contract: PluginConnectorContractV1
): ReviewedConnectorInvocation {
  const plugin = requireInstalledDeclaration(request.plugin, contract, options.adapters)
  const adapter = options.adapters.resolve(contract)
  if (!adapter) {
    throw executionError(
      'adapter-unavailable',
      `Connector adapter is unavailable: ${contract.adapterId}`
    )
  }
  if (!options.authorization.isAuthorized(contract, plugin.package.digest)) {
    throw executionError('unauthorized', `Connector is not authorized: ${contract.connectorId}`)
  }
  const operation = requireOperation(contract, request.operationId)
  let mutationAttemptId: string | undefined
  if (operation.kind === 'mutation') {
    try {
      mutationAttemptId = parseConnectorMutationAttemptId(
        request.mutationAttemptId ?? createConnectorMutationAttemptId()
      )
    } catch (cause) {
      throw executionError('invalid-parameters', 'Connector mutation attempt ID is invalid', cause)
    }
  }
  if (operation.kind !== 'mutation' && request.mutationAttemptId !== undefined) {
    throw executionError(
      'invalid-parameters',
      'Connector query cannot declare a mutation attempt ID'
    )
  }
  return {
    contract,
    adapter,
    operation,
    parameters: validatedParameters(operation, request.parameters),
    packageDigest: plugin.package.digest,
    ...(mutationAttemptId === undefined ? {} : { mutationAttemptId })
  }
}

async function fetchConnectorResponse(
  fetchImplementation: ConnectorFetch,
  outgoing: ReturnType<typeof validatedPreparedRequest>,
  operation: ExecutableConnectorOperation,
  signal: AbortSignal,
  timeoutMs: number,
  maxResponseBytes: number,
  metrics: ExecutionMetrics
): Promise<Response> {
  let response: Response
  const markDispatched = () => {
    metrics.requestDispatched = true
  }
  try {
    response = await abortable(
      fetchImplementation(
        outgoing.url,
        {
          method: operation.request.method,
          headers: outgoing.headers,
          ...(outgoing.body === undefined ? {} : { body: outgoing.body }),
          credentials: 'omit',
          redirect: 'error',
          signal
        },
        {
          maxResponseBytes,
          timeoutMs
        },
        markDispatched
      ),
      signal
    )
    // A response proves dispatch even if a non-conforming host transport omitted the callback.
    markDispatched()
  } catch (cause) {
    if (signal.aborted) throw cause
    throw executionError('network-failed', 'Connector network request failed', cause)
  }
  metrics.httpStatus = response.status
  if (response.redirected) {
    throw executionError('redirect-rejected', 'Connector redirects are not allowed')
  }
  if (!response.ok) {
    throw executionError('http-error', `Connector request failed with HTTP ${response.status}`)
  }
  return response
}

async function transformConnectorResponse(
  invocation: ReviewedConnectorInvocation,
  upstream: unknown,
  signal: AbortSignal
): Promise<unknown> {
  if (!invocation.adapter.transformResponse) return upstream
  try {
    return await abortable(
      Promise.resolve(
        invocation.adapter.transformResponse(upstream, {
          contract: invocation.contract,
          operation: invocation.operation,
          parameters: invocation.parameters,
          ...(invocation.mutationAttemptId === undefined
            ? {}
            : { mutationAttemptId: invocation.mutationAttemptId }),
          signal
        })
      ),
      signal
    )
  } catch (cause) {
    if (signal.aborted) throw cause
    throw executionError('adapter-failed', 'Connector response adapter failed', cause)
  }
}

async function performConnectorRequest(
  options: CreateConnectorExecutionBrokerOptions,
  fetchImplementation: ConnectorFetch,
  request: ExecuteConnectorRequest,
  invocation: ReviewedConnectorInvocation,
  signal: AbortSignal,
  timeoutMs: number,
  metrics: ExecutionMetrics
): Promise<ConnectorExecutionResult> {
  const credentials = await credentialHeaders(
    request,
    invocation.contract,
    invocation.operation,
    invocation.adapter,
    options.credentialResolver,
    signal
  )
  const prepared = await abortable(
    invocation.adapter.prepare({
      contract: invocation.contract,
      operation: invocation.operation,
      parameters: invocation.parameters,
      ...(invocation.mutationAttemptId === undefined
        ? {}
        : { mutationAttemptId: invocation.mutationAttemptId }),
      signal
    }),
    signal
  )
  const outgoing = validatedPreparedRequest(
    prepared,
    invocation.operation,
    invocation.parameters,
    credentials
  )
  metrics.requestBytes = outgoing.requestBytes
  const maximum = Math.min(
    invocation.operation.request.maxResponseBytes ?? invocation.operation.result.maxBytes,
    CONNECTOR_EXECUTION_LIMITS.maxResponseBytes
  )
  const response = await fetchConnectorResponse(
    fetchImplementation,
    outgoing,
    invocation.operation,
    signal,
    timeoutMs,
    maximum,
    metrics
  )
  const responseBody = await boundedResponse(response, maximum, signal)
  metrics.responseBytes = responseBody.byteLength
  const upstream = decodedResponse(responseBody.bytes)
  const transformed = await transformConnectorResponse(invocation, upstream, signal)
  return Object.freeze({
    data: validatedResponse(transformed, invocation.operation),
    httpStatus: response.status,
    requestBytes: metrics.requestBytes,
    responseBytes: metrics.responseBytes
  })
}

async function performTimedConnectorRequest(
  options: CreateConnectorExecutionBrokerOptions,
  fetchImplementation: ConnectorFetch,
  request: ExecuteConnectorRequest,
  invocation: ReviewedConnectorInvocation,
  signal: AbortSignal | undefined,
  metrics: ExecutionMetrics
): Promise<ConnectorExecutionResult> {
  const timeoutMs = boundedTimeout(request.timeoutMs)
  const clock = createExecutionClock(signal, timeoutMs)
  try {
    return await performConnectorRequest(
      options,
      fetchImplementation,
      request,
      invocation,
      clock.signal,
      timeoutMs,
      metrics
    )
  } catch (cause) {
    if (cause instanceof ConnectorExecutionError) throw cause
    if (clock.signal.aborted) {
      const code = clock.timedOut() ? 'timeout' : 'aborted'
      const message = clock.timedOut()
        ? 'Connector execution timed out'
        : 'Connector execution was aborted'
      throw executionError(code, message, cause)
    }
    throw executionError('adapter-failed', 'Connector adapter failed', cause)
  } finally {
    clock.dispose()
  }
}

function connectorAuditEvent(
  startedAt: number,
  finishedAt: number,
  invocation: ReviewedConnectorInvocation | undefined,
  metrics: ExecutionMetrics,
  thrown: ConnectorExecutionError | undefined
): ConnectorAuditEvent {
  const outcome: ConnectorAuditOutcome = thrown ? auditOutcome(thrown.code) : 'completed'
  return Object.freeze({
    timestamp: startedAt,
    pluginId: invocation?.contract.pluginId ?? 'unknown',
    connectorId: invocation?.contract.connectorId ?? 'unknown',
    adapterId: invocation?.contract.adapterId ?? 'unknown',
    operationId: invocation?.operation.operationId ?? 'unknown',
    operationKind: invocation?.operation.kind ?? 'unknown',
    outcome,
    durationMs: Math.max(0, finishedAt - startedAt),
    requestDispatched: metrics.requestDispatched,
    requestBytes: metrics.requestBytes,
    responseBytes: metrics.responseBytes,
    ...(metrics.httpStatus === undefined ? {} : { httpStatus: metrics.httpStatus }),
    ...(thrown ? { errorCode: thrown.code } : {})
  })
}

function recordConnectorAudit(audit: ConnectorAuditSink, event: ConnectorAuditEvent): void {
  try {
    void Promise.resolve(audit.record(event)).catch((cause) => {
      void cause
      return undefined
    })
  } catch (cause) {
    // Audit is best-effort metadata. Its storage failure must never replace a connector result or
    // make callers retry a mutation whose remote outcome has already been established.
    void cause
  }
}

export function createConnectorExecutionBroker(options: CreateConnectorExecutionBrokerOptions) {
  const fetchImplementation: ConnectorFetch =
    options.fetch ??
    ((input, init, _limits, onDispatch) => {
      onDispatch()
      return globalThis.fetch(input, init)
    })
  const now = options.now ?? Date.now
  const active = new Set<ActiveConnectorInvocation>()
  let disposed = false
  const unsubscribe = options.authorization.subscribe((grants) => {
    for (const entry of active) {
      const invocation = entry.invocation
      const remainsAuthorized = grants.some(
        (grant) =>
          grant.pluginId === invocation.contract.pluginId &&
          grant.connectorId === invocation.contract.connectorId &&
          grant.adapterId === invocation.contract.adapterId &&
          grant.packageDigest === invocation.packageDigest
      )
      if (!remainsAuthorized && !entry.controller.signal.aborted) {
        entry.controller.abort(new Error('Connector authorization was revoked'))
      }
    }
  })

  async function execute(request: ExecuteConnectorRequest): Promise<ConnectorExecutionResult> {
    const startedAt = now()
    const metrics: ExecutionMetrics = {
      requestDispatched: false,
      requestBytes: 0,
      responseBytes: 0
    }
    let invocation: ReviewedConnectorInvocation | undefined
    let activeInvocation: ActiveConnectorInvocation | undefined
    let mergedSignal: MergedExecutionSignal | undefined
    let thrown: ConnectorExecutionError | undefined
    try {
      if (disposed) throw executionError('aborted', 'Connector execution broker is disposed')
      throwIfAborted(request.signal)
      const contract = reviewedContract(options.adapters, request.contract)
      invocation = reviewedInvocation(options, request, contract)
      activeInvocation = { invocation, controller: new AbortController() }
      active.add(activeInvocation)
      if (!options.authorization.isAuthorized(contract, invocation.packageDigest)) {
        activeInvocation.controller.abort(new Error('Connector authorization was revoked'))
      }
      mergedSignal = mergeExecutionSignals(request.signal, activeInvocation.controller.signal)
      throwIfAborted(mergedSignal.signal)
      await requireMutationConfirmation(
        request,
        contract,
        invocation.operation,
        mergedSignal.signal
      )
      throwIfAborted(mergedSignal.signal)
      return await performTimedConnectorRequest(
        options,
        fetchImplementation,
        request,
        invocation,
        mergedSignal.signal,
        metrics
      )
    } catch (cause) {
      thrown = protectedExecutionError(cause, invocation, metrics)
      throw thrown
    } finally {
      mergedSignal?.dispose()
      if (activeInvocation) active.delete(activeInvocation)
      recordConnectorAudit(
        options.audit,
        connectorAuditEvent(startedAt, now(), invocation, metrics, thrown)
      )
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    unsubscribe()
    for (const entry of active) {
      if (!entry.controller.signal.aborted) {
        entry.controller.abort(new Error('Connector execution broker was disposed'))
      }
    }
    active.clear()
  }

  return Object.freeze({ execute, dispose })
}
