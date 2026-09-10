import { describe, expect, test } from 'bun:test'

import {
  backendProviderPlanDigestV2,
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  emitBackendProviderPlanV2,
  SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2,
  SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2,
  SUPABASE_OBSERVABILITY_PROVIDER_ADAPTER_VERSION_V2,
  SUPABASE_OBSERVABILITY_PROVIDER_BUNDLE_V2,
  type BackendProviderPlanV2
} from '@open-pencil/compiler'

import { supabaseObservabilityApplicationV2, supabasePrivateRealtimeSelectionV2 } from './helpers'

function createPlan(
  application = supabaseObservabilityApplicationV2(),
  mode: 'preview' | 'source-only-prototype' | 'production' = 'production'
) {
  const registry = createBackendProviderRegistryV2([SUPABASE_OBSERVABILITY_PROVIDER_BUNDLE_V2])
  const selection = supabasePrivateRealtimeSelectionV2(SUPABASE_OBSERVABILITY_PROVIDER_BUNDLE_V2)
  const result = createBackendProviderPlanV2(registry, {
    selection,
    application,
    target: 'react',
    mode
  })
  return { registry, selection, result }
}

function emittedArtifacts(application = supabaseObservabilityApplicationV2()) {
  const planned = createPlan(application)
  expect(planned.result.ok).toBe(true)
  if (!planned.result.ok) throw new Error(JSON.stringify(planned.result.diagnostics))
  const emitted = emitBackendProviderPlanV2(planned.registry, {
    plan: planned.result.plan,
    selection: planned.selection
  })
  expect(emitted.ok).toBe(true)
  if (!emitted.ok) throw new Error(JSON.stringify(emitted.diagnostics))
  const artifact = (path: string): string => {
    const content = emitted.emission.files.get(path)
    if (typeof content !== 'string') throw new Error(`Missing text artifact: ${path}`)
    return content
  }
  return { ...planned, plan: planned.result.plan, emission: emitted.emission, artifact }
}

describe('Supabase Backend Provider V2 observability review artifacts', () => {
  test('uses an independent read-only trust domain without changing older candidate descriptors', () => {
    expect(SUPABASE_OBSERVABILITY_PROVIDER_ADAPTER_VERSION_V2).toBe('2.5.0')
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.descriptor.adapterVersion).toBe('2.3.0')
    expect(SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2.descriptor.adapterVersion).toBe('2.4.0')
    expect(SUPABASE_OBSERVABILITY_PROVIDER_BUNDLE_V2.descriptor.adapterId).not.toBe(
      SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.descriptor.adapterId
    )
    expect(SUPABASE_OBSERVABILITY_PROVIDER_BUNDLE_V2.descriptor.adapterId).not.toBe(
      SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2.descriptor.adapterId
    )

    const first = emittedArtifacts()
    const second = emittedArtifacts()
    expect(first.plan.planDigest).toBe(second.plan.planDigest)
    expect(first.emission.manifestDigest).toBe(second.emission.manifestDigest)
    expect([...first.emission.files]).toEqual([...second.emission.files])
    expect(first.plan.actualCapabilities).toEqual([
      'audit.events',
      'drift.detect',
      'jobs.schedule',
      'migrations.schema',
      'observability.logs',
      'observability.metrics',
      'observability.traces',
      'queues.consume',
      'queues.publish',
      'server.functions',
      'webhooks.deliver',
      'webhooks.receive',
      'workflows.durable-execution',
      'workflows.idempotency',
      'workflows.retry'
    ])
    expect(Object.keys(first.plan.adapterPlans)).toEqual([
      'server',
      'migrations',
      'automations',
      'observability'
    ])
    expect(first.plan.capabilities.every((entry) => entry.included)).toBe(true)
  })

  test('emits bounded contracts for one Host-owned snapshot and append-only audit sink', () => {
    const result = emittedArtifacts()
    expect(
      Object.values(SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2).every((path) =>
        result.emission.files.has(path)
      )
    ).toBe(true)
    const review = JSON.parse(
      result.artifact(SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.reviewManifest)
    )
    const inspection = JSON.parse(
      result.artifact(SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.inspectionContract)
    )
    const audit = JSON.parse(
      result.artifact(SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.auditContract)
    )

    expect(review).toMatchObject({
      reviewOnly: true,
      readOnly: true,
      applyAllowed: false,
      deployAllowed: false,
      releaseReady: false,
      executableRuntimeEmitted: false
    })
    expect(review.blockers).toEqual(
      expect.arrayContaining([
        'trusted-host-observation-runner-not-implemented',
        'single-snapshot-inspection-receipt-required',
        'operational-event-sink-schema-not-applied',
        'operational-event-sink-postgrest-exposed-schema-inventory-required',
        'operational-event-sink-host-cas-writer-not-implemented',
        'operational-event-sink-post-apply-receipt-not-implemented',
        'live-drift-and-observability-tests-required'
      ])
    )
    expect(review.expectedPostApplyState.operationalEventSink).toMatchObject({
      exactHeadCasFields: [
        'current_revision',
        'current_head_digest',
        'current_batch_digest',
        'provider_id',
        'environment',
        'authority_digest',
        'current_segment_last_occurred_at',
        'observed_at'
      ],
      anchorBinding: 'exact-prior-head-prior-time-domain-authority-and-evaluated-at',
      segmentLastOccurredAtBinding: 'host-derived-final-event-and-exact-successor-anchor-bound',
      postgrestExposedSchemaInventory:
        'expected-not-exposed-unverified-until-trusted-post-apply-receipt',
      timestampProjection: 'trusted-host-zero-pad-to-nine-fractional-digits-without-rounding'
    })
    expect(review.requiredManualChecks).toContain(
      'verify-operational-event-sink-schema-absent-from-postgrest-exposed-schemas'
    )
    expect(inspection).toMatchObject({
      reviewOnly: true,
      inputAuthority: {
        transport: 'trusted-desktop-host-single-snapshot',
        compilerSuppliedSqlAccepted: false,
        callerSuppliedSqlAccepted: false,
        callerSuppliedUrlAccepted: false,
        callerSuppliedHeadersAccepted: false,
        callerSuppliedCredentialAccepted: false
      },
      observationBoundary: {
        applicationRows: 'forbidden',
        credentialMaterial: 'forbidden',
        rawErrors: 'forbidden'
      },
      outcome: {
        receiptFormat: 'openpencil.source-migration-drift-receipt',
        receiptVersion: 1,
        sourceLedgerMutationAuthority: false,
        releaseAuthority: false
      }
    })
    expect(inspection.declaredDataModelDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(inspection.declaredSubjectDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(inspection.expectedSourceLedgerSchemaDigest).toBeNull()
    expect(inspection.expectedSourceLedgerSchemaDigestAuthority).toBe(
      'trusted-host-current-environment-only'
    )
    expect(result.plan.adapterPlans.migrations).toMatchObject({
      targetModelDigest: inspection.declaredDataModelDigest
    })
    expect(result.plan.adapterPlans.observability.operationalEventSink).toMatchObject({
      proposalAndBatchAuthorityClaims: 'fixed-false',
      timestampProjection: 'trusted-host-zero-pad-to-nine-fractional-digits-without-rounding',
      expectedPostgrestExposure: 'not-exposed',
      postgrestExposureVerified: false,
      hostCasWriterEmitted: false,
      databaseApplied: false,
      trustedReceiptAccepted: false
    })
    expect(inspection.plan.driftDetection.schedule).toEqual({
      automationId: 'schema-drift-check',
      cron: '15 3 * * *',
      mode: 'read-only',
      scope: 'declared-schema',
      timezone: 'UTC'
    })
    expect(audit).toMatchObject({
      reviewOnly: true,
      appendOnlySinkProvisioned: false,
      telemetrySinkProvisioned: false,
      schemaCandidate: {
        emitted: true,
        reviewOnly: true,
        databaseApplied: false,
        eventPayloadStored: false,
        hostCasWriterEmitted: false,
        networkTransportEmitted: false,
        credentialAuthorityCreated: false,
        telemetryDrainEmitted: false,
        expectedPostgrestExposure: 'not-exposed',
        postgrestExposureVerified: false,
        applyAuthorityCreated: false,
        verifyAuthorityCreated: false,
        releaseAuthorityCreated: false
      },
      eventEnvelope: {
        format: 'openpencil.backend-operational-event',
        version: 1,
        maximumSegmentEvents: 256,
        trustedAnchorFormat: 'openpencil.backend-operational-anchor',
        appendAuthorityFormat: 'openpencil.backend-operational-append-authority',
        hostAuthenticatedAnchorRequired: true,
        atomicHeadCasRequired: true
      },
      retention: 'operator-policy-required',
      export: 'operator-controlled-required'
    })
    expect(audit.schemaCandidate.applicationScopeDigest).toMatch(
      /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
    )
    expect(audit.schemaCandidate.schemaName).toMatch(/^op_observability_[a-z0-9_-]{20}$/u)
    expect(audit.sinkEnvelope).toEqual({
      batchFormat: 'openpencil.backend-operational-event-sink-batch',
      proposalFormat: 'openpencil.backend-operational-event-sink-cas-proposal',
      version: 1,
      maximumRevision: Number.MAX_SAFE_INTEGER,
      exactBindings: [
        'trusted-anchor',
        'expected-revision-and-head',
        'next-revision-and-head',
        'segment-prior-and-head',
        'segment-last-occurred-at-and-successor-prior-time',
        'ordered-event-digests-and-count',
        'batch-digest',
        'observed-at',
        'provider-environment-authority'
      ],
      canonicalDigestPattern: '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$',
      timestampPattern:
        '^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{9}Z$',
      timestampProjection: 'trusted-host-zero-pad-to-nine-fractional-digits-without-rounding',
      explicitNullSemantics: 'initial-null-successor-non-null',
      proposalAndBatchAuthorityClaims: 'fixed-false',
      eventPayloadStored: false
    })
    expect(audit.eventEnvelope.exactFields).toEqual(
      expect.arrayContaining([
        'eventId',
        'operationId',
        'attemptId',
        'authorityDigest',
        'phase',
        'outcome',
        'previousEventDigest'
      ])
    )
    expect(audit.integrity).toEqual({
      canonicalEncoding: 'openpencil.canonical-manifest-json-utf8.v1',
      clockRegression: 'reject',
      digest: 'sha256',
      duplicateEventId: 'reject',
      globalEventAndAttemptReservationRequired: true,
      previousEventDigestRequired: true
    })
    expect(audit.forbiddenEventFields).toEqual(
      expect.arrayContaining(['authorization', 'databasePassword', 'rawSql', 'rowData', 'secret'])
    )
    expect(result.emission.manifest.requiredSecrets).toHaveLength(3)
    const automationSql = result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.sql)
    expect(automationSql).toContain("'automationId', 'scheduled-publish'")
    expect(automationSql).not.toContain('schema-drift-check')
  })

  test('emits a collision-safe one-shot private operational-event sink CAS schema only', () => {
    const result = emittedArtifacts()
    const review = JSON.parse(
      result.artifact(SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.reviewManifest)
    )
    const sink = review.expectedPostApplyState.operationalEventSink as {
      applicationScopeDigest: string
      schemaName: string
    }
    const sql = result.artifact(SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.operationalEventSinkSchema)
    const schema = `"${sink.schemaName}"`
    const revisions = `${schema}."operational_event_sink_revisions"`
    const heads = `${schema}."operational_event_sink_heads"`
    const refusal = sql.indexOf(
      'refuses to adopt or replace a pre-existing operational event sink schema'
    )
    const createSchema = sql.indexOf(`CREATE SCHEMA ${schema} AUTHORIZATION CURRENT_USER;`)

    expect(sink.applicationScopeDigest).toMatch(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u)
    expect(sink.schemaName).toMatch(/^op_observability_[a-z0-9_-]{20}$/u)
    expect(refusal).toBeGreaterThan(-1)
    expect(createSchema).toBeGreaterThan(refusal)
    expect(sql).toContain('including a truncated-name collision')
    expect(sql).toContain('FROM "pg_catalog"."pg_description" AS "prior_sink_marker"')
    expect(sql).toContain('LEFT("prior_sink_marker"."description"')
    expect(sql).not.toContain('"prior_sink_marker"."description" LIKE')
    expect(sql).toContain(`CREATE TABLE ${revisions} (`)
    expect(sql).toContain(`CREATE TABLE ${heads} (`)
    expect(sql).toContain(
      `'${sink.applicationScopeDigest.slice(0, 21)}' || '${sink.applicationScopeDigest.slice(21)}'`
    )
    expect(sql).toContain(
      `${sink.applicationScopeDigest.slice(0, 21)}.${sink.applicationScopeDigest.slice(21)}`
    )
    expect(sql).not.toContain(sink.applicationScopeDigest)
    expect(sql).toContain('PRIMARY KEY ("application_scope_digest", "revision")')
    expect(sql).toContain('PRIMARY KEY ("application_scope_digest")')
    expect(sql).toContain(
      `FOREIGN KEY (
      "application_scope_digest", "expected_revision", "expected_head_digest",
      "provider_id", "environment", "authority_digest",
      "anchor_prior_segment_last_occurred_at"
    ) REFERENCES ${revisions} (
      "application_scope_digest", "revision", "next_head_digest",
      "provider_id", "environment", "authority_digest", "segment_last_occurred_at"
    )`
    )
    expect(sql).toContain(
      `FOREIGN KEY (
      "application_scope_digest", "current_revision", "current_head_digest",
      "current_batch_digest", "provider_id", "environment", "authority_digest",
      "current_segment_last_occurred_at", "observed_at"
    ) REFERENCES ${revisions} (
      "application_scope_digest", "revision", "next_head_digest",
      "batch_digest", "provider_id", "environment", "authority_digest",
      "segment_last_occurred_at", "observed_at"
    )`
    )
    expect(sql).toContain('MATCH SIMPLE DEFERRABLE INITIALLY DEFERRED')
    expect(sql).toContain('MATCH FULL DEFERRABLE INITIALLY DEFERRED')
    expect(sql).toContain('"expected_revision" = "revision" - 1')
    expect(sql).toContain('"expected_head_digest" IS NOT DISTINCT FROM "segment_prior_head_digest"')
    expect(sql).toContain(
      '"expected_head_digest" IS NOT DISTINCT FROM "anchor_prior_segment_head_digest"'
    )
    expect(sql).toContain('"next_head_digest" = "segment_head_digest"')
    expect(sql).toContain('"anchor_trusted_head_digest" = "segment_head_digest"')
    expect(sql).toContain('"anchor_provider_id" = "provider_id"')
    expect(sql).toContain('"anchor_environment" = "environment"')
    expect(sql).toContain('"anchor_authority_digest" = "authority_digest"')
    expect(sql).toContain('"segment_last_occurred_at" text COLLATE "C" NOT NULL')
    expect(sql).toContain('"current_segment_last_occurred_at" text COLLATE "C" NOT NULL')
    expect(sql).toContain(
      'Release timestamps are Host-projected without rounding to fixed YYYY-MM-DDTHH:MM:SS.nnnnnnnnnZ text'
    )
    expect(sql).toContain(
      "'^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{9}Z$'"
    )
    expect(sql).toContain(
      '"isfinite"(CAST("segment_last_occurred_at" AS timestamp with time zone))'
    )
    expect(sql).toContain(
      'OR "anchor_prior_segment_last_occurred_at" <= "segment_last_occurred_at")'
    )
    expect(sql).toContain('"segment_last_occurred_at" <= "host_evaluated_at"')
    expect(sql).toContain('"current_segment_last_occurred_at" <= "observed_at"')
    expect(sql).toContain(
      '"chain_constraint"."conkey" = ARRAY[1, 3, 4, 11, 12, 13, 20]::smallint[]'
    )
    expect(sql).toContain(
      '"chain_constraint"."confkey" = ARRAY[1, 2, 5, 11, 12, 13, 26]::smallint[]'
    )
    expect(sql).toContain(
      '"head_constraint"."confkey" = ARRAY[1, 2, 5, 6, 11, 12, 13, 26, 30]::smallint[]'
    )
    expect(sql).toContain(
      '"anchor_prior_segment_open_attempt_ids"\n      IS NOT DISTINCT FROM ARRAY[]::text[]'
    )
    expect(sql).toContain('"cardinality"("anchor_prior_segment_open_attempt_ids") = 0')
    expect(sql).toContain('"cardinality"("ordered_event_digests") = "event_count"')
    expect(sql).toContain(
      `"array_to_string"("ordered_event_digests", ':') ~ '^(?:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])(?::[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]){0,255}$'`
    )
    expect(sql).toContain('"ordered_event_digests"["event_count"] = "segment_head_digest"')
    expect(sql).toContain('"host_evaluated_at" = "anchor_evaluated_at"')
    expect(sql).toContain('"observed_at" = "anchor_evaluated_at"')
    expect(sql.split('^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$').length - 1).toBe(14)
    expect(sql).not.toContain('^[A-Za-z0-9_-]{43}$')
    expect(sql).toContain('"proposal_host_anchor_authenticated" IS FALSE')
    expect(sql).toContain('"proposal_persistence_authority_granted" IS FALSE')
    expect(sql).toContain('"proposal_export_authority_granted" IS FALSE')
    expect(sql).toContain('"proposal_alert_authority_granted" IS FALSE')
    expect(sql).toContain('"proposal_release_authority_granted" IS FALSE')
    expect(sql).toContain('"batch_host_anchor_authenticated" IS FALSE')
    expect(sql).toContain('"batch_persistence_authority_granted" IS FALSE')
    expect(sql).toContain('"batch_export_authority_granted" IS FALSE')
    expect(sql).toContain('"batch_alert_authority_granted" IS FALSE')
    expect(sql).toContain('"batch_release_authority_granted" IS FALSE')
    expect(sql).toContain('operational event sink revisions are append-only')
    expect(sql).toContain('BEFORE UPDATE OR DELETE OR TRUNCATE ON')
    expect(sql).toContain('FROM "pg_catalog"."pg_attribute" AS "table_column"')
    const revisionColumnOrdinals = [
      ...sql.matchAll(
        /^\s+\('operational_event_sink_revisions', (\d+), '[^']+', "pg_catalog"\."to_regtype"/gmu
      )
    ].map((entry) => Number(entry[1]))
    const headColumnOrdinals = [
      ...sql.matchAll(
        /^\s+\('operational_event_sink_heads', (\d+), '[^']+', "pg_catalog"\."to_regtype"/gmu
      )
    ].map((entry) => Number(entry[1]))
    expect(revisionColumnOrdinals).toEqual(Array.from({ length: 40 }, (_, index) => index + 1))
    expect(headColumnOrdinals).toEqual(Array.from({ length: 9 }, (_, index) => index + 1))
    expect(
      sql.split(
        `('operational_event_sink_revisions', 3, 'expected_revision', "pg_catalog"."to_regtype"('pg_catalog.int8'), FALSE)`
      ).length - 1
    ).toBe(1)
    expect(sql).toContain(
      `('operational_event_sink_revisions', 35, 'proposal_release_authority_granted', "pg_catalog"."to_regtype"('pg_catalog.bool'), TRUE)`
    )
    expect(sql).toContain(
      `('operational_event_sink_revisions', 40, 'batch_release_authority_granted', "pg_catalog"."to_regtype"('pg_catalog.bool'), TRUE)`
    )
    expect(sql).toContain(
      `('operational_event_sink_heads', 9, 'observed_at', "pg_catalog"."to_regtype"('pg_catalog.text'), TRUE)`
    )
    expect(sql).toContain('canonical timestamp collation postcondition failed')
    expect(sql).toContain('FROM "pg_catalog"."pg_constraint" AS "table_constraint"')
    expect(sql).toContain('FROM "pg_catalog"."pg_index" AS "table_index"')
    expect(sql).toContain('"sink_schema"."nspowner" = expected_owner')
    expect(sql).toContain('"sink_relation"."relowner" <> expected_owner')
    expect(sql).toContain('"guard_proc"."proowner" = expected_owner')
    expect(sql).toContain('CROSS JOIN LATERAL "pg_catalog"."aclexplode"(')
    expect(sql).toContain('A non-owner retains a direct privilege')
    expect(sql).toContain('A known Supabase API role retains effective access')
    expect(sql).toContain('FROM PUBLIC, "anon", "authenticated", "authenticator";')
    expect(sql).toContain("CURRENT_USER IN ('anon', 'authenticated', 'authenticator', 'postgres')")
    expect(sql.match(/authenticator/gu)).toHaveLength(7)
    expect(sql).not.toContain('service_role')
    expect(sql).not.toContain(`INSERT INTO ${revisions}`)
    expect(sql).not.toContain(`UPDATE ${heads}`)
    expect(sql).not.toContain(`DELETE FROM ${revisions}`)
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/u)
    expect(sql).not.toMatch(/\bUPDATE\s+\S+\s+SET\b/u)
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/u)
    expect(sql).not.toMatch(/\bTRUNCATE\s+TABLE\b/u)
    expect(sql).not.toMatch(/\bMERGE\s+INTO\b/u)
    expect(sql).not.toContain('CREATE EXTENSION')
    expect(sql).not.toContain('CREATE POLICY')
    expect(sql).not.toContain('GRANT ')
    expect(sql).not.toContain('DROP ')
    expect(sql).not.toContain('jsonb')
    expect(sql).not.toContain('event_payload')
    expect(sql).toEndWith('COMMIT;\n')

    const distinctApplication = structuredClone(supabaseObservabilityApplicationV2())
    distinctApplication.applicationId = 'test.supabase-observability-collision-boundary'
    const distinctReview = JSON.parse(
      emittedArtifacts(distinctApplication).artifact(
        SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.reviewManifest
      )
    )
    expect(distinctReview.expectedPostApplyState.operationalEventSink).not.toMatchObject({
      applicationScopeDigest: sink.applicationScopeDigest,
      schemaName: sink.schemaName
    })
  })

  test('creates no scheduler, database, network, credential, telemetry-sink, or release authority', () => {
    const result = emittedArtifacts()
    expect(result.plan.adapterPlans.observability).toMatchObject({
      reviewOnly: true,
      inspectionTransport: 'trusted-desktop-host-single-snapshot',
      releaseReady: false,
      runtimeAuthorityCreated: false,
      credentialAuthorityCreated: false,
      databaseAuthorityCreated: false,
      networkAuthorityCreated: false,
      schedulerAuthorityCreated: false,
      telemetrySinkAuthorityCreated: false
    })
    const joined = [
      SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.reviewManifest,
      SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.inspectionContract,
      SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.auditContract
    ]
      .map((path) => result.artifact(path))
      .join('\n')
    expect(joined).not.toContain('service_role')
    expect(joined).not.toContain('Authorization:')
    expect(joined).not.toContain('CREATE ')
    expect(joined).not.toContain('SELECT ')
    expect(joined).not.toContain('fetch(')
    expect(joined).not.toContain('WEBHOOK_INGRESS_HMAC')
    expect(joined).not.toContain('WEBHOOK_EGRESS_ENDPOINT')
    expect(joined).not.toContain('WEBHOOK_EGRESS_HMAC')
    const schema = result.artifact(
      SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.operationalEventSinkSchema
    )
    expect(schema).not.toContain('Authorization:')
    expect(schema).not.toContain('fetch(')
    expect(schema).not.toContain('WEBHOOK_INGRESS_HMAC')
    expect(schema).not.toContain('WEBHOOK_EGRESS_ENDPOINT')
    expect(schema).not.toContain('WEBHOOK_EGRESS_HMAC')
  })

  test('keeps a pure drift and telemetry declaration free of unrelated pgmq artifacts', () => {
    const application = structuredClone(supabaseObservabilityApplicationV2())
    application.automations.queues = []
    application.automations.webhookDestinations = []
    application.automations.automations = application.automations.automations.filter(
      (entry) => entry.action.kind === 'drift.detect'
    )
    application.capabilities = application.capabilities.filter(
      (entry) =>
        !['queues.consume', 'queues.publish', 'webhooks.deliver', 'webhooks.receive'].includes(
          entry.capability
        )
    )
    application.secrets = []

    const result = emittedArtifacts(application)
    expect(result.plan.adapterPlans.automations).toMatchObject({
      automationPlan: null,
      ordinaryAutomationArtifactsEmitted: false,
      scheduleId: 'schema-drift-check',
      ordinaryAutomationReviewSqlEmitted: false,
      driftSchedulerSqlEmitted: false
    })
    for (const path of Object.values(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2)) {
      expect(result.emission.files.has(path)).toBe(false)
    }
    expect(result.emission.manifest.requiredSecrets).toEqual([])
  })

  test('fails closed for delivery authority and non-drift automations', () => {
    const application = structuredClone(supabaseObservabilityApplicationV2())
    const automation = application.automations.automations.at(0)
    if (!automation) throw new Error('Expected observability automation fixture')
    automation.action = {
      kind: 'webhook.deliver',
      destinationId: 'foreign',
      payloadExpression: 'input'
    }
    const result = createPlan(application).result
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'backend-webhook-destination-missing' })
      ])
    )
  })

  test('fails closed in preview, omits server authority in prototypes, and rejects plan tampering', () => {
    const preview = createPlan(supabaseObservabilityApplicationV2(), 'preview')
    expect(preview.result.ok).toBe(false)
    if (!preview.result.ok) {
      expect(preview.result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'backend-v2-preview-server-capability-unavailable' })
      )
    }

    const prototype = createPlan(supabaseObservabilityApplicationV2(), 'source-only-prototype')
    expect(prototype.result.ok).toBe(true)
    if (prototype.result.ok) {
      expect(Object.keys(prototype.result.plan.adapterPlans)).toEqual(['migrations'])
      expect(
        prototype.result.plan.capabilities
          .filter((entry) => entry.capability !== 'migrations.schema')
          .every((entry) => !entry.included)
      ).toBe(true)
      expect(
        prototype.result.plan.capabilities.find((entry) => entry.capability === 'migrations.schema')
          ?.included
      ).toBe(true)
    }

    const planned = createPlan()
    expect(planned.result.ok).toBe(true)
    if (!planned.result.ok) return
    const plan = structuredClone(planned.result.plan) as BackendProviderPlanV2
    ;(plan.adapterPlans.observability as { releaseReady: boolean }).releaseReady = true
    ;(plan as { planDigest: string }).planDigest = backendProviderPlanDigestV2(plan)
    const emitted = emitBackendProviderPlanV2(planned.registry, {
      plan,
      selection: planned.selection
    })
    expect(emitted.ok).toBe(false)
    if (emitted.ok) return
    expect(emitted.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-provider-v2-plan-stale' })
    )
  })
})
