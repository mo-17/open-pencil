import type {
  ActionDef,
  SceneNode,
  ServerActionDef,
  ServerValueSource,
  ServerWorkflowDef,
  SupabaseConfig,
  WorkflowDef
} from '@open-pencil/scene-graph'

import {
  collectRlsRequirements,
  type RlsListQueryUsage,
  type RlsStorageUploadUsage,
  type RlsTableRequirement,
  type SqlCommand
} from './rls-advisor'
import { validateServerWorkflows } from './server/workflows'
import { validateSupabaseConfig } from './supabase-config'

export type ApplicationRuntimeEnvironment = 'preview' | 'staging' | 'production'
export type ApplicationRuntimeIssueSeverity = 'error' | 'warning'

export interface ApplicationRuntimeIssue {
  code:
    | 'supabase-config-required'
    | 'supabase-config-invalid'
    | 'supabase-production-https-required'
    | 'supabase-schema-invalid'
    | 'supabase-schema-unverified'
    | 'supabase-table-unverified'
    | 'rls-verification-required'
    | 'server-workflows-invalid'
    | 'server-workflows-deploy-required'
    | 'server-environment-required'
  severity: ApplicationRuntimeIssueSeverity
  message: string
}

export interface ApplicationRuntimeAuditOptions {
  /** Defaults to preview so editor/compiler diagnostics remain non-blocking. */
  environment?: ApplicationRuntimeEnvironment
  /** Undefined uses the document root config. Null explicitly means no effective config. */
  effectiveSupabaseConfig?: SupabaseConfig | null
  /** Set after an operator has reviewed and applied production RLS policies. */
  rlsVerified?: boolean
  /** Set by a deploy orchestrator only after the generated server runtime is live. */
  serverWorkflowsDeployed?: boolean
  /** Optional schema-catalog table names for typo/staleness diagnostics. */
  knownTables?: readonly string[]
}

export interface ApplicationRuntimeGraph {
  readonly rootId: string
  getNode(id: string): SceneNode | undefined
  getAllNodes(): Iterable<SceneNode>
}

export interface ApplicationRuntimeAudit {
  environment: ApplicationRuntimeEnvironment
  ready: boolean
  usesSupabase: boolean
  serverWorkflowCount: number
  requiredServerEnvironment: string[]
  rlsRequirements: RlsTableRequirement[]
  issues: ApplicationRuntimeIssue[]
}

interface CollectedClientUsage {
  actions: ActionDef[]
  listQueries: RlsListQueryUsage[]
  storageUploads: RlsStorageUploadUsage[]
  usesSupabase: boolean
}

interface PropertyBag {
  [key: string]: unknown
}

const COMMAND_ORDER: readonly SqlCommand[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
const SCHEMA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/

function isPropertyBag(value: unknown): value is PropertyBag {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function actionUsesSupabase(
  action: ActionDef,
  workflows: ReadonlyMap<string, WorkflowDef>,
  activeWorkflows: Set<string>
): boolean {
  if (
    action.kind === 'supabaseQuery' ||
    action.kind === 'supabaseMutation' ||
    action.kind === 'supabaseAuth' ||
    action.kind === 'invokeServerWorkflow'
  ) {
    return true
  }
  if (action.kind === 'condition' || action.kind === 'confirm') {
    return scanClientActions(
      [...action.consequent, ...(action.alternate ?? [])],
      workflows,
      activeWorkflows
    )
  }
  if (action.kind === 'callWorkflow') {
    if (!action.workflowId) return false
    const workflow = workflows.get(action.workflowId)
    if (!workflow || activeWorkflows.has(workflow.id)) return false
    activeWorkflows.add(workflow.id)
    const result = scanClientActions(workflow.actions, workflows, activeWorkflows)
    activeWorkflows.delete(workflow.id)
    return result
  }
  if (action.kind !== 'apiCall') return false
  return scanClientActions(
    [...(action.onSuccess ?? []), ...(action.onError ?? [])],
    workflows,
    activeWorkflows
  )
}

function scanClientActions(
  actions: readonly ActionDef[],
  workflows: ReadonlyMap<string, WorkflowDef>,
  activeWorkflows: Set<string>
): boolean {
  return actions.some((action) => actionUsesSupabase(action, workflows, activeWorkflows))
}

function collectNodeClientUsage(
  node: SceneNode,
  usage: Omit<CollectedClientUsage, 'usesSupabase'>
): void {
  for (const chain of Object.values(node.events ?? {})) {
    usage.actions.push(...chain)
  }
  const props = node.interactiveProps
  if (node.type === 'LIST') {
    const source = isPropertyBag(props?.dataSourceRef) ? props.dataSourceRef : undefined
    const query = isPropertyBag(source?.query) ? source.query : undefined
    if (source?.kind === 'supabaseQuery' && typeof query?.table === 'string') {
      usage.listQueries.push({ table: query.table })
    }
    return
  }
  if (node.type !== 'INPUT') return
  const upload = isPropertyBag(props?.upload) ? props.upload : undefined
  if (typeof upload?.bucket === 'string') usage.storageUploads.push({ bucket: upload.bucket })
}

function collectClientUsage(
  nodes: Iterable<SceneNode>,
  workflows: ReadonlyMap<string, WorkflowDef>
): CollectedClientUsage {
  const actions: ActionDef[] = []
  const listQueries: RlsListQueryUsage[] = []
  const storageUploads: RlsStorageUploadUsage[] = []
  for (const node of nodes) {
    collectNodeClientUsage(node, { actions, listQueries, storageUploads })
  }
  return {
    actions,
    listQueries,
    storageUploads,
    usesSupabase:
      listQueries.length > 0 ||
      storageUploads.length > 0 ||
      scanClientActions(actions, workflows, new Set())
  }
}

function serverCommands(action: ServerActionDef): SqlCommand[] {
  if (action.kind === 'supabaseQuery') return ['SELECT']
  if (action.kind !== 'supabaseMutation') return []
  if (action.operation === 'insert') return ['INSERT']
  if (action.operation === 'update') return ['SELECT', 'UPDATE']
  if (action.operation === 'delete') return ['SELECT', 'DELETE']
  return ['SELECT', 'INSERT', 'UPDATE']
}

function walkServerActions(
  actions: readonly ServerActionDef[],
  visit: (action: ServerActionDef) => void
): void {
  for (const action of actions) {
    visit(action)
    if (action.kind !== 'condition') continue
    walkServerActions(action.consequent, visit)
    walkServerActions(action.alternate ?? [], visit)
  }
}

function collectServerRlsRequirements(
  workflows: readonly ServerWorkflowDef[],
  schema: string
): RlsTableRequirement[] {
  const byTable = new Map<string, Set<SqlCommand>>()
  for (const workflow of workflows) {
    walkServerActions(workflow.actions, (action) => {
      const commands = serverCommands(action)
      if (commands.length === 0 || !('table' in action)) return
      const table = action.table.trim()
      if (!table) return
      const existing = byTable.get(table) ?? new Set<SqlCommand>()
      for (const command of commands) existing.add(command)
      byTable.set(table, existing)
    })
  }
  return [...byTable].map(([table, commands]) => ({
    schema,
    table,
    commands: COMMAND_ORDER.filter((command) => commands.has(command)),
    needsWriteWarning: commands.has('UPDATE') || commands.has('DELETE')
  }))
}

function mergeRlsRequirements(
  client: readonly RlsTableRequirement[],
  server: readonly RlsTableRequirement[]
): RlsTableRequirement[] {
  const merged = new Map<string, RlsTableRequirement>()
  for (const requirement of [...client, ...server]) {
    const schema = requirement.schema?.trim() || 'public'
    const key = JSON.stringify([schema, requirement.table, requirement.storageBucket ?? null])
    const current = merged.get(key)
    const commands = new Set<SqlCommand>(current?.commands)
    for (const command of requirement.commands) commands.add(command)
    merged.set(key, {
      schema,
      table: requirement.table,
      commands: COMMAND_ORDER.filter((command) => commands.has(command)),
      needsWriteWarning: commands.has('UPDATE') || commands.has('DELETE'),
      ...(requirement.storageBucket ? { storageBucket: requirement.storageBucket } : {})
    })
  }
  return [...merged.values()]
}

function collectEnvironmentNames(workflows: readonly ServerWorkflowDef[]): string[] {
  const names = new Set<string>()
  const add = (source: ServerValueSource | undefined): void => {
    if (source?.kind === 'env') names.add(source.name)
  }
  for (const workflow of workflows) {
    walkServerActions(workflow.actions, (action) => {
      if (action.kind !== 'httpRequest') return
      add(action.url)
      add(action.body)
      for (const header of action.headers ?? []) add(header.value)
    })
  }
  return [...names].sort()
}

function effectiveConfig(
  rootConfig: SupabaseConfig | undefined,
  options: ApplicationRuntimeAuditOptions
): SupabaseConfig | undefined {
  if (options.effectiveSupabaseConfig === null) return undefined
  return options.effectiveSupabaseConfig ?? rootConfig
}

function validateRuntimeConfig(
  config: SupabaseConfig,
  environment: ApplicationRuntimeEnvironment,
  issues: ApplicationRuntimeIssue[]
): void {
  const validation = validateSupabaseConfig(config)
  if (!validation.ok) {
    issues.push({
      code: 'supabase-config-invalid',
      severity: 'error',
      message: `Supabase runtime configuration is invalid: ${validation.reason ?? 'unknown reason'}.`
    })
    return
  }
  let url: URL
  try {
    url = new URL(config.url.trim())
  } catch {
    issues.push({
      code: 'supabase-config-invalid',
      severity: 'error',
      message: 'Supabase runtime URL is invalid.'
    })
    return
  }
  if (url.username || url.password) {
    issues.push({
      code: 'supabase-config-invalid',
      severity: 'error',
      message: 'Supabase runtime URL must not contain credentials.'
    })
  }
  if (environment === 'production' && url.protocol !== 'https:') {
    issues.push({
      code: 'supabase-production-https-required',
      severity: 'error',
      message: 'Production Supabase runtime configuration must use HTTPS.'
    })
  }
  const schema = config.schema?.trim()
  if (schema && !SCHEMA_IDENTIFIER.test(schema)) {
    issues.push({
      code: 'supabase-schema-invalid',
      severity: 'error',
      message: 'Supabase schema must be a plain PostgreSQL identifier up to 63 characters.'
    })
  }
}

function appendSchemaIssues(
  requirements: readonly RlsTableRequirement[],
  schema: string,
  knownTableNames: readonly string[] | undefined,
  issues: ApplicationRuntimeIssue[]
): void {
  if (!knownTableNames) {
    if (requirements.length > 0) {
      issues.push({
        code: 'supabase-schema-unverified',
        severity: 'warning',
        message: 'Supabase table names have not been checked against a current schema catalog.'
      })
    }
    return
  }
  const knownTables = new Set(knownTableNames)
  for (const requirement of requirements) {
    if ((requirement.schema ?? 'public') !== schema || knownTables.has(requirement.table)) continue
    issues.push({
      code: 'supabase-table-unverified',
      severity: 'warning',
      message: `Supabase table ${schema}.${requirement.table} is absent from the inspected schema catalog.`
    })
  }
}

function appendProductionIssues(
  requirements: readonly RlsTableRequirement[],
  environment: ApplicationRuntimeEnvironment,
  rlsVerified: boolean,
  issues: ApplicationRuntimeIssue[]
): void {
  if (environment !== 'production' || requirements.length === 0 || rlsVerified) return
  issues.push({
    code: 'rls-verification-required',
    severity: 'warning',
    message: 'Review and verify production RLS policies for every listed table before release.'
  })
}

function appendServerDeploymentIssues(
  workflowCount: number,
  environmentNames: readonly string[],
  deployed: boolean,
  issues: ApplicationRuntimeIssue[]
): void {
  if (workflowCount > 0 && !deployed) {
    issues.push({
      code: 'server-workflows-deploy-required',
      severity: 'warning',
      message: 'Generated server workflows must be deployed before client actions can invoke them.'
    })
  }
  if (environmentNames.length === 0) return
  issues.push({
    code: 'server-environment-required',
    severity: 'warning',
    message: `Configure server environment variables: ${environmentNames.join(', ')}.`
  })
}

/** Build a deterministic, secret-free readiness report for editor preview,
 * compiler diagnostics, and deploy preflight. This does not claim to inspect
 * live RLS policies or deployment state: callers must explicitly supply those
 * acknowledgements after performing the external checks. */
export function auditApplicationRuntime(
  graph: ApplicationRuntimeGraph,
  options: ApplicationRuntimeAuditOptions = {}
): ApplicationRuntimeAudit {
  const environment = options.environment ?? 'preview'
  const root = graph.getNode(graph.rootId)
  const workflows = new Map<string, WorkflowDef>(
    (root?.lowcodeWorkflows ?? []).map((workflow) => [workflow.id, workflow])
  )
  const client = collectClientUsage(graph.getAllNodes(), workflows)
  const rawServerWorkflows = root?.lowcodeServerWorkflows ?? []
  const serverValidation = validateServerWorkflows(rawServerWorkflows, 'lowcodeServerWorkflows')
  const issues: ApplicationRuntimeIssue[] = []
  const serverWorkflows = serverValidation.ok ? serverValidation.workflows : []
  if (!serverValidation.ok) {
    issues.push({
      code: 'server-workflows-invalid',
      severity: 'error',
      message: `Server workflow definitions are invalid: ${serverValidation.error}.`
    })
  }

  const config = effectiveConfig(root?.lowcodeSupabaseConfig, options)
  const usesSupabase = client.usesSupabase || rawServerWorkflows.length > 0
  if (usesSupabase && !config) {
    issues.push({
      code: 'supabase-config-required',
      severity: 'error',
      message: 'This application uses Supabase but has no effective public runtime configuration.'
    })
  } else if (config) {
    validateRuntimeConfig(config, environment, issues)
  }

  const schema = config?.schema?.trim() || 'public'
  const clientRls = collectRlsRequirements(client.actions, workflows, {
    schema,
    listQueries: client.listQueries,
    storageUploads: client.storageUploads
  })
  const serverRls = collectServerRlsRequirements(serverWorkflows, schema)
  const rlsRequirements = mergeRlsRequirements(clientRls, serverRls)
  appendSchemaIssues(rlsRequirements, schema, options.knownTables, issues)
  appendProductionIssues(rlsRequirements, environment, options.rlsVerified === true, issues)

  const requiredServerEnvironment = collectEnvironmentNames(serverWorkflows)
  appendServerDeploymentIssues(
    rawServerWorkflows.length,
    requiredServerEnvironment,
    options.serverWorkflowsDeployed === true,
    issues
  )

  return {
    environment,
    ready: !issues.some((issue) => issue.severity === 'error'),
    usesSupabase,
    serverWorkflowCount: rawServerWorkflows.length,
    requiredServerEnvironment,
    rlsRequirements,
    issues
  }
}
