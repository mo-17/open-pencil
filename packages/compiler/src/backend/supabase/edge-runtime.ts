import {
  emitExpression,
  parseExpression,
  substituteIdents,
  type ExprAst
} from '@open-pencil/lowcode'
import type {
  BackendApplicationSpecV1,
  BackendValueSource,
  BackendWorkflowDefinitionIR,
  BackendWorkflowStepIR
} from '@open-pencil/lowcode/backend'

import { backendSha256 } from '../canonical'

interface EdgeEmitScope {
  readonly bindings: Map<string, ExprAst>
  nextLocal: number
}

function expression(source: string, scope: EdgeEmitScope): string {
  const parsed = parseExpression(source)
  if (!parsed.ok) throw new TypeError('Normalized Backend workflow expression is invalid.')
  return emitExpression(substituteIdents(parsed.ast, scope.bindings))
}

function cloneScope(scope: EdgeEmitScope): EdgeEmitScope {
  return { bindings: new Map(scope.bindings), nextLocal: scope.nextLocal }
}

function nextLocal(scope: EdgeEmitScope, hint = 'value'): string {
  return `__${hint}${scope.nextLocal++}`
}

function bindResult(scope: EdgeEmitScope, name: string, hint: string): string {
  const local = nextLocal(scope, hint)
  scope.bindings.set(name, { kind: 'ident', name: local })
  return local
}

function entityName(application: BackendApplicationSpecV1, entityId: string): string {
  const entity = application.dataModel.entities.find((entry) => entry.id === entityId)
  if (!entity) throw new TypeError('Normalized Backend workflow entity is unavailable.')
  return entity.name
}

function fieldName(
  application: BackendApplicationSpecV1,
  entityId: string,
  fieldId: string
): string {
  const entity = application.dataModel.entities.find((entry) => entry.id === entityId)
  if (!entity) throw new TypeError('Normalized Backend workflow entity is unavailable.')
  if (entity.management === 'external') return fieldId
  const field = entity.fields.find((entry) => entry.id === fieldId)
  if (!field) throw new TypeError('Normalized Backend workflow field is unavailable.')
  return field.name
}

function valueSource(source: BackendValueSource, scope: EdgeEmitScope): string {
  return source.kind === 'environment'
    ? `requiredEnvironment(${JSON.stringify(source.name)})`
    : expression(source.expression, scope)
}

function filterChain(
  application: BackendApplicationSpecV1,
  entityId: string,
  filters: Extract<BackendWorkflowStepIR, { kind: 'data.read' | 'data.mutate' }>['filters'],
  scope: EdgeEmitScope
): string {
  return (filters ?? [])
    .map(
      (filter) =>
        `.${filter.operator}(${JSON.stringify(fieldName(application, entityId, filter.field))}, ${valueSource(filter.value, scope)})`
    )
    .join('')
}

function mutationPayload(
  application: BackendApplicationSpecV1,
  step: Extract<BackendWorkflowStepIR, { kind: 'data.mutate' }>,
  scope: EdgeEmitScope
): string {
  return `{ ${(step.values ?? [])
    .map(
      (entry) =>
        `${JSON.stringify(fieldName(application, step.entityId, entry.field))}: ${valueSource(entry.value, scope)}`
    )
    .join(', ')} }`
}

function emitDataRead(
  application: BackendApplicationSpecV1,
  step: Extract<BackendWorkflowStepIR, { kind: 'data.read' }>,
  scope: EdgeEmitScope,
  indent: string
): string {
  const operation = nextLocal(scope, 'query')
  const result = bindResult(scope, step.resultName, 'result')
  const columns = step.fields?.length
    ? step.fields.map((field) => fieldName(application, step.entityId, field)).join(',')
    : '*'
  const chain =
    `context.supabase.from(${JSON.stringify(entityName(application, step.entityId))})` +
    `.select(${JSON.stringify(columns)})` +
    filterChain(application, step.entityId, step.filters, scope) +
    `.limit(${step.single ? 2 : 100})` +
    (step.single ? '.single()' : '')
  return (
    `${indent}const ${operation} = await ${chain}\n` +
    `${indent}if (${operation}.error) throw new Error('Database request failed')\n` +
    `${indent}assertBoundedJSONValue(${operation}.data, MAX_RESPONSE_BYTES, 'Database response too large')\n` +
    `${indent}const ${result}: any = ${operation}.data\n`
  )
}

function emitDataMutation(
  application: BackendApplicationSpecV1,
  step: Extract<BackendWorkflowStepIR, { kind: 'data.mutate' }>,
  scope: EdgeEmitScope,
  indent: string
): string {
  const operation = nextLocal(scope, 'mutation')
  let chain = `context.supabase.from(${JSON.stringify(entityName(application, step.entityId))})`
  if (step.operation === 'delete') chain += '.delete()'
  else chain += `.${step.operation}(${mutationPayload(application, step, scope)})`
  chain += filterChain(application, step.entityId, step.filters, scope)
  if (step.resultName) chain += '.select().limit(100)'
  let output = `${indent}const ${operation} = await ${chain}\n`
  output += `${indent}if (${operation}.error) throw new Error('Database request failed')\n`
  if (step.resultName) {
    const result = bindResult(scope, step.resultName, 'result')
    output += `${indent}assertBoundedJSONValue(${operation}.data, MAX_RESPONSE_BYTES, 'Database response too large')\n`
    output += `${indent}const ${result}: any = ${operation}.data\n`
  }
  return output
}

function emitHttpRequest(
  step: Extract<BackendWorkflowStepIR, { kind: 'http.request' }>,
  scope: EdgeEmitScope,
  indent: string
): string {
  const headers = step.headers?.length
    ? `{ ${step.headers
        .map(
          (header) => `${JSON.stringify(header.name)}: String(${valueSource(header.value, scope)})`
        )
        .join(', ')} }`
    : '{}'
  const call = `await safeHttpRequest({ method: ${JSON.stringify(step.method)}, url: String(${valueSource(step.url, scope)}), headers: ${headers}${step.body ? `, body: ${valueSource(step.body, scope)}` : ''} })`
  if (!step.resultName) return `${indent}${call}\n`
  const result = bindResult(scope, step.resultName, 'http')
  return `${indent}const ${result}: any = ${call}\n`
}

function emitSteps(
  application: BackendApplicationSpecV1,
  steps: readonly BackendWorkflowStepIR[],
  scope: EdgeEmitScope,
  indent: string
): string {
  let output = ''
  for (const step of steps) {
    if (step.kind === 'data.read') output += emitDataRead(application, step, scope, indent)
    else if (step.kind === 'data.mutate') {
      output += emitDataMutation(application, step, scope, indent)
    } else if (step.kind === 'http.request') {
      output += emitHttpRequest(step, scope, indent)
    } else if (step.kind === 'branch') {
      const consequent = cloneScope(scope)
      const alternate = cloneScope(scope)
      output += `${indent}if (${expression(step.condition, scope)}) {\n`
      output += emitSteps(application, step.consequent, consequent, `${indent}  `)
      output += `${indent}} else {\n`
      output += emitSteps(application, step.alternate, alternate, `${indent}  `)
      output += `${indent}}\n`
    } else if (step.kind === 'respond') {
      output += `${indent}return { status: ${step.status ?? 200}, body: ${step.value ? expression(step.value, scope) : 'null'} }\n`
    } else {
      const operation = nextLocal(scope, 'call')
      output += `${indent}const ${operation} = await runWorkflow(${JSON.stringify(step.workflowId)}, projectArgs(${JSON.stringify(step.workflowId)}, args), context)\n`
      output += `${indent}if (${operation}.status >= 400) return ${operation}\n`
    }
  }
  return output
}

function emitWorkflow(
  application: BackendApplicationSpecV1,
  workflow: BackendWorkflowDefinitionIR,
  index: number
): string {
  const bindings = new Map<string, ExprAst>()
  bindings.set('$currentUser', { kind: 'ident', name: '__currentUser' })
  const parameters = workflow.parameters.map((name, parameterIndex) => {
    const local = `__arg${parameterIndex}`
    bindings.set(name, { kind: 'ident', name: local })
    return `  const ${local}: any = args[${JSON.stringify(name)}]`
  })
  const scope: EdgeEmitScope = { bindings, nextLocal: parameters.length }
  const body = emitSteps(application, workflow.steps, scope, '  ')
  return `async function __workflow${index}(
  args: Record<string, unknown>,
  context: WorkflowContext
): Promise<WorkflowResult> {
  assertExactArgs(args, ${JSON.stringify(workflow.parameters)})
  const __currentUser: any = context.user
${parameters.join('\n')}${parameters.length ? '\n' : ''}${body}  return { status: 200, body: null }
}`
}

export function buildSupabaseBackendEdgeFunction(application: BackendApplicationSpecV1): string {
  const workflows = application.workflows.workflows
  const functions = workflows.map((workflow, index) => emitWorkflow(application, workflow, index))
  const dispatch = workflows.map(
    (workflow, index) =>
      `    case ${JSON.stringify(workflow.id)}: return __workflow${index}(args, context)`
  )
  const params = JSON.stringify(workflows.map((workflow) => [workflow.id, workflow.parameters]))
  const runtimeSource = `${EDGE_PREAMBLE}

const WORKFLOW_PARAMS = new Map<string, string[]>(${params})

${functions.join('\n\n')}

async function runWorkflow(
  workflowId: string,
  args: Record<string, unknown>,
  context: WorkflowContext
): Promise<WorkflowResult> {
  switch (workflowId) {
${dispatch.join('\n')}
    default: throw new Error('Unknown workflow')
  }
}

${EDGE_HANDLER}`
  const firstLineEnd = runtimeSource.indexOf('\n')
  if (firstLineEnd === -1)
    throw new TypeError('Supabase Edge Function runtime preamble is invalid.')
  const buildIdentity = backendSha256(runtimeSource)
  return `${runtimeSource.slice(0, firstLineEnd + 1)}const OPENPENCIL_EDGE_BUILD_IDENTITY = ${JSON.stringify(buildIdentity)}\n${runtimeSource.slice(firstLineEnd + 1)}`
}

// These names are inert output tokens, not Compiler-global references. Keeping the interpolation
// explicit makes the host/runtime boundary visible while preserving the emitted source byte-for-byte.
const EMITTED_EDGE_RUNTIME_IDENTIFIERS = Object.freeze({
  environment: 'Deno',
  request: 'fetch'
})

const EDGE_PREAMBLE = `import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.100.0'

interface WorkflowContext {
  supabase: SupabaseClient
  user: User
}

interface WorkflowResult {
  status: number
  body: unknown
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024
const HTTP_TIMEOUT_MS = 8_000
const MAX_OUTBOUND_HOSTS_BYTES = 8 * 1024
const MAX_OUTBOUND_HOSTS = 64

function json(body: unknown, status: number): Response {
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status, headers: JSON_HEADERS })
  }
  return new Response(serializeBoundedJSON(body, MAX_RESPONSE_BYTES, 'Response too large'), {
    status,
    headers: JSON_HEADERS
  })
}

function serializeBoundedJSON(value: unknown, maxBytes: number, message: string): string {
  let serialized: string
  try {
    serialized = JSON.stringify(value ?? null)
  } catch {
    throw new Error(message)
  }
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) throw new Error(message)
  return serialized
}

function assertBoundedJSONValue(value: unknown, maxBytes: number, message: string): void {
  serializeBoundedJSON(value, maxBytes, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const set = new Set(allowed)
  return Object.keys(value).every((key) => set.has(key))
}

function assertExactArgs(args: Record<string, unknown>, params: readonly string[]): void {
  const keys = Object.keys(args)
  if (keys.length !== params.length || keys.some((key) => !params.includes(key))) {
    throw new Error('Invalid workflow arguments')
  }
}

function projectArgs(workflowId: string, args: Record<string, unknown>): Record<string, unknown> {
  const params = WORKFLOW_PARAMS.get(workflowId)
  if (!params) throw new Error('Unknown workflow')
  return Object.fromEntries(params.map((name) => [name, args[name]]))
}

function requiredEnvironment(name: string): string {
  const value = ${EMITTED_EDGE_RUNTIME_IDENTIFIERS.environment}.env.get(name)
  if (!value) throw new Error('Required environment is unavailable')
  return value
}

function requiredSupabasePublishableKey(): string {
  const encoded = requiredEnvironment('SUPABASE_PUBLISHABLE_KEYS')
  if (new TextEncoder().encode(encoded).byteLength > 16 * 1024) {
    throw new Error('Supabase publishable key is unavailable')
  }
  let parsed: unknown
  try { parsed = JSON.parse(encoded) } catch { throw new Error('Supabase publishable key is unavailable') }
  const key = isRecord(parsed) ? parsed.default : undefined
  if (typeof key !== 'string' || !key.startsWith('sb_publishable_') || key.length > 4096) {
    throw new Error('Supabase publishable key is unavailable')
  }
  return key
}

async function readBoundedRequestText(request: Request): Promise<string> {
  const declaredHeader = request.headers.get('content-length')
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader)
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_REQUEST_BYTES) {
      void request.body?.cancel().catch(() => undefined)
      throw new Error('Invalid request')
    }
  }
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined)
        throw new Error('Invalid request')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function isPrivateHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\\[|\\]$/g, '')
  if (
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
    hostname.endsWith('.internal') || hostname.endsWith('.lan') || hostname === '::' ||
    hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') ||
    hostname.startsWith('fe80:')
  ) return true
  if (hostname.startsWith('::ffff:')) return isPrivateHostname(hostname.slice(7))
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
}

function safeExternalUrl(raw: string): URL {
  const url = new URL(raw)
  if (
    url.protocol !== 'https:' || url.username || url.password || url.port ||
    isPrivateHostname(url.hostname) || url.hostname.includes(':')
  ) {
    throw new Error('Unsafe outbound URL')
  }
  const encodedHosts = requiredEnvironment('OPENPENCIL_OUTBOUND_HTTP_HOSTS')
  if (new TextEncoder().encode(encodedHosts).byteLength > MAX_OUTBOUND_HOSTS_BYTES) {
    throw new Error('Outbound host policy is unavailable')
  }
  const hosts = encodedHosts
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  if (
    hosts.length === 0 || hosts.length > MAX_OUTBOUND_HOSTS ||
    new Set(hosts).size !== hosts.length ||
    hosts.some((host) => !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host)) ||
    !hosts.includes(url.hostname.toLowerCase())
  ) {
    throw new Error('Outbound host is not allowed')
  }
  return url
}

async function readResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let onAbort: () => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Outbound request failed'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    if (signal.aborted) throw new Error('Outbound request failed')
    const result = await Promise.race([reader.read(), aborted])
    if (signal.aborted) throw new Error('Outbound request failed')
    return result
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error('Response too large')
  }
  const reader = response.body?.getReader()
  if (!reader) {
    if (signal.aborted) throw new Error('Outbound request failed')
    return null
  }
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await readResponseChunk(reader, signal)
      if (signal.aborted) throw new Error('Outbound request failed')
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        throw new Error('Response too large')
      }
      chunks.push(value)
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes)
  if (!text) return null
  return (response.headers.get('content-type') ?? '').includes('application/json')
    ? JSON.parse(text)
    : text
}

async function safeHttpRequest(input: {
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
}): Promise<unknown> {
  const url = safeExternalUrl(input.url)
  const serializedBody =
    input.body === undefined
      ? undefined
      : serializeBoundedJSON(input.body, MAX_REQUEST_BYTES, 'Outbound request too large')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const headers = { ...input.headers }
    if (input.body !== undefined && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
    const response = await ${EMITTED_EDGE_RUNTIME_IDENTIFIERS.request}(url, {
      method: input.method,
      headers,
      ...(serializedBody === undefined ? {} : { body: serializedBody }),
      credentials: 'omit',
      redirect: 'manual',
      signal: controller.signal
    })
    if (response.status >= 300 && response.status < 400) throw new Error('Redirect refused')
    const data = await readBoundedResponse(response, controller.signal)
    if (controller.signal.aborted) throw new Error('Outbound request failed')
    if (!response.ok) throw new Error('Outbound request failed')
    return data
  } finally {
    clearTimeout(timer)
  }
}`

const EDGE_HANDLER = `${EMITTED_EDGE_RUNTIME_IDENTIFIERS.environment}.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  try {
    const rawBody = await readBoundedRequestText(request)
    let parsed: unknown
    try { parsed = JSON.parse(rawBody) } catch { return json({ error: 'Invalid request.' }, 400) }
    if (!isRecord(parsed) || !exactKeys(parsed, ['workflowId', 'args'])) {
      return json({ error: 'Invalid request.' }, 400)
    }
    if (typeof parsed.workflowId !== 'string' || !isRecord(parsed.args)) {
      return json({ error: 'Invalid request.' }, 400)
    }
    if (parsed.workflowId !== '__openpencil_health_v1') {
      const params = WORKFLOW_PARAMS.get(parsed.workflowId)
      if (!params) return json({ error: 'Invalid request.' }, 400)
      try { assertExactArgs(parsed.args, params) } catch { return json({ error: 'Invalid request.' }, 400) }
    } else if (Object.keys(parsed.args).length !== 0) {
      return json({ error: 'Invalid request.' }, 400)
    }

    const authorization = request.headers.get('authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Unauthorized.' }, 401)
    const userAccess = authorization.slice(7).trim()
    if (!userAccess) return json({ error: 'Unauthorized.' }, 401)
    const supabase = createClient(
      requiredEnvironment('SUPABASE_URL'),
      requiredSupabasePublishableKey(),
      {
        global: { headers: { Authorization: 'Bearer ' + userAccess } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      }
    )
    const { data, error } = await supabase.auth.getUser(userAccess)
    if (error || !data.user) return json({ error: 'Unauthorized.' }, 401)
    if (parsed.workflowId === '__openpencil_health_v1') {
      return json({
        healthy: true,
        authenticated: true,
        buildIdentity: OPENPENCIL_EDGE_BUILD_IDENTITY
      }, 200)
    }
    const result = await runWorkflow(parsed.workflowId, parsed.args, {
      supabase,
      user: data.user
    })
    return json(result.body, result.status)
  } catch {
    return json({ error: 'Server workflow failed.' }, 500)
  }
})
`
