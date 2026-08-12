/* eslint-disable max-lines -- The fixed result schema, static finding copy, bounded scanner, and host authority stay one reviewable security boundary. */

import {
  auditApplicationRuntime,
  detectSupabaseSecretKey,
  isSafeLowcodeHeadLinkHref,
  unsafeLowcodeCustomCSSURLs,
  unsafeLowcodeHeadMetaRefreshURL,
  validateAnalyticsConfig
} from '@open-pencil/core/lowcode-validation'
import type { ApplicationRuntimeIssue } from '@open-pencil/core/lowcode-validation'
import type {
  PluginContributionDataContractV2,
  PluginObjectParameterSchemaV2
} from '@open-pencil/core/plugins'
import type {
  ActionDef,
  AnalyticsConfig,
  SceneNode,
  ServerWorkflowDef,
  SupabaseConfig,
  WorkflowDef
} from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'

export const APPLICATION_SECURITY_READINESS_PLUGIN_ID = 'open-pencil.application-security-readiness'
export const APPLICATION_SECURITY_READINESS_COMMAND_ID = 'run-application-security-readiness'
export const APPLICATION_SECURITY_READINESS_ADAPTER_ID =
  'open-pencil.audit.application-security-readiness'

export const APPLICATION_SECURITY_READINESS_LIMITS = Object.freeze({
  nodes: 4_096,
  actions: 8_192,
  actionsPerChain: 512,
  actionDepth: 32,
  workflows: 512,
  serverWorkflows: 256,
  structuredValues: 32_768,
  structuredDepth: 32,
  structuredMembersPerContainer: 256,
  stringCodePoints: 4_096,
  totalStringCodePoints: 262_144,
  customCssCodeUnits: 64 * 1024,
  headEntries: 256,
  checkpointWork: 128,
  findings: 32,
  reportBytes: 64 * 1024
})

export type ApplicationSecurityReadinessFindingCode =
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
  | 'supabase-secret-key-embedded'
  | 'auth-guard-runtime-required'
  | 'insecure-client-endpoint'
  | 'dynamic-client-authority'
  | 'invalid-client-endpoint'
  | 'client-endpoint-credentials'
  | 'analytics-config-invalid'
  | 'insecure-analytics-endpoint'
  | 'analytics-consent-review-required'
  | 'unsafe-custom-css-url'
  | 'unsafe-head-link'
  | 'unsafe-meta-refresh'
  | 'cross-origin-credentials-review'
  | 'lowcode-structure-invalid'

export type ApplicationSecurityReadinessCategory =
  | 'configuration'
  | 'data-access'
  | 'transport'
  | 'server-runtime'
  | 'privacy'
  | 'custom-code'

export type ApplicationSecurityReadinessSeverity = 'error' | 'warning'

export interface ApplicationSecurityReadinessFinding extends JSONObject {
  code: ApplicationSecurityReadinessFindingCode
  category: ApplicationSecurityReadinessCategory
  severity: ApplicationSecurityReadinessSeverity
  title: string
  remediation: string
  occurrences: number
}

export interface ApplicationSecurityReadinessSummary extends JSONObject {
  visitedNodeCount: number
  visitedActionCount: number
  clientEndpointCount: number
  authGuardedPageCount: number
  usesSupabase: boolean
  serverWorkflowCount: number
  rlsResourceCount: number
  serverEnvironmentBindingCount: number
}

export interface ApplicationSecurityReadinessResult extends JSONObject {
  kind: 'application-security-readiness'
  scope: 'document'
  pluginId: typeof APPLICATION_SECURITY_READINESS_PLUGIN_ID
  commandId: typeof APPLICATION_SECURITY_READINESS_COMMAND_ID
  environment: 'production'
  status: 'pass' | 'review' | 'blocked'
  errorCount: number
  warningCount: number
  findingCount: number
  truncated: boolean
  summary: ApplicationSecurityReadinessSummary
  findings: ApplicationSecurityReadinessFinding[]
  notEvaluated: string[]
  disclaimer: string
}

export interface RunApplicationSecurityReadinessOptions {
  signal?: AbortSignal
}

interface FindingDefinition {
  category: ApplicationSecurityReadinessCategory
  severity: ApplicationSecurityReadinessSeverity
  title: string
  remediation: string
}

const FINDING_DEFINITIONS: Readonly<
  Record<ApplicationSecurityReadinessFindingCode, FindingDefinition>
> = Object.freeze({
  'supabase-config-required': Object.freeze({
    category: 'configuration',
    severity: 'error',
    title: 'Public Supabase runtime configuration is missing',
    remediation:
      'Configure the public project URL and publishable or legacy anon key before deployment.'
  }),
  'supabase-config-invalid': Object.freeze({
    category: 'configuration',
    severity: 'error',
    title: 'Supabase runtime configuration is invalid',
    remediation:
      'Replace the runtime configuration with a valid public project URL and publishable key.'
  }),
  'supabase-production-https-required': Object.freeze({
    category: 'transport',
    severity: 'error',
    title: 'Production Supabase transport is not HTTPS',
    remediation: 'Use an HTTPS Supabase project URL for production.'
  }),
  'supabase-schema-invalid': Object.freeze({
    category: 'configuration',
    severity: 'error',
    title: 'Supabase schema identifier is invalid',
    remediation: 'Use a plain PostgreSQL schema identifier no longer than 63 characters.'
  }),
  'supabase-schema-unverified': Object.freeze({
    category: 'data-access',
    severity: 'warning',
    title: 'Referenced Supabase resources were not checked against a live schema',
    remediation: 'Inspect the current project schema and resolve missing or renamed resources.'
  }),
  'supabase-table-unverified': Object.freeze({
    category: 'data-access',
    severity: 'warning',
    title: 'A referenced Supabase table was not found in the inspected schema',
    remediation: 'Review the current project schema and update the affected low-code operation.'
  }),
  'rls-verification-required': Object.freeze({
    category: 'data-access',
    severity: 'warning',
    title: 'Production Row Level Security has not been verified',
    remediation:
      'Review and test least-privilege RLS policies with anonymous and authenticated accounts.'
  }),
  'server-workflows-invalid': Object.freeze({
    category: 'server-runtime',
    severity: 'error',
    title: 'Server workflow definitions are invalid',
    remediation: 'Repair invalid server workflow triggers, actions, and bounded value sources.'
  }),
  'server-workflows-deploy-required': Object.freeze({
    category: 'server-runtime',
    severity: 'warning',
    title: 'Server workflows require a verified deployment',
    remediation: 'Deploy the generated server runtime and verify authenticated invocation.'
  }),
  'server-environment-required': Object.freeze({
    category: 'server-runtime',
    severity: 'warning',
    title: 'Server workflows depend on environment configuration',
    remediation:
      'Configure required values in the deployment secret store and verify rotation procedures.'
  }),
  'supabase-secret-key-embedded': Object.freeze({
    category: 'configuration',
    severity: 'error',
    title: 'A privileged Supabase key is embedded in the document',
    remediation:
      'Remove the privileged key, rotate it immediately, and use only a publishable or legacy anon key in the client.'
  }),
  'auth-guard-runtime-required': Object.freeze({
    category: 'configuration',
    severity: 'error',
    title: 'An authentication guard has no Supabase runtime configuration',
    remediation: 'Configure the authentication runtime before relying on guarded pages.'
  }),
  'insecure-client-endpoint': Object.freeze({
    category: 'transport',
    severity: 'error',
    title: 'A client-side endpoint uses unencrypted HTTP',
    remediation: 'Move the endpoint to HTTPS before production.'
  }),
  'dynamic-client-authority': Object.freeze({
    category: 'transport',
    severity: 'warning',
    title: 'A client-side endpoint has a dynamic network authority',
    remediation:
      'Use a fixed reviewed HTTPS origin or validate the allowed host set in a trusted server adapter.'
  }),
  'invalid-client-endpoint': Object.freeze({
    category: 'transport',
    severity: 'error',
    title: 'A client-side endpoint is not a safe HTTPS or root-relative URL',
    remediation: 'Replace it with a fixed HTTPS URL or a root-relative same-origin path.'
  }),
  'client-endpoint-credentials': Object.freeze({
    category: 'transport',
    severity: 'error',
    title: 'A client-side endpoint URL contains credentials',
    remediation: 'Remove URL credentials and resolve authorization through a protected runtime.'
  }),
  'analytics-config-invalid': Object.freeze({
    category: 'privacy',
    severity: 'error',
    title: 'Analytics configuration is invalid',
    remediation: 'Correct the provider, public identifier, endpoint, and policy URL settings.'
  }),
  'insecure-analytics-endpoint': Object.freeze({
    category: 'transport',
    severity: 'error',
    title: 'The analytics endpoint uses unencrypted HTTP',
    remediation: 'Use the provider default or a reviewed HTTPS analytics endpoint.'
  }),
  'analytics-consent-review-required': Object.freeze({
    category: 'privacy',
    severity: 'warning',
    title: 'Analytics can start without explicit runtime consent',
    remediation:
      'Review applicable privacy requirements and enable consent gating where it is required.'
  }),
  'unsafe-custom-css-url': Object.freeze({
    category: 'custom-code',
    severity: 'error',
    title: 'Custom CSS contains an unsafe URL protocol',
    remediation: 'Remove the URL or replace it with a reviewed HTTPS or relative resource.'
  }),
  'unsafe-head-link': Object.freeze({
    category: 'custom-code',
    severity: 'error',
    title: 'Head metadata contains an unsafe link target',
    remediation: 'Use an allowed HTTPS, HTTP, mail, telephone, or relative target as appropriate.'
  }),
  'unsafe-meta-refresh': Object.freeze({
    category: 'custom-code',
    severity: 'error',
    title: 'Head metadata contains an unsafe refresh target',
    remediation: 'Remove the refresh or use a reviewed HTTPS or relative destination.'
  }),
  'cross-origin-credentials-review': Object.freeze({
    category: 'custom-code',
    severity: 'warning',
    title: 'A head resource requests cross-origin credentials',
    remediation:
      'Verify the resource origin, CORS policy, cache behavior, and whether credentials are necessary.'
  }),
  'lowcode-structure-invalid': Object.freeze({
    category: 'configuration',
    severity: 'warning',
    title: 'Some low-code security-relevant structure could not be inspected',
    remediation: 'Open and resave the affected low-code configuration, then run the audit again.'
  })
})

const FINDING_CODES = Object.freeze(
  Object.keys(FINDING_DEFINITIONS) as ApplicationSecurityReadinessFindingCode[]
)

const EMPTY_OBJECT_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  additionalProperties: false,
  maxProperties: 0
})

export const APPLICATION_SECURITY_READINESS_PARAMETERS: PluginContributionDataContractV2 =
  Object.freeze({ schema: EMPTY_OBJECT_SCHEMA, maxBytes: 2 })

const NON_NEGATIVE_INTEGER_SCHEMA = Object.freeze({
  type: 'integer' as const,
  minimum: 0
})
const BOOLEAN_SCHEMA = Object.freeze({ type: 'boolean' as const })

const SECURITY_FINDING_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    code: Object.freeze({ type: 'string', enum: FINDING_CODES }),
    category: Object.freeze({
      type: 'string',
      enum: Object.freeze([
        'configuration',
        'data-access',
        'transport',
        'server-runtime',
        'privacy',
        'custom-code'
      ])
    }),
    severity: Object.freeze({ type: 'string', enum: Object.freeze(['error', 'warning']) }),
    title: Object.freeze({ type: 'string', minLength: 1, maxLength: 256 }),
    remediation: Object.freeze({ type: 'string', minLength: 1, maxLength: 512 }),
    occurrences: NON_NEGATIVE_INTEGER_SCHEMA
  }),
  required: Object.freeze(['code', 'category', 'severity', 'title', 'remediation', 'occurrences']),
  additionalProperties: false,
  minProperties: 6,
  maxProperties: 6
})

const SECURITY_SUMMARY_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    visitedNodeCount: NON_NEGATIVE_INTEGER_SCHEMA,
    visitedActionCount: NON_NEGATIVE_INTEGER_SCHEMA,
    clientEndpointCount: NON_NEGATIVE_INTEGER_SCHEMA,
    authGuardedPageCount: NON_NEGATIVE_INTEGER_SCHEMA,
    usesSupabase: BOOLEAN_SCHEMA,
    serverWorkflowCount: NON_NEGATIVE_INTEGER_SCHEMA,
    rlsResourceCount: NON_NEGATIVE_INTEGER_SCHEMA,
    serverEnvironmentBindingCount: NON_NEGATIVE_INTEGER_SCHEMA
  }),
  required: Object.freeze([
    'visitedNodeCount',
    'visitedActionCount',
    'clientEndpointCount',
    'authGuardedPageCount',
    'usesSupabase',
    'serverWorkflowCount',
    'rlsResourceCount',
    'serverEnvironmentBindingCount'
  ]),
  additionalProperties: false,
  minProperties: 8,
  maxProperties: 8
})

export const APPLICATION_SECURITY_READINESS_RESULT: PluginContributionDataContractV2 =
  Object.freeze({
    schema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        kind: Object.freeze({
          type: 'string',
          enum: Object.freeze(['application-security-readiness'])
        }),
        scope: Object.freeze({ type: 'string', enum: Object.freeze(['document']) }),
        pluginId: Object.freeze({
          type: 'string',
          enum: Object.freeze([APPLICATION_SECURITY_READINESS_PLUGIN_ID])
        }),
        commandId: Object.freeze({
          type: 'string',
          enum: Object.freeze([APPLICATION_SECURITY_READINESS_COMMAND_ID])
        }),
        environment: Object.freeze({ type: 'string', enum: Object.freeze(['production']) }),
        status: Object.freeze({
          type: 'string',
          enum: Object.freeze(['pass', 'review', 'blocked'])
        }),
        errorCount: NON_NEGATIVE_INTEGER_SCHEMA,
        warningCount: NON_NEGATIVE_INTEGER_SCHEMA,
        findingCount: NON_NEGATIVE_INTEGER_SCHEMA,
        truncated: BOOLEAN_SCHEMA,
        summary: SECURITY_SUMMARY_SCHEMA,
        findings: Object.freeze({
          type: 'array',
          items: SECURITY_FINDING_SCHEMA,
          maxItems: APPLICATION_SECURITY_READINESS_LIMITS.findings
        }),
        notEvaluated: Object.freeze({
          type: 'array',
          items: Object.freeze({ type: 'string', maxLength: 512 }),
          maxItems: 12
        }),
        disclaimer: Object.freeze({ type: 'string', minLength: 1, maxLength: 512 })
      }),
      required: Object.freeze([
        'kind',
        'scope',
        'pluginId',
        'commandId',
        'environment',
        'status',
        'errorCount',
        'warningCount',
        'findingCount',
        'truncated',
        'summary',
        'findings',
        'notEvaluated',
        'disclaimer'
      ]),
      additionalProperties: false,
      minProperties: 14,
      maxProperties: 14
    }),
    maxBytes: APPLICATION_SECURITY_READINESS_LIMITS.reportBytes
  })

/**
 * Exact host-owned authority for central catalog and command registration.
 * The manifest may describe only this fixed identity, permission set, empty
 * argument contract, and bounded result contract.
 */
export const APPLICATION_SECURITY_READINESS_HOST_CONTRACT = Object.freeze({
  pluginId: APPLICATION_SECURITY_READINESS_PLUGIN_ID,
  command: Object.freeze({
    commandId: APPLICATION_SECURITY_READINESS_COMMAND_ID,
    adapterId: APPLICATION_SECURITY_READINESS_ADAPTER_ID,
    permissions: Object.freeze(['document.read'] as const),
    parameters: APPLICATION_SECURITY_READINESS_PARAMETERS,
    result: APPLICATION_SECURITY_READINESS_RESULT
  })
})

interface AuditState {
  work: number
  truncated: boolean
  visitedNodeCount: number
  visitedActionCount: number
  clientEndpointCount: number
  authGuardedPageCount: number
  structuredValues: number
  totalStringCodePoints: number
  findingOccurrences: Map<ApplicationSecurityReadinessFindingCode, number>
}

interface PropertyBag {
  [key: string]: unknown
}

function propertyBag(value: unknown): PropertyBag | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? (value as PropertyBag) : null
}

function abortError(): Error {
  const error = new Error('Application security readiness audit was cancelled')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}

async function checkpoint(
  state: AuditState,
  signal: AbortSignal | undefined,
  force = false
): Promise<void> {
  throwIfAborted(signal)
  state.work += 1
  if (!force && state.work % APPLICATION_SECURITY_READINESS_LIMITS.checkpointWork !== 0) return
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  throwIfAborted(signal)
}

function addFinding(
  state: AuditState,
  code: ApplicationSecurityReadinessFindingCode,
  occurrences = 1
): void {
  const current = state.findingOccurrences.get(code) ?? 0
  state.findingOccurrences.set(code, Math.min(Number.MAX_SAFE_INTEGER, current + occurrences))
}

function boundedString(value: string, state: AuditState, maximum: number): string {
  const remaining = Math.max(
    0,
    APPLICATION_SECURITY_READINESS_LIMITS.totalStringCodePoints - state.totalStringCodePoints
  )
  const limit = Math.min(maximum, remaining)
  if (limit === 0) {
    if (value.length > 0) state.truncated = true
    return ''
  }
  const prefix = value.length > limit * 2 ? value.slice(0, limit * 2) : value
  let output = ''
  let count = 0
  for (const codePoint of prefix.normalize('NFC')) {
    if (count >= limit) {
      state.truncated = true
      break
    }
    output += codePoint
    count += 1
  }
  if (value.length > prefix.length) state.truncated = true
  state.totalStringCodePoints += count
  return output
}

function syntheticActionId(state: AuditState): string {
  return `security-audit-action-${state.visitedActionCount}`
}

function endpointAuthorityIsDynamic(value: string): boolean {
  const scheme = value.match(/^https?:\/\//i)
  if (!scheme) return value.includes('${')
  const authorityStart = scheme[0].length
  const pathStart = value.slice(authorityStart).search(/[/?#]/)
  const authorityEnd = pathStart < 0 ? value.length : authorityStart + pathStart
  const interpolation = value.indexOf('${')
  return interpolation !== -1 && interpolation < authorityEnd
}

function inspectClientEndpoint(value: unknown, state: AuditState): void {
  state.clientEndpointCount += 1
  if (typeof value !== 'string') {
    addFinding(state, 'invalid-client-endpoint')
    return
  }
  const endpoint = boundedString(
    value.trim(),
    state,
    APPLICATION_SECURITY_READINESS_LIMITS.stringCodePoints
  )
  if (!endpoint || endpoint.startsWith('//')) {
    addFinding(state, 'invalid-client-endpoint')
    return
  }
  if (endpoint.startsWith('/') && !endpoint.startsWith('//')) return
  if (endpointAuthorityIsDynamic(endpoint)) addFinding(state, 'dynamic-client-authority')
  if (/^http:\/\//i.test(endpoint)) addFinding(state, 'insecure-client-endpoint')
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    if (!endpointAuthorityIsDynamic(endpoint)) addFinding(state, 'invalid-client-endpoint')
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    addFinding(state, 'invalid-client-endpoint')
  }
  if (parsed.username || parsed.password) addFinding(state, 'client-endpoint-credentials')
}

// eslint-disable-next-line complexity -- Each supported action kind is reduced to one minimal runtime-audit projection in a single fail-closed dispatcher.
async function sanitizeActions(
  value: unknown,
  state: AuditState,
  signal: AbortSignal | undefined,
  depth = 0
): Promise<ActionDef[]> {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    addFinding(state, 'lowcode-structure-invalid')
    return []
  }
  if (depth > APPLICATION_SECURITY_READINESS_LIMITS.actionDepth) {
    state.truncated = true
    return []
  }
  const output: ActionDef[] = []
  const count = Math.min(value.length, APPLICATION_SECURITY_READINESS_LIMITS.actionsPerChain)
  if (value.length > count) state.truncated = true
  for (let index = 0; index < count; index += 1) {
    if (state.visitedActionCount >= APPLICATION_SECURITY_READINESS_LIMITS.actions) {
      state.truncated = true
      break
    }
    state.visitedActionCount += 1
    await checkpoint(state, signal)
    const source = propertyBag(value[index])
    if (!source || typeof source.kind !== 'string') {
      addFinding(state, 'lowcode-structure-invalid')
      continue
    }
    const id = syntheticActionId(state)
    if (source.kind === 'condition' || source.kind === 'confirm') {
      const consequent = await sanitizeActions(source.consequent, state, signal, depth + 1)
      const alternate = await sanitizeActions(source.alternate, state, signal, depth + 1)
      output.push({ id, kind: source.kind, consequent, alternate } as ActionDef)
      continue
    }
    if (source.kind === 'callWorkflow') {
      const workflowId =
        typeof source.workflowId === 'string'
          ? boundedString(source.workflowId, state, 256)
          : undefined
      output.push({ id, kind: 'callWorkflow', workflowId } as ActionDef)
      continue
    }
    if (source.kind === 'apiCall') {
      inspectClientEndpoint(source.url, state)
      const onSuccess = await sanitizeActions(source.onSuccess, state, signal, depth + 1)
      const onError = await sanitizeActions(source.onError, state, signal, depth + 1)
      output.push({
        id,
        kind: 'apiCall',
        method: source.method === 'POST' ? 'POST' : 'GET',
        url: typeof source.url === 'string' ? boundedString(source.url, state, 4_096) : '',
        targetName: 'securityAuditResult',
        onSuccess,
        onError
      })
      continue
    }
    if (source.kind === 'supabaseQuery' || source.kind === 'supabaseMutation') {
      const onSuccess = await sanitizeActions(source.onSuccess, state, signal, depth + 1)
      const onError = await sanitizeActions(source.onError, state, signal, depth + 1)
      const table = typeof source.table === 'string' ? boundedString(source.table, state, 256) : ''
      if (!table) addFinding(state, 'lowcode-structure-invalid')
      if (source.kind === 'supabaseQuery') {
        output.push({ id, kind: 'supabaseQuery', table, onSuccess, onError } as ActionDef)
      } else {
        const operation = ['insert', 'update', 'delete', 'upsert'].includes(
          String(source.operation)
        )
          ? source.operation
          : 'insert'
        if (operation !== source.operation) addFinding(state, 'lowcode-structure-invalid')
        output.push({
          id,
          kind: 'supabaseMutation',
          operation,
          table,
          onSuccess,
          onError
        } as ActionDef)
      }
      continue
    }
    if (source.kind === 'supabaseAuth') {
      output.push({ id, kind: 'supabaseAuth' } as ActionDef)
      continue
    }
    if (source.kind === 'invokeServerWorkflow') {
      const onSuccess = await sanitizeActions(source.onSuccess, state, signal, depth + 1)
      const onError = await sanitizeActions(source.onError, state, signal, depth + 1)
      output.push({ id, kind: 'invokeServerWorkflow', onSuccess, onError } as ActionDef)
      continue
    }
    if (source.kind === 'stripeCheckout' || source.kind === 'stripeCustomerPortal') {
      if (source.endpoint !== undefined) inspectClientEndpoint(source.endpoint, state)
    }
  }
  return output
}

async function sanitizeEventActions(
  node: SceneNode,
  state: AuditState,
  signal: AbortSignal | undefined
): Promise<ActionDef[]> {
  const events = propertyBag(node.events)
  if (!events) return []
  const actions: ActionDef[] = []
  let eventCount = 0
  for (const eventName in events) {
    if (!Object.hasOwn(events, eventName)) continue
    if (eventCount >= 64) {
      state.truncated = true
      break
    }
    eventCount += 1
    actions.push(...(await sanitizeActions(events[eventName], state, signal)))
  }
  return actions
}

function sanitizeInteractiveProps(node: SceneNode, state: AuditState): Record<string, unknown> {
  const props = propertyBag(node.interactiveProps)
  if (!props) return {}
  if (node.type === 'LIST') {
    const source = propertyBag(props.dataSourceRef)
    const query = propertyBag(source?.query)
    if (source?.kind === 'supabaseQuery' && typeof query?.table === 'string') {
      return {
        dataSourceRef: {
          kind: 'supabaseQuery',
          query: { table: boundedString(query.table, state, 256) }
        }
      }
    }
  }
  if (node.type === 'INPUT') {
    const upload = propertyBag(props.upload)
    if (typeof upload?.bucket === 'string') {
      return { upload: { bucket: boundedString(upload.bucket, state, 256) } }
    }
  }
  return {}
}

async function sanitizeWorkflows(
  value: unknown,
  state: AuditState,
  signal: AbortSignal | undefined
): Promise<WorkflowDef[]> {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    addFinding(state, 'lowcode-structure-invalid')
    return []
  }
  const count = Math.min(value.length, APPLICATION_SECURITY_READINESS_LIMITS.workflows)
  if (value.length > count) state.truncated = true
  const workflows: WorkflowDef[] = []
  for (let index = 0; index < count; index += 1) {
    await checkpoint(state, signal)
    const source = propertyBag(value[index])
    if (!source || typeof source.id !== 'string') {
      addFinding(state, 'lowcode-structure-invalid')
      continue
    }
    workflows.push({
      id: boundedString(source.id, state, 256),
      name: 'Security audit workflow',
      actions: await sanitizeActions(source.actions, state, signal)
    })
  }
  return workflows
}

// eslint-disable-next-line complexity -- One recursive copier enforces the shared depth, member, value, string, cycle, and cancellation budgets.
async function sanitizeStructuredValue(
  value: unknown,
  state: AuditState,
  signal: AbortSignal | undefined,
  ancestors: WeakSet<object>,
  depth = 0
): Promise<unknown> {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    return boundedString(value, state, APPLICATION_SECURITY_READINESS_LIMITS.stringCodePoints)
  }
  if (typeof value !== 'object') return undefined
  if (
    depth > APPLICATION_SECURITY_READINESS_LIMITS.structuredDepth ||
    state.structuredValues >= APPLICATION_SECURITY_READINESS_LIMITS.structuredValues
  ) {
    state.truncated = true
    return undefined
  }
  state.structuredValues += 1
  await checkpoint(state, signal)
  if (ancestors.has(value)) {
    state.truncated = true
    return undefined
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const count = Math.min(
        value.length,
        APPLICATION_SECURITY_READINESS_LIMITS.structuredMembersPerContainer
      )
      if (value.length > count) state.truncated = true
      const output: unknown[] = []
      for (let index = 0; index < count; index += 1) {
        const item = await sanitizeStructuredValue(
          value[index],
          state,
          signal,
          ancestors,
          depth + 1
        )
        if (item !== undefined) output.push(item)
      }
      return output
    }
    const source = propertyBag(value)
    if (!source) {
      state.truncated = true
      return undefined
    }
    const output: Record<string, unknown> = Object.create(null)
    let memberCount = 0
    for (const key in source) {
      if (!Object.hasOwn(source, key)) continue
      if (memberCount >= APPLICATION_SECURITY_READINESS_LIMITS.structuredMembersPerContainer) {
        state.truncated = true
        break
      }
      memberCount += 1
      if (key.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(key)) {
        state.truncated = true
        continue
      }
      const descriptor = Object.getOwnPropertyDescriptor(source, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        state.truncated = true
        continue
      }
      const member = await sanitizeStructuredValue(
        descriptor.value,
        state,
        signal,
        ancestors,
        depth + 1
      )
      if (member !== undefined) output[key] = member
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

async function sanitizeServerWorkflows(
  value: unknown,
  state: AuditState,
  signal: AbortSignal | undefined
): Promise<ServerWorkflowDef[]> {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    addFinding(state, 'lowcode-structure-invalid')
    return []
  }
  const count = Math.min(value.length, APPLICATION_SECURITY_READINESS_LIMITS.serverWorkflows)
  if (value.length > count) state.truncated = true
  const sanitized = await sanitizeStructuredValue(
    value.slice(0, count),
    state,
    signal,
    new WeakSet<object>()
  )
  return Array.isArray(sanitized) ? (sanitized as ServerWorkflowDef[]) : []
}

function sanitizeSupabaseConfig(
  root: SceneNode | undefined,
  state: AuditState
): SupabaseConfig | undefined {
  const source = propertyBag(root?.lowcodeSupabaseConfig)
  if (!source) return undefined
  const url = typeof source.url === 'string' ? boundedString(source.url, state, 4_096) : ''
  const anonKey =
    typeof source.anonKey === 'string' ? boundedString(source.anonKey, state, 4_096) : ''
  const schema =
    typeof source.schema === 'string' ? boundedString(source.schema, state, 256) : undefined
  if (!url || !anonKey) addFinding(state, 'supabase-config-invalid')
  if (detectSupabaseSecretKey(anonKey)) addFinding(state, 'supabase-secret-key-embedded')
  return { url, anonKey, ...(schema ? { schema } : {}) }
}

function inspectAnalytics(root: SceneNode | undefined, state: AuditState): void {
  const source = root?.lowcodeAnalyticsConfig
  if (!source) return
  if (typeof source.provider !== 'string' || typeof source.id !== 'string') {
    addFinding(state, 'analytics-config-invalid')
    return
  }
  const endpoint =
    typeof source.endpoint === 'string' ? boundedString(source.endpoint, state, 4_096) : undefined
  let consentCopy: AnalyticsConfig['consentCopy']
  if (source.consentCopy) {
    consentCopy =
      typeof source.consentCopy.privacyPolicyUrl === 'string'
        ? { privacyPolicyUrl: boundedString(source.consentCopy.privacyPolicyUrl, state, 4_096) }
        : {}
  }
  const config: AnalyticsConfig = {
    provider: source.provider,
    id: boundedString(source.id, state, 4_096),
    ...(endpoint ? { endpoint } : {}),
    ...(source.enabled !== undefined ? { enabled: source.enabled } : {}),
    ...(source.respectDoNotTrack !== undefined
      ? { respectDoNotTrack: source.respectDoNotTrack }
      : {}),
    ...(source.consentRequired !== undefined ? { consentRequired: source.consentRequired } : {}),
    ...(source.consentRegionPreset !== undefined
      ? { consentRegionPreset: source.consentRegionPreset }
      : {}),
    ...(consentCopy ? { consentCopy } : {})
  }
  if (!validateAnalyticsConfig(config).ok) addFinding(state, 'analytics-config-invalid')
  if (endpoint && /^http:\/\//i.test(endpoint)) addFinding(state, 'insecure-analytics-endpoint')
  if (source.enabled !== false && source.consentRequired !== true) {
    addFinding(state, 'analytics-consent-review-required')
  }
}

function inspectCSS(value: string, state: AuditState): void {
  const bounded = value.slice(0, APPLICATION_SECURITY_READINESS_LIMITS.customCssCodeUnits)
  if (value.length > bounded.length) state.truncated = true
  const unsafe = unsafeLowcodeCustomCSSURLs(bounded)
  if (unsafe.length > 0) addFinding(state, 'unsafe-custom-css-url', unsafe.length)
}

// eslint-disable-next-line complexity -- Styles, links, and meta entries share one aggregate head-entry budget and cancellation cadence.
async function inspectCustomCode(
  root: SceneNode | undefined,
  state: AuditState,
  signal: AbortSignal | undefined
): Promise<void> {
  if (typeof root?.lowcodeCustomCss === 'string') inspectCSS(root.lowcodeCustomCss, state)
  const head = root?.lowcodeHeadMetadata
  if (!head) return
  const styles = Array.isArray(head.styles) ? head.styles : []
  const styleCount = Math.min(styles.length, APPLICATION_SECURITY_READINESS_LIMITS.headEntries)
  if (styles.length > styleCount) state.truncated = true
  for (let index = 0; index < styleCount; index += 1) {
    await checkpoint(state, signal)
    if (typeof styles[index] === 'string') inspectCSS(styles[index], state)
    else addFinding(state, 'lowcode-structure-invalid')
  }
  const links = Array.isArray(head.link) ? head.link : []
  const linkCount = Math.min(links.length, APPLICATION_SECURITY_READINESS_LIMITS.headEntries)
  if (links.length > linkCount) state.truncated = true
  for (let index = 0; index < linkCount; index += 1) {
    await checkpoint(state, signal)
    const link = links[index]
    if (typeof link.href !== 'string') {
      addFinding(state, 'lowcode-structure-invalid')
      continue
    }
    const href = boundedString(link.href, state, 4_096)
    if (!isSafeLowcodeHeadLinkHref(href)) addFinding(state, 'unsafe-head-link')
    if (link.crossorigin === 'use-credentials') addFinding(state, 'cross-origin-credentials-review')
  }
  const meta = Array.isArray(head.meta) ? head.meta : []
  const metaCount = Math.min(meta.length, APPLICATION_SECURITY_READINESS_LIMITS.headEntries)
  if (meta.length > metaCount) state.truncated = true
  for (let index = 0; index < metaCount; index += 1) {
    await checkpoint(state, signal)
    const entry = meta[index]
    if (
      typeof entry.kind !== 'string' ||
      typeof entry.key !== 'string' ||
      typeof entry.content !== 'string'
    ) {
      addFinding(state, 'lowcode-structure-invalid')
      continue
    }
    const key = boundedString(entry.key, state, 256)
    const content = boundedString(entry.content, state, 4_096)
    if (unsafeLowcodeHeadMetaRefreshURL(entry.kind, key, content)) {
      addFinding(state, 'unsafe-meta-refresh')
    }
  }
}

async function boundedRuntimeGraph(
  editor: EditorStore,
  state: AuditState,
  signal: AbortSignal | undefined,
  sourceRoot: SceneNode | undefined,
  supabaseConfig: SupabaseConfig | undefined
) {
  const workflows = await sanitizeWorkflows(sourceRoot?.lowcodeWorkflows, state, signal)
  const serverWorkflows = await sanitizeServerWorkflows(
    sourceRoot?.lowcodeServerWorkflows,
    state,
    signal
  )
  const rootActions = sourceRoot ? await sanitizeEventActions(sourceRoot, state, signal) : []
  const root = {
    id: 'security-audit-root',
    type: sourceRoot?.type ?? 'DOCUMENT',
    events: rootActions.length > 0 ? { click: rootActions } : undefined,
    interactiveProps: sourceRoot ? sanitizeInteractiveProps(sourceRoot, state) : {},
    lowcodeWorkflows: workflows,
    lowcodeServerWorkflows: serverWorkflows,
    ...(supabaseConfig ? { lowcodeSupabaseConfig: supabaseConfig } : {})
  } as SceneNode
  const nodes: SceneNode[] = [root]
  if (sourceRoot) state.visitedNodeCount = 1
  for (const node of editor.graph.getAllNodes()) {
    if (node.id === editor.graph.rootId) continue
    if (state.visitedNodeCount >= APPLICATION_SECURITY_READINESS_LIMITS.nodes) {
      state.truncated = true
      break
    }
    state.visitedNodeCount += 1
    await checkpoint(state, signal)
    if (node.lowcodeRequiresAuth === true) state.authGuardedPageCount += 1
    const actions = await sanitizeEventActions(node, state, signal)
    nodes.push({
      id: `security-audit-node-${state.visitedNodeCount}`,
      type: node.type,
      events: actions.length > 0 ? { click: actions } : undefined,
      interactiveProps: sanitizeInteractiveProps(node, state)
    } as SceneNode)
  }
  if (state.authGuardedPageCount > 0 && !supabaseConfig) {
    addFinding(state, 'auth-guard-runtime-required')
  }
  return {
    rootId: root.id,
    getNode: (id: string) => (id === root.id ? root : undefined),
    getAllNodes: () => nodes
  }
}

function addRuntimeFindings(state: AuditState, issues: readonly ApplicationRuntimeIssue[]): void {
  for (const issue of issues) {
    if (Object.hasOwn(FINDING_DEFINITIONS, issue.code)) {
      addFinding(state, issue.code as ApplicationSecurityReadinessFindingCode)
    } else {
      addFinding(state, 'lowcode-structure-invalid')
    }
  }
}

function materializeFindings(state: AuditState): ApplicationSecurityReadinessFinding[] {
  return FINDING_CODES.flatMap((code) => {
    const occurrences = state.findingOccurrences.get(code)
    if (!occurrences) return []
    const definition = FINDING_DEFINITIONS[code]
    return [{ code, ...definition, occurrences }]
  }).slice(0, APPLICATION_SECURITY_READINESS_LIMITS.findings)
}

function reportBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function readinessStatus(
  errorCount: number,
  warningCount: number,
  truncated: boolean
): ApplicationSecurityReadinessResult['status'] {
  if (errorCount > 0) return 'blocked'
  if (warningCount > 0 || truncated) return 'review'
  return 'pass'
}

export async function runApplicationSecurityReadiness(
  editor: EditorStore,
  options: RunApplicationSecurityReadinessOptions = {}
): Promise<ApplicationSecurityReadinessResult> {
  const state: AuditState = {
    work: 0,
    truncated: false,
    visitedNodeCount: 0,
    visitedActionCount: 0,
    clientEndpointCount: 0,
    authGuardedPageCount: 0,
    structuredValues: 0,
    totalStringCodePoints: 0,
    findingOccurrences: new Map()
  }
  await checkpoint(state, options.signal, true)
  const sourceRoot = editor.graph.getNode(editor.graph.rootId)
  const supabaseConfig = sanitizeSupabaseConfig(sourceRoot, state)
  inspectAnalytics(sourceRoot, state)
  await inspectCustomCode(sourceRoot, state, options.signal)
  const graph = await boundedRuntimeGraph(editor, state, options.signal, sourceRoot, supabaseConfig)
  throwIfAborted(options.signal)
  const runtime = auditApplicationRuntime(graph, { environment: 'production' })
  addRuntimeFindings(state, runtime.issues)
  throwIfAborted(options.signal)

  const findings = materializeFindings(state)
  const errorCount = findings.filter((finding) => finding.severity === 'error').length
  const warningCount = findings.length - errorCount
  const notEvaluated = [
    'live authentication, authorization, account-recovery, and abuse-control behavior',
    'deployed TLS, security headers, content security policy, cookies, caching, and redirects',
    'live database grants, Row Level Security policy behavior, and storage bucket policies',
    'server source code, environment secret values, secret rotation, and deployment isolation',
    'third-party dependency vulnerabilities, provenance, licenses, SBOMs, and build artifacts',
    'external APIs, webhooks, payment flows, analytics delivery, and vendor-side configuration',
    'business-logic authorization, privacy-law compliance, threat modeling, and penetration testing',
    'this static readiness report is not a complete security assessment or certification',
    ...(state.truncated ? ['content beyond the static audit resource limits'] : [])
  ]
  const result: ApplicationSecurityReadinessResult = {
    kind: 'application-security-readiness',
    scope: 'document',
    pluginId: APPLICATION_SECURITY_READINESS_PLUGIN_ID,
    commandId: APPLICATION_SECURITY_READINESS_COMMAND_ID,
    environment: 'production',
    status: readinessStatus(errorCount, warningCount, state.truncated),
    errorCount,
    warningCount,
    findingCount: findings.length,
    truncated: state.truncated,
    summary: {
      visitedNodeCount: state.visitedNodeCount,
      visitedActionCount: state.visitedActionCount,
      clientEndpointCount: state.clientEndpointCount,
      authGuardedPageCount: state.authGuardedPageCount,
      usesSupabase: runtime.usesSupabase,
      serverWorkflowCount: runtime.serverWorkflowCount,
      rlsResourceCount: runtime.rlsRequirements.length,
      serverEnvironmentBindingCount: runtime.requiredServerEnvironment.length
    },
    findings,
    notEvaluated,
    disclaimer:
      'OpenPencil performs a bounded static readiness review only; independent security review and live verification remain required.'
  }
  if (reportBytes(result) > APPLICATION_SECURITY_READINESS_LIMITS.reportBytes) {
    result.findings = []
    result.truncated = true
    result.status = readinessStatus(errorCount, warningCount, true)
    result.notEvaluated = [
      ...notEvaluated.slice(0, 8),
      'finding details were removed to enforce the report byte limit'
    ]
  }
  return result
}
