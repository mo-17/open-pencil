import { describe, expect, test } from 'bun:test'

import {
  PluginConnectorContractRegistry,
  parsePluginConnectorContract
} from '@open-pencil/core/plugins'

import { RedactedConnectorAuditLog } from '@/app/plugins/connectors/audit'
import { ConnectorAuthorizationRegistry } from '@/app/plugins/connectors/authorization'
import { createConnectorExecutionBroker } from '@/app/plugins/connectors/broker'
import { ConnectorHostAdapterRegistry } from '@/app/plugins/connectors/registry'
import {
  RESEND_EMAIL_ADAPTER_ID,
  RESEND_EMAIL_CONNECTOR_ADAPTER,
  RESEND_EMAIL_CONNECTOR_CONTRACT,
  RESEND_EMAIL_CONNECTOR_ID,
  RESEND_EMAIL_CREDENTIAL_REFS,
  RESEND_EMAIL_CREDENTIAL_SLOT_ID,
  RESEND_EMAIL_LIMITS,
  RESEND_EMAIL_ORIGIN,
  RESEND_EMAIL_PLUGIN_ID,
  RESEND_GET_EMAIL_OPERATION,
  RESEND_GET_EMAIL_OPERATION_ID,
  RESEND_SEND_EMAIL_OPERATION,
  RESEND_SEND_EMAIL_OPERATION_ID,
  normalizeResendEmailResponse,
  prepareResendEmailRequest
} from '@/app/plugins/connectors/resend-email'
import type { ConnectorParameterObject } from '@/app/plugins/connectors/types'
import type { InstalledAppPlugin } from '@/app/plugins/types'

const MUTATION_ATTEMPT_ID = 'bc5b70f2-9439-4ed6-a77a-c8a4603f5a1e'

function signal(): AbortSignal {
  return new AbortController().signal
}

function sendParameters(overrides: Record<string, unknown> = {}): ConnectorParameterObject {
  return {
    from: 'OpenPencil <sender@example.com>',
    to: ['reader@example.com'],
    subject: 'Connector review',
    text: 'The reviewed connector is ready.',
    ...overrides
  } as ConnectorParameterObject
}

function prepareGet(emailId: string, requestSignal = signal()) {
  return RESEND_EMAIL_CONNECTOR_ADAPTER.prepare({
    contract: RESEND_EMAIL_CONNECTOR_CONTRACT,
    operation: RESEND_GET_EMAIL_OPERATION,
    parameters: { emailId },
    signal: requestSignal
  })
}

function prepareSend(parameters: ConnectorParameterObject, requestSignal = signal()) {
  return RESEND_EMAIL_CONNECTOR_ADAPTER.prepare({
    contract: RESEND_EMAIL_CONNECTOR_CONTRACT,
    operation: RESEND_SEND_EMAIL_OPERATION,
    parameters,
    mutationAttemptId: MUTATION_ATTEMPT_ID,
    signal: requestSignal
  })
}

function retrievedEmail(overrides: Record<string, unknown> = {}) {
  return {
    object: 'email',
    id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c',
    to: ['reader@example.com'],
    from: 'OpenPencil <sender@example.com>',
    created_at: '2026-04-03T22:13:42.674981+00:00',
    subject: 'Connector review',
    html: '<p>The reviewed connector is ready.</p>',
    text: 'The reviewed connector is ready.',
    bcc: [],
    cc: ['reviewer@example.com'],
    reply_to: [],
    last_event: 'delivered',
    scheduled_at: null,
    tags: [{ name: 'category', value: 'review' }],
    ...overrides
  }
}

function installedPlugin(): InstalledAppPlugin {
  return {
    package: {
      trustSource: 'app-bundle',
      digest: 'sha256-resend-email-v1',
      manifest: {
        format: 'openpencil-plugin',
        schemaVersion: 2,
        plugin: { id: RESEND_EMAIL_PLUGIN_ID, name: 'Resend Email', version: '1.0.0' },
        publisher: { id: 'open-pencil', name: 'OpenPencil', keyId: 'builtin' },
        engineRange: '>=0.0.0',
        capabilities: [],
        contributions: { modules: [], connectors: [RESEND_EMAIL_CONNECTOR_CONTRACT] }
      }
    },
    enabled: true,
    pinnedDigest: null
  }
}

describe('Resend Email reference connector', () => {
  test('declares exact GET/POST authority and a runtime-only scoped bearer slot', () => {
    expect(parsePluginConnectorContract(RESEND_EMAIL_CONNECTOR_CONTRACT)).toEqual(
      RESEND_EMAIL_CONNECTOR_CONTRACT
    )
    expect(RESEND_EMAIL_CONNECTOR_CONTRACT).toMatchObject({
      pluginId: RESEND_EMAIL_PLUGIN_ID,
      connectorId: RESEND_EMAIL_CONNECTOR_ID,
      adapterId: RESEND_EMAIL_ADAPTER_ID,
      kind: 'data-source',
      network: {
        origins: [RESEND_EMAIL_ORIGIN],
        methods: ['GET', 'POST'],
        credentials: 'omit',
        redirects: 'error'
      }
    })
    expect(RESEND_EMAIL_CONNECTOR_CONTRACT.credentialSlots).toEqual([
      {
        slotId: RESEND_EMAIL_CREDENTIAL_SLOT_ID,
        label: 'Resend API key',
        kind: 'bearer-token',
        required: true
      }
    ])
    expect(
      RESEND_EMAIL_CONNECTOR_CONTRACT.operations.map(({ operationId, kind, request }) => ({
        operationId,
        kind,
        method: request?.method,
        path: request?.pathTemplate,
        responseBytes: request?.maxResponseBytes
      }))
    ).toEqual([
      {
        operationId: RESEND_GET_EMAIL_OPERATION_ID,
        kind: 'query',
        method: 'GET',
        path: '/emails/{emailId}',
        responseBytes: RESEND_EMAIL_LIMITS.upstreamResponseBytes
      },
      {
        operationId: RESEND_SEND_EMAIL_OPERATION_ID,
        kind: 'mutation',
        method: 'POST',
        path: '/emails',
        responseBytes: RESEND_EMAIL_LIMITS.upstreamResponseBytes
      }
    ])
    expect(RESEND_EMAIL_CREDENTIAL_REFS).toEqual({
      [RESEND_EMAIL_CREDENTIAL_SLOT_ID]: {
        integrationId: RESEND_EMAIL_PLUGIN_ID,
        profileId: 'default',
        field: RESEND_EMAIL_CREDENTIAL_SLOT_ID
      }
    })
    expect(JSON.stringify(RESEND_EMAIL_CONNECTOR_CONTRACT)).not.toContain('re_')
  })

  test('prepares fixed retrieve and send requests without credentials or arbitrary headers', async () => {
    await expect(prepareGet('4ef9a417-02e9-4d39-ad75-9611e0fcc33c')).resolves.toEqual({
      url: 'https://api.resend.com/emails/4ef9a417-02e9-4d39-ad75-9611e0fcc33c',
      headers: { Accept: 'application/json' }
    })

    const prepared = await prepareSend(
      sendParameters({
        to: ['reader@example.com', 'second@example.com'],
        cc: ['reviewer@example.com'],
        bcc: ['archive@example.com'],
        html: '<p>The reviewed connector is ready.</p>'
      })
    )
    expect(prepared.url).toBe('https://api.resend.com/emails')
    expect(prepared.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': MUTATION_ATTEMPT_ID
    })
    expect(JSON.parse(String(prepared.body))).toEqual({
      from: 'OpenPencil <sender@example.com>',
      to: ['reader@example.com', 'second@example.com'],
      cc: ['reviewer@example.com'],
      bcc: ['archive@example.com'],
      subject: 'Connector review',
      text: 'The reviewed connector is ready.',
      html: '<p>The reviewed connector is ready.</p>'
    })
    const headers = new Headers(prepared.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('cookie')).toBe(false)
  })

  test('rejects header injection, excessive recipients, missing content, and undeclared features', async () => {
    for (const parameters of [
      sendParameters({ from: 'sender@example.com\r\nBcc: attacker@example.com' }),
      sendParameters({ to: ['reader@example.com\nCc: attacker@example.com'] }),
      sendParameters({ subject: 'Hello\r\nX-Header: unsafe' }),
      sendParameters({ subject: 'Hello\u2028Bcc: attacker@example.com' }),
      sendParameters({ text: '', html: '' }),
      sendParameters({ to: Array.from({ length: 51 }, (_, index) => `user${index}@example.com`) }),
      sendParameters({ headers: { 'X-Unsafe': 'value' } }),
      sendParameters({ attachments: [{ path: 'https://example.com/file.pdf' }] }),
      sendParameters({ url: 'https://example.com/webhook' })
    ]) {
      await expect(prepareSend(parameters)).rejects.toMatchObject({ code: 'invalid-parameters' })
    }

    await expect(prepareGet('../domains')).rejects.toMatchObject({ code: 'invalid-parameters' })
    await expect(prepareGet('https://example.com')).rejects.toMatchObject({
      code: 'invalid-parameters'
    })
  })

  test('honors aborts and rejects forged authority without invoking getters or toJSON', async () => {
    const controller = new AbortController()
    controller.abort('private reason')
    await expect(prepareSend(sendParameters(), controller.signal)).rejects.toMatchObject({
      code: 'aborted',
      message: 'Resend email operation was aborted.'
    })

    let getterCalls = 0
    let toJSONCalls = 0
    const forgedContract = {
      ...RESEND_EMAIL_CONNECTOR_CONTRACT,
      toJSON() {
        toJSONCalls += 1
        return RESEND_EMAIL_CONNECTOR_CONTRACT
      }
    }
    const forgedOperation = Object.defineProperty({ ...RESEND_SEND_EMAIL_OPERATION }, 'name', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'Unsafe send'
      }
    })
    expect(() =>
      prepareResendEmailRequest({
        contract: forgedContract as never,
        operation: forgedOperation as never,
        parameters: sendParameters(),
        signal: signal()
      })
    ).toThrow('authority does not match')
    expect(getterCalls).toBe(0)
    expect(toJSONCalls).toBe(0)
  })

  test('normalizes only reviewed send and retrieve response fields', () => {
    expect(
      normalizeResendEmailResponse(
        { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' },
        RESEND_SEND_EMAIL_OPERATION_ID
      )
    ).toEqual({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' })

    expect(normalizeResendEmailResponse(retrievedEmail(), RESEND_GET_EMAIL_OPERATION_ID)).toEqual({
      id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c',
      from: 'OpenPencil <sender@example.com>',
      to: ['reader@example.com'],
      cc: ['reviewer@example.com'],
      bcc: [],
      subject: 'Connector review',
      createdAt: '2026-04-03T22:13:42.674981+00:00',
      lastEvent: 'delivered',
      text: 'The reviewed connector is ready.',
      html: '<p>The reviewed connector is ready.</p>'
    })
  })

  test('fails closed on widened, accessor-backed, custom-array, and oversized responses', () => {
    expect(() =>
      normalizeResendEmailResponse(
        retrievedEmail({ attachments: [{ id: 'attachment' }] }),
        RESEND_GET_EMAIL_OPERATION_ID
      )
    ).toThrow('invalid or unsupported')

    let getterCalls = 0
    const response = Object.defineProperty(retrievedEmail(), 'subject', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'Unsafe'
      }
    })
    expect(() => normalizeResendEmailResponse(response, RESEND_GET_EMAIL_OPERATION_ID)).toThrow(
      'invalid or unsupported'
    )
    expect(getterCalls).toBe(0)

    const recipients = ['reader@example.com']
    Object.defineProperty(recipients, '00', { enumerable: true, value: 'other@example.com' })
    expect(() =>
      normalizeResendEmailResponse(
        retrievedEmail({ to: recipients }),
        RESEND_GET_EMAIL_OPERATION_ID
      )
    ).toThrow('invalid or unsupported')

    expect(() =>
      normalizeResendEmailResponse(
        retrievedEmail({ html: 'x'.repeat(RESEND_EMAIL_LIMITS.htmlLength + 1) }),
        RESEND_GET_EMAIL_OPERATION_ID
      )
    ).toThrow('invalid or unsupported')
  })

  test('requires broker confirmation for every send mutation and not for get-email', async () => {
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(RESEND_EMAIL_CONNECTOR_CONTRACT)
    contracts.freeze()
    const adapters = new ConnectorHostAdapterRegistry(contracts)
    adapters.register(RESEND_EMAIL_CONNECTOR_ADAPTER)
    adapters.freeze()
    const authorization = new ConnectorAuthorizationRegistry()
    const plugin = installedPlugin()
    authorization.authorize(RESEND_EMAIL_CONNECTOR_CONTRACT, plugin.package.digest, 1)
    let fetchCalls = 0
    const idempotencyKeys: Array<string | null> = []
    const broker = createConnectorExecutionBroker({
      adapters,
      authorization,
      credentialResolver: { resolve: async () => 'test-resend-api-key' },
      audit: new RedactedConnectorAuditLog(),
      fetch: async (input, init) => {
        fetchCalls += 1
        expect(String(input).startsWith(RESEND_EMAIL_ORIGIN)).toBe(true)
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe('Bearer test-resend-api-key')
        if (init?.method === 'POST') idempotencyKeys.push(headers.get('idempotency-key'))
        const data =
          init?.method === 'POST'
            ? { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }
            : retrievedEmail()
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
    })
    const sendRequest = {
      plugin,
      contract: RESEND_EMAIL_CONNECTOR_CONTRACT,
      operationId: RESEND_SEND_EMAIL_OPERATION_ID,
      parameters: sendParameters(),
      mutationAttemptId: MUTATION_ATTEMPT_ID,
      credentialRefs: RESEND_EMAIL_CREDENTIAL_REFS
    }

    await expect(broker.execute(sendRequest)).rejects.toMatchObject({
      code: 'mutation-confirmation-required'
    })
    await expect(
      broker.execute({ ...sendRequest, confirmMutation: async () => false })
    ).rejects.toMatchObject({ code: 'mutation-denied' })
    expect(fetchCalls).toBe(0)

    let confirmations = 0
    const confirmMutation = async () => {
      confirmations += 1
      return true
    }
    await expect(broker.execute({ ...sendRequest, confirmMutation })).resolves.toMatchObject({
      data: { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }
    })
    await expect(broker.execute({ ...sendRequest, confirmMutation })).resolves.toMatchObject({
      data: { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }
    })
    expect(confirmations).toBe(2)
    expect(idempotencyKeys).toEqual([MUTATION_ATTEMPT_ID, MUTATION_ATTEMPT_ID])

    await expect(
      broker.execute({
        plugin,
        contract: RESEND_EMAIL_CONNECTOR_CONTRACT,
        operationId: RESEND_GET_EMAIL_OPERATION_ID,
        parameters: { emailId: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c' },
        credentialRefs: RESEND_EMAIL_CREDENTIAL_REFS
      })
    ).resolves.toMatchObject({
      data: { id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c', lastEvent: 'delivered' }
    })
    expect(fetchCalls).toBe(3)
  })
})
