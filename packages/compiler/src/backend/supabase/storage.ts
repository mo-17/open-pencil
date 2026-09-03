/* eslint-disable max-lines -- Storage proposal, inspected reconciliation SQL, and pure policy mirror share one policy vocabulary. */
/* oxlint-disable typescript-eslint(no-unnecessary-condition) -- Compiler inputs remain runtime-untrusted despite their static snapshot type. */
import type {
  BackendApplicationSpecV1,
  BackendStorageBucketIR,
  BackendStorageOperation,
  BackendStoragePathRuleIR
} from '@open-pencil/lowcode/backend'

import { canonicalBackendValue } from '../canonical'
import type { BackendArtifactSource, BackendProviderAdapterContext } from '../contracts'
import { jsonArtifact, SUPABASE_ARTIFACT_PATHS } from './artifacts'
import {
  formatSupabaseManagedMarker,
  type SupabaseInspectedMigrationSnapshotV1
} from './inspection'
import { stableSQLName } from './migration-review/common'
import {
  qualifiedSupabaseTable,
  quoteSupabaseIdentifier,
  supabaseModelFieldName
} from './policy-helpers'

const SQL_OPERATION_ORDER = ['select', 'insert', 'update', 'delete'] as const
type StorageSQLOperation = (typeof SQL_OPERATION_ORDER)[number]

export interface SupabaseStoragePolicyActor {
  readonly authenticated: boolean
  readonly userId?: string
  /** Tenant rule id to membership values established by the authenticated host. */
  readonly tenantMemberships?: Readonly<Record<string, readonly string[]>>
}

function quoteLiteral(value: string): string {
  return `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

function sqlArray(values: readonly string[]): string {
  return `ARRAY[${values.map(quoteLiteral).join(', ')}]::text[]`
}

function expandedOperations(
  operations: readonly BackendStorageOperation[]
): readonly StorageSQLOperation[] {
  const expanded = new Set<StorageSQLOperation>()
  for (const operation of operations) {
    if (operation === 'read') expanded.add('select')
    else if (operation === 'create') expanded.add('insert')
    else if (operation === 'update') {
      expanded.add('select')
      expanded.add('update')
    } else if (operation === 'delete') {
      expanded.add('select')
      expanded.add('delete')
    } else {
      expanded.add('select')
      expanded.add('insert')
      expanded.add('update')
    }
  }
  return SQL_OPERATION_ORDER.filter((operation) => expanded.has(operation))
}

function prefixPredicate(prefix: readonly string[]): readonly string[] {
  return prefix.map(
    (segment, index) => `(storage.foldername(name))[${index + 1}] = ${quoteLiteral(segment)}`
  )
}

function tenantPredicate(
  application: BackendApplicationSpecV1,
  rule: BackendStoragePathRuleIR,
  segment: number
): string | undefined {
  if (rule.principal.kind !== 'tenant-member') return undefined
  const tenantId = rule.principal.tenantId
  const tenant = application.auth.tenants.find((entry) => entry.id === tenantId)
  if (
    !tenant?.membershipEntityId ||
    !tenant.membershipIdentityFieldId ||
    !tenant.membershipTenantFieldId
  ) {
    return undefined
  }
  const membership = application.dataModel.entities.find(
    (entry) => entry.id === tenant.membershipEntityId
  )
  const identityField = supabaseModelFieldName(
    application,
    tenant.membershipEntityId,
    tenant.membershipIdentityFieldId
  )
  const tenantField = supabaseModelFieldName(
    application,
    tenant.membershipEntityId,
    tenant.membershipTenantFieldId
  )
  if (!membership || !identityField || !tenantField) return undefined
  const alias = quoteSupabaseIdentifier('membership')
  return `(storage.foldername(name))[${segment}] in (select ${alias}.${quoteSupabaseIdentifier(tenantField)}::text from ${qualifiedSupabaseTable(membership)} as ${alias} where ${alias}.${quoteSupabaseIdentifier(identityField)} = (select auth.uid()))`
}

function rulePredicate(
  application: BackendApplicationSpecV1,
  bucket: BackendStorageBucketIR,
  rule: BackendStoragePathRuleIR
): string | undefined {
  const parts = [`bucket_id = ${quoteLiteral(bucket.name)}`, ...prefixPredicate(rule.prefix)]
  const principalSegment = rule.prefix.length + 1
  if (rule.principal.kind === 'owner') {
    parts.push(`(storage.foldername(name))[${principalSegment}] = (select auth.uid())::text`)
  } else {
    const predicate = tenantPredicate(application, rule, principalSegment)
    if (!predicate) return undefined
    parts.push(predicate)
  }
  return parts.join(' and ')
}

function operationClause(operation: StorageSQLOperation, predicate: string): string {
  if (operation === 'insert') return `WITH CHECK (${predicate})`
  if (operation === 'update') return `USING (${predicate}) WITH CHECK (${predicate})`
  return `USING (${predicate})`
}

interface DesiredStoragePolicy {
  readonly name: string
  readonly operation: StorageSQLOperation
  readonly predicate: string
}

interface StoragePolicyIdentity {
  readonly name: string
  readonly command: StorageSQLOperation
  readonly mode: 'permissive'
  readonly roles: readonly ['authenticated']
  readonly marker: string
}

function desiredStoragePolicies(
  application: BackendApplicationSpecV1
): readonly DesiredStoragePolicy[] {
  const policies: DesiredStoragePolicy[] = []
  for (const bucket of application.storage?.buckets ?? []) {
    for (const rule of bucket.pathRules) {
      const predicate = rulePredicate(application, bucket, rule)
      if (!predicate) {
        throw new TypeError(
          `Supabase Storage migration cannot bind tenant policy ${bucket.id}:${rule.id}.`
        )
      }
      for (const operation of expandedOperations(rule.operations)) {
        policies.push({
          name: stableSQLName('op_storage', `${bucket.id}:${rule.id}:${operation}`),
          operation,
          predicate
        })
      }
    }
  }
  return policies.sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

function sameTextArray(left: readonly string[] | null, right: readonly string[]): boolean {
  return (
    left !== null &&
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  )
}

function canonicalJSONLiteral(value: unknown): string {
  return `${quoteLiteral(JSON.stringify(value))}::jsonb`
}

function jsonbArrayMultisetDiffers(actual: string, expected: string): string {
  return `EXISTS (
    SELECT 1
    FROM (
      SELECT entry, pg_catalog.count(*) AS copies
      FROM pg_catalog.jsonb_array_elements(${actual}) AS entries(entry)
      GROUP BY entry
    ) AS actual_inventory
    FULL JOIN (
      SELECT entry, pg_catalog.count(*) AS copies
      FROM pg_catalog.jsonb_array_elements(${expected}) AS entries(entry)
      GROUP BY entry
    ) AS expected_inventory USING (entry)
    WHERE actual_inventory.copies IS DISTINCT FROM expected_inventory.copies
  )`
}

function storageExpressionDigestSQL(
  column: 'pol.polqual' | 'pol.polwithcheck',
  kind: string
): string {
  return `CASE WHEN ${column} IS NULL THEN NULL ELSE pg_catalog.translate(
          pg_catalog.rtrim(
            pg_catalog.encode(
              pg_catalog.sha256(
                pg_catalog.convert_to(
                  '{"expression":' || pg_catalog.to_json(
                    pg_catalog.pg_get_expr(${column}, pol.polrelid)
                  )::text || ',"format":"openpencil.supabase-pg-catalog-expression.v1","kind":"${kind}"}',
                  'UTF8'
                )
              ),
              'base64'
            ),
            '='
          ),
          '+/',
          '-_'
        ) END`
}

function storageBaselineGuard(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  targetBuckets: SupabaseInspectedMigrationSnapshotV1['storageBuckets'],
  targetPolicies: readonly StoragePolicyIdentity[]
): string {
  const buckets = canonicalJSONLiteral(snapshot.storageBuckets)
  const policies = canonicalJSONLiteral(
    snapshot.storagePolicies.map((policy) => ({
      address: policy.address,
      name: policy.name,
      command: policy.command,
      mode: policy.mode,
      roles: [...policy.roles],
      marker:
        policy.source === 'openpencil' ? formatSupabaseManagedMarker('policy', policy.name) : null,
      usingExpressionDigest: policy.usingExpressionDigest,
      withCheckExpressionDigest: policy.withCheckExpressionDigest
    }))
  )
  const targetBucketInventory = canonicalJSONLiteral(targetBuckets)
  const targetPolicyInventory = canonicalJSONLiteral(targetPolicies)
  return `DO $openpencil_storage_precondition$
DECLARE
  actual_buckets jsonb;
  actual_policies jsonb;
  actual_policy_identities jsonb;
BEGIN
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', bucket.id,
        'name', bucket.name,
        'public', bucket.public,
        'fileSizeLimit', bucket.file_size_limit,
        'allowedMimeTypes', pg_catalog.to_jsonb(bucket.allowed_mime_types)
      )
      ORDER BY bucket.id
    ),
    '[]'::jsonb
  )
  INTO actual_buckets
  FROM storage.buckets AS bucket;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'address', pg_catalog.jsonb_build_object(
          'classOid', 'pg_policy'::regclass::oid::text,
          'objectOid', pol.oid::text,
          'subId', 0
        ),
        'name', pol.polname,
        'command', CASE pol.polcmd
          WHEN '*' THEN 'all'
          WHEN 'r' THEN 'select'
          WHEN 'a' THEN 'insert'
          WHEN 'w' THEN 'update'
          WHEN 'd' THEN 'delete'
        END,
        'mode', CASE WHEN pol.polpermissive THEN 'permissive' ELSE 'restrictive' END,
        'roles', COALESCE((
          SELECT pg_catalog.jsonb_agg(
            CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE role.rolname END
            ORDER BY pg_catalog.convert_to(
              CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE role.rolname::text END,
              'UTF8'
            )
          )
          FROM unnest(pol.polroles) AS policy_role(role_oid)
          LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
        ), '[]'::jsonb),
        'marker', CASE
          WHEN pg_catalog.obj_description(pol.oid, 'pg_policy') LIKE 'openpencil:%'
          THEN pg_catalog.obj_description(pol.oid, 'pg_policy')
          ELSE NULL
        END,
        'usingExpressionDigest', ${storageExpressionDigestSQL('pol.polqual', 'policy-using')},
        'withCheckExpressionDigest', ${storageExpressionDigestSQL(
          'pol.polwithcheck',
          'policy-check'
        )}
      )
      ORDER BY pol.polname
    ),
    '[]'::jsonb
  )
  INTO actual_policies
  FROM pg_catalog.pg_policy AS pol
  JOIN pg_catalog.pg_class AS relation ON relation.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'storage'
    AND relation.relname = 'objects';

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      policy - 'address' - 'usingExpressionDigest' - 'withCheckExpressionDigest'
      ORDER BY policy->>'name'
    ),
    '[]'::jsonb
  )
  INTO actual_policy_identities
  FROM pg_catalog.jsonb_array_elements(actual_policies) AS policies(policy);

  IF ${jsonbArrayMultisetDiffers('actual_buckets', buckets)}
    OR ${jsonbArrayMultisetDiffers('actual_policies', policies)}
  THEN
    -- A second execution is accepted only from the complete target inventory. Policies are
    -- immediately dropped and recreated below, so altered expressions cannot survive this path.
    IF ${jsonbArrayMultisetDiffers('actual_buckets', targetBucketInventory)}
      OR ${jsonbArrayMultisetDiffers('actual_policy_identities', targetPolicyInventory)}
    THEN
      RAISE EXCEPTION USING
        MESSAGE = 'OpenPencil inspected Storage baseline precondition failed: bucket or policy drift.',
        ERRCODE = 'P0001';
    END IF;
  END IF;
END
$openpencil_storage_precondition$;`
}

/**
 * Render the exact Storage delta from one complete inspected snapshot. The returned SQL remains
 * review-only and transaction-wrapped for source bundle composition; it never executes itself.
 */
// oxlint-disable-next-line complexity -- Inspected Storage reconciliation validates complete bucket and policy state before deriving one atomic delta.
export function renderSupabaseInspectedStorageMigrationSQL(
  application: BackendApplicationSpecV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1
): string | null {
  const desiredBuckets = application.storage?.buckets ?? []
  const desiredPolicies = desiredStoragePolicies(application)
  const managedLivePolicies = snapshot.storagePolicies.filter(
    (policy) => policy.source === 'openpencil'
  )
  const touchesStorage = desiredBuckets.length > 0 || managedLivePolicies.length > 0
  if (!touchesStorage) return null
  if (
    snapshot.coverage.storageBuckets !== 'complete' ||
    snapshot.coverage.storagePolicies !== 'complete'
  ) {
    throw new TypeError('Supabase Storage migration requires complete inspected Storage coverage.')
  }
  const unmanagedPolicy = snapshot.storagePolicies.find((policy) => policy.source !== 'openpencil')
  if (unmanagedPolicy) {
    throw new TypeError(
      `Supabase Storage migration refused non-OpenPencil policy ${unmanagedPolicy.name}.`
    )
  }

  const targetBuckets = [...snapshot.storageBuckets]
  for (const bucket of desiredBuckets) {
    if (!targetBuckets.some((candidate) => candidate.id === bucket.name)) {
      targetBuckets.push({
        id: bucket.name,
        name: bucket.name,
        public: bucket.access === 'public-read',
        fileSizeLimit: bucket.maxObjectBytes,
        allowedMimeTypes: [...bucket.allowedMimeTypes]
      })
    }
  }
  targetBuckets.sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const targetPolicies: readonly StoragePolicyIdentity[] = desiredPolicies.map((policy) => ({
    name: policy.name,
    command: policy.operation,
    mode: 'permissive',
    roles: ['authenticated'],
    marker: formatSupabaseManagedMarker('policy', policy.name)
  }))

  const statements: string[] = []
  for (const bucket of desiredBuckets) {
    const live = snapshot.storageBuckets.find((candidate) => candidate.id === bucket.name)
    if (!live) {
      statements.push(
        'INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)',
        `VALUES (${quoteLiteral(bucket.name)}, ${quoteLiteral(bucket.name)}, ${bucket.access === 'public-read' ? 'TRUE' : 'FALSE'}, ${String(bucket.maxObjectBytes)}, ${sqlArray(bucket.allowedMimeTypes)})`,
        'ON CONFLICT (id) DO NOTHING;'
      )
      continue
    }
    if (
      live.name !== bucket.name ||
      live.public !== (bucket.access === 'public-read') ||
      live.fileSizeLimit !== bucket.maxObjectBytes ||
      !sameTextArray(live.allowedMimeTypes, bucket.allowedMimeTypes)
    ) {
      throw new TypeError(
        `Supabase Storage migration refused to adopt or alter bucket ${bucket.name}.`
      )
    }
  }

  const desiredNames = new Set(desiredPolicies.map((policy) => policy.name))
  for (const live of managedLivePolicies) {
    if (!desiredNames.has(live.name)) {
      statements.push(
        `DROP POLICY IF EXISTS ${quoteSupabaseIdentifier(live.name)} ON storage.objects;`
      )
    }
  }
  for (const policy of desiredPolicies) {
    statements.push(
      `DROP POLICY IF EXISTS ${quoteSupabaseIdentifier(policy.name)} ON storage.objects;`,
      `CREATE POLICY ${quoteSupabaseIdentifier(policy.name)} ON storage.objects FOR ${policy.operation.toUpperCase()} TO authenticated ${operationClause(policy.operation, policy.predicate)};`,
      `COMMENT ON POLICY ${quoteSupabaseIdentifier(policy.name)} ON storage.objects IS ${quoteLiteral(formatSupabaseManagedMarker('policy', policy.name))};`
    )
  }
  if (statements.length === 0) return null
  return [
    '-- OpenPencil Supabase inspected Storage migration v1.',
    '-- Exact inspected delta only; Apply remains Host-controlled.',
    'BEGIN;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '15s';",
    'LOCK TABLE storage.buckets IN ACCESS EXCLUSIVE MODE;',
    'LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE;',
    storageBaselineGuard(snapshot, targetBuckets, targetPolicies),
    ...statements,
    'COMMIT;',
    ''
  ].join('\n')
}

export function createSupabaseStoragePolicyProposal(context: BackendProviderAdapterContext) {
  const buckets = (context.application.storage?.buckets ?? []).map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    access: bucket.access,
    maxObjectBytes: bucket.maxObjectBytes,
    allowedMimeTypes: bucket.allowedMimeTypes,
    policies: bucket.pathRules.flatMap((rule) => {
      const predicate = rulePredicate(context.application, bucket, rule)
      return expandedOperations(rule.operations).map((operation) => ({
        sourceRuleId: rule.id,
        operation,
        principal: rule.principal,
        prefix: rule.prefix,
        status: predicate ? 'emitted' : 'blocked-review'
      }))
    })
  }))
  const blockers = buckets.flatMap((bucket) => [
    ...(bucket.access === 'public-read' ? [`${bucket.id}:public-read-production-review`] : []),
    ...bucket.policies
      .filter((policy) => policy.status !== 'emitted')
      .map((policy) => `${bucket.id}:${policy.sourceRuleId}:${policy.operation}`)
  ])
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-storage-policy.v1',
      version: 1,
      applicationId: context.application.applicationId,
      proposalOnly: true,
      applyAllowed: false,
      releaseReady: false,
      defaultAccess: 'deny',
      buckets,
      blockers,
      operationExpansions: {
        update: ['select', 'update'],
        delete: ['select', 'delete'],
        upsert: ['select', 'insert', 'update']
      },
      upsertExpandsTo: ['select', 'insert', 'update'],
      requiredLiveChecks: [
        'existing-bucket-config-exact-or-explicit-adoption',
        'anonymous-private-object-denied',
        'owner-create-read-update-delete-upsert',
        'second-user-read-update-delete-denied',
        'cross-tenant-read-update-delete-denied',
        'path-prefix-escape-denied',
        'mime-and-size-limits-enforced'
      ]
    },
    '$.supabase.storagePolicy'
  )
}

export function emitSupabaseStoragePolicySQL(context: BackendProviderAdapterContext): string {
  const lines = [
    '-- OpenPencil Supabase Storage proposal v1.',
    '-- Review only: a trusted release host must inspect, approve, apply, and verify this SQL.',
    '-- Object access remains deny-by-default outside the exact bucket/path policies below.',
    '-- Existing buckets are never adopted or reconfigured implicitly.',
    '',
    'BEGIN;',
    ''
  ]
  for (const bucket of context.application.storage?.buckets ?? []) {
    const bucketName = quoteLiteral(bucket.name)
    const publicAccess = bucket.access === 'public-read' ? 'true' : 'false'
    const mimeTypes = sqlArray(bucket.allowedMimeTypes)
    lines.push(
      'INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)',
      `VALUES (${bucketName}, ${bucketName}, ${publicAccess}, ${bucket.maxObjectBytes}, ${mimeTypes})`,
      'ON CONFLICT (id) DO NOTHING;',
      '',
      'DO $openpencil_bucket_guard$',
      'BEGIN',
      '  IF NOT EXISTS (',
      '    SELECT 1 FROM storage.buckets',
      `    WHERE id = ${bucketName}`,
      `      AND name = ${bucketName}`,
      `      AND public IS NOT DISTINCT FROM ${publicAccess}`,
      `      AND file_size_limit IS NOT DISTINCT FROM ${bucket.maxObjectBytes}`,
      `      AND allowed_mime_types IS NOT DISTINCT FROM ${mimeTypes}`,
      '  ) THEN',
      '    RAISE EXCEPTION USING',
      `      MESSAGE = ${quoteLiteral(`OpenPencil refused to adopt or alter Storage bucket ${bucket.name} because its live configuration differs.`)};`,
      '  END IF;',
      'END',
      '$openpencil_bucket_guard$;',
      ''
    )
    for (const rule of bucket.pathRules) {
      const predicate = rulePredicate(context.application, bucket, rule)
      for (const operation of expandedOperations(rule.operations)) {
        const policyName = quoteSupabaseIdentifier(
          stableSQLName('op_storage', `${bucket.id}:${rule.id}:${operation}`)
        )
        if (!predicate) {
          lines.push(
            `-- BLOCKED policy ${policyName} for ${operation.toUpperCase()}: incomplete tenant membership mapping.`
          )
          continue
        }
        lines.push(
          `CREATE POLICY ${policyName} ON storage.objects FOR ${operation.toUpperCase()} TO authenticated ${operationClause(operation, predicate)};`,
          `COMMENT ON POLICY ${policyName} ON storage.objects IS ${quoteLiteral(
            formatSupabaseManagedMarker(
              'policy',
              stableSQLName('op_storage', `${bucket.id}:${rule.id}:${operation}`)
            )
          )};`
        )
      }
    }
    lines.push('')
  }
  if ((context.application.storage?.buckets.length ?? 0) === 0) {
    lines.push('-- No first-class Storage IR was declared; no bucket or object policy was emitted.')
  }
  lines.push('COMMIT;')
  return `${lines.join('\n').trimEnd()}\n`
}

export function emitSupabaseStoragePolicyArtifacts(
  context: BackendProviderAdapterContext
): readonly BackendArtifactSource[] {
  if (!context.application.storage?.buckets.length) return Object.freeze([])
  return Object.freeze([
    Object.freeze({
      path: SUPABASE_ARTIFACT_PATHS.storagePolicy,
      kind: 'security-policy',
      mediaType: 'application/sql; charset=utf-8',
      content: emitSupabaseStoragePolicySQL(context)
    }),
    jsonArtifact(
      SUPABASE_ARTIFACT_PATHS.storagePolicyManifest,
      'security-policy',
      createSupabaseStoragePolicyProposal(context)
    )
  ])
}

function mimeMatches(allowed: readonly string[], actual: string): boolean {
  return allowed.some((entry) => {
    if (entry === actual) return true
    return entry.endsWith('/*') && actual.startsWith(entry.slice(0, -1))
  })
}

function ruleMatches(
  rule: BackendStoragePathRuleIR,
  pathSegments: readonly string[],
  actor: SupabaseStoragePolicyActor
): boolean {
  if (!actor.authenticated) return false
  if (!rule.prefix.every((segment, index) => pathSegments[index] === segment)) return false
  const partition = pathSegments[rule.prefix.length]
  if (!partition) return false
  if (rule.principal.kind === 'owner') return partition === actor.userId
  return Boolean(actor.tenantMemberships?.[rule.principal.tenantId]?.includes(partition))
}

function ruleAllows(rule: BackendStoragePathRuleIR, operation: BackendStorageOperation): boolean {
  if (operation === 'upsert') {
    return (
      rule.operations.includes('upsert') ||
      (rule.operations.includes('read') &&
        rule.operations.includes('create') &&
        rule.operations.includes('update'))
    )
  }
  return (
    rule.operations.includes(operation) ||
    (rule.operations.includes('upsert') && operation !== 'delete')
  )
}

/** Pure mirror for owner/second-user/tenant negative tests; it never grants database authority. */
export function evaluateSupabaseStorageAccess(
  application: BackendApplicationSpecV1,
  input: {
    readonly bucketId: string
    readonly operation: BackendStorageOperation
    readonly objectPath: string
    readonly mimeType: string
    readonly objectBytes: number
    readonly actor: SupabaseStoragePolicyActor
  }
): boolean {
  const bucket = application.storage?.buckets.find(
    (entry) => entry.id === input.bucketId || entry.name === input.bucketId
  )
  if (
    !bucket ||
    !Number.isSafeInteger(input.objectBytes) ||
    input.objectBytes < 0 ||
    input.objectBytes > bucket.maxObjectBytes
  ) {
    return false
  }
  if (!mimeMatches(bucket.allowedMimeTypes, input.mimeType)) return false
  if (
    input.objectPath.startsWith('/') ||
    input.objectPath.endsWith('/') ||
    input.objectPath.includes('//')
  ) {
    return false
  }
  const pathSegments = input.objectPath.split('/')
  if (pathSegments.some((segment) => !segment || segment === '.' || segment === '..')) return false
  if (bucket.access === 'public-read' && input.operation === 'read') return true
  return bucket.pathRules.some(
    (rule) => ruleAllows(rule, input.operation) && ruleMatches(rule, pathSegments, input.actor)
  )
}
