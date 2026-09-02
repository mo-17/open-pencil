import { parseAuthPolicyIR, parseBackendWorkflowIR } from './auth-workflow-validation'
import { BACKEND_LIMITS } from './limits'
import { parseDataModelIR } from './model-validation'
import { assertBackendSecretFreeData } from './secret-boundary'
import {
  BACKEND_APPLICATION_SPEC_VERSION,
  type BackendApplicationSpecV1,
  type BackendCapability,
  type BackendCapabilityRequirement,
  type BackendCredentialRef,
  type BackendSecretRef,
  type BackendValidationResult,
  type BackendWorkflowIR,
  type DataModelIR
} from './types'
import {
  array,
  assertBoundedBackendData,
  boolean,
  boundedText,
  environmentName,
  id,
  oneOf,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from './validation-helpers'
import { validateWorkflowEnvironmentReferences } from './workflow-application-validation'

export const BACKEND_CAPABILITIES: readonly BackendCapability[] = Object.freeze([
  'data.read',
  'data.write',
  'auth.identity',
  'auth.roles',
  'policy.row-level',
  'server.functions',
  'server.http',
  'storage.objects',
  'migrations.schema',
  'migrations.data',
  'realtime.subscribe',
  'transactions.atomic'
])

function isSafeBackendInput(value: unknown, context: BackendValidationContext): boolean {
  if (!assertBoundedBackendData(value, context)) return false
  return assertBackendSecretFreeData(value, context)
}

function validateApplicationWorkflowEnvironmentReferences(
  workflows: BackendWorkflowIR | undefined,
  secrets: readonly BackendSecretRef[],
  context: BackendValidationContext
): void {
  if (!workflows) return
  validateWorkflowEnvironmentReferences(workflows.workflows, secrets, context)
}

const BACKEND_CREDENTIAL_REF =
  /^credential\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export function isBackendCredentialRef(value: unknown): value is BackendCredentialRef {
  return typeof value === 'string' && BACKEND_CREDENTIAL_REF.test(value)
}

function credentialReference(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCredentialRef | undefined {
  if (isBackendCredentialRef(value)) return value
  context.diagnostics.push({
    code: 'backend-credential-reference-invalid',
    severity: 'error',
    path,
    message: 'Credential references must use a host-issued opaque credential.<uuid> handle.'
  })
  return undefined
}

function capabilityRequirement(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCapabilityRequirement | undefined {
  const source = record(
    value,
    path,
    context,
    ['capability', 'required', 'reason'],
    ['capability', 'required']
  )
  if (!source) return undefined
  const capability = oneOf(source.capability, `${path}.capability`, context, BACKEND_CAPABILITIES)
  const required = boolean(source.required, `${path}.required`, context)
  const reason =
    source.reason === undefined
      ? undefined
      : boundedText(source.reason, `${path}.reason`, context, BACKEND_LIMITS.maxReasonLength)
  return capability && required !== undefined
    ? { capability, required, ...(reason ? { reason } : {}) }
    : undefined
}

function secretRef(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendSecretRef | undefined {
  const source = record(
    value,
    path,
    context,
    ['kind', 'name', 'credentialRef', 'exposure', 'required'],
    ['kind', 'name', 'exposure', 'required']
  )
  if (!source) return undefined
  const kind = oneOf(source.kind, `${path}.kind`, context, ['environment', 'credential'])
  const name = environmentName(source.name, `${path}.name`, context)
  const required = boolean(source.required, `${path}.required`, context)
  if (kind === 'environment') {
    const exposure = oneOf(source.exposure, `${path}.exposure`, context, [
      'server',
      'client-public'
    ])
    if (source.credentialRef !== undefined) {
      context.diagnostics.push({
        code: 'backend-secret-field-invalid',
        severity: 'error',
        path: `${path}.credentialRef`,
        message: 'Environment references cannot carry a credential reference.'
      })
    }
    if (
      exposure === 'client-public' &&
      name &&
      /(SECRET|SERVICE_ROLE|ADMIN|PRIVATE|PASSWORD|TOKEN)/u.test(name)
    ) {
      context.diagnostics.push({
        code: 'backend-client-secret-risk',
        severity: 'error',
        path: `${path}.name`,
        message: 'Sensitive environment names cannot be exposed to a client artifact.'
      })
    }
    return name && exposure && required !== undefined
      ? { kind, name, exposure, required }
      : undefined
  }
  if (kind === 'credential') {
    const credentialRef = credentialReference(
      source.credentialRef,
      `${path}.credentialRef`,
      context
    )
    const exposure = oneOf(source.exposure, `${path}.exposure`, context, ['host', 'server'])
    return name && credentialRef && exposure && required !== undefined
      ? { kind, name, credentialRef, exposure, required }
      : undefined
  }
  return undefined
}

export function validateDataModelIR(value: unknown): BackendValidationResult<DataModelIR> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!isSafeBackendInput(value, context)) {
    return { ok: false, diagnostics: context.diagnostics }
  }
  const model = parseDataModelIR(value, '$', context)
  return model && context.diagnostics.length === 0
    ? { ok: true, value: model, diagnostics: [] }
    : { ok: false, diagnostics: context.diagnostics }
}

export function parseBackendApplicationSpecV1(
  value: unknown
): BackendValidationResult<BackendApplicationSpecV1> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!isSafeBackendInput(value, context)) {
    return { ok: false, diagnostics: context.diagnostics }
  }
  const source = record(value, '$', context, [
    'format',
    'version',
    'applicationId',
    'dataModel',
    'auth',
    'workflows',
    'capabilities',
    'secrets'
  ])
  if (!source) return { ok: false, diagnostics: context.diagnostics }
  if (source.format !== 'openpencil.backend-application') {
    context.diagnostics.push({
      code: 'backend-format-unsupported',
      severity: 'error',
      path: '$.format',
      message: 'Backend application format is not supported.'
    })
  }
  if (source.version !== BACKEND_APPLICATION_SPEC_VERSION) {
    context.diagnostics.push({
      code: 'backend-version-unsupported',
      severity: 'error',
      path: '$.version',
      message: 'Backend application version is not supported.'
    })
  }
  const applicationId = id(source.applicationId, '$.applicationId', context)
  const dataModel = parseDataModelIR(source.dataModel, '$.dataModel', context)
  const auth = dataModel ? parseAuthPolicyIR(source.auth, '$.auth', dataModel, context) : undefined
  const workflows = dataModel
    ? parseBackendWorkflowIR(source.workflows, '$.workflows', dataModel, context)
    : undefined
  const rawCapabilities = array(
    source.capabilities,
    '$.capabilities',
    context,
    BACKEND_LIMITS.maxCapabilities
  )
  const capabilities = (rawCapabilities ?? [])
    .map((entry, index) => capabilityRequirement(entry, `$.capabilities[${index}]`, context))
    .filter((entry): entry is BackendCapabilityRequirement => entry !== undefined)
  uniqueBy(
    capabilities.map((entry) => entry.capability),
    '$.capabilities',
    context,
    'capability requirement'
  )
  const rawSecrets = array(source.secrets, '$.secrets', context, BACKEND_LIMITS.maxSecretRefs)
  const secrets = (rawSecrets ?? [])
    .map((entry, index) => secretRef(entry, `$.secrets[${index}]`, context))
    .filter((entry): entry is BackendSecretRef => entry !== undefined)
  uniqueBy(
    secrets.map((entry) =>
      entry.kind === 'credential'
        ? `${entry.kind}:${entry.credentialRef}:${entry.name}`
        : `${entry.kind}:${entry.name}`
    ),
    '$.secrets',
    context,
    'secret reference'
  )
  validateApplicationWorkflowEnvironmentReferences(workflows, secrets, context)
  const hasErrors = context.diagnostics.some((entry) => entry.severity === 'error')
  if (
    source.format !== 'openpencil.backend-application' ||
    source.version !== BACKEND_APPLICATION_SPEC_VERSION ||
    !applicationId ||
    !dataModel ||
    !auth ||
    !workflows ||
    !rawCapabilities ||
    rawCapabilities.length !== capabilities.length ||
    !rawSecrets ||
    rawSecrets.length !== secrets.length ||
    hasErrors
  ) {
    return { ok: false, diagnostics: context.diagnostics }
  }
  return {
    ok: true,
    value: {
      format: 'openpencil.backend-application',
      version: BACKEND_APPLICATION_SPEC_VERSION,
      applicationId,
      dataModel,
      auth,
      workflows,
      capabilities: sorted(capabilities, (entry) => entry.capability),
      secrets: sorted(secrets, (entry) =>
        entry.kind === 'credential'
          ? `${entry.kind}:${entry.credentialRef}:${entry.name}`
          : `${entry.kind}:${entry.name}`
      )
    },
    diagnostics: context.diagnostics
  }
}
