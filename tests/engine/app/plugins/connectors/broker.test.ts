/* eslint-disable max-lines -- Broker security gates need joint end-to-end regression coverage. */
import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_CONNECTOR_CONTRACT_FORMAT,
  PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION,
  PluginConnectorContractRegistry,
  parsePluginConnectorContract,
  type PluginConnectorContractV1,
  type PluginManifestPayload
} from '@open-pencil/core/plugins'

import { ConnectorAuditFanout, RedactedConnectorAuditLog } from '@/app/plugins/connectors/audit'
import type { ConnectorAuditSink } from '@/app/plugins/connectors/audit'
import { ConnectorAuthorizationRegistry } from '@/app/plugins/connectors/authorization'
import { createConnectorExecutionBroker } from '@/app/plugins/connectors/broker'
import { ConnectorOutcomeUnknownNoticeStore } from '@/app/plugins/connectors/outcome-notices'
import {
  ConnectorHostAdapterRegistry,
  inspectConnectorManifestCompatibility
} from '@/app/plugins/connectors/registry'
import {
  ConnectorExecutionError,
  type ConnectorFetch,
  type ConnectorHostAdapter,
  type ConnectorTransportLimits
} from '@/app/plugins/connectors/types'
import type { InstalledAppPlugin } from '@/app/plugins/types'
import { credentialRef } from '@/app/settings/credentials'

const EMPTY_MODULES = Object.freeze([])

function objectContract(properties: Record<string, unknown>, required: string[], maxBytes = 1_024) {
  return {
    schema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
      minProperties: required.length,
      maxProperties: Object.keys(properties).length
    },
    maxBytes
  }
}

function connectorContract(
  kind: 'query' | 'mutation' = 'query',
  credentialKind: 'api-key' | 'bearer-token' = 'bearer-token'
): PluginConnectorContractV1 {
  const mutation = kind === 'mutation'
  return parsePluginConnectorContract({
    format: PLUGIN_CONNECTOR_CONTRACT_FORMAT,
    schemaVersion: PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION,
    pluginId: 'open-pencil.reference',
    connectorId: mutation ? 'records.write' : 'records.read',
    adapterId: mutation ? 'open-pencil.connector.write' : 'open-pencil.connector.read',
    name: mutation ? 'Record Writer' : 'Record Reader',
    description: mutation ? 'Write one bounded record.' : 'Read bounded records.',
    kind: 'data-source',
    network: {
      origins: ['https://api.example.com'],
      methods: [mutation ? 'POST' : 'GET'],
      credentials: 'omit',
      redirects: 'error'
    },
    credentialSlots: [
      {
        slotId: 'access-token',
        label: 'Access token',
        kind: credentialKind,
        required: true
      }
    ],
    operations: [
      {
        operationId: mutation ? 'create-record' : 'list-records',
        name: mutation ? 'Create record' : 'List records',
        description: mutation ? 'Create one record.' : 'List one bounded page.',
        kind,
        credentialSlots: ['access-token'],
        request: {
          origin: 'https://api.example.com',
          method: mutation ? 'POST' : 'GET',
          pathTemplate: '/v1/{collection}'
        },
        parameters: objectContract(
          {
            collection: { type: 'string', minLength: 1, maxLength: 64 },
            ...(mutation ? { name: { type: 'string', minLength: 1, maxLength: 128 } } : {})
          },
          mutation ? ['collection', 'name'] : ['collection']
        ),
        result: objectContract({ ok: { type: 'boolean' } }, ['ok'])
      }
    ]
  })
}

function installedPlugin(
  contract: PluginConnectorContractV1,
  values: { enabled?: boolean; digest?: string; declared?: boolean } = {}
): InstalledAppPlugin {
  return {
    package: {
      trustSource: 'app-bundle',
      digest: values.digest ?? 'sha256:reference-v1',
      manifest: {
        format: 'openpencil-plugin',
        schemaVersion: 2,
        plugin: { id: contract.pluginId, name: 'Reference', version: '1.0.0' },
        publisher: { id: 'open-pencil', name: 'OpenPencil', keyId: 'builtin' },
        engineRange: '>=0.0.0',
        capabilities: [],
        contributions: {
          modules: EMPTY_MODULES,
          ...(values.declared === false ? {} : { connectors: [contract] })
        }
      }
    },
    enabled: values.enabled ?? true,
    pinnedDigest: null
  } as InstalledAppPlugin
}

function adapterFor(
  contract: PluginConnectorContractV1,
  prepare: ConnectorHostAdapter['prepare'] = async ({ operation, parameters }) => ({
    url: `${operation.request?.origin}${operation.request?.pathTemplate.replace(
      '{collection}',
      encodeURIComponent(String(parameters.collection))
    )}`,
    headers: { Accept: 'application/json' },
    ...(operation.request?.method === 'POST'
      ? { body: JSON.stringify({ name: parameters.name }) }
      : {})
  }),
  validateCredential?: ConnectorHostAdapter['validateCredential']
): ConnectorHostAdapter {
  return {
    pluginId: contract.pluginId,
    connectorId: contract.connectorId,
    adapterId: contract.adapterId,
    contract,
    ...(validateCredential ? { validateCredential } : {}),
    prepare
  }
}

function runtime(
  contract = connectorContract(),
  options: {
    authorize?: boolean
    resolve?: () => Promise<string | null>
    prepare?: ConnectorHostAdapter['prepare']
    validateCredential?: ConnectorHostAdapter['validateCredential']
    transformResponse?: ConnectorHostAdapter['transformResponse']
    fetch?: ConnectorFetch
    audit?: ConnectorAuditSink
    additionalAudit?: ConnectorAuditSink
  } = {}
) {
  const contracts = new PluginConnectorContractRegistry()
  contracts.register(contract)
  const adapters = new ConnectorHostAdapterRegistry(contracts)
  adapters.register({
    ...adapterFor(contract, options.prepare, options.validateCredential),
    ...(options.transformResponse ? { transformResponse: options.transformResponse } : {})
  })
  const authorization = new ConnectorAuthorizationRegistry()
  const plugin = installedPlugin(contract)
  if (options.authorize !== false) authorization.authorize(contract, plugin.package.digest, 10)
  const audit = new RedactedConnectorAuditLog()
  let resolverCalls = 0
  const broker = createConnectorExecutionBroker({
    adapters,
    authorization,
    credentialResolver: {
      resolve: () => {
        resolverCalls += 1
        return options.resolve?.() ?? Promise.resolve('top-secret-token')
      }
    },
    audit:
      options.audit ??
      (options.additionalAudit
        ? new ConnectorAuditFanout([audit, options.additionalAudit])
        : audit),
    fetch:
      options.fetch ??
      (async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })),
    now: (() => {
      let value = 100
      return () => value++
    })()
  })
  return {
    adapters,
    audit,
    authorization,
    broker,
    contract,
    plugin,
    resolverCalls: () => resolverCalls
  }
}

function executionRequest(contract: PluginConnectorContractV1, plugin: InstalledAppPlugin | null) {
  return {
    plugin,
    contract,
    operationId: contract.operations[0].operationId,
    parameters: { collection: 'Team Notes' },
    credentialRefs: {
      'access-token': credentialRef(contract.pluginId, 'access-token')
    }
  }
}

function errorCode(cause: unknown): string | undefined {
  return cause instanceof ConnectorExecutionError ? cause.code : undefined
}

describe('connector execution broker', () => {
  test('executes a reviewed query with runtime credentials and fixed fetch policy', async () => {
    let capturedURL = ''
    let capturedInit: RequestInit | undefined
    let capturedLimits: ConnectorTransportLimits | undefined
    const state = runtime(connectorContract(), {
      fetch: async (input, init, limits) => {
        capturedURL = String(input)
        capturedInit = init
        capturedLimits = limits
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
    })

    expect(state.resolverCalls()).toBe(0)
    const result = await state.broker.execute(executionRequest(state.contract, state.plugin))

    expect(result.data).toEqual({ ok: true })
    expect(state.resolverCalls()).toBe(1)
    expect(capturedURL).toBe('https://api.example.com/v1/Team%20Notes')
    expect(capturedInit).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error' })
    expect(capturedLimits).toEqual({ maxResponseBytes: 1_024, timeoutMs: 15_000 })
    expect(new Headers(capturedInit?.headers).get('authorization')).toBe('Bearer top-secret-token')
    const auditJSON = JSON.stringify(state.audit.snapshot())
    expect(auditJSON).not.toContain('top-secret-token')
    expect(auditJSON).not.toContain('Team Notes')
    expect(state.audit.snapshot()[0]).toMatchObject({
      outcome: 'completed',
      operationId: 'list-records',
      requestDispatched: true,
      httpStatus: 200
    })
  })

  test('fails closed for installation, enablement, declaration, and authorization gates', async () => {
    const state = runtime(connectorContract(), { authorize: false })
    const base = executionRequest(state.contract, state.plugin)

    expect(
      errorCode(await state.broker.execute({ ...base, plugin: null }).catch((error) => error))
    ).toBe('plugin-not-installed')
    expect(
      errorCode(
        await state.broker
          .execute({ ...base, plugin: installedPlugin(state.contract, { enabled: false }) })
          .catch((error) => error)
      )
    ).toBe('plugin-disabled')
    expect(
      errorCode(
        await state.broker
          .execute({ ...base, plugin: installedPlugin(state.contract, { declared: false }) })
          .catch((error) => error)
      )
    ).toBe('connector-not-declared')
    expect(errorCode(await state.broker.execute(base).catch((error) => error))).toBe('unauthorized')
    expect(state.resolverCalls()).toBe(0)
  })

  test('requires credential readiness and exact slot-bound references', async () => {
    const state = runtime(connectorContract(), { resolve: async () => null })
    const base = executionRequest(state.contract, state.plugin)
    expect(errorCode(await state.broker.execute(base).catch((error) => error))).toBe(
      'credential-missing'
    )

    const mismatched = {
      ...base,
      credentialRefs: {
        'access-token': credentialRef('open-pencil.other', 'access-token')
      }
    }
    expect(errorCode(await state.broker.execute(mismatched).catch((error) => error))).toBe(
      'credential-unavailable'
    )

    const oversized = runtime(connectorContract(), { resolve: async () => 'x'.repeat(8 * 1024) })
    expect(
      errorCode(
        await oversized.broker
          .execute(executionRequest(oversized.contract, oversized.plugin))
          .catch((error) => error)
      )
    ).toBe('credential-unavailable')
  })

  test('fails closed for API keys until a reviewed injection policy exists', async () => {
    const contract = connectorContract('query', 'api-key')
    const state = runtime(contract)
    expect(
      errorCode(
        await state.broker.execute(executionRequest(contract, state.plugin)).catch((error) => error)
      )
    ).toBe('unsupported-credential')
    expect(
      inspectConnectorManifestCompatibility(state.plugin.package.manifest, state.adapters)
    ).toMatchObject({ ok: false })
    expect(state.resolverCalls()).toBe(0)
  })

  test('injects reviewed API-key headers only after host credential validation', async () => {
    const legacy = connectorContract('query', 'api-key')
    const contract = parsePluginConnectorContract({
      ...legacy,
      credentialSlots: [
        {
          ...legacy.credentialSlots[0],
          injection: { location: 'header', name: 'apikey' }
        }
      ]
    })
    let capturedHeaders = new Headers()
    const state = runtime(contract, {
      validateCredential: ({ value }) => value === 'top-secret-token',
      fetch: async (_input, init) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response(JSON.stringify({ ok: true }))
      }
    })

    await expect(state.broker.execute(executionRequest(contract, state.plugin))).resolves.toEqual({
      data: { ok: true },
      httpStatus: 200,
      requestBytes: 0,
      responseBytes: 11
    })
    expect(capturedHeaders.get('apikey')).toBe('top-secret-token')
    expect(capturedHeaders.has('authorization')).toBe(false)
    expect(
      inspectConnectorManifestCompatibility(state.plugin.package.manifest, state.adapters)
    ).toEqual({ ok: true })
    expect(JSON.stringify(state.audit.snapshot())).not.toContain('top-secret-token')

    const rejected = runtime(contract, { validateCredential: () => false })
    expect(
      errorCode(
        await rejected.broker
          .execute(executionRequest(contract, rejected.plugin))
          .catch((error) => error)
      )
    ).toBe('credential-unavailable')

    const spoofed = runtime(contract, {
      prepare: async () => ({
        url: 'https://api.example.com/v1/tasks',
        headers: { apikey: 'adapter-value' }
      })
    })
    expect(
      errorCode(
        await spoofed.broker
          .execute({
            ...executionRequest(contract, spoofed.plugin),
            parameters: { collection: 'tasks' }
          })
          .catch((error) => error)
      )
    ).toBe('adapter-failed')
  })

  test('allows queries without per-call confirmation but gates every mutation', async () => {
    const contract = connectorContract('mutation')
    const state = runtime(contract)
    const base = {
      ...executionRequest(contract, state.plugin),
      parameters: { collection: 'tasks', name: 'Ship' }
    }

    expect(errorCode(await state.broker.execute(base).catch((error) => error))).toBe(
      'mutation-confirmation-required'
    )
    expect(
      errorCode(
        await state.broker
          .execute({ ...base, confirmMutation: async () => false })
          .catch((error) => error)
      )
    ).toBe('mutation-denied')
    await expect(
      state.broker.execute({ ...base, confirmMutation: async () => true })
    ).resolves.toMatchObject({ data: { ok: true } })

    const controller = new AbortController()
    const pending = state.broker.execute({
      ...base,
      signal: controller.signal,
      confirmMutation: () =>
        new Promise((resolve) => {
          void resolve
        })
    })
    controller.abort(new Error('confirmation cancelled'))
    expect(errorCode(await pending.catch((error) => error))).toBe('aborted')
    expect(state.audit.snapshot().at(-1)).toMatchObject({
      outcome: 'cancelled',
      errorCode: 'aborted',
      requestDispatched: false
    })
  })

  test('binds canonical mutation attempt IDs before credentials or network access', async () => {
    const fixedAttemptId = '8cc6ec86-93df-46fb-b03c-56cfdc6f620e'
    const capturedAttemptIds: Array<string | undefined> = []
    const contract = connectorContract('mutation')
    const state = runtime(contract, {
      prepare: async ({ operation, parameters, mutationAttemptId }) => {
        capturedAttemptIds.push(mutationAttemptId)
        return {
          url: `${operation.request?.origin}/v1/${encodeURIComponent(String(parameters.collection))}`,
          headers: { Accept: 'application/json' },
          body: JSON.stringify({ name: parameters.name })
        }
      }
    })
    const request = {
      ...executionRequest(contract, state.plugin),
      parameters: { collection: 'tasks', name: 'Ship' },
      confirmMutation: async () => true
    }

    await state.broker.execute({ ...request, mutationAttemptId: fixedAttemptId })
    await state.broker.execute(request)
    expect(capturedAttemptIds[0]).toBe(fixedAttemptId)
    expect(capturedAttemptIds[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )

    const resolverCalls = state.resolverCalls()
    expect(
      errorCode(
        await state.broker
          .execute({ ...request, mutationAttemptId: 'same-parameters' })
          .catch((error) => error)
      )
    ).toBe('invalid-parameters')
    expect(state.resolverCalls()).toBe(resolverCalls)

    const query = runtime(connectorContract())
    expect(
      errorCode(
        await query.broker
          .execute({
            ...executionRequest(query.contract, query.plugin),
            mutationAttemptId: fixedAttemptId
          })
          .catch((error) => error)
      )
    ).toBe('invalid-parameters')
    expect(query.resolverCalls()).toBe(0)
  })

  test('marks dispatched mutations outcome-unknown when authorization is revoked or cleared', async () => {
    const contract = connectorContract('mutation')
    const notices = new ConnectorOutcomeUnknownNoticeStore()
    let notifyStarted: (() => void) | undefined
    const started = () =>
      new Promise<void>((resolve) => {
        notifyStarted = resolve
      })
    let nextStarted = started()
    const state = runtime(contract, {
      additionalAudit: notices,
      fetch: (_input, init, _limits, onDispatch) =>
        new Promise<Response>((_resolve, reject) => {
          onDispatch()
          notifyStarted?.()
          const signal = init?.signal
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    })
    const request = {
      ...executionRequest(contract, state.plugin),
      parameters: { collection: 'tasks', name: 'Ship' },
      confirmMutation: async () => true
    }

    const revoked = state.broker.execute(request)
    await nextStarted
    expect(state.authorization.revoke(contract.pluginId, contract.connectorId)).toBe(true)
    expect(errorCode(await revoked.catch((error) => error))).toBe('outcome-unknown')

    state.authorization.authorize(contract, state.plugin.package.digest, 20)
    nextStarted = started()
    const cleared = state.broker.execute(request)
    await nextStarted
    state.authorization.clear()
    expect(errorCode(await cleared.catch((error) => error))).toBe('outcome-unknown')
    expect(state.audit.snapshot()).toEqual([
      expect.objectContaining({
        outcome: 'outcome-unknown',
        errorCode: 'outcome-unknown',
        requestDispatched: true
      }),
      expect.objectContaining({
        outcome: 'outcome-unknown',
        errorCode: 'outcome-unknown',
        requestDispatched: true
      })
    ])
    expect(JSON.stringify(state.audit.snapshot())).not.toContain('top-secret-token')
    expect(notices.snapshot().map((notice) => notice.operationId)).toEqual([
      'create-record',
      'create-record'
    ])

    state.broker.dispose()
    expect(errorCode(await state.broker.execute(request).catch((error) => error))).toBe('aborted')
  })

  test('keeps a pre-dispatch mutation abort cancelled but protects a post-dispatch abort', async () => {
    const contract = connectorContract('mutation')
    let prepareStarted: (() => void) | undefined
    const beforeDispatch = runtime(contract, {
      prepare: ({ signal }) =>
        new Promise((_resolve, reject) => {
          prepareStarted?.()
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    })
    const request = {
      ...executionRequest(contract, beforeDispatch.plugin),
      parameters: { collection: 'tasks', name: 'Ship' },
      confirmMutation: async () => true
    }
    const beforeController = new AbortController()
    const prepared = new Promise<void>((resolve) => {
      prepareStarted = resolve
    })
    const before = beforeDispatch.broker.execute({
      ...request,
      signal: beforeController.signal
    })
    await prepared
    beforeController.abort(new Error('stop before dispatch'))
    expect(errorCode(await before.catch((error) => error))).toBe('aborted')
    expect(beforeDispatch.audit.snapshot()[0]).toMatchObject({
      outcome: 'cancelled',
      errorCode: 'aborted',
      requestDispatched: false
    })

    let dispatched: (() => void) | undefined
    const afterDispatch = runtime(contract, {
      fetch: (_input, init, _limits, onDispatch) =>
        new Promise<Response>((_resolve, reject) => {
          onDispatch()
          dispatched?.()
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true
          })
        })
    })
    const afterController = new AbortController()
    const requestDispatched = new Promise<void>((resolve) => {
      dispatched = resolve
    })
    const after = afterDispatch.broker.execute({
      ...request,
      plugin: afterDispatch.plugin,
      signal: afterController.signal
    })
    await requestDispatched
    afterController.abort(new Error('stop waiting after dispatch'))
    expect(errorCode(await after.catch((error) => error))).toBe('outcome-unknown')
    expect(afterDispatch.audit.snapshot()[0]).toMatchObject({
      outcome: 'outcome-unknown',
      errorCode: 'outcome-unknown',
      requestDispatched: true
    })
  })

  test('protects a mutation outcome after a 2xx response during revoke or local transform failure', async () => {
    const contract = connectorContract('mutation')
    let transformStarted: (() => void) | undefined
    const transforming = runtime(contract, {
      fetch: async (_input, _init, _limits, onDispatch) => {
        onDispatch()
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
      transformResponse: () =>
        new Promise(() => {
          transformStarted?.()
        })
    })
    const base = {
      ...executionRequest(contract, transforming.plugin),
      parameters: { collection: 'tasks', name: 'Ship' },
      confirmMutation: async () => true
    }
    const started = new Promise<void>((resolve) => {
      transformStarted = resolve
    })
    const revoked = transforming.broker.execute(base)
    await started
    transforming.authorization.revoke(contract.pluginId, contract.connectorId)
    expect(errorCode(await revoked.catch((error) => error))).toBe('outcome-unknown')
    expect(transforming.audit.snapshot()[0]).toMatchObject({
      outcome: 'outcome-unknown',
      errorCode: 'outcome-unknown',
      requestDispatched: true,
      httpStatus: 200
    })

    const failedTransform = runtime(contract, {
      fetch: async (_input, _init, _limits, onDispatch) => {
        onDispatch()
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
      transformResponse: () => {
        throw new Error('local transform failed')
      }
    })
    const failure = await failedTransform.broker
      .execute({ ...base, plugin: failedTransform.plugin })
      .catch((error) => error)
    expect(errorCode(failure)).toBe('outcome-unknown')
    expect(failedTransform.audit.snapshot()[0]).toMatchObject({
      outcome: 'outcome-unknown',
      requestDispatched: true,
      httpStatus: 200
    })
  })

  test('marks a dispatched mutation timeout outcome-unknown', async () => {
    const contract = connectorContract('mutation')
    const state = runtime(contract, {
      fetch: (_input, _init, _limits, onDispatch) => {
        onDispatch()
        return new Promise<Response>((resolve) => {
          void resolve
        })
      }
    })
    const cause = await state.broker
      .execute({
        ...executionRequest(contract, state.plugin),
        parameters: { collection: 'tasks', name: 'Ship' },
        confirmMutation: async () => true,
        timeoutMs: 1
      })
      .catch((error) => error)
    expect(errorCode(cause)).toBe('outcome-unknown')
    expect(state.audit.snapshot()[0]).toMatchObject({
      outcome: 'outcome-unknown',
      requestDispatched: true
    })
  })

  test('never lets a rejecting audit sink replace success or the original connector failure', async () => {
    const rejectingAudit: ConnectorAuditSink = {
      record: async () => {
        throw new Error('audit storage unavailable')
      }
    }
    const mutation = connectorContract('mutation')
    const successful = runtime(mutation, { audit: rejectingAudit })
    await expect(
      successful.broker.execute({
        ...executionRequest(mutation, successful.plugin),
        parameters: { collection: 'tasks', name: 'Ship' },
        confirmMutation: async () => true
      })
    ).resolves.toMatchObject({ data: { ok: true } })

    const query = runtime(connectorContract(), {
      audit: rejectingAudit,
      fetch: async () => {
        throw new Error('upstream unavailable')
      }
    })
    const failure = await query.broker
      .execute(executionRequest(query.contract, query.plugin))
      .catch((error) => error)
    expect(errorCode(failure)).toBe('network-failed')
  })

  test('does not block a completed mutation on a never-settling best-effort audit sink', async () => {
    const mutation = connectorContract('mutation')
    const state = runtime(mutation, {
      audit: {
        record: () =>
          new Promise<void>((resolve) => {
            void resolve
          })
      }
    })
    const execution = state.broker
      .execute({
        ...executionRequest(mutation, state.plugin),
        parameters: { collection: 'tasks', name: 'Ship' },
        confirmMutation: async () => true
      })
      .then(() => 'completed' as const)
    const outcome = await Promise.race([execution, Bun.sleep(50).then(() => 'timed-out' as const)])
    expect(outcome).toBe('completed')
  })

  test('rejects adapter URL widening, reserved headers, redirects, and oversized responses', async () => {
    const contract = connectorContract()
    const widened = runtime(contract, {
      prepare: async () => ({ url: 'https://evil.example/v1/records' })
    })
    expect(
      errorCode(
        await widened.broker
          .execute(executionRequest(contract, widened.plugin))
          .catch((error) => error)
      )
    ).toBe('authority-mismatch')

    const reserved = runtime(contract, {
      prepare: async () => ({
        url: 'https://api.example.com/v1/tasks',
        headers: { Authorization: 'attacker-value' }
      })
    })
    expect(
      errorCode(
        await reserved.broker
          .execute({
            ...executionRequest(contract, reserved.plugin),
            parameters: { collection: 'tasks' }
          })
          .catch((error) => error)
      )
    ).toBe('adapter-failed')

    const redirected = runtime(contract, {
      fetch: async () =>
        ({
          status: 200,
          ok: true,
          redirected: true,
          headers: new Headers(),
          body: null
        }) as Response
    })
    expect(
      errorCode(
        await redirected.broker
          .execute(executionRequest(contract, redirected.plugin))
          .catch((error) => error)
      )
    ).toBe('redirect-rejected')

    const tooLarge = runtime(contract, {
      fetch: async () =>
        new Response('x'.repeat(2_000), {
          status: 200,
          headers: { 'content-length': '2000' }
        })
    })
    expect(
      errorCode(
        await tooLarge.broker
          .execute(executionRequest(contract, tooLarge.plugin))
          .catch((error) => error)
      )
    ).toBe('response-too-large')
  })

  test('propagates cancellation through adapters and records only a redacted code', async () => {
    const controller = new AbortController()
    const notices = new ConnectorOutcomeUnknownNoticeStore()
    const state = runtime(connectorContract(), {
      additionalAudit: notices,
      prepare: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    })
    const promise = state.broker.execute({
      ...executionRequest(state.contract, state.plugin),
      signal: controller.signal
    })
    controller.abort(new Error('private abort detail'))
    expect(errorCode(await promise.catch((error) => error))).toBe('aborted')
    expect(state.audit.snapshot()[0]).toMatchObject({ outcome: 'cancelled', errorCode: 'aborted' })
    expect(notices.snapshot()).toEqual([])
    expect(JSON.stringify(state.audit.snapshot())).not.toContain('private abort detail')
  })

  test('enforces timeout and supports a bounded host-owned response transform', async () => {
    const timed = runtime(connectorContract(), {
      prepare: () =>
        new Promise((resolve) => {
          void resolve
        })
    })
    expect(
      errorCode(
        await timed.broker
          .execute({ ...executionRequest(timed.contract, timed.plugin), timeoutMs: 1 })
          .catch((error) => error)
      )
    ).toBe('timeout')

    const contract = connectorContract()
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(contract)
    const adapters = new ConnectorHostAdapterRegistry(contracts)
    adapters.register({
      ...adapterFor(contract),
      transformResponse: (value) => ({
        ok: typeof value === 'object' && value !== null && Reflect.get(value, 'upstream') === true
      })
    })
    const authorization = new ConnectorAuthorizationRegistry()
    const plugin = installedPlugin(contract)
    authorization.authorize(contract, plugin.package.digest)
    const broker = createConnectorExecutionBroker({
      adapters,
      authorization,
      credentialResolver: { resolve: async () => 'token' },
      audit: new RedactedConnectorAuditLog(),
      fetch: async () => new Response(JSON.stringify({ upstream: true }))
    })
    await expect(broker.execute(executionRequest(contract, plugin))).resolves.toMatchObject({
      data: { ok: true }
    })
  })

  test('never invokes accessors or toJSON on a forged caller contract', async () => {
    const state = runtime()
    let getterCalls = 0
    let toJSONCalls = 0
    const forged = {
      ...state.contract,
      toJSON() {
        toJSONCalls += 1
        return state.contract
      }
    }
    Object.defineProperty(forged, 'name', {
      enumerable: true,
      get() {
        getterCalls += 1
        return state.contract.name
      }
    })

    const cause = await state.broker
      .execute({
        ...executionRequest(state.contract, state.plugin),
        contract: forged as PluginConnectorContractV1
      })
      .catch((error) => error)
    expect(errorCode(cause)).toBe('authority-mismatch')
    expect(getterCalls).toBe(0)
    expect(toJSONCalls).toBe(0)
    expect(state.audit.snapshot()[0]).toMatchObject({
      pluginId: 'unknown',
      connectorId: 'unknown',
      errorCode: 'authority-mismatch'
    })
  })
})

describe('connector adapter registration and activation compatibility', () => {
  test('binds exact contract and adapter identities and invalidates grants after digest changes', () => {
    const contract = connectorContract()
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(contract)
    const adapters = new ConnectorHostAdapterRegistry(contracts)

    expect(() =>
      adapters.register({ ...adapterFor(contract), adapterId: 'open-pencil.connector.other' })
    ).toThrow('identity')
    adapters.register(adapterFor(contract))
    expect(adapters.resolve(contract)?.adapterId).toBe(contract.adapterId)

    const authorization = new ConnectorAuthorizationRegistry()
    authorization.authorize(contract, 'digest-a', 1)
    expect(authorization.isAuthorized(contract, 'digest-a')).toBe(true)
    expect(authorization.isAuthorized(contract, 'digest-b')).toBe(false)

    let toJSONCalls = 0
    const forged = {
      ...contract,
      toJSON() {
        toJSONCalls += 1
        return contract
      }
    }
    expect(() =>
      authorization.authorize(forged as PluginConnectorContractV1, 'digest-a', 1)
    ).toThrow()
    expect(toJSONCalls).toBe(0)
  })

  test('notifies bounded authorization subscribers only when state changes', () => {
    const contract = connectorContract()
    const authorization = new ConnectorAuthorizationRegistry()
    const snapshots: number[] = []
    const unsubscribe = authorization.subscribe((grants) => snapshots.push(grants.length))

    authorization.authorize(contract, 'digest-a', 1)
    expect(authorization.revoke(contract.pluginId, 'missing')).toBe(false)
    authorization.authorize(contract, 'digest-b', 2)
    authorization.clear()
    authorization.clear()
    unsubscribe()
    authorization.authorize(contract, 'digest-c', 3)

    expect(snapshots).toEqual([1, 1, 0])
  })

  test('provides a pure fail-closed manifest activation helper', () => {
    const contract = connectorContract()
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(contract)
    const adapters = new ConnectorHostAdapterRegistry(contracts)

    const v1 = { schemaVersion: 1 } as PluginManifestPayload
    expect(inspectConnectorManifestCompatibility(v1, adapters)).toEqual({ ok: true })

    const v2 = installedPlugin(contract).package.manifest
    expect(inspectConnectorManifestCompatibility(v2, adapters)).toMatchObject({ ok: false })
    adapters.register(adapterFor(contract))
    expect(inspectConnectorManifestCompatibility(v2, adapters)).toEqual({ ok: true })
  })
})
