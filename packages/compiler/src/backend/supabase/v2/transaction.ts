/* oxlint-disable max-lines -- The closed atomic validator and resolver intentionally share one auditable contract. */
import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import { backendDiagnostic } from '#compiler/backend/diagnostics'
import type { BackendProviderAdapterContextV2 } from '#compiler/backend/v2/contracts'

import type {
  BackendApplicationSpecV2,
  BackendCapabilityV2,
  BackendDiagnostic,
  BackendFieldScalarType,
  BackendTransactionDefinitionIR,
  BackendTransactionFilterIR,
  BackendTransactionParameterIR,
  DataEntityIR,
  DataFieldIR
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

export const SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2 = Object.freeze({
  client: 'backend/supabase-v2/transactions/client.ts',
  prerequisites: 'backend/supabase-v2/transactions/database-prerequisites.json',
  reviewManifest: 'backend/supabase-v2/transactions/review-manifest.json',
  sql: 'backend/supabase-v2/transactions/review.sql'
} as const)

export const SUPABASE_ATOMIC_TRANSACTION_ACTUAL_CAPABILITIES_V2 = Object.freeze([
  'auth.identity',
  'data.read',
  'data.write',
  'migrations.schema',
  'policy.row-level',
  'transactions.atomic'
] as const satisfies readonly BackendCapabilityV2[])

const SUPPORTED_PARAMETER_TYPES = new Set<BackendFieldScalarType>([
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'uuid'
])

type ReadStep = Extract<BackendTransactionDefinitionIR['steps'][number], { kind: 'data.read' }>
type MutateStep = Extract<BackendTransactionDefinitionIR['steps'][number], { kind: 'data.mutate' }>

export interface ResolvedSupabaseAtomicParameterV2 {
  readonly name: string
  readonly type: BackendFieldScalarType
  readonly sqlArgument: string
  readonly sqlType: string
  readonly fieldId: string
  readonly field: string
}

export interface ResolvedSupabaseAtomicFieldV2 {
  readonly fieldId: string
  readonly field: string
  readonly parameter: string
  readonly sqlArgument: string
}

export interface ResolvedSupabaseAtomicTransactionV2 {
  readonly id: string
  readonly name: string
  readonly digest: string
  readonly applicationObjectKey: string
  readonly transactionObjectKey: string
  readonly functionName: string
  readonly entityId: string
  readonly table: string
  readonly ownershipId: string
  readonly ownerFieldId: string
  readonly ownerField: string
  readonly policyId: string
  readonly versionFieldId: string
  readonly versionField: string
  readonly expectedVersionParameter: string
  readonly expectedVersionSqlArgument: string
  readonly primaryKey: readonly ResolvedSupabaseAtomicFieldV2[]
  readonly updates: readonly ResolvedSupabaseAtomicFieldV2[]
  readonly parameters: readonly ResolvedSupabaseAtomicParameterV2[]
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  severity: BackendDiagnostic['severity'] = 'error'
): BackendDiagnostic {
  return backendDiagnostic(code, severity, path, message)
}

function stableObjectKey(domain: string, value: unknown, path: string): string {
  return digestCanonicalBackendValue({ domain, value }, path).slice(0, 16).toLowerCase()
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry) => right.includes(entry))
}

function parameterFilterMap(
  filters: readonly BackendTransactionFilterIR[] | undefined
): ReadonlyMap<string, string> | undefined {
  const entries = new Map<string, string>()
  for (const filter of filters ?? []) {
    if (
      filter.operator !== 'eq' ||
      filter.value.kind !== 'parameter' ||
      entries.has(filter.field)
    ) {
      return undefined
    }
    entries.set(filter.field, filter.value.name)
  }
  return entries
}

function exactOwnerPolicy(
  application: BackendApplicationSpecV2,
  entity: DataEntityIR | undefined,
  ownershipId: string | undefined
) {
  if (!entity || !ownershipId || application.auth.rowAccess.length !== 1) return undefined
  const policy = application.auth.rowAccess.at(0)
  if (!policy) return undefined
  return policy.entityId === entity.id &&
    policy.effect === 'allow' &&
    policy.principal.kind === 'owner' &&
    policy.principal.ownershipId === ownershipId &&
    sameSet(policy.operations, ['select', 'update'])
    ? policy
    : undefined
}

function validateActualCapabilities(
  context: BackendProviderAdapterContextV2,
  diagnostics: BackendDiagnostic[]
): void {
  const actual = new Set(context.actualCapabilities)
  const allowed = new Set<BackendCapabilityV2>(SUPABASE_ATOMIC_TRANSACTION_ACTUAL_CAPABILITIES_V2)
  for (const capability of SUPABASE_ATOMIC_TRANSACTION_ACTUAL_CAPABILITIES_V2) {
    if (actual.has(capability)) continue
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-capability-required',
        `$.actualCapabilities.${capability}`,
        'The bounded Supabase atomic RPC requires this capability to be proven by normalized Backend V2 IR.'
      )
    )
  }
  for (const capability of context.actualCapabilities) {
    if (allowed.has(capability)) continue
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-capability-unsupported',
        `$.actualCapabilities.${capability}`,
        'The first Supabase atomic RPC slice refuses unrelated application capabilities.'
      )
    )
  }
}

/** This slot owns only the transaction data steps; P1 direct owner CRUD remains separate. */
export function validateSupabaseAtomicDataBridgeV2(
  context: BackendProviderAdapterContextV2
): readonly BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  if (!context.actualCapabilities.includes('transactions.atomic')) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-data-standalone-forbidden',
        '$.actualCapabilities',
        'This adapter emits atomic RPC artifacts only when a transaction is declared; P1 owner RLS and direct REST CRUD authority remain separate and non-exclusive.'
      )
    )
  }
  if (context.application.workflows.workflows.length > 0) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-data-workflow-forbidden',
        '$.application.workflows.workflows',
        'This data slot owns only the declared atomic transaction steps; P1 direct owner REST CRUD remains a separate non-exclusive authority.'
      )
    )
  }
  if (context.mode !== 'production') {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-production-mode-required',
        '$.mode',
        'Reviewed Supabase atomic RPC artifacts are emitted only in production compilation mode.'
      )
    )
  }
  return Object.freeze(diagnostics)
}

function validateApplicationBoundary(
  context: BackendProviderAdapterContextV2,
  diagnostics: BackendDiagnostic[]
): void {
  const { application } = context
  if (context.target !== 'react' && context.target !== 'vue') {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-target-unsupported',
        '$.target',
        'Supabase atomic RPC client artifacts currently support only React and Vue web targets.'
      )
    )
  }
  if (
    application.secrets.length > 0 ||
    application.capabilities.some((entry) =>
      ['workflows.idempotency', 'workflows.retry'].includes(entry.capability)
    )
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-secret-retry-authority-forbidden',
        '$.application',
        'The atomic RPC slice accepts no secrets, idempotency claim, or automatic retry claim.'
      )
    )
  }
  if (
    application.realtime.subscriptions.length > 0 ||
    application.dataMigrations.migrations.length > 0 ||
    application.automations.queues.length > 0 ||
    application.automations.webhookDestinations.length > 0 ||
    application.automations.automations.length > 0
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-application-scope-unsupported',
        '$.application',
        'Realtime, migrations, queues, webhooks, and automation behavior are outside this atomic-only slice.'
      )
    )
  }
  if (application.dataModel.entities.length !== 1) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-entity-count-invalid',
        '$.application.dataModel.entities',
        'The first Supabase atomic RPC slice requires exactly one managed entity.'
      )
    )
  }
  if (application.dataModel.relations.length > 0) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-relation-unsupported',
        '$.application.dataModel.relations',
        'Relations are outside the first single-entity atomic RPC slice.'
      )
    )
  }
  if (
    application.auth.identities.length !== 1 ||
    application.auth.identities[0]?.kind !== 'user' ||
    application.auth.roles.length > 0 ||
    application.auth.tenants.length > 0
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-auth-shape-invalid',
        '$.application.auth',
        'The first atomic RPC slice requires one user identity and forbids anonymous, service, role, and tenant authority.'
      )
    )
  }
  if (application.transactions.transactions.length !== 1) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-transaction-count-invalid',
        '$.application.transactions.transactions',
        'The first Supabase atomic RPC slice requires exactly one transaction.'
      )
    )
  }
}

// oxlint-disable-next-line complexity -- Entity, owner, RLS, PK, and version authority fail closed together.
function validateEntityAuthority(
  application: BackendApplicationSpecV2,
  transaction: BackendTransactionDefinitionIR | undefined,
  diagnostics: BackendDiagnostic[]
): {
  readonly entity?: DataEntityIR
  readonly ownershipId?: string
  readonly ownerField?: DataFieldIR
  readonly versionField?: DataFieldIR
} {
  const entity = application.dataModel.entities.at(0)
  if (entity && entity.management !== 'managed') {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-managed-entity-required',
        '$.application.dataModel.entities[0].management',
        'Atomic RPC review artifacts require one source-managed entity.'
      )
    )
  }
  if (!entity?.primaryKey || entity.primaryKey.fields.length !== 1) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-primary-key-invalid',
        '$.application.dataModel.entities[0].primaryKey',
        'The first atomic RPC slice requires one non-null scalar primary-key field.'
      )
    )
  }
  const primaryKeyField = entity?.fields.find((field) => field.id === entity.primaryKey?.fields[0])
  if (!primaryKeyField || primaryKeyField.nullable || primaryKeyField.type !== 'uuid') {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-primary-key-type-unsupported',
        '$.application.dataModel.entities[0].primaryKey',
        'The first atomic RPC slice requires one non-null UUID primary key.'
      )
    )
  }
  const ownership = application.auth.ownership.at(0)
  if (application.auth.ownership.length !== 1 || !ownership || ownership.entityId !== entity?.id) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-ownership-invalid',
        '$.application.auth.ownership',
        'The atomic entity requires exactly one ownership binding.'
      )
    )
  }
  const ownerField = entity?.fields.find((field) => field.id === ownership?.identityFieldId)
  if (ownerField?.type !== 'uuid' || ownerField.nullable) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-owner-field-invalid',
        '$.application.auth.ownership[0].identityFieldId',
        'The atomic owner field must be a non-null UUID compatible with auth.uid().'
      )
    )
  }
  if (!exactOwnerPolicy(application, entity, ownership?.id)) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-owner-policy-invalid',
        '$.application.auth.rowAccess',
        'Exactly one owner allow policy covering SELECT and UPDATE is required.'
      )
    )
  }
  if (
    transaction?.principal.kind !== 'owner' ||
    transaction.principal.ownershipId !== ownership?.id
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-owner-principal-required',
        '$.application.transactions.transactions[0].principal',
        'The transaction principal must use the entity ownership binding.'
      )
    )
  }
  const conflict = transaction?.conflictPolicy
  const versionField =
    conflict?.kind === 'expected-version'
      ? entity?.fields.find((field) => field.id === conflict.fieldId)
      : undefined
  const protectedFieldsAreDistinct =
    primaryKeyField !== undefined &&
    ownerField !== undefined &&
    versionField !== undefined &&
    new Set([primaryKeyField.id, ownerField.id, versionField.id]).size === 3
  const validVersionControl =
    conflict?.kind === 'expected-version' &&
    conflict.entityId === entity?.id &&
    versionField?.type === 'integer' &&
    !versionField.nullable &&
    versionField.default?.kind === 'literal' &&
    versionField.default.value === 0 &&
    protectedFieldsAreDistinct
  if (!validVersionControl) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-version-control-invalid',
        '$.application.transactions.transactions[0].conflictPolicy',
        'Expected-version control requires a distinct non-null integer version field with literal default zero.'
      )
    )
  }
  return { entity, ownershipId: ownership?.id, ownerField, versionField }
}

function validateReadShape(
  transaction: BackendTransactionDefinitionIR,
  entity: DataEntityIR,
  versionField: DataFieldIR,
  read: ReadStep | undefined,
  existsStep: BackendTransactionDefinitionIR['steps'][number] | undefined,
  diagnostics: BackendDiagnostic[]
): ReadonlyMap<string, string> | undefined {
  const primaryKey = entity.primaryKey?.fields ?? []
  const filters = parameterFilterMap(read?.filters)
  if (
    !read ||
    read.entityId !== entity.id ||
    read.single !== true ||
    read.limit !== 1 ||
    !sameSet(read.fields ?? [], [...primaryKey, versionField.id]) ||
    !filters ||
    !sameSet([...filters.keys()], primaryKey)
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-read-shape-invalid',
        '$.application.transactions.transactions[0].steps[0]',
        'Step one must read exactly the full primary key and version by primary-key equality, as one row.'
      )
    )
  }
  const validExistsAssertion =
    existsStep?.kind === 'assert' &&
    existsStep.assertion.kind === 'result-exists' &&
    existsStep.assertion.resultName === read?.resultName
  if (!validExistsAssertion) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-exists-assertion-invalid',
        '$.application.transactions.transactions[0].steps[1]',
        'Step two must assert that the locked read result exists.'
      )
    )
  }
  void transaction
  return filters
}

// oxlint-disable-next-line complexity -- Mutation shape, protected fields, and terminal bound are one safety invariant.
function validateMutationShape(
  transaction: BackendTransactionDefinitionIR,
  entity: DataEntityIR,
  ownerField: DataFieldIR,
  versionField: DataFieldIR,
  mutation: MutateStep | undefined,
  countStep: BackendTransactionDefinitionIR['steps'][number] | undefined,
  diagnostics: BackendDiagnostic[]
): ReadonlyMap<string, string> | undefined {
  const primaryKey = entity.primaryKey?.fields ?? []
  const filters = parameterFilterMap(mutation?.filters)
  const updateFields = mutation?.values?.map((entry) => entry.field) ?? []
  const updateParameters =
    mutation?.values?.flatMap((entry) =>
      entry.value.kind === 'parameter' ? [entry.value.name] : []
    ) ?? []
  if (
    !mutation ||
    mutation.entityId !== entity.id ||
    mutation.operation !== 'update' ||
    mutation.maxAffectedRows !== 1 ||
    !filters ||
    !sameSet([...filters.keys()], [...primaryKey, versionField.id])
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-update-shape-invalid',
        '$.application.transactions.transactions[0].steps[2]',
        'Step three must update one row filtered by the full primary key and expected version.'
      )
    )
  }
  const protectedFields = new Set([...primaryKey, ownerField.id, versionField.id])
  if (
    !mutation?.values?.length ||
    mutation.values.some((entry) => {
      const field = entity.fields.find((candidate) => candidate.id === entry.field)
      return (
        protectedFields.has(entry.field) ||
        entry.value.kind !== 'parameter' ||
        field?.default?.kind === 'generated' ||
        !SUPPORTED_PARAMETER_TYPES.has(field?.type as BackendFieldScalarType)
      )
    }) ||
    new Set(updateFields).size !== updateFields.length ||
    new Set(updateParameters).size !== updateParameters.length ||
    mutation.increments?.length !== 1 ||
    mutation.increments[0]?.field !== versionField.id
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-update-values-invalid',
        '$.application.transactions.transactions[0].steps[2]',
        'The update must assign supported declared fields from required parameters and increment only the version field by one.'
      )
    )
  }
  const validCountAssertion =
    countStep?.kind === 'assert' &&
    countStep.assertion.kind === 'result-count' &&
    countStep.assertion.resultName === mutation?.resultName &&
    countStep.assertion.operator === 'eq' &&
    countStep.assertion.value === 1
  if (!validCountAssertion) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-count-assertion-invalid',
        '$.application.transactions.transactions[0].steps[3]',
        'Step four must assert that the update affected exactly one row.'
      )
    )
  }
  void transaction
  return filters
}

function validateParameters(
  transaction: BackendTransactionDefinitionIR,
  entity: DataEntityIR,
  readFilters: ReadonlyMap<string, string> | undefined,
  mutationFilters: ReadonlyMap<string, string> | undefined,
  mutation: MutateStep | undefined,
  diagnostics: BackendDiagnostic[]
): void {
  const expectedVersion =
    transaction.conflictPolicy.kind === 'expected-version'
      ? transaction.conflictPolicy.parameter
      : undefined
  const referenced = new Map<string, Set<string>>()
  const reference = (parameter: string, field: string) => {
    const fields = referenced.get(parameter) ?? new Set<string>()
    fields.add(field)
    referenced.set(parameter, fields)
  }
  for (const [field, parameter] of readFilters ?? []) reference(parameter, field)
  for (const [field, parameter] of mutationFilters ?? []) reference(parameter, field)
  for (const value of mutation?.values ?? []) {
    if (value.value.kind === 'parameter') reference(value.value.name, value.field)
  }
  const declared = new Set(transaction.parameters.map((entry) => entry.name))
  if (
    transaction.parameters.some(
      (entry) =>
        !entry.required ||
        !SUPPORTED_PARAMETER_TYPES.has(entry.type) ||
        referenced.get(entry.name)?.size !== 1 ||
        entity.fields.find((field) => field.id === [...(referenced.get(entry.name) ?? [])][0])
          ?.type !== entry.type
    ) ||
    !sameSet([...declared], [...referenced.keys()]) ||
    !expectedVersion ||
    !declared.has(expectedVersion)
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-parameters-invalid',
        '$.application.transactions.transactions[0].parameters',
        'Every and only referenced transaction parameter must be required and exactly match its scalar field type.'
      )
    )
  }
}

/** Rejects every transaction shape outside the first serializable owner-update RPC subset. */
// oxlint-disable-next-line complexity -- Ordered IR and cross-step bindings are validated as one provider boundary.
export function validateSupabaseAtomicTransactionV2(
  context: BackendProviderAdapterContextV2
): readonly BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  validateActualCapabilities(context, diagnostics)
  validateApplicationBoundary(context, diagnostics)
  const transaction = context.application.transactions.transactions.at(0)
  if (transaction && (transaction.isolation !== 'serializable' || transaction.steps.length !== 4)) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-transaction-shape-invalid',
        '$.application.transactions.transactions[0]',
        'The transaction must be authenticated, serializable, and contain exactly four ordered steps.'
      )
    )
  }
  const authority = validateEntityAuthority(context.application, transaction, diagnostics)
  if (!transaction || !authority.entity || !authority.ownerField || !authority.versionField) {
    return Object.freeze(diagnostics)
  }
  const read = transaction.steps[0]?.kind === 'data.read' ? transaction.steps[0] : undefined
  const mutation = transaction.steps[2]?.kind === 'data.mutate' ? transaction.steps[2] : undefined
  const readFilters = validateReadShape(
    transaction,
    authority.entity,
    authority.versionField,
    read,
    transaction.steps[1],
    diagnostics
  )
  const mutationFilters = validateMutationShape(
    transaction,
    authority.entity,
    authority.ownerField,
    authority.versionField,
    mutation,
    transaction.steps[3],
    diagnostics
  )
  if (
    transaction.conflictPolicy.kind === 'expected-version' &&
    mutationFilters?.get(authority.versionField.id) !== transaction.conflictPolicy.parameter
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-version-filter-invalid',
        '$.application.transactions.transactions[0].steps[2].filters',
        'The update version equality must use the conflict-policy expected-version parameter.'
      )
    )
  }
  const primaryKeyFieldId = authority.entity.primaryKey?.fields[0]
  if (
    primaryKeyFieldId &&
    readFilters?.get(primaryKeyFieldId) !== mutationFilters?.get(primaryKeyFieldId)
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-atomic-primary-key-parameter-mismatch',
        '$.application.transactions.transactions[0].steps',
        'The read and update must bind the same primary-key parameter.'
      )
    )
  }
  validateParameters(
    transaction,
    authority.entity,
    readFilters,
    mutationFilters,
    mutation,
    diagnostics
  )
  diagnostics.push(
    diagnostic(
      'supabase-v2-atomic-reviewed-apply-required',
      '$.application.transactions.transactions[0]',
      'This non-exclusive atomic RPC is review-only: P1 direct owner REST CRUD remains available, no P1 receipt or artifact digest is bound, and source-ledger Apply plus live owner/RLS/concurrency verification is still required.',
      'warning'
    )
  )
  return Object.freeze(diagnostics)
}

function postgresType(type: BackendFieldScalarType): string {
  switch (type) {
    case 'string':
      return 'text'
    case 'integer':
      return 'int8'
    case 'number':
      return 'float8'
    case 'boolean':
      return 'bool'
    case 'date':
      return 'date'
    case 'datetime':
      return 'timestamptz'
    case 'uuid':
      return 'uuid'
    default:
      throw new TypeError('Unsupported Supabase atomic RPC parameter type.')
  }
}

function fieldForParameter(
  entity: DataEntityIR,
  transaction: BackendTransactionDefinitionIR,
  parameter: BackendTransactionParameterIR
): DataFieldIR {
  for (const step of transaction.steps) {
    if (step.kind === 'assert') continue
    for (const filter of step.filters ?? []) {
      if (filter.value.kind === 'parameter' && filter.value.name === parameter.name) {
        const field = entity.fields.find((entry) => entry.id === filter.field)
        if (field) return field
      }
    }
    if (step.kind === 'data.mutate') {
      for (const value of step.values ?? []) {
        if (value.value.kind === 'parameter' && value.value.name === parameter.name) {
          const field = entity.fields.find((entry) => entry.id === value.field)
          if (field) return field
        }
      }
    }
  }
  throw new TypeError('Supabase atomic RPC parameter was not validated.')
}

/** Resolves stable function/object names only after the strict validator has succeeded. */
// oxlint-disable-next-line complexity -- Resolution rechecks every trusted emission input before rendering SQL.
export function resolvedSupabaseAtomicTransactionV2(
  application: BackendApplicationSpecV2
): ResolvedSupabaseAtomicTransactionV2 {
  const entity = application.dataModel.entities.at(0)
  const transaction = application.transactions.transactions.at(0)
  const ownership = application.auth.ownership.at(0)
  const ownerField = entity?.fields.find((field) => field.id === ownership?.identityFieldId)
  const policy = application.auth.rowAccess.at(0)
  const conflict = transaction?.conflictPolicy
  const versionField =
    conflict?.kind === 'expected-version'
      ? entity?.fields.find((field) => field.id === conflict.fieldId)
      : undefined
  const mutation = transaction?.steps[2]?.kind === 'data.mutate' ? transaction.steps[2] : undefined
  if (
    !entity ||
    !transaction ||
    !ownership ||
    !ownerField ||
    !policy ||
    conflict?.kind !== 'expected-version' ||
    !versionField ||
    !mutation
  ) {
    throw new TypeError('Supabase atomic RPC application was not validated.')
  }
  const parameters = transaction.parameters.map((parameter, index) => {
    const field = fieldForParameter(entity, transaction, parameter)
    return Object.freeze({
      name: parameter.name,
      type: parameter.type,
      sqlArgument: `arg_${String(index + 1).padStart(3, '0')}`,
      sqlType: postgresType(parameter.type),
      fieldId: field.id,
      field: field.name
    })
  })
  const byName = new Map(parameters.map((entry) => [entry.name, entry]))
  const read = transaction.steps[0] as ReadStep
  const readFilters = parameterFilterMap(read.filters)
  const primaryKey = (entity.primaryKey?.fields ?? []).map((fieldId) => {
    const field = entity.fields.find((entry) => entry.id === fieldId)
    const parameter = byName.get(readFilters?.get(fieldId) ?? '')
    if (!field || !parameter) throw new TypeError('Atomic primary key was not validated.')
    return Object.freeze({
      fieldId,
      field: field.name,
      parameter: parameter.name,
      sqlArgument: parameter.sqlArgument
    })
  })
  const updates = [...(mutation.values ?? [])]
    .sort((left, right) => left.field.localeCompare(right.field, 'en'))
    .map((value) => {
      const field = entity.fields.find((entry) => entry.id === value.field)
      const parameter = value.value.kind === 'parameter' ? byName.get(value.value.name) : undefined
      if (!field || !parameter) throw new TypeError('Atomic update field was not validated.')
      return Object.freeze({
        fieldId: field.id,
        field: field.name,
        parameter: parameter.name,
        sqlArgument: parameter.sqlArgument
      })
    })
  const expected = byName.get(conflict.parameter)
  if (!expected) throw new TypeError('Atomic expected-version parameter was not validated.')
  const digest = digestCanonicalBackendValue(
    {
      domain: 'openpencil.supabase-atomic-transaction.v1',
      applicationId: application.applicationId,
      entity,
      ownership,
      policy,
      transaction
    },
    '$.supabaseAtomicTransaction.digest'
  )
  const applicationObjectKey = stableObjectKey(
    'openpencil.supabase-atomic-application-object.v1',
    application.applicationId,
    '$.supabaseAtomicTransaction.applicationObjectKey'
  )
  const transactionObjectKey = stableObjectKey(
    'openpencil.supabase-atomic-transaction-object.v1',
    { applicationId: application.applicationId, transactionId: transaction.id },
    '$.supabaseAtomicTransaction.transactionObjectKey'
  )
  return Object.freeze({
    id: transaction.id,
    name: transaction.name,
    digest,
    applicationObjectKey,
    transactionObjectKey,
    functionName: `optrx_${applicationObjectKey}_${transactionObjectKey}`,
    entityId: entity.id,
    table: entity.name,
    ownershipId: ownership.id,
    ownerFieldId: ownerField.id,
    ownerField: ownerField.name,
    policyId: policy.id,
    versionFieldId: versionField.id,
    versionField: versionField.name,
    expectedVersionParameter: expected.name,
    expectedVersionSqlArgument: expected.sqlArgument,
    primaryKey: Object.freeze(primaryKey),
    updates: Object.freeze(updates),
    parameters: Object.freeze(parameters)
  })
}

export function createSupabaseAtomicDataPlanV2(
  context: BackendProviderAdapterContextV2
): JSONValue {
  const transaction = resolvedSupabaseAtomicTransactionV2(context.application)
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-transaction-bound-data-plan.v1',
      version: 1,
      releaseReady: false,
      p1ReceiptBound: false,
      p1ArtifactDigestBound: false,
      directOwnerCrud: true,
      exclusiveWriteAuthority: false,
      atomicGuarantee: 'rpc-call-only',
      directOwnerCrudAuthority: 'p1-owner-rls-and-authenticated-table-grants',
      executionBoundary: 'single-reviewed-atomic-rpc',
      transactionId: transaction.id,
      entityId: transaction.entityId,
      operations: ['select-for-update', 'bounded-update']
    },
    '$.supabaseAtomicTransaction.dataPlan'
  )
}

export function createSupabaseAtomicTransactionPlanV2(
  context: BackendProviderAdapterContextV2
): JSONValue {
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-atomic-transaction-plan.v1',
      version: 1,
      providerId: 'supabase',
      applicationId: context.application.applicationId,
      target: context.target,
      mode: context.mode,
      actualCapabilities: context.actualCapabilities,
      reviewOnly: true,
      applyAllowed: false,
      deployAllowed: false,
      releaseReady: false,
      p1ReceiptBound: false,
      p1ArtifactDigestBound: false,
      directOwnerCrud: true,
      exclusiveWriteAuthority: false,
      atomicGuarantee: 'rpc-call-only',
      transaction: resolvedSupabaseAtomicTransactionV2(context.application),
      execution: {
        api: 'postgrest-rpc',
        schema: 'public',
        security: 'invoker',
        isolation: 'serializable',
        atomicGuarantee: 'rpc-call-only',
        directOwnerCrud: true,
        exclusiveWriteAuthority: false,
        retry: 'caller-forbidden-by-generated-client'
      }
    },
    '$.supabaseAtomicTransaction.plan'
  )
}
