/* eslint-disable max-lines -- Security regression cases intentionally exercise the full V2 boundary. */
import { describe, expect, test } from 'bun:test'

import {
  canonicalBackendApplicationV2Bytes,
  deriveBackendApplicationCapabilitiesV2,
  digestBackendApplicationV2,
  lowerBackendApplicationSpecV1ToV2,
  normalizedBackendApplicationV2,
  parseBackendApplicationSpecV2,
  validateBackendCapabilityDeclarationsV2
} from '#lowcode/backend/application-v2'
import type { BackendApplicationSpecV2 } from '#lowcode/backend/application-v2-types'
import { parseBackendApplicationSpecV1 } from '#lowcode/backend/validate'

import { backendApplicationFixture } from './fixture'

function loweredFixture(): BackendApplicationSpecV2 {
  const source = backendApplicationFixture()
  source.dataModel.entities[0].fields[0] = {
    id: 'id',
    name: 'id',
    type: 'integer',
    nullable: false,
    default: { kind: 'generated', generator: 'identity' }
  }
  source.dataModel.entities[0].fields.push({
    id: 'version',
    name: 'version',
    type: 'integer',
    nullable: false,
    default: { kind: 'literal', value: 0 }
  })
  source.secrets.push(
    {
      kind: 'credential',
      credentialRef: 'credential.00000000-0000-4000-8000-000000000001',
      name: 'WEBHOOK_INGRESS_HMAC',
      exposure: 'server',
      required: true
    },
    {
      kind: 'credential',
      credentialRef: 'credential.00000000-0000-4000-8000-000000000002',
      name: 'WEBHOOK_EGRESS_HMAC',
      exposure: 'server',
      required: true
    }
  )
  const lowered = lowerBackendApplicationSpecV1ToV2(source)
  if (!lowered.ok) throw new Error('fixture must lower')
  return structuredClone(lowered.value)
}

function fullV2Fixture(): BackendApplicationSpecV2 {
  const application = loweredFixture()
  application.realtime.subscriptions.push({
    id: 'notes-live',
    entityId: 'notes',
    events: ['update', 'insert'],
    principal: { kind: 'owner', ownershipId: 'note-owner' },
    delivery: { kind: 'invalidate-query', queryKey: 'notes' }
  })
  application.transactions.transactions.push({
    id: 'rename-note',
    name: 'Rename note',
    access: 'authenticated',
    principal: { kind: 'owner', ownershipId: 'note-owner' },
    isolation: 'serializable',
    parameters: [
      { name: 'note_id', type: 'integer', required: true },
      { name: 'expected_version', type: 'integer', required: true },
      { name: 'title', type: 'string', required: true }
    ],
    conflictPolicy: {
      kind: 'expected-version',
      entityId: 'notes',
      fieldId: 'version',
      parameter: 'expected_version'
    },
    steps: [
      {
        id: 'load',
        kind: 'data.read',
        entityId: 'notes',
        resultName: 'existing',
        fields: ['id', 'version'],
        filters: [
          {
            field: 'id',
            operator: 'eq',
            value: { kind: 'parameter', name: 'note_id' }
          }
        ],
        single: true,
        limit: 1
      },
      {
        id: 'require-existing',
        kind: 'assert',
        assertion: { kind: 'result-exists', resultName: 'existing' }
      },
      {
        id: 'update',
        kind: 'data.mutate',
        entityId: 'notes',
        operation: 'update',
        values: [{ field: 'title', value: { kind: 'parameter', name: 'title' } }],
        increments: [{ field: 'version', by: 1 }],
        filters: [
          {
            field: 'id',
            operator: 'eq',
            value: { kind: 'parameter', name: 'note_id' }
          },
          {
            field: 'version',
            operator: 'eq',
            value: { kind: 'parameter', name: 'expected_version' }
          }
        ],
        resultName: 'updated',
        maxAffectedRows: 1
      },
      {
        id: 'require-update',
        kind: 'assert',
        assertion: { kind: 'result-count', resultName: 'updated', operator: 'eq', value: 1 }
      }
    ]
  })
  application.dataMigrations.migrations.push({
    id: 'notes-title-backfill',
    name: 'Backfill note titles',
    entityId: 'notes',
    cursor: {
      kind: 'monotonic-identity-primary-key',
      fieldId: 'id'
    },
    batchSize: 100,
    predicate: { kind: 'field-is-null', fieldId: 'title' },
    transforms: [{ kind: 'set-literal', fieldId: 'title', value: 'Untitled' }],
    postconditions: [{ kind: 'field-not-null', fieldId: 'title' }],
    dryRunRequired: true,
    resumePolicy: 'from-receipt'
  })
  application.automations.queues.push(
    {
      id: 'events',
      name: 'Events',
      visibility: 'private',
      delivery: 'at-least-once',
      maxPayloadBytes: 65_536,
      visibilityTimeoutSeconds: 60,
      retentionSeconds: 86_400
    },
    {
      id: 'dead-letter',
      name: 'Dead letter',
      visibility: 'private',
      delivery: 'at-least-once',
      maxPayloadBytes: 65_536,
      visibilityTimeoutSeconds: 60,
      retentionSeconds: 604_800
    }
  )
  application.automations.webhookDestinations.push({
    id: 'audit-endpoint',
    name: 'Audit endpoint',
    url: 'https://hooks.example.test/openpencil',
    method: 'POST',
    contentType: 'application/json',
    maxPayloadBytes: 65_536,
    signingCredentialRef: 'credential.00000000-0000-4000-8000-000000000002',
    signature: {
      kind: 'hmac-sha256',
      canonicalEnvelope: 'raw-body-v1',
      signedComponents: ['method', 'path', 'timestamp', 'idempotency-key', 'raw-body-sha256'],
      signatureEncoding: 'lowercase-hex',
      timestampFormat: 'unix-seconds',
      signatureHeaderName: 'X-OpenPencil-Signature',
      timestampHeaderName: 'X-OpenPencil-Timestamp',
      idempotencyHeaderName: 'Idempotency-Key'
    }
  })
  application.automations.automations.push(
    {
      id: 'drift-check',
      name: 'Drift check',
      subject: 'system',
      trigger: { kind: 'schedule', cron: '0 * * * *', timezone: 'UTC' },
      action: { kind: 'drift.detect', scope: 'declared-schema', mode: 'read-only' },
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1_000,
        maxDelayMs: 60_000,
        backoff: 'exponential',
        jitter: 'full',
        deadLetterQueueId: 'dead-letter'
      },
      idempotency: { kind: 'event-id', retentionHours: 24 },
      causation: { kind: 'required', idField: 'causationId', maxHop: 8 }
    },
    {
      id: 'webhook-ingress',
      name: 'Webhook ingress',
      subject: 'system',
      trigger: {
        kind: 'webhook',
        method: 'POST',
        path: '/hooks/events',
        signature: {
          kind: 'hmac-sha256',
          credentialRef: 'credential.00000000-0000-4000-8000-000000000001',
          canonicalEnvelope: 'raw-body-v1',
          signedComponents: ['method', 'path', 'timestamp', 'idempotency-key', 'raw-body-sha256'],
          signatureEncoding: 'lowercase-hex',
          timestampFormat: 'unix-seconds',
          signatureHeaderName: 'X-OpenPencil-Signature',
          timestampHeaderName: 'X-OpenPencil-Timestamp',
          idempotencyHeaderName: 'Idempotency-Key',
          maxAgeSeconds: 300
        }
      },
      action: { kind: 'queue.publish', queueId: 'events', payloadExpression: 'input' },
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1_000,
        maxDelayMs: 10_000,
        backoff: 'exponential',
        jitter: 'full',
        deadLetterQueueId: 'dead-letter'
      },
      idempotency: {
        kind: 'request-header',
        headerName: 'Idempotency-Key',
        retentionHours: 24
      },
      causation: { kind: 'required', idField: 'causationId', maxHop: 8 }
    },
    {
      id: 'event-delivery',
      name: 'Event delivery',
      subject: 'system',
      trigger: { kind: 'queue', queueId: 'events' },
      action: {
        kind: 'webhook.deliver',
        destinationId: 'audit-endpoint',
        payloadExpression: 'input'
      },
      retry: {
        maxAttempts: 5,
        initialDelayMs: 1_000,
        maxDelayMs: 60_000,
        backoff: 'exponential',
        jitter: 'full',
        deadLetterQueueId: 'dead-letter'
      },
      idempotency: { kind: 'event-id', retentionHours: 72 },
      causation: { kind: 'required', idField: 'causationId', maxHop: 8 }
    }
  )
  application.automations.telemetry = {
    logs: true,
    metrics: true,
    traces: true,
    auditEvents: true
  }
  application.automations.driftDetection = {
    enabled: true,
    scheduleAutomationId: 'drift-check'
  }
  application.capabilities = deriveBackendApplicationCapabilitiesV2(application).map(
    (capability) => ({ capability, required: true })
  )
  return application
}

function failureCodes(value: unknown): string[] {
  const result = parseBackendApplicationSpecV2(value)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.diagnostics.map((entry) => entry.code)
}

describe('BackendApplicationSpecV2 contract foundation', () => {
  test('lowers a normalized V1 application without silently enabling P2 features', () => {
    const lowered = lowerBackendApplicationSpecV1ToV2(backendApplicationFixture())
    expect(lowered.ok).toBe(true)
    if (!lowered.ok) return
    expect(lowered.value.version).toBe(2)
    expect(lowered.value.realtime).toEqual({ version: 1, subscriptions: [] })
    expect(lowered.value.transactions).toEqual({ version: 1, transactions: [] })
    expect(lowered.value.dataMigrations).toEqual({ version: 1, migrations: [] })
    expect(lowered.value.automations).toEqual({
      version: 1,
      queues: [],
      webhookDestinations: [],
      automations: [],
      telemetry: { logs: false, metrics: false, traces: false, auditEvents: false },
      driftDetection: { enabled: false }
    })
  })

  test('normalizes the versioned provider-neutral P2 sections and derives capabilities', () => {
    const result = parseBackendApplicationSpecV2(fullV2Fixture())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.realtime.subscriptions[0].events).toEqual(['insert', 'update'])
    expect(result.value.transactions.transactions[0].parameters.map((entry) => entry.name)).toEqual(
      ['expected_version', 'note_id', 'title']
    )
    expect(validateBackendCapabilityDeclarationsV2(result.value)).toEqual([])
    const capabilities = deriveBackendApplicationCapabilitiesV2(result.value)
    expect(capabilities).toContain('realtime.subscribe')
    expect(capabilities).toContain('events.data-change')
    expect(capabilities).toContain('transactions.atomic')
    expect(capabilities).toContain('migrations.backfill')
    expect(capabilities).toContain('jobs.schedule')
    expect(capabilities).toContain('queues.publish')
    expect(capabilities).toContain('queues.consume')
    expect(capabilities).toContain('webhooks.receive')
    expect(capabilities).toContain('webhooks.deliver')
    expect(capabilities).toContain('workflows.idempotency')
    expect(capabilities).toContain('workflows.retry')
    expect(capabilities).toContain('workflows.durable-execution')
    expect(capabilities).toContain('observability.logs')
    expect(capabilities).toContain('observability.metrics')
    expect(capabilities).toContain('observability.traces')
    expect(capabilities).toContain('audit.events')
    expect(capabilities).toContain('drift.detect')
    expect(JSON.stringify(result.value).toLowerCase()).not.toContain('supabase')
  })

  test('fails closed for unknown top-level and section fields or versions', () => {
    const unknown = Object.assign(structuredClone(fullV2Fixture()), {
      providerDialect: 'forbidden'
    })
    expect(parseBackendApplicationSpecV2(unknown).ok).toBe(false)

    const future = structuredClone(fullV2Fixture())
    Reflect.set(future.realtime, 'version', 2)
    const result = parseBackendApplicationSpecV2(future)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map((entry) => entry.code)).toContain(
        'backend-realtime-version-unsupported'
      )
    }
  })

  test('transactions reject HTTP, storage, queue, call, and nested steps', () => {
    for (const kind of ['http.request', 'storage.write', 'queue.publish', 'call', 'transaction']) {
      const input = fullV2Fixture()
      Reflect.set(input.transactions.transactions[0], 'steps', [{ id: 'bad', kind }])
      expect(parseBackendApplicationSpecV2(input).ok).toBe(false)
    }

    const nested = fullV2Fixture()
    Reflect.set(nested.transactions.transactions[0].steps[2], 'steps', [])
    const result = parseBackendApplicationSpecV2(nested)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual({
        code: 'backend-unknown-field',
        severity: 'error',
        path: '$.transactions.transactions[0].steps[2].steps',
        message: 'Unknown field is not allowed.'
      })
    }
  })

  test('data migrations require bounded batches, dry runs, receipts, and postconditions', () => {
    const input = fullV2Fixture()
    input.dataMigrations.migrations[0].batchSize = 1_001
    Reflect.set(input.dataMigrations.migrations[0], 'dryRunRequired', false)
    input.dataMigrations.migrations[0].postconditions = []
    const result = parseBackendApplicationSpecV2(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const codes = result.diagnostics.map((entry) => entry.code)
      expect(codes).toContain('backend-integer-invalid')
      expect(codes).toContain('backend-data-migration-dry-run-required')
      expect(codes).toContain('backend-data-migration-postcondition-required')
    }
  })

  test('webhooks cannot be unsigned or use caller authority', () => {
    const unsigned = fullV2Fixture()
    const webhook = unsigned.automations.automations.find(
      (entry) => entry.trigger.kind === 'webhook'
    )
    if (!webhook || webhook.trigger.kind !== 'webhook') throw new Error('fixture webhook missing')
    Reflect.deleteProperty(webhook.trigger, 'signature')
    expect(parseBackendApplicationSpecV2(unsigned).ok).toBe(false)

    const caller = fullV2Fixture()
    const callerWebhook = caller.automations.automations.find(
      (entry) => entry.trigger.kind === 'webhook'
    )
    if (!callerWebhook) throw new Error('fixture webhook missing')
    callerWebhook.subject = 'caller-user'
    const result = parseBackendApplicationSpecV2(caller)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map((entry) => entry.code)).toContain(
        'backend-automation-subject-invalid'
      )
    }
  })

  test('Realtime requires the same principal to have an allow-select row policy', () => {
    const input = fullV2Fixture()
    input.auth.rowAccess[0].operations = ['insert', 'update', 'delete']
    const result = parseBackendApplicationSpecV2(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map((entry) => entry.code)).toContain(
        'backend-realtime-select-policy-missing'
      )
    }
  })

  test('rejects undeclared P2 capabilities and remains data-only without invoking accessors', () => {
    const input = fullV2Fixture()
    input.capabilities = input.capabilities.filter((entry) => entry.capability !== 'drift.detect')
    const parsed = parseBackendApplicationSpecV2(input)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.diagnostics).toContainEqual({
        code: 'backend-capability-use-undeclared',
        severity: 'error',
        path: '$.capabilities.drift.detect',
        message: 'Backend IR uses a capability that is not declared as required.'
      })
    }

    let invoked = false
    const accessor = fullV2Fixture()
    Object.defineProperty(accessor, 'provider', {
      enumerable: true,
      get() {
        invoked = true
        return 'forbidden'
      }
    })
    expect(parseBackendApplicationSpecV2(accessor).ok).toBe(false)
    expect(invoked).toBe(false)
  })

  test('lowers incomplete V1 declarations into a valid frozen V2 round trip', () => {
    const source = backendApplicationFixture()
    source.capabilities = []
    const lowered = lowerBackendApplicationSpecV1ToV2(source)
    expect(lowered.ok).toBe(true)
    if (!lowered.ok) return
    expect(parseBackendApplicationSpecV2(lowered.value).ok).toBe(true)
    expect(lowered.value.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: 'auth.identity', required: true }),
        expect.objectContaining({ capability: 'migrations.schema', required: true }),
        expect.objectContaining({ capability: 'policy.row-level', required: true })
      ])
    )
    expect(Object.isFrozen(lowered.value)).toBe(true)
    expect(Object.isFrozen(lowered.value.dataModel.entities[0].fields)).toBe(true)
  })

  test('provides deterministic authority-owned V2 canonical bytes and digest', async () => {
    const left = fullV2Fixture()
    const right = fullV2Fixture()
    right.capabilities.reverse()
    right.realtime.subscriptions[0].events.reverse()
    expect(canonicalBackendApplicationV2Bytes(left)).toEqual(
      canonicalBackendApplicationV2Bytes(right)
    )
    expect(await digestBackendApplicationV2(left)).toBe(await digestBackendApplicationV2(right))
    const normalized = normalizedBackendApplicationV2(left)
    expect(Object.isFrozen(normalized.automations.automations)).toBe(true)
    expect(Reflect.set(normalized, 'applicationId', 'tampered')).toBe(false)
  })

  test('does not satisfy required V1 or V2 fields from a polluted prototype', () => {
    const v1 = backendApplicationFixture()
    const v2 = fullV2Fixture()
    Reflect.deleteProperty(v1, 'format')
    Reflect.deleteProperty(v2, 'format')
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'format')
    let getterCalls = 0
    // oxlint-disable-next-line no-extend-native -- Reproduces inherited required-field pollution.
    Object.defineProperty(Object.prototype, 'format', {
      configurable: true,
      get() {
        getterCalls++
        return 'openpencil.backend-application'
      }
    })
    try {
      expect(parseBackendApplicationSpecV1(v1).ok).toBe(false)
      expect(parseBackendApplicationSpecV2(v2).ok).toBe(false)
      expect(getterCalls).toBe(0)
    } finally {
      // oxlint-disable-next-line no-extend-native -- Restore the exact pre-test prototype descriptor.
      if (previous) Object.defineProperty(Object.prototype, 'format', previous)
      else Reflect.deleteProperty(Object.prototype, 'format')
    }
  })

  test('binds expected-version to one atomic bounded update and exact result assertion', () => {
    const staleWrite = fullV2Fixture()
    const staleMutation = staleWrite.transactions.transactions[0].steps.find(
      (step) => step.kind === 'data.mutate'
    )
    if (!staleMutation || staleMutation.kind !== 'data.mutate') throw new Error('mutation missing')
    staleMutation.increments = []
    staleMutation.values?.push({
      field: 'version',
      value: { kind: 'parameter', name: 'expected_version' }
    })
    expect(failureCodes(staleWrite)).toContain('backend-transaction-version-increment-missing')

    const bypass = fullV2Fixture()
    const transaction = bypass.transactions.transactions[0]
    const original = transaction.steps.find((step) => step.kind === 'data.mutate')
    if (!original || original.kind !== 'data.mutate') throw new Error('mutation missing')
    transaction.steps.push(
      { ...structuredClone(original), id: 'unversioned', resultName: 'unversioned_result' },
      {
        id: 'bound-unversioned',
        kind: 'assert',
        assertion: {
          kind: 'result-count',
          resultName: 'unversioned_result',
          operator: 'eq',
          value: 1
        }
      }
    )
    expect(failureCodes(bypass)).toContain('backend-transaction-version-mutation-count-invalid')

    const missingBound = fullV2Fixture()
    missingBound.transactions.transactions[0].steps.pop()
    expect(failureCodes(missingBound)).toContain(
      'backend-transaction-affected-row-assertion-missing'
    )
  })

  test('enforces transaction limits, typed values, and matching RLS authority', () => {
    const missingLimit = fullV2Fixture()
    const read = missingLimit.transactions.transactions[0].steps[0]
    Reflect.deleteProperty(read, 'limit')
    expect(failureCodes(missingLimit)).toContain('backend-required-field')

    const missingMutationBound = fullV2Fixture()
    const mutation = missingMutationBound.transactions.transactions[0].steps.find(
      (step) => step.kind === 'data.mutate'
    )
    if (!mutation || mutation.kind !== 'data.mutate') throw new Error('mutation missing')
    Reflect.deleteProperty(mutation, 'maxAffectedRows')
    expect(failureCodes(missingMutationBound)).toContain('backend-required-field')

    const typeMismatch = fullV2Fixture()
    const typedMutation = typeMismatch.transactions.transactions[0].steps.find(
      (step) => step.kind === 'data.mutate'
    )
    if (!typedMutation || typedMutation.kind !== 'data.mutate') throw new Error('mutation missing')
    if (!typedMutation.values?.[0]) throw new Error('mutation value missing')
    typedMutation.values[0].value = { kind: 'parameter', name: 'expected_version' }
    expect(failureCodes(typeMismatch)).toContain('backend-transaction-value-type-mismatch')

    const overlappingWrites = fullV2Fixture()
    const overlappingMutation = overlappingWrites.transactions.transactions[0].steps.find(
      (step) => step.kind === 'data.mutate'
    )
    if (!overlappingMutation || overlappingMutation.kind !== 'data.mutate') {
      throw new Error('mutation missing')
    }
    overlappingMutation.values?.push({
      field: 'version',
      value: { kind: 'literal', value: 1 }
    })
    expect(failureCodes(overlappingWrites)).toContain('backend-transaction-field-write-conflict')

    const elevated = fullV2Fixture()
    elevated.transactions.transactions[0].principal = { kind: 'authenticated' }
    expect(failureCodes(elevated)).toContain('backend-transaction-row-policy-missing')
  })

  test('restricts data migrations to null-only backfills with identity PK cursors', () => {
    const protectedField = fullV2Fixture()
    const protectedMigration = protectedField.dataMigrations.migrations[0]
    protectedMigration.predicate = { kind: 'field-is-null', fieldId: 'owner_id' }
    protectedMigration.transforms = [
      { kind: 'set-literal', fieldId: 'owner_id', value: '00000000-0000-4000-8000-000000000001' }
    ]
    protectedMigration.postconditions = [{ kind: 'field-not-null', fieldId: 'owner_id' }]
    expect(failureCodes(protectedField)).toContain(
      'backend-data-migration-security-field-forbidden'
    )

    const nonPrimaryCursor = fullV2Fixture()
    nonPrimaryCursor.dataModel.entities[0].fields.push({
      id: 'sequence',
      name: 'sequence',
      type: 'integer',
      nullable: false
    })
    nonPrimaryCursor.dataModel.entities[0].uniques = [
      { id: 'notes_sequence_unique', fields: ['sequence'] }
    ]
    nonPrimaryCursor.dataMigrations.migrations[0].cursor = {
      kind: 'monotonic-identity-primary-key',
      fieldId: 'sequence'
    }
    expect(failureCodes(nonPrimaryCursor)).toContain('backend-data-migration-cursor-unstable')

    const nonIdentityCursor = fullV2Fixture()
    const cursorField = nonIdentityCursor.dataModel.entities[0].fields.find(
      (field) => field.id === 'id'
    )
    if (!cursorField) throw new Error('cursor field missing')
    cursorField.default = { kind: 'literal', value: 0 }
    expect(failureCodes(nonIdentityCursor)).toContain('backend-data-migration-cursor-unstable')

    const uuidCursor = fullV2Fixture()
    const uuidCursorField = uuidCursor.dataModel.entities[0].fields.find(
      (field) => field.id === 'id'
    )
    if (!uuidCursorField) throw new Error('cursor field missing')
    uuidCursorField.type = 'uuid'
    uuidCursorField.default = { kind: 'generated', generator: 'uuid' }
    expect(failureCodes(uuidCursor)).toContain('backend-data-migration-cursor-unstable')

    const sourceHighWater = fullV2Fixture()
    Reflect.set(sourceHighWater.dataMigrations.migrations[0].cursor, 'highWater', 10)
    expect(parseBackendApplicationSpecV2(sourceHighWater).ok).toBe(false)

    const rewrite = fullV2Fixture()
    Reflect.set(rewrite.dataMigrations.migrations[0], 'predicate', {
      kind: 'field-equals',
      fieldId: 'title',
      value: 'old'
    })
    expect(parseBackendApplicationSpecV2(rewrite).ok).toBe(false)

    const mismatched = fullV2Fixture()
    mismatched.dataMigrations.migrations[0].transforms = [
      { kind: 'set-literal', fieldId: 'version', value: 1 }
    ]
    expect(failureCodes(mismatched)).toContain('backend-data-migration-predicate-target-mismatch')
  })

  test('pins webhook transport, HMAC envelope, credential scope, and credential isolation', () => {
    for (const url of [
      'https://127.0.0.1/hook',
      'https://localhost./hook',
      'https://worker.local./hook',
      'https://service.internal./hook'
    ]) {
      const privateTarget = fullV2Fixture()
      privateTarget.automations.webhookDestinations[0].url = url
      expect(failureCodes(privateTarget)).toContain('backend-webhook-destination-url-invalid')
    }

    const arbitraryHeader = fullV2Fixture()
    const ingress = arbitraryHeader.automations.automations.find(
      (entry) => entry.trigger.kind === 'webhook'
    )
    if (!ingress || ingress.trigger.kind !== 'webhook') throw new Error('webhook missing')
    Reflect.set(ingress.trigger.signature, 'signatureHeaderName', 'Authorization')
    expect(parseBackendApplicationSpecV2(arbitraryHeader).ok).toBe(false)

    const hostCredential = fullV2Fixture()
    const ingressSecret = hostCredential.secrets.find(
      (entry) => entry.kind === 'credential' && entry.name === 'WEBHOOK_INGRESS_HMAC'
    )
    if (!ingressSecret || ingressSecret.kind !== 'credential') throw new Error('secret missing')
    ingressSecret.exposure = 'host'
    expect(failureCodes(hostCredential)).toContain('backend-automation-credential-undeclared')

    const reusedCredential = fullV2Fixture()
    reusedCredential.automations.webhookDestinations[0].signingCredentialRef =
      'credential.00000000-0000-4000-8000-000000000001'
    expect(failureCodes(reusedCredential)).toContain('backend-automation-credential-reused')

    const missingEnvelope = fullV2Fixture()
    Reflect.deleteProperty(missingEnvelope.automations.webhookDestinations[0], 'signature')
    expect(parseBackendApplicationSpecV2(missingEnvelope).ok).toBe(false)
  })

  test('uses a bounded cron subset and trigger-specific idempotency sources', () => {
    for (const cron of ['0 0 ? * *', '60 0 * * *', '0 24 * * *', '*/0 * * * *', '@daily']) {
      const input = fullV2Fixture()
      const schedule = input.automations.automations.find(
        (entry) => entry.trigger.kind === 'schedule'
      )
      if (!schedule || schedule.trigger.kind !== 'schedule') throw new Error('schedule missing')
      schedule.trigger.cron = cron
      expect(failureCodes(input)).toContain('backend-automation-cron-invalid')
    }

    const wrongIdempotency = fullV2Fixture()
    const schedule = wrongIdempotency.automations.automations.find(
      (entry) => entry.trigger.kind === 'schedule'
    )
    if (!schedule) throw new Error('schedule missing')
    schedule.idempotency = {
      kind: 'request-header',
      headerName: 'Idempotency-Key',
      retentionHours: 24
    }
    expect(failureCodes(wrongIdempotency)).toContain(
      'backend-automation-idempotency-trigger-invalid'
    )
  })

  test('binds drift and data-change capabilities to actual IR use', () => {
    const disabled = fullV2Fixture()
    disabled.automations.driftDetection = { enabled: false }
    expect(deriveBackendApplicationCapabilitiesV2(disabled)).toContain('drift.detect')
    expect(failureCodes(disabled)).toContain('backend-drift-action-disabled')

    const dataChange = fullV2Fixture()
    dataChange.realtime.subscriptions = []
    dataChange.automations.automations.push({
      id: 'note-change-capability',
      name: 'Note change capability',
      subject: 'system',
      trigger: { kind: 'data-change', entityId: 'notes', events: ['insert'] },
      action: { kind: 'queue.publish', queueId: 'events', payloadExpression: 'input' },
      retry: {
        maxAttempts: 1,
        initialDelayMs: 1_000,
        maxDelayMs: 1_000,
        backoff: 'fixed',
        jitter: 'none'
      },
      idempotency: {
        kind: 'data-field',
        entityId: 'notes',
        fieldId: 'id',
        retentionHours: 24
      },
      causation: { kind: 'required', idField: 'causationId', maxHop: 8 }
    })
    expect(deriveBackendApplicationCapabilitiesV2(dataChange)).toContain('events.data-change')
    dataChange.capabilities = deriveBackendApplicationCapabilitiesV2(dataChange).map(
      (capability) => ({ capability, required: true })
    )
    expect(parseBackendApplicationSpecV2(dataChange).ok).toBe(true)

    const repeatedRowEvent = structuredClone(dataChange)
    const repeatedTrigger = repeatedRowEvent.automations.automations.at(-1)?.trigger
    if (repeatedTrigger?.kind !== 'data-change') throw new Error('data-change trigger missing')
    repeatedTrigger.events = ['update']
    expect(failureCodes(repeatedRowEvent)).toContain('backend-automation-idempotency-event-unsafe')
  })

  test('rejects async authority escalation, queue cycles, DLQ consumers, and short leases', () => {
    const escalation = fullV2Fixture()
    escalation.automations.automations[0].action = {
      kind: 'transaction',
      transactionId: 'rename-note',
      parameters: [
        { parameter: 'note_id', source: { kind: 'event-field', path: 'note_id' } },
        {
          parameter: 'expected_version',
          source: { kind: 'event-field', path: 'expected_version' }
        },
        { parameter: 'title', source: { kind: 'event-field', path: 'title' } }
      ]
    }
    expect(failureCodes(escalation)).toContain('backend-automation-authority-incompatible')

    const cyclic = fullV2Fixture()
    const consumer = cyclic.automations.automations.find((entry) => entry.trigger.kind === 'queue')
    if (!consumer) throw new Error('consumer missing')
    consumer.action = { kind: 'queue.publish', queueId: 'events', payloadExpression: 'input' }
    expect(failureCodes(cyclic)).toContain('backend-automation-causation-cycle')

    const consumedDlq = fullV2Fixture()
    const drift = consumedDlq.automations.automations.find((entry) => entry.id === 'drift-check')
    if (!drift) throw new Error('drift automation missing')
    drift.trigger = { kind: 'queue', queueId: 'dead-letter' }
    expect(failureCodes(consumedDlq)).toContain('backend-automation-dead-letter-consumed')

    const invalidLease = fullV2Fixture()
    invalidLease.automations.queues[0].visibilityTimeoutSeconds = 60
    invalidLease.automations.queues[0].retentionSeconds = 60
    expect(failureCodes(invalidLease)).toContain('backend-queue-visibility-invalid')

    const shortRetention = fullV2Fixture()
    const delivery = shortRetention.automations.automations.find(
      (entry) => entry.trigger.kind === 'queue'
    )
    if (!delivery) throw new Error('delivery automation missing')
    delivery.idempotency = { kind: 'event-id', retentionHours: 1 }
    expect(failureCodes(shortRetention)).toContain('backend-automation-idempotency-retention-short')
  })

  test('requires data-change idempotency to use the same immutable primary key', () => {
    const input = fullV2Fixture()
    input.dataModel.entities[0].fields.push({
      id: 'event_key',
      name: 'event_key',
      type: 'string',
      nullable: false
    })
    input.dataModel.entities[0].uniques = [{ id: 'event_key_unique', fields: ['event_key'] }]
    input.automations.automations.push({
      id: 'note-events',
      name: 'Note events',
      subject: 'system',
      trigger: { kind: 'data-change', entityId: 'notes', events: ['insert'] },
      action: { kind: 'queue.publish', queueId: 'events', payloadExpression: 'input' },
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1_000,
        maxDelayMs: 10_000,
        backoff: 'exponential',
        jitter: 'full'
      },
      idempotency: {
        kind: 'data-field',
        entityId: 'notes',
        fieldId: 'event_key',
        retentionHours: 24
      },
      causation: { kind: 'required', idField: 'causationId', maxHop: 8 }
    })
    expect(failureCodes(input)).toContain('backend-automation-idempotency-field-unsafe')
  })
})
