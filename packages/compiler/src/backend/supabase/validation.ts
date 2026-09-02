import type {
  AuthAccessOperation,
  AuthPrincipalIntent,
  AuthRowAccessIntentIR,
  BackendCapability,
  BackendDiagnostic,
  BackendValueSource,
  BackendWorkflowStepIR,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

import type { BackendProviderAdapterContext } from '../contracts'
import { backendDiagnostic } from '../diagnostics'
import { isSupabaseAllowPolicyEmittable, requiredSupabasePolicyOperations } from './policy'
import { visitSupabaseWorkflowSteps } from './policy-helpers'

function hasRequirement(context: BackendProviderAdapterContext, capability: BackendCapability) {
  return context.application.capabilities.some((entry) => entry.capability === capability)
}

function principalKey(principal: AuthPrincipalIntent): string {
  switch (principal.kind) {
    case 'anonymous':
    case 'authenticated':
      return principal.kind
    case 'owner':
      return `owner:${principal.ownershipId}`
    case 'role':
      return `role:${principal.roleId}`
    case 'tenant-member':
      return `tenant-member:${principal.tenantId}`
    default:
      throw new TypeError('Unsupported auth principal.')
  }
}

function stepsContainHttp(steps: readonly BackendWorkflowStepIR[]): boolean {
  return steps.some(
    (step) =>
      step.kind === 'http.request' ||
      (step.kind === 'branch' &&
        (stepsContainHttp(step.consequent) || stepsContainHttp(step.alternate)))
  )
}

function policyCoverage(context: BackendProviderAdapterContext) {
  const coverage = new Map<string, Map<string, Set<AuthAccessOperation>>>()
  for (const entry of context.application.auth.rowAccess) {
    if (!isSupabaseAllowPolicyEmittable(context.application, entry)) continue
    let entity = coverage.get(entry.entityId)
    if (!entity) {
      entity = new Map()
      coverage.set(entry.entityId, entity)
    }
    const key = principalKey(entry.principal)
    let operations = entity.get(key)
    if (!operations) {
      operations = new Set()
      entity.set(key, operations)
    }
    for (const operation of entry.operations) operations.add(operation)
  }
  return coverage
}

function validateWorkflowPolicyCoverage(
  context: BackendProviderAdapterContext,
  diagnostics: BackendDiagnostic[]
): void {
  const coverage = policyCoverage(context)
  for (const workflow of context.application.workflows.workflows) {
    visitSupabaseWorkflowSteps(workflow.steps, (step) => {
      if (step.kind !== 'data.read' && step.kind !== 'data.mutate') return
      const required = requiredSupabasePolicyOperations(step)
      const policies = coverage.get(step.entityId)
      const covered = [...(policies?.values() ?? [])].some((operations) =>
        required.every((operation) => operations.has(operation))
      )
      if (!covered) {
        diagnostics.push(
          backendDiagnostic(
            'supabase-workflow-policy-coverage-required',
            'error',
            `$.workflows.${workflow.id}.${step.id}`,
            'Supabase user-scoped workflow data access requires one explicit principal policy covering every required operation.'
          )
        )
      }
    })
  }
}

function validateCapabilities(
  context: BackendProviderAdapterContext,
  diagnostics: BackendDiagnostic[]
): void {
  const data = hasRequirement(context, 'data.read') || hasRequirement(context, 'data.write')
  const storage = hasRequirement(context, 'storage.objects')
  if ((data || storage) && !hasRequirement(context, 'policy.row-level')) {
    diagnostics.push(
      backendDiagnostic(
        'supabase-row-level-capability-required',
        'error',
        '$.capabilities.policy.row-level',
        'Supabase data and storage access requires explicit row-level policy intent.'
      )
    )
  }
  if (context.application.workflows.workflows.length > 0) {
    if (!hasRequirement(context, 'server.functions')) {
      diagnostics.push(
        backendDiagnostic(
          'supabase-server-functions-capability-required',
          'error',
          '$.capabilities.server.functions',
          'Supabase Backend workflows require the server.functions capability.'
        )
      )
    }
    if (!hasRequirement(context, 'auth.identity')) {
      diagnostics.push(
        backendDiagnostic(
          'supabase-workflow-auth-capability-required',
          'error',
          '$.capabilities.auth.identity',
          'Authenticated Supabase Backend workflows require auth.identity.'
        )
      )
    }
  }
  const hasHttp = context.application.workflows.workflows.some((workflow) =>
    stepsContainHttp(workflow.steps)
  )
  if (hasHttp && !hasRequirement(context, 'server.http')) {
    diagnostics.push(
      backendDiagnostic(
        'supabase-server-http-capability-required',
        'error',
        '$.capabilities.server.http',
        'Supabase Backend HTTP workflow steps require server.http.'
      )
    )
  }
}

function modelField(
  context: BackendProviderAdapterContext,
  entityId: string,
  fieldId: string
): DataFieldIR | undefined {
  return context.application.dataModel.entities
    .find((entry) => entry.id === entityId)
    ?.fields.find((entry) => entry.id === fieldId)
}

function sameSupabaseFieldType(
  target: DataFieldIR | undefined,
  membership: DataFieldIR | undefined
): boolean {
  if (!target || !membership) return false
  return target.type === membership.type && target.enumId === membership.enumId
}

function validateAuthFieldTypes(
  context: BackendProviderAdapterContext,
  diagnostics: BackendDiagnostic[]
): void {
  for (const ownership of context.application.auth.ownership) {
    const identity = modelField(context, ownership.entityId, ownership.identityFieldId)
    if (identity && identity.type !== 'uuid') {
      diagnostics.push(
        backendDiagnostic(
          'supabase-owner-identity-type-unsupported',
          'error',
          `$.auth.ownership.${ownership.id}.identityFieldId`,
          'Supabase owner identity fields must be UUID-compatible with auth.uid().'
        )
      )
    }
  }
  for (const tenant of context.application.auth.tenants) {
    if (
      !tenant.membershipEntityId ||
      !tenant.membershipIdentityFieldId ||
      !tenant.membershipTenantFieldId
    ) {
      continue
    }
    const membershipIdentity = modelField(
      context,
      tenant.membershipEntityId,
      tenant.membershipIdentityFieldId
    )
    if (membershipIdentity && membershipIdentity.type !== 'uuid') {
      diagnostics.push(
        backendDiagnostic(
          'supabase-tenant-identity-type-unsupported',
          'error',
          `$.auth.tenants.${tenant.id}.membershipIdentityFieldId`,
          'Supabase membership identity fields must be UUID-compatible with auth.uid().'
        )
      )
    }
    const targetTenant = modelField(context, tenant.entityId, tenant.tenantFieldId)
    const membershipTenant = modelField(
      context,
      tenant.membershipEntityId,
      tenant.membershipTenantFieldId
    )
    if (!sameSupabaseFieldType(targetTenant, membershipTenant)) {
      diagnostics.push(
        backendDiagnostic(
          'supabase-tenant-field-type-mismatch',
          'error',
          `$.auth.tenants.${tenant.id}.membershipTenantFieldId`,
          'Supabase target and membership tenant fields must have the same database type.'
        )
      )
    }
  }
}

function validatePolicyIntents(
  context: BackendProviderAdapterContext,
  diagnostics: BackendDiagnostic[]
): void {
  const external = new Set(
    context.application.dataModel.entities
      .filter((entry) => entry.management === 'external')
      .map((entry) => entry.id)
  )
  for (const entry of context.application.auth.rowAccess) {
    const path = `$.auth.rowAccess.${entry.id}`
    validateConditionalDeny(context, entry, path, diagnostics)
    if (
      entry.effect === 'allow' &&
      (entry.principal.kind === 'anonymous' || entry.principal.kind === 'authenticated')
    ) {
      diagnostics.push(
        backendDiagnostic(
          'supabase-broad-row-policy-blocked',
          context.mode === 'production' ? 'error' : 'warning',
          `${path}.principal`,
          'Broad anonymous or authenticated row access is not emitted as SQL and cannot enter a production emission.'
        )
      )
    }
    if (entry.effect === 'allow' && entry.operations.includes('update')) {
      if (!entry.operations.includes('select')) {
        diagnostics.push(
          backendDiagnostic(
            'supabase-update-select-policy-required',
            'error',
            `${path}.operations`,
            'Supabase UPDATE policy intent must also include SELECT and emits both USING and WITH CHECK.'
          )
        )
      }
    }
    if (entry.effect === 'allow' && entry.operations.includes('delete')) {
      if (!entry.operations.includes('select')) {
        diagnostics.push(
          backendDiagnostic(
            'supabase-delete-select-policy-required',
            'error',
            `${path}.operations`,
            'Supabase DELETE policy intent must also include SELECT for filtered user-scoped mutations.'
          )
        )
      }
    }
    if (entry.principal.kind === 'tenant-member') {
      const tenantId = entry.principal.tenantId
      const tenant = context.application.auth.tenants.find((candidate) => candidate.id === tenantId)
      if (
        !tenant?.membershipEntityId ||
        !tenant.membershipIdentityFieldId ||
        !tenant.membershipTenantFieldId
      ) {
        diagnostics.push(
          backendDiagnostic(
            'supabase-tenant-membership-incomplete',
            'error',
            `${path}.principal`,
            'Tenant-member policy intent requires an explicit membership entity and identity/tenant fields.'
          )
        )
      }
    }
    if (external.has(entry.entityId)) {
      diagnostics.push(
        backendDiagnostic(
          'supabase-external-rls-live-review-required',
          'warning',
          path,
          'External tables are never altered; their live RLS policies remain a release prerequisite.'
        )
      )
    }
  }
}

function validateConditionalDeny(
  context: BackendProviderAdapterContext,
  entry: AuthRowAccessIntentIR,
  path: string,
  diagnostics: BackendDiagnostic[]
): void {
  if (
    entry.effect !== 'deny' ||
    entry.principal.kind === 'anonymous' ||
    entry.principal.kind === 'authenticated'
  ) {
    return
  }
  diagnostics.push(
    backendDiagnostic(
      'supabase-conditional-deny-unsupported',
      context.mode === 'production' ? 'error' : 'warning',
      `${path}.principal`,
      'Conditional deny intent requires a reviewed restrictive-policy translation and cannot enter a production emission.'
    )
  )
}

const JWT_CANDIDATE = /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu

function serviceRoleJWT(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = parts[1].replaceAll('-', '+').replaceAll('_', '/')
    const decoded = atob(payload + '='.repeat((4 - (payload.length % 4)) % 4))
    const parsed = JSON.parse(decoded) as { role?: unknown }
    return parsed.role === 'service_role'
  } catch {
    return false
  }
}

function containsPrivilegedMaterial(value: string): boolean {
  const upper = value.toUpperCase()
  const compact = upper.replaceAll(/[^A-Z0-9]/gu, '')
  if (
    upper.includes('SB_SECRET_') ||
    compact.includes('SERVICEROLE') ||
    compact.includes('SUPABASESECRET') ||
    compact.includes('SUPABASEADMIN') ||
    compact.includes('ADMINKEY') ||
    compact.includes('ROOTKEY')
  ) {
    return true
  }
  return [...value.matchAll(JWT_CANDIDATE)].some((match) => serviceRoleJWT(match[0]))
}

function isSensitiveHttpHeaderName(value: string): boolean {
  const compact = value.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
  return (
    ['authorization', 'proxyauthorization', 'cookie', 'setcookie', 'apikey', 'xapikey'].includes(
      compact
    ) || /(credential|password|privatekey|secret|token)/u.test(compact)
  )
}

function stepValueSources(step: BackendWorkflowStepIR): readonly BackendValueSource[] {
  if (step.kind === 'data.read') return (step.filters ?? []).map((entry) => entry.value)
  if (step.kind === 'data.mutate') {
    return [
      ...(step.values?.map((entry) => entry.value) ?? []),
      ...(step.filters?.map((entry) => entry.value) ?? [])
    ]
  }
  if (step.kind === 'http.request') {
    return [
      step.url,
      ...(step.body ? [step.body] : []),
      ...(step.headers ?? []).map((entry) => entry.value)
    ]
  }
  return []
}

function privilegedDiagnostic(path: string, kind: 'credential' | 'literal'): BackendDiagnostic {
  return backendDiagnostic(
    kind === 'credential'
      ? 'supabase-privileged-credential-forbidden'
      : 'supabase-privileged-literal-forbidden',
    'error',
    path,
    kind === 'credential'
      ? 'Supabase service-role, secret, admin, and root credentials cannot enter compiler plans or generated artifacts.'
      : 'Privileged Supabase credential material cannot be embedded in generated artifacts.'
  )
}

function validateWorkflowSecretBoundary(
  context: BackendProviderAdapterContext,
  diagnostics: BackendDiagnostic[]
): void {
  const declaredEnvironment = new Set(
    context.application.secrets
      .filter((entry) => entry.kind === 'environment')
      .map((entry) => entry.name)
  )
  for (const workflow of context.application.workflows.workflows) {
    visitSupabaseWorkflowSteps(workflow.steps, (step) => {
      const path = `$.workflows.${workflow.id}.${step.id}`
      if (step.kind === 'http.request') {
        for (const header of step.headers ?? []) {
          if (isSensitiveHttpHeaderName(header.name) && header.value.kind !== 'environment') {
            diagnostics.push(
              backendDiagnostic(
                'supabase-workflow-sensitive-header-reference-required',
                'error',
                path,
                'Sensitive HTTP request headers must reference a declared server environment requirement.'
              )
            )
          }
        }
      }
      for (const source of stepValueSources(step)) {
        if (source.kind === 'environment') {
          if (!declaredEnvironment.has(source.name)) {
            diagnostics.push(
              backendDiagnostic(
                'supabase-workflow-environment-undeclared',
                'error',
                path,
                'Supabase workflow environment references must be declared as explicit secret requirements.'
              )
            )
          }
          if (containsPrivilegedMaterial(source.name)) {
            diagnostics.push(privilegedDiagnostic(path, 'credential'))
          }
        } else if (containsPrivilegedMaterial(source.expression)) {
          diagnostics.push(privilegedDiagnostic(path, 'literal'))
        }
      }
      let expression: string | undefined
      if (step.kind === 'branch') expression = step.condition
      else if (step.kind === 'respond') expression = step.value
      if (expression && containsPrivilegedMaterial(expression)) {
        diagnostics.push(privilegedDiagnostic(path, 'literal'))
      }
    })
  }
}

function validateSecretBoundary(
  context: BackendProviderAdapterContext,
  diagnostics: BackendDiagnostic[]
): void {
  for (const [index, entry] of context.application.secrets.entries()) {
    const authority =
      entry.kind === 'credential' ? `${entry.name}_${entry.credentialRef}` : entry.name
    if (containsPrivilegedMaterial(authority)) {
      diagnostics.push(privilegedDiagnostic(`$.secrets[${index}]`, 'credential'))
    }
  }
  for (const [entityIndex, entity] of context.application.dataModel.entities.entries()) {
    for (const [fieldIndex, field] of entity.fields.entries()) {
      const literal = field.default?.kind === 'literal' ? field.default.value : undefined
      if (typeof literal === 'string' && containsPrivilegedMaterial(literal)) {
        diagnostics.push(
          privilegedDiagnostic(
            `$.dataModel.entities[${entityIndex}].fields[${fieldIndex}].default`,
            'literal'
          )
        )
      }
    }
  }
  validateWorkflowSecretBoundary(context, diagnostics)
}

function addReviewDiagnostics(
  context: BackendProviderAdapterContext,
  diagnostics: BackendDiagnostic[]
): void {
  const secretNames = new Set(context.application.secrets.map((entry) => entry.name))
  const data = hasRequirement(context, 'data.read') || hasRequirement(context, 'data.write')
  if (data && (!secretNames.has('BACKEND_PUBLIC_URL') || !secretNames.has('BACKEND_PUBLIC_KEY'))) {
    diagnostics.push(
      backendDiagnostic(
        'supabase-public-environment-review-required',
        'warning',
        '$.secrets',
        'Supabase client data access normally requires explicit BACKEND_PUBLIC_URL and BACKEND_PUBLIC_KEY environment references.'
      )
    )
  }
  if (hasRequirement(context, 'storage.objects')) {
    diagnostics.push(
      backendDiagnostic(
        'supabase-storage-policy-review-required',
        'warning',
        '$.capabilities.storage.objects',
        'Storage bucket/object policy is never inferred; release requires explicit SELECT, INSERT, and UPDATE checks for upsert.'
      )
    )
  }
  if (hasRequirement(context, 'server.http')) {
    diagnostics.push(
      backendDiagnostic(
        'supabase-outbound-http-review-required',
        'warning',
        '$.capabilities.server.http',
        'Outbound HTTP remains declarative until a reviewed host runtime enforces URL and response bounds.'
      )
    )
  }
  if (
    hasRequirement(context, 'migrations.schema') &&
    context.application.dataModel.entities.every((entry) => entry.management === 'external')
  ) {
    diagnostics.push(
      backendDiagnostic(
        'supabase-managed-schema-empty',
        'warning',
        '$.dataModel.entities',
        'No managed entity is eligible for a migration proposal; external schema remains inspect-only.'
      )
    )
  }
}

export function validateSupabaseBackendProvider(
  context: BackendProviderAdapterContext
): readonly BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  validateCapabilities(context, diagnostics)
  validateAuthFieldTypes(context, diagnostics)
  validatePolicyIntents(context, diagnostics)
  validateWorkflowPolicyCoverage(context, diagnostics)
  validateSecretBoundary(context, diagnostics)
  addReviewDiagnostics(context, diagnostics)
  return diagnostics
}
