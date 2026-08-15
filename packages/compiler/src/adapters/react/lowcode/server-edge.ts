import type {
  IRSupabaseFilter,
  IRSupabasePayloadEntry,
  IRServerAction,
  IRServerValueSource,
  IRServerWorkflow
} from '#compiler/ir/types'

import { emitExpression, substituteIdents, type ExprAst } from '@open-pencil/lowcode'

interface EmitScope {
  bindings: Map<string, ExprAst>
  nextLocal: number
}

export interface ServerArtifactSet {
  edgeFunction: string
  envExample: string
  manifest: string
  readme: string
}

export function buildServerArtifacts(workflows: readonly IRServerWorkflow[]): ServerArtifactSet {
  const envNames = collectEnvironmentNames(workflows)
  return {
    edgeFunction: buildEdgeFunction(workflows),
    envExample:
      ['SUPABASE_URL=', 'SUPABASE_ANON_KEY=', ...envNames.map((name) => `${name}=`)].join('\n') +
      '\n',
    manifest: buildManifest(workflows, envNames),
    readme: buildReadme(envNames)
  }
}

function buildManifest(
  workflows: readonly IRServerWorkflow[],
  envNames: readonly string[]
): string {
  return (
    JSON.stringify(
      {
        version: 1,
        function: 'openpencil-runtime',
        deploy: 'manual',
        auth: 'supabase-user',
        workflows: workflows.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          method: 'POST',
          params: workflow.params
        })),
        environment: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', ...envNames]
      },
      null,
      2
    ) + '\n'
  )
}

function buildReadme(envNames: readonly string[]): string {
  const custom = envNames.length > 0 ? ` plus ${envNames.join(', ')}` : ''
  return `# OpenPencil server workflows

This directory is generated deployment source. It is intentionally excluded from the static web bundle and is never deployed automatically.

1. Review \`supabase/functions/openpencil-runtime/index.ts\`.
2. Configure \`SUPABASE_URL\`, \`SUPABASE_ANON_KEY\`${custom} in the target Supabase project. Never commit populated secret values.
3. From this directory, run \`supabase functions deploy openpencil-runtime\`.

The function accepts authenticated POST requests only and uses the caller's bearer token for Row Level Security. It never uses a service-role credential.
`
}

function collectEnvironmentNames(workflows: readonly IRServerWorkflow[]): string[] {
  const names = new Set<string>()
  const value = (source: IRServerValueSource | undefined) => {
    if (source?.kind === 'env') names.add(source.name)
  }
  const actions = (items: readonly IRServerAction[]) => {
    for (const action of items) {
      if (action.kind === 'httpRequest') {
        value(action.url)
        value(action.body)
        for (const header of action.headers ?? []) value(header.value)
      } else if (action.kind === 'condition') {
        actions(action.consequent)
        actions(action.alternate ?? [])
      }
    }
  }
  for (const workflow of workflows) actions(workflow.actions)
  return [...names].sort()
}

function buildEdgeFunction(workflows: readonly IRServerWorkflow[]): string {
  const functions = workflows.map((workflow, index) => emitWorkflow(workflow, index)).join('\n\n')
  const dispatch = workflows
    .map(
      (workflow, index) =>
        `    case ${JSON.stringify(workflow.id)}: return __workflow${index}(args, context)`
    )
    .join('\n')
  const params = JSON.stringify(workflows.map((workflow) => [workflow.id, workflow.params]))
  return `${EDGE_PREAMBLE}

const WORKFLOW_PARAMS = new Map<string, string[]>(${params})

${functions}

async function runWorkflow(
  workflowId: string,
  args: Record<string, unknown>,
  context: WorkflowContext
): Promise<WorkflowResult> {
  switch (workflowId) {
${dispatch}
    default: throw new Error('Unknown workflow')
  }
}

${EDGE_HANDLER}`
}

function emitWorkflow(workflow: IRServerWorkflow, index: number): string {
  const bindings = new Map<string, ExprAst>()
  bindings.set('$currentUser', { kind: 'ident', name: '__currentUser' })
  const params = workflow.params.map((name, paramIndex) => {
    const local = `__arg${paramIndex}`
    bindings.set(name, { kind: 'ident', name: local })
    return `  const ${local}: any = args[${JSON.stringify(name)}]`
  })
  const scope: EmitScope = { bindings, nextLocal: workflow.params.length }
  const body = emitActions(workflow.actions, scope, '  ')
  return `async function __workflow${index}(
  args: Record<string, unknown>,
  context: WorkflowContext
): Promise<WorkflowResult> {
  assertExactArgs(args, ${JSON.stringify(workflow.params)})
  const __currentUser: any = context.user
${params.join('\n')}${params.length > 0 ? '\n' : ''}${body}  return { status: 200, body: null }
}`
}

function emitActions(actions: readonly IRServerAction[], scope: EmitScope, indent: string): string {
  let output = ''
  for (const action of actions) output += emitAction(action, scope, indent)
  return output
}

function emitAction(action: IRServerAction, scope: EmitScope, indent: string): string {
  switch (action.kind) {
    case 'httpRequest':
      return emitHttpAction(action, scope, indent)
    case 'supabaseQuery':
      return emitQueryAction(action, scope, indent)
    case 'supabaseMutation':
      return emitMutationAction(action, scope, indent)
    case 'condition': {
      const consequent = cloneScope(scope)
      const alternate = cloneScope(scope)
      const elseBlock = action.alternate
        ? ` else {\n${emitActions(action.alternate, alternate, `${indent}  `)}${indent}}`
        : ''
      return `${indent}if (${emitAst(action.condAst, scope)}) {\n${emitActions(
        action.consequent,
        consequent,
        `${indent}  `
      )}${indent}}${elseBlock}\n`
    }
    case 'return':
      return `${indent}return { status: ${action.status}, body: ${
        action.valueAst ? emitAst(action.valueAst, scope) : 'null'
      } }\n`
    case 'callServerWorkflow': {
      const args = emitEntries(action.args, scope)
      const local = nextLocal(scope, 'call')
      return (
        `${indent}const ${local} = await runWorkflow(${JSON.stringify(action.workflowId)}, ${args}, context)\n` +
        `${indent}if (${local}.status >= 400) return ${local}\n`
      )
    }
  }
  const exhaustive: never = action
  throw new Error(`unhandled server action kind: ${JSON.stringify(exhaustive)}`)
}

function emitHttpAction(
  action: Extract<IRServerAction, { kind: 'httpRequest' }>,
  scope: EmitScope,
  indent: string
): string {
  const headers = action.headers?.length
    ? `{ ${action.headers
        .map(
          (header) => `${JSON.stringify(header.name)}: String(${emitValue(header.value, scope)})`
        )
        .join(', ')} }`
    : '{}'
  const result = action.resultName ? bindResult(action.resultName, scope, 'http') : nextLocal(scope)
  const declaration = action.resultName ? `const ${result}: any = ` : ''
  const call = `await safeHttpRequest({ method: ${JSON.stringify(action.method)}, url: String(${emitValue(
    action.url,
    scope
  )}), headers: ${headers}${action.body ? `, body: ${emitValue(action.body, scope)}` : ''} })`
  return action.resultName ? `${indent}${declaration}${call}\n` : `${indent}${call}\n`
}

function emitQueryAction(
  action: Extract<IRServerAction, { kind: 'supabaseQuery' }>,
  scope: EmitScope,
  indent: string
): string {
  const operation = nextLocal(scope, 'query')
  const result = bindResult(action.resultName, scope, 'value')
  const chain = `context.supabase.from(${JSON.stringify(action.table)}).select(${JSON.stringify(
    action.columns
  )})${emitFilters(action.filters, scope)}${action.single ? '.single()' : ''}`
  return (
    `${indent}const ${operation} = await ${chain}\n` +
    `${indent}if (${operation}.error) throw new Error('Database request failed')\n` +
    `${indent}const ${result}: any = ${operation}.data\n`
  )
}

function emitMutationAction(
  action: Extract<IRServerAction, { kind: 'supabaseMutation' }>,
  scope: EmitScope,
  indent: string
): string {
  const operation = nextLocal(scope, 'mutation')
  const payload = emitEntries(action.payloadEntries ?? [], scope)
  let chain = `context.supabase.from(${JSON.stringify(action.table)})`
  if (action.operation === 'delete') chain += '.delete()'
  else chain += `.${action.operation}(${payload})`
  chain += emitFilters(action.filters, scope)
  if (action.resultName) chain += '.select()'
  let output = `${indent}const ${operation} = await ${chain}\n`
  output += `${indent}if (${operation}.error) throw new Error('Database request failed')\n`
  if (action.resultName) {
    const result = bindResult(action.resultName, scope, 'value')
    output += `${indent}const ${result}: any = ${operation}.data\n`
  }
  return output
}

function emitFilters(filters: readonly IRSupabaseFilter[], scope: EmitScope): string {
  return filters
    .map(
      (filter) => `.${filter.op}(${JSON.stringify(filter.column)}, ${emitAst(filter.ast, scope)})`
    )
    .join('')
}

function emitEntries(entries: readonly IRSupabasePayloadEntry[], scope: EmitScope): string {
  return `{ ${entries
    .map((entry) => `${JSON.stringify(entry.key)}: ${emitAst(entry.ast, scope)}`)
    .join(', ')} }`
}

function emitValue(source: IRServerValueSource, scope: EmitScope): string {
  return source.kind === 'env'
    ? `requiredEnvironment(${JSON.stringify(source.name)})`
    : emitAst(source.ast, scope)
}

function emitAst(ast: ExprAst, scope: EmitScope): string {
  return emitExpression(substituteIdents(ast, scope.bindings))
}

function cloneScope(scope: EmitScope): EmitScope {
  return { bindings: new Map(scope.bindings), nextLocal: scope.nextLocal }
}

function nextLocal(scope: EmitScope, hint = 'unused'): string {
  return `__${hint}${scope.nextLocal++}`
}

function bindResult(name: string, scope: EmitScope, hint: string): string {
  const local = nextLocal(scope, hint)
  scope.bindings.set(name, { kind: 'ident', name: local })
  return local
}

const EDGE_PREAMBLE = `import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

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

function json(body: unknown, status: number): Response {
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status, headers: JSON_HEADERS })
  }
  return new Response(JSON.stringify(body ?? null), { status, headers: JSON_HEADERS })
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

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error('Required environment is unavailable')
  return value
}

function isPrivateHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\\[|\\]$/g, '')
  if (
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
    hostname.endsWith('.internal') || hostname.endsWith('.lan') || hostname === '::' ||
    hostname === '::1'
  ) return true
  if (hostname.startsWith('::ffff:')) return isPrivateHostname(hostname.slice(7))
  if (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')) return true
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
}

function safeExternalUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || isPrivateHostname(url.hostname)) {
    throw new Error('Unsafe outbound URL')
  }
  return url
}

async function readBoundedResponse(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_RESPONSE_BYTES) throw new Error('Response too large')
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('Response too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes)
  if (text === '') return null
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json') ? JSON.parse(text) : text
}

async function safeHttpRequest(input: {
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
}): Promise<unknown> {
  const url = safeExternalUrl(input.url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const headers = { ...input.headers }
    if (input.body !== undefined && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
    const response = await fetch(url, {
      method: input.method,
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      credentials: 'omit',
      redirect: 'manual',
      signal: controller.signal
    })
    if (response.status >= 300 && response.status < 400) throw new Error('Redirect refused')
    const data = await readBoundedResponse(response)
    if (!response.ok) throw new Error('Outbound request failed')
    return data
  } finally {
    clearTimeout(timer)
  }
}`

const EDGE_HANDLER = `Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  try {
    const declared = Number(request.headers.get('content-length') ?? '0')
    if (declared > MAX_REQUEST_BYTES) return json({ error: 'Invalid request.' }, 400)
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: 'Invalid request.' }, 400)
    }
    let parsed: unknown
    try { parsed = JSON.parse(rawBody) } catch { return json({ error: 'Invalid request.' }, 400) }
    if (!isRecord(parsed) || !exactKeys(parsed, ['workflowId', 'args'])) {
      return json({ error: 'Invalid request.' }, 400)
    }
    if (typeof parsed.workflowId !== 'string' || !isRecord(parsed.args)) {
      return json({ error: 'Invalid request.' }, 400)
    }
    const params = WORKFLOW_PARAMS.get(parsed.workflowId)
    if (!params) return json({ error: 'Invalid request.' }, 400)
    try { assertExactArgs(parsed.args, params) } catch { return json({ error: 'Invalid request.' }, 400) }

    const authorization = request.headers.get('authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Unauthorized.' }, 401)
    const token = authorization.slice(7).trim()
    if (!token) return json({ error: 'Unauthorized.' }, 401)
    const supabase = createClient(
      requiredEnvironment('SUPABASE_URL'),
      requiredEnvironment('SUPABASE_ANON_KEY'),
      {
        global: { headers: { Authorization: 'Bearer ' + token } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      }
    )
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) return json({ error: 'Unauthorized.' }, 401)
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
