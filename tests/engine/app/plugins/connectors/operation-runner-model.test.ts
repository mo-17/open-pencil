import { describe, expect, test } from 'bun:test'

import { PLUGIN_MANIFEST_FORMAT } from '@open-pencil/plugin-contracts'
import {
  type PluginConnectorOperationV1,
  type PluginManifestPayloadV2
} from '@open-pencil/plugin-contracts'

import {
  createConnectorMutationAttemptId,
  parseConnectorMutationAttemptId
} from '@/app/plugins/connectors/mutation-attempt'
import {
  connectorExecutionDataText,
  connectorExecutionErrorCode,
  connectorMutationConfirmationMatches,
  connectorMutationReviewMatches,
  connectorOperationParameterSkeleton,
  connectorParameterFingerprint,
  createConnectorMutationConfirmationGate,
  createConnectorMutationReview,
  parseConnectorOperationParameters,
  requiredConnectorOperationParameterNames
} from '@/app/plugins/connectors/operation/runner-model'
import {
  RESEND_EMAIL_CONNECTOR_CONTRACT,
  RESEND_GET_EMAIL_OPERATION_ID,
  RESEND_SEND_EMAIL_OPERATION_ID
} from '@/app/plugins/connectors/resend-email'
import {
  SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
  SUPABASE_BUSINESS_ORIGIN_TEMPLATE,
  SUPABASE_TABLE_OPERATION_IDS
} from '@/app/plugins/connectors/supabase-business'
import {
  ConnectorExecutionError,
  type ConnectorExecutionResult
} from '@/app/plugins/connectors/types'
import type { InstalledAppPlugin, InstalledPluginConnector } from '@/app/plugins/types'

function operation(
  contract: typeof RESEND_EMAIL_CONNECTOR_CONTRACT,
  operationId: string
): PluginConnectorOperationV1 {
  const found = contract.operations.find((candidate) => candidate.operationId === operationId)
  if (!found) throw new Error(`Missing operation fixture: ${operationId}`)
  return found
}

function installedConnector(
  digest = 'sha256:runner-v1',
  adapterId = SUPABASE_BUSINESS_CONNECTOR_CONTRACT.adapterId
): InstalledPluginConnector {
  const contract = {
    ...SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
    adapterId
  }
  const manifest: PluginManifestPayloadV2 = {
    format: PLUGIN_MANIFEST_FORMAT,
    schemaVersion: 2,
    plugin: { id: contract.pluginId, name: contract.name, version: '1.0.0' },
    publisher: { id: 'open-pencil', name: 'OpenPencil', keyId: 'open-pencil-key' },
    engineRange: '>=0.0.0',
    capabilities: [],
    contributions: { modules: [], connectors: [contract] }
  }
  const plugin: InstalledAppPlugin = {
    package: { trustSource: 'app-bundle', manifest, digest },
    enabled: true,
    pinnedDigest: null
  }
  return { plugin, contribution: contract }
}

function supabaseMutation(): PluginConnectorOperationV1 {
  const found = SUPABASE_BUSINESS_CONNECTOR_CONTRACT.operations.find(
    ({ operationId }) => operationId === SUPABASE_TABLE_OPERATION_IDS.insert
  )
  if (!found) throw new Error('Missing Supabase mutation fixture')
  return found
}

describe('plugin connector operation runner model', () => {
  test('creates and validates non-sensitive UUID v4 mutation attempt identities', () => {
    const attemptId = createConnectorMutationAttemptId()
    expect(parseConnectorMutationAttemptId(attemptId)).toBe(attemptId)
    expect(() => parseConnectorMutationAttemptId('same-parameters')).toThrow('UUID v4')
    expect(() =>
      createConnectorMutationReview(
        installedConnector(),
        supabaseMutation(),
        128,
        'sha256-parameters',
        'same-parameters'
      )
    ).toThrow('UUID v4')
  })

  test('generates a bounded required-field skeleton without guessing sensitive values', () => {
    const send = operation(RESEND_EMAIL_CONNECTOR_CONTRACT, RESEND_SEND_EMAIL_OPERATION_ID)
    expect(requiredConnectorOperationParameterNames(send)).toEqual(['from', 'to', 'subject'])
    expect(JSON.parse(connectorOperationParameterSkeleton(send))).toEqual({
      from: '',
      to: [],
      subject: ''
    })

    const typedOperation: PluginConnectorOperationV1 = {
      ...send,
      parameters: {
        maxBytes: 1_024,
        schema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            count: { type: 'integer', minimum: 2 },
            ratio: { type: 'number' },
            enabled: { type: 'boolean' },
            items: { type: 'array', items: { type: 'string' } },
            metadata: {
              type: 'object',
              properties: {},
              additionalProperties: false
            }
          },
          required: ['text', 'count', 'ratio', 'enabled', 'items', 'metadata'],
          additionalProperties: false
        }
      }
    }
    expect(JSON.parse(connectorOperationParameterSkeleton(typedOperation))).toEqual({
      text: '',
      count: 2,
      ratio: 0,
      enabled: false,
      items: [],
      metadata: {}
    })
  })

  test('bounds UTF-16 and UTF-8 before parsing, then applies the strict schema', () => {
    const getEmail = operation(RESEND_EMAIL_CONNECTOR_CONTRACT, RESEND_GET_EMAIL_OPERATION_ID)
    expect(parseConnectorOperationParameters('{"emailId":"email-123"}', getEmail)).toEqual({
      parameters: { emailId: 'email-123' },
      byteLength: 23
    })
    expect(() =>
      parseConnectorOperationParameters(`{"emailId":"${'x'.repeat(600)}"}`, getEmail)
    ).toThrow('character safety limit')
    expect(() =>
      parseConnectorOperationParameters(`{"emailId":"${'汉'.repeat(170)}"}`, getEmail)
    ).toThrow('byte contract limit')
    expect(() =>
      parseConnectorOperationParameters('{"emailId":"email-123","header":"forbidden"}', getEmail)
    ).toThrow()
    expect(() => parseConnectorOperationParameters('{not-json', getEmail)).toThrow('valid JSON')
  })

  test('fingerprints reviewed parameters without retaining their raw values', async () => {
    const first = await connectorParameterFingerprint({ projectRef: 'project-one' })
    const same = await connectorParameterFingerprint({ projectRef: 'project-one' })
    const changed = await connectorParameterFingerprint({ projectRef: 'project-two' })
    expect(first).toBe(same)
    expect(changed).not.toBe(first)
    expect(first).toMatch(/^sha256-[a-f\d]{64}$/u)
    expect(first).not.toContain('project-one')
  })

  test('binds mutation review to current package, adapter, authority, operation, and parameters', () => {
    const connector = installedConnector()
    const mutation = supabaseMutation()
    const review = createConnectorMutationReview(
      connector,
      mutation,
      128,
      'sha256-parameters',
      '8cc6ec86-93df-46fb-b03c-56cfdc6f620e'
    )
    expect(review).toMatchObject({
      pluginId: SUPABASE_BUSINESS_CONNECTOR_CONTRACT.pluginId,
      connectorId: SUPABASE_BUSINESS_CONNECTOR_CONTRACT.connectorId,
      adapterId: SUPABASE_BUSINESS_CONNECTOR_CONTRACT.adapterId,
      packageDigest: 'sha256:runner-v1',
      operationId: SUPABASE_TABLE_OPERATION_IDS.insert,
      authorityKind: 'origin-template',
      authority: SUPABASE_BUSINESS_ORIGIN_TEMPLATE,
      parameterBytes: 128,
      parameterFingerprint: 'sha256-parameters',
      mutationAttemptId: '8cc6ec86-93df-46fb-b03c-56cfdc6f620e'
    })
    expect(JSON.stringify(review)).not.toContain('secret-row-value')
    expect(
      connectorMutationReviewMatches(review, connector, mutation, 128, 'sha256-parameters')
    ).toBe(true)
    expect(
      connectorMutationReviewMatches(
        review,
        installedConnector('sha256:runner-v2'),
        mutation,
        128,
        'sha256-parameters'
      )
    ).toBe(false)
    expect(
      connectorMutationReviewMatches(
        review,
        installedConnector('sha256:runner-v1', 'open-pencil.connector.changed'),
        mutation,
        128,
        'sha256-parameters'
      )
    ).toBe(false)
    expect(connectorMutationReviewMatches(review, connector, mutation, 128, 'changed')).toBe(false)
  })

  test('accepts only the exact broker mutation confirmation', () => {
    const connector = installedConnector()
    const mutation = supabaseMutation()
    const review = createConnectorMutationReview(connector, mutation, 10, 'sha256-parameters')
    expect(
      connectorMutationConfirmationMatches(review, {
        pluginId: review.pluginId,
        connectorId: review.connectorId,
        operationId: review.operationId,
        operationName: review.operationName
      })
    ).toBe(true)
    expect(
      connectorMutationConfirmationMatches(review, {
        pluginId: review.pluginId,
        connectorId: review.connectorId,
        operationId: review.operationId,
        operationName: 'Forged operation name'
      })
    ).toBe(false)
  })

  test('admits only one broker execution for concurrent double confirmation', async () => {
    const gate = createConnectorMutationConfirmationGate()
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let brokerExecutions = 0
    async function confirm(): Promise<void> {
      if (!gate.tryEnter()) return
      try {
        await barrier
        brokerExecutions += 1
      } finally {
        gate.leave()
      }
    }

    const first = confirm()
    const second = confirm()
    release()
    await Promise.all([first, second])
    expect(brokerExecutions).toBe(1)
  })

  test('renders only bounded broker data and a broker error code', () => {
    const result: ConnectorExecutionResult = {
      data: { id: 'email-123' },
      httpStatus: 201,
      requestBytes: 9_999,
      responseBytes: 8_888
    }
    const text = connectorExecutionDataText(result)
    expect(text).toContain('email-123')
    expect(text).not.toContain('201')
    expect(text).not.toContain('9999')
    expect(text).not.toContain('8888')

    const error = new ConnectorExecutionError(
      'network-failed',
      'request https://secret.invalid failed with Authorization: secret-token'
    )
    expect(connectorExecutionErrorCode(error)).toBe('network-failed')
    expect(
      connectorExecutionErrorCode(
        new ConnectorExecutionError('outcome-unknown', 'verify remote state')
      )
    ).toBe('outcome-unknown')
    expect(connectorExecutionErrorCode(new Error('secret-token'))).toBeNull()
  })

  test('keeps JSON DOM-owned and re-resolves, confirms, and aborts through host APIs', async () => {
    const source = await Bun.file(
      'src/components/settings/plugins/PluginConnectorOperationRunner.vue'
    ).text()
    expect(source).toContain('<textarea')
    expect(source).toContain(':maxlength="operation.contract.parameters.maxBytes"')
    expect(source).not.toContain('v-model')
    expect(source).toContain('appPluginStore.connector(')
    expect(source).toContain('executeInstalledAppConnector(')
    expect(source).toContain('confirmMutation:')
    expect(source).toContain('mutationAttemptId: review.mutationAttemptId')
    expect(source).toContain('signal: controller.signal')
    expect(source).toContain('onBeforeUnmount')
    expect(source).toContain('activeController?.abort()')
    expect(source).toContain("code === 'outcome-unknown'")
    expect(source).toContain('pendingReview.value = review ?? null')
    expect(source).toContain('copy.executionOutcomeUnknown')
    expect(source).toContain('copy.stopWaiting')
    const confirmationSource = source
      .split('async function confirmMutation(): Promise<void> {')[1]
      ?.split('function parametersChanged(): void {')[0]
    expect(confirmationSource).toContain('mutationConfirmationGate.tryEnter()')
    expect(confirmationSource).toContain('pendingReview.value = null')
    expect(confirmationSource?.indexOf('pendingReview.value = null')).toBeLessThan(
      confirmationSource?.indexOf('await connectorParameterFingerprint') ?? -1
    )
    expect(source).not.toContain('Authorization:')
    expect(source).not.toContain('request.body')
  })
})
