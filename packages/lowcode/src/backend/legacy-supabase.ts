import type {
  ActionDef,
  SceneNode,
  ServerActionDef,
  ServerValueSource,
  ServerWorkflowDef,
  SupabaseFilter,
  SupabasePayloadEntry,
  WorkflowDef
} from '@open-pencil/scene-graph'

import { commandsForSupabaseAction } from '../rls-action-commands'
import { collectRlsRequirements, type RlsTableRequirement, type SqlCommand } from '../rls-advisor'
import { validateServerWorkflows } from '../server/workflows'
import { validateSupabaseConfig } from '../supabase-config'
import {
  AUTH_POLICY_IR_VERSION,
  BACKEND_APPLICATION_SPEC_VERSION,
  BACKEND_WORKFLOW_IR_VERSION,
  DATA_MODEL_IR_VERSION,
  type AuthAccessOperation,
  type BackendApplicationSpecV1,
  type BackendCapability,
  type BackendDataFilterIR,
  type BackendDataValueIR,
  type BackendDiagnostic,
  type BackendSecretRef,
  type BackendValueSource,
  type BackendWorkflowDefinitionIR,
  type BackendWorkflowStepIR,
  type DataEntityIR
} from './types'
import { parseBackendApplicationSpecV1 } from './validate'

export interface LegacyBackendGraph {
  readonly rootId: string
  getNode(id: string): SceneNode | undefined
  getAllNodes(): Iterable<SceneNode>
}

export interface LegacySupabaseLoweringResult {
  ok: boolean
  spec: BackendApplicationSpecV1
  diagnostics: BackendDiagnostic[]
}

interface LegacyUsage {
  actions: ActionDef[]
  listQueries: { table: string }[]
  storageUploads: { bucket: string }[]
}

type ResourceEntry = Omit<RlsTableRequirement, 'commands' | 'needsWriteWarning' | 'schema'> & {
  schema: string
  commands: Set<SqlCommand>
}

interface WorkflowLoweringState {
  nextStep: number
  workflowIds: ReadonlyMap<string, string>
  resources: ReadonlyMap<string, DataEntityIR>
  secrets: Map<string, BackendSecretRef>
}

interface LegacyPropertyBag {
  readonly [key: string]: unknown
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u
const COMMAND_ORDER: readonly SqlCommand[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']

function issue(
  diagnostics: BackendDiagnostic[],
  code: string,
  severity: BackendDiagnostic['severity'],
  path: string,
  message: string
): void {
  diagnostics.push({ code, severity, path, message })
}

function propertyBag(value: unknown): LegacyPropertyBag | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as LegacyPropertyBag)
    : undefined
}

function collectLegacyUsage(graph: LegacyBackendGraph): LegacyUsage {
  const actions: ActionDef[] = []
  const listQueries: { table: string }[] = []
  const storageUploads: { bucket: string }[] = []
  for (const node of graph.getAllNodes()) {
    for (const chain of Object.values(node.events ?? {})) actions.push(...chain)
    if (node.type === 'LIST') {
      const props = propertyBag(node.interactiveProps)
      const source = propertyBag(props?.dataSourceRef)
      const query = propertyBag(source?.query)
      if (source?.kind === 'supabaseQuery' && typeof query?.table === 'string') {
        listQueries.push({ table: query.table })
      }
    }
    if (node.type === 'INPUT') {
      const props = propertyBag(node.interactiveProps)
      const upload = propertyBag(props?.upload)
      if (typeof upload?.bucket === 'string') storageUploads.push({ bucket: upload.bucket })
    }
  }
  return { actions, listQueries, storageUploads }
}

function walkClientActions(
  actions: readonly ActionDef[],
  workflows: ReadonlyMap<string, WorkflowDef>,
  active: Set<string>,
  visit: (action: ActionDef) => void
): void {
  for (const action of actions) {
    visit(action)
    if (action.kind === 'condition' || action.kind === 'confirm') {
      walkClientActions(action.consequent, workflows, active, visit)
      walkClientActions(action.alternate ?? [], workflows, active, visit)
    } else if (action.kind === 'callWorkflow' && action.workflowId) {
      const workflow = workflows.get(action.workflowId)
      if (workflow && !active.has(workflow.id)) {
        active.add(workflow.id)
        walkClientActions(workflow.actions, workflows, active, visit)
        active.delete(workflow.id)
      }
    } else if (
      action.kind === 'apiCall' ||
      action.kind === 'supabaseQuery' ||
      action.kind === 'supabaseMutation' ||
      action.kind === 'invokeServerWorkflow'
    ) {
      walkClientActions(action.onSuccess ?? [], workflows, active, visit)
      walkClientActions(action.onError ?? [], workflows, active, visit)
    }
  }
}

function walkServerActions(
  actions: readonly ServerActionDef[],
  visit: (action: ServerActionDef) => void
): void {
  for (const action of actions) {
    visit(action)
    if (action.kind === 'condition') {
      walkServerActions(action.consequent, visit)
      walkServerActions(action.alternate ?? [], visit)
    }
  }
}

function mergeRequirements(
  client: readonly RlsTableRequirement[],
  workflows: readonly ServerWorkflowDef[],
  schema: string
): ResourceEntry[] {
  const resources = new Map<string, ResourceEntry>()
  const add = (
    requirementSchema: string,
    table: string,
    commands: readonly SqlCommand[],
    storageBucket?: string
  ): void => {
    const key = JSON.stringify([requirementSchema, table, storageBucket ?? null])
    const entry = resources.get(key) ?? {
      schema: requirementSchema,
      table,
      commands: new Set<SqlCommand>(),
      ...(storageBucket ? { storageBucket } : {})
    }
    for (const command of commands) entry.commands.add(command)
    resources.set(key, entry)
  }
  for (const requirement of client) {
    add(
      requirement.schema?.trim() || schema,
      requirement.table,
      requirement.commands,
      requirement.storageBucket
    )
  }
  for (const workflow of workflows) {
    walkServerActions(workflow.actions, (action) => {
      if (!('table' in action)) return
      const commands = commandsForSupabaseAction(action)
      if (commands.length > 0) add(schema, action.table.trim(), commands)
    })
  }
  return [...resources.values()].sort((left, right) =>
    JSON.stringify([left.schema, left.table, left.storageBucket ?? null]).localeCompare(
      JSON.stringify([right.schema, right.table, right.storageBucket ?? null]),
      'en'
    )
  )
}

function resourceKey(schema: string, table: string, storageBucket?: string): string {
  return JSON.stringify([schema, table, storageBucket ?? null])
}

function externalEntity(
  resource: ResourceEntry,
  index: number,
  diagnostics: BackendDiagnostic[]
): DataEntityIR | undefined {
  const isStorage = resource.schema === 'storage' && resource.table === 'objects'
  const name = isStorage ? 'storage_objects' : resource.table
  if (!IDENTIFIER.test(resource.schema) || !IDENTIFIER.test(name)) {
    issue(
      diagnostics,
      'legacy-backend-identifier-invalid',
      'error',
      `$.legacy.resources[${index}]`,
      'Legacy schema and table names must be plain identifiers before they can enter Backend IR.'
    )
    return undefined
  }
  const candidate = `external:${resource.schema}.${name}`
  return {
    id: SAFE_ID.test(candidate) ? candidate : `external-resource-${index + 1}`,
    name,
    management: 'external',
    fields: []
  }
}

function valueSource(source: ServerValueSource): BackendValueSource {
  return source.kind === 'env'
    ? { kind: 'environment', name: source.name }
    : { kind: 'expression', expression: source.expr }
}

function addEnvironmentSecret(
  source: ServerValueSource | undefined,
  secrets: Map<string, BackendSecretRef>
): void {
  if (source?.kind !== 'env') return
  secrets.set(source.name, {
    kind: 'environment',
    name: source.name,
    exposure: 'server',
    required: true
  })
}

function dataFilters(
  filters: readonly SupabaseFilter[] | undefined
): BackendDataFilterIR[] | undefined {
  if (!filters?.length) return undefined
  return filters.map((entry) => ({
    field: entry.column,
    operator: entry.op,
    value: { kind: 'expression', expression: entry.valueExpr }
  }))
}

function dataValues(
  entries: readonly SupabasePayloadEntry[] | undefined
): BackendDataValueIR[] | undefined {
  if (!entries?.length) return undefined
  return entries.map((entry) => ({
    field: entry.key,
    value: { kind: 'expression', expression: entry.valueExpr }
  }))
}

function nextStepId(state: WorkflowLoweringState): string {
  state.nextStep++
  return `step-${state.nextStep}`
}

function serverDataStep(
  action: Extract<ServerActionDef, { kind: 'supabaseQuery' | 'supabaseMutation' }>,
  stepId: string,
  state: WorkflowLoweringState,
  schema: string,
  diagnostics: BackendDiagnostic[]
): BackendWorkflowStepIR | undefined {
  const entity = state.resources.get(resourceKey(schema, action.table.trim()))
  if (!entity) {
    issue(
      diagnostics,
      'legacy-backend-resource-missing',
      'error',
      `$.legacy.serverActions.${action.id}`,
      'Legacy data action could not resolve a normalized external entity.'
    )
    return undefined
  }
  const filters = dataFilters(action.filters)
  if (action.kind === 'supabaseMutation') {
    const values = dataValues(action.payloadEntries)
    return {
      id: stepId,
      kind: 'data.mutate',
      entityId: entity.id,
      operation: action.operation,
      ...(values ? { values } : {}),
      ...(filters ? { filters } : {}),
      ...(action.resultName ? { resultName: action.resultName } : {})
    }
  }
  const fields = action.columns
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== '*')
  const validFields = fields?.every((entry) => IDENTIFIER.test(entry)) ?? true
  if (!validFields) {
    issue(
      diagnostics,
      'legacy-backend-column-invalid',
      'error',
      `$.legacy.serverActions.${action.id}.columns`,
      'Legacy query columns must be plain identifiers before they can enter Backend IR.'
    )
  }
  return {
    id: stepId,
    kind: 'data.read',
    entityId: entity.id,
    resultName: action.resultName,
    ...(fields?.length && validFields ? { fields } : {}),
    ...(filters ? { filters } : {}),
    ...(action.single !== undefined ? { single: action.single } : {})
  }
}

function serverHttpStep(
  action: Extract<ServerActionDef, { kind: 'httpRequest' }>,
  stepId: string,
  state: WorkflowLoweringState
): BackendWorkflowStepIR {
  addEnvironmentSecret(action.url, state.secrets)
  addEnvironmentSecret(action.body, state.secrets)
  for (const header of action.headers ?? []) addEnvironmentSecret(header.value, state.secrets)
  return {
    id: stepId,
    kind: 'http.request',
    method: action.method,
    url: valueSource(action.url),
    ...(action.headers?.length
      ? {
          headers: action.headers.map((header) => ({
            name: header.name,
            value: valueSource(header.value)
          }))
        }
      : {}),
    ...(action.body ? { body: valueSource(action.body) } : {}),
    ...(action.resultName ? { resultName: action.resultName } : {})
  }
}

function serverCallStep(
  action: Extract<ServerActionDef, { kind: 'callServerWorkflow' }>,
  stepId: string,
  state: WorkflowLoweringState,
  diagnostics: BackendDiagnostic[]
): BackendWorkflowStepIR | undefined {
  const workflowId = state.workflowIds.get(action.workflowId)
  if (workflowId) return { id: stepId, kind: 'call', workflowId }
  issue(
    diagnostics,
    'legacy-backend-workflow-call-missing',
    'error',
    `$.legacy.serverActions.${action.id}.workflowId`,
    'Legacy workflow call could not resolve its normalized target.'
  )
  return undefined
}

function unsupportedServerAction(_action: never): never {
  throw new Error('Unsupported legacy server action variant.')
}

function serverStep(
  action: ServerActionDef,
  stepId: string,
  state: WorkflowLoweringState,
  schema: string,
  diagnostics: BackendDiagnostic[]
): BackendWorkflowStepIR | undefined {
  switch (action.kind) {
    case 'supabaseQuery':
    case 'supabaseMutation':
      return serverDataStep(action, stepId, state, schema, diagnostics)
    case 'httpRequest':
      return serverHttpStep(action, stepId, state)
    case 'condition':
      return {
        id: stepId,
        kind: 'branch',
        condition: action.condExpr,
        consequent: serverSteps(action.consequent, state, schema, diagnostics),
        alternate: serverSteps(action.alternate ?? [], state, schema, diagnostics)
      }
    case 'return':
      return {
        id: stepId,
        kind: 'respond',
        ...(action.valueExpr ? { value: action.valueExpr } : {}),
        ...(action.status !== undefined ? { status: action.status } : {})
      }
    case 'callServerWorkflow':
      return serverCallStep(action, stepId, state, diagnostics)
    default:
      return unsupportedServerAction(action)
  }
}

function serverSteps(
  actions: readonly ServerActionDef[],
  state: WorkflowLoweringState,
  schema: string,
  diagnostics: BackendDiagnostic[]
): BackendWorkflowStepIR[] {
  const steps: BackendWorkflowStepIR[] = []
  for (const action of actions) {
    const step = serverStep(action, nextStepId(state), state, schema, diagnostics)
    if (step) steps.push(step)
  }
  return steps
}

function normalizedWorkflowId(rawId: string, index: number): string {
  return SAFE_ID.test(rawId) ? rawId : `workflow-${index + 1}`
}

function lowerServerWorkflows(
  workflows: readonly ServerWorkflowDef[],
  resources: ReadonlyMap<string, DataEntityIR>,
  schema: string,
  secrets: Map<string, BackendSecretRef>,
  diagnostics: BackendDiagnostic[]
): BackendWorkflowDefinitionIR[] {
  const workflowIds = new Map(
    workflows.map((workflow, index) => [workflow.id, normalizedWorkflowId(workflow.id, index)])
  )
  return workflows.map((workflow, index) => {
    const state: WorkflowLoweringState = { nextStep: 0, workflowIds, resources, secrets }
    const name = workflow.name.slice(0, 128) || `Legacy workflow ${index + 1}`
    if (workflow.name.length > 128) {
      issue(
        diagnostics,
        'legacy-backend-workflow-name-limit',
        'error',
        `$.legacy.serverWorkflows[${index}].name`,
        'Legacy workflow name exceeds the Backend IR limit.'
      )
    }
    return {
      id: workflowIds.get(workflow.id) ?? `workflow-${index + 1}`,
      name,
      trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
      parameters: workflow.params ?? [],
      steps: serverSteps(workflow.actions, state, schema, diagnostics)
    }
  })
}

function operationName(command: SqlCommand): AuthAccessOperation {
  return command.toLowerCase() as AuthAccessOperation
}

function validatedServerWorkflows(
  root: SceneNode | undefined,
  diagnostics: BackendDiagnostic[]
): ServerWorkflowDef[] {
  const validation = validateServerWorkflows(root?.lowcodeServerWorkflows ?? [])
  if (validation.ok) return validation.workflows
  issue(
    diagnostics,
    'legacy-backend-server-workflows-invalid',
    'error',
    '$.legacy.serverWorkflows',
    validation.error
  )
  return []
}

function inspectClientRequirements(
  root: SceneNode | undefined,
  usage: LegacyUsage,
  configured: boolean
): { usesAuth: boolean; invokesServer: boolean; workflows: ReadonlyMap<string, WorkflowDef> } {
  const workflows = new Map((root?.lowcodeWorkflows ?? []).map((entry) => [entry.id, entry]))
  let usesAuth = configured
  let invokesServer = false
  walkClientActions(usage.actions, workflows, new Set(), (action) => {
    if (action.kind === 'supabaseAuth') usesAuth = true
    if (action.kind === 'invokeServerWorkflow') invokesServer = true
  })
  return { usesAuth, invokesServer, workflows }
}

function normalizedResources(
  entries: readonly ResourceEntry[],
  diagnostics: BackendDiagnostic[]
): { entities: DataEntityIR[]; resources: ReadonlyMap<string, DataEntityIR> } {
  const entities: DataEntityIR[] = []
  const resources = new Map<string, DataEntityIR>()
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const entity = externalEntity(entry, index, diagnostics)
    if (!entity) continue
    entities.push(entity)
    resources.set(resourceKey(entry.schema, entry.table, entry.storageBucket), entity)
    issue(
      diagnostics,
      'legacy-backend-auth-intent-required',
      'error',
      `$.dataModel.entities.${entity.id}`,
      'Legacy usage cannot prove ownership, tenant, or role intent; row access remains explicitly denied.'
    )
  }
  return { entities, resources }
}

function legacySecrets(configured: boolean): Map<string, BackendSecretRef> {
  const secrets = new Map<string, BackendSecretRef>()
  if (!configured) return secrets
  secrets.set('BACKEND_PUBLIC_URL', {
    kind: 'environment',
    name: 'BACKEND_PUBLIC_URL',
    exposure: 'client-public',
    required: true
  })
  secrets.set('BACKEND_PUBLIC_KEY', {
    kind: 'environment',
    name: 'BACKEND_PUBLIC_KEY',
    exposure: 'client-public',
    required: true
  })
  return secrets
}

function legacyCapabilities(
  resources: readonly ResourceEntry[],
  workflows: readonly ServerWorkflowDef[],
  usage: LegacyUsage,
  usesAuth: boolean,
  invokesServer: boolean
): BackendCapability[] {
  const capabilities = new Set<BackendCapability>()
  if (resources.some((entry) => entry.commands.has('SELECT'))) capabilities.add('data.read')
  if (resources.some((entry) => [...entry.commands].some((command) => command !== 'SELECT'))) {
    capabilities.add('data.write')
  }
  if (resources.length > 0 || usesAuth || invokesServer || workflows.length > 0) {
    capabilities.add('auth.identity')
  }
  if (resources.length > 0) capabilities.add('policy.row-level')
  if (workflows.length > 0) capabilities.add('server.functions')
  if (workflows.length > 0) capabilities.add('server.http')
  if (usage.storageUploads.length > 0) capabilities.add('storage.objects')
  return [...capabilities].sort((left, right) => left.localeCompare(right, 'en'))
}

function denyByDefaultRowAccess(
  entries: readonly ResourceEntry[],
  resources: ReadonlyMap<string, DataEntityIR>
): BackendApplicationSpecV1['auth']['rowAccess'] {
  return entries.flatMap((entry, index) => {
    const entity = resources.get(resourceKey(entry.schema, entry.table, entry.storageBucket))
    if (!entity) return []
    const operations = COMMAND_ORDER.filter((command) => entry.commands.has(command)).map(
      operationName
    )
    return [
      {
        id: `deny-${index + 1}-anonymous`,
        entityId: entity.id,
        effect: 'deny' as const,
        operations,
        principal: { kind: 'anonymous' as const }
      },
      {
        id: `deny-${index + 1}-authenticated`,
        entityId: entity.id,
        effect: 'deny' as const,
        operations,
        principal: { kind: 'authenticated' as const }
      }
    ]
  })
}

function normalizedApplicationId(rootId: string, diagnostics: BackendDiagnostic[]): string {
  if (SAFE_ID.test(rootId)) return rootId
  issue(
    diagnostics,
    'legacy-backend-application-id-normalized',
    'warning',
    '$.applicationId',
    'Legacy document identity was normalized to a safe Backend IR identifier.'
  )
  return 'legacy-backend'
}

export function lowerLegacySupabaseApplication(
  graph: LegacyBackendGraph
): LegacySupabaseLoweringResult {
  const diagnostics: BackendDiagnostic[] = []
  const root = graph.getNode(graph.rootId)
  const config = root?.lowcodeSupabaseConfig
  const schema = config?.schema?.trim() || 'public'
  if (config) {
    const validation = validateSupabaseConfig(config)
    if (!validation.ok) {
      issue(
        diagnostics,
        'legacy-backend-config-invalid',
        'error',
        '$.legacy.config',
        `Legacy public runtime configuration is invalid: ${validation.reason ?? 'unknown reason'}.`
      )
    }
  }
  const serverWorkflows = validatedServerWorkflows(root, diagnostics)
  const usage = collectLegacyUsage(graph)
  const client = inspectClientRequirements(root, usage, Boolean(config))
  const clientRequirements = collectRlsRequirements(usage.actions, client.workflows, {
    schema,
    listQueries: usage.listQueries,
    storageUploads: usage.storageUploads
  })
  const resourceEntries = mergeRequirements(clientRequirements, serverWorkflows, schema)
  const { entities, resources } = normalizedResources(resourceEntries, diagnostics)
  const secrets = legacySecrets(Boolean(config))
  const loweredWorkflows = lowerServerWorkflows(
    serverWorkflows,
    resources,
    schema,
    secrets,
    diagnostics
  )
  const capabilities = legacyCapabilities(
    resourceEntries,
    serverWorkflows,
    usage,
    client.usesAuth,
    client.invokesServer
  )
  const applicationId = normalizedApplicationId(graph.rootId, diagnostics)
  const spec: BackendApplicationSpecV1 = {
    format: 'openpencil.backend-application',
    version: BACKEND_APPLICATION_SPEC_VERSION,
    applicationId,
    dataModel: {
      version: DATA_MODEL_IR_VERSION,
      entities,
      enums: [],
      relations: []
    },
    auth: {
      version: AUTH_POLICY_IR_VERSION,
      identities: [
        { id: 'anonymous', kind: 'anonymous' },
        { id: 'user', kind: 'user' }
      ],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: denyByDefaultRowAccess(resourceEntries, resources)
    },
    workflows: { version: BACKEND_WORKFLOW_IR_VERSION, workflows: loweredWorkflows },
    capabilities: capabilities.map((capability) => ({
      capability,
      required: true,
      reason: 'Required by normalized legacy backend usage.'
    })),
    secrets: [...secrets.values()].sort((left, right) => left.name.localeCompare(right.name, 'en'))
  }
  const parsed = parseBackendApplicationSpecV1(spec)
  diagnostics.push(...parsed.diagnostics)
  return {
    ok: diagnostics.every((entry) => entry.severity !== 'error'),
    spec: parsed.ok ? parsed.value : spec,
    diagnostics
  }
}
