import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_PACKAGE_FORMAT,
  PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
  createPluginRuntimeAsset,
  signPluginManifest,
  signPluginRuntimePackage,
  verifyPluginPackage,
  verifyPluginRuntimePackage,
  type PluginRuntimeCapabilityV1,
  type PluginRuntimePackagePayloadV1,
  type VerifiedIndexedPluginRuntimePackage
} from '@open-pencil/plugin-contracts'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import type { AppPluginMarketplaceAuthority } from '@/app/plugins'
import {
  createMemoryPluginRuntimePolicyStorage,
  createPluginRuntimeManager,
  parsePluginRuntimePolicyRecord,
  type CreatePluginRuntimeManagerOptions,
  type PluginRuntimeAuditAction,
  type PluginRuntimePolicyRecordV1,
  type PluginRuntimePolicyStorage
} from '@/app/plugins/runtime'

import { pluginPayload } from '#tests/engine/plugins/helpers'

const MARKETPLACE_AUTHORITY: AppPluginMarketplaceAuthority = Object.freeze({
  sourceId: 'source:runtime',
  trustDomainId: 'trust-domain:runtime',
  sourceGeneration: 1,
  rootKeySpkiSha256: `sha256-${'A'.repeat(43)}`
})

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

function unsignedLeb(value: number): number[] {
  const encoded: number[] = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) byte |= 0x80
    encoded.push(byte)
  } while (value !== 0)
  return encoded
}

function wasmText(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)]
  return [...unsignedLeb(bytes.length), ...bytes]
}

function wasmSection(id: number, payload: number[]): number[] {
  return [id, ...unsignedLeb(payload.length), ...payload]
}

function safeWasmFixture(): Uint8Array {
  const typeSection = wasmSection(
    1,
    [3, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 0, 0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f]
  )
  const functionSection = wasmSection(3, [3, 0, 1, 2])
  const memorySection = wasmSection(5, [1, 1, 1, 4])
  const exports = [
    [...wasmText('memory'), 2, 0],
    [...wasmText('openpencil_alloc'), 0, 0],
    [...wasmText('openpencil_dealloc'), 0, 1],
    [...wasmText('openpencil_compute'), 0, 2]
  ]
  const exportSection = wasmSection(7, [exports.length, ...exports.flat()])
  const bodies = [
    [0, 0x20, 0, 0x0b],
    [0, 0x0b],
    [0, 0x41, 0, 0x0b]
  ]
  const codeSection = wasmSection(10, [
    bodies.length,
    ...bodies.flatMap((body) => [body.length, ...body])
  ])
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...typeSection,
    ...functionSection,
    ...memorySection,
    ...exportSection,
    ...codeSection
  ])
}

async function runtimeFixture(options: {
  publicKey: CryptoKey
  privateKey: CryptoKey
  declarativeDigest: string
  timeoutMs?: number
  capabilities?: readonly PluginRuntimeCapabilityV1[]
}): Promise<VerifiedIndexedPluginRuntimePackage> {
  const payload: PluginRuntimePackagePayloadV1 = {
    format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
    schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
    plugin: { id: 'acme.analytics', version: '1.0.0' },
    publisher: { id: 'acme', keyId: 'acme.release' },
    declarativeManifestDigest: options.declarativeDigest,
    runtime: {
      kind: 'wasm',
      abi: PLUGIN_RUNTIME_COMPUTE_ABI,
      capabilities: options.capabilities ?? [],
      limits: {
        timeoutMs: options.timeoutMs ?? 2_000,
        maxInputBytes: 256 * 1024,
        maxOutputBytes: 256 * 1024,
        maxMemoryPages: 4
      },
      asset: await createPluginRuntimeAsset('wasm', safeWasmFixture())
    }
  }
  const signed = await signPluginRuntimePackage(payload, options.privateKey)
  const verifiedRuntimePackage = await verifyPluginRuntimePackage(signed, options.publicKey)
  return { verifiedRuntimePackage } as VerifiedIndexedPluginRuntimePackage
}

function storageRejectingAction(
  action: PluginRuntimeAuditAction,
  failure: Error
): {
  storage: PluginRuntimePolicyStorage
  attemptedActions: PluginRuntimeAuditAction[]
} {
  const durable = createMemoryPluginRuntimePolicyStorage()
  const attemptedActions: PluginRuntimeAuditAction[] = []
  const storage: PluginRuntimePolicyStorage = {
    get: (pluginId) => durable.get(pluginId),
    list: () => durable.list(),
    delete: (pluginId) => durable.delete(pluginId),
    async put(value) {
      const record = parsePluginRuntimePolicyRecord(value)
      const attemptedAction = record.audit[record.audit.length - 1]?.action
      if (attemptedAction) attemptedActions.push(attemptedAction)
      if (attemptedAction === action) throw failure
      await durable.put(record)
    }
  }
  return { storage, attemptedActions }
}

async function createGrantedManagerFixture(options: {
  storage: PluginRuntimePolicyStorage
  executor: NonNullable<CreatePluginRuntimeManagerOptions['executor']>
  captureInputContext?: CreatePluginRuntimeManagerOptions['captureInputContext']
  prepareInput?: CreatePluginRuntimeManagerOptions['prepareInput']
}) {
  const publisher = await keys()
  const declarative = await verifyPluginPackage(
    await signPluginManifest(pluginPayload(), publisher.privateKey),
    publisher.publicKey
  )
  const runtime = await runtimeFixture({
    publicKey: publisher.publicKey,
    privateKey: publisher.privateKey,
    declarativeDigest: declarative.verifiedDigest
  })
  const manager = createPluginRuntimeManager({
    ...options,
    resolveInstalledPlugin: () => ({
      package: {
        trustSource: 'publisher-signature',
        manifest: declarative.manifest,
        digest: declarative.verifiedDigest,
        verifiedPackage: declarative
      },
      enabled: true,
      pinnedDigest: null
    }),
    loadRuntime: async () => ({ runtime, source: 'network', refreshError: null })
  })
  await manager.load()
  await manager.grant('acme.analytics', await manager.review('acme.analytics'))
  return manager
}

describe('plugin runtime policy manager', () => {
  test('requires exact grants, revokes changed runtime digests, and records bounded audit events', async () => {
    const publisher = await keys()
    const declarative = await verifyPluginPackage(
      await signPluginManifest(pluginPayload(), publisher.privateKey),
      publisher.publicKey,
      { engineVersion: '0.13.2' }
    )
    let runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest,
      capabilities: ['document.selection.read']
    })
    const storage = createMemoryPluginRuntimePolicyStorage()
    const executedInputs: JSONValue[] = []
    let now = Date.parse('2026-08-05T00:00:00.000Z')
    const manager = createPluginRuntimeManager({
      storage,
      now: () => now++,
      resolveInstalledPlugin: () => ({
        package: {
          trustSource: 'publisher-signature',
          manifest: declarative.manifest,
          digest: declarative.verifiedDigest,
          verifiedPackage: declarative
        },
        enabled: true,
        pinnedDigest: null
      }),
      loadRuntime: async () => ({
        runtime,
        source: 'network',
        refreshError: null
      }),
      prepareInput: async (capabilities, input) => ({ capabilities, input }),
      executor: {
        async execute({ input }) {
          executedInputs.push(input)
          return { ok: true }
        }
      }
    })

    await manager.load()
    await expect(manager.execute('acme.analytics', { before: 'grant' })).rejects.toThrow(
      'grant-required'
    )
    const firstReview = await manager.review('acme.analytics')
    const granted = await manager.grant('acme.analytics', firstReview)
    expect(granted.grantedCapabilities).toEqual(['document.selection.read'])
    await expect(manager.execute('acme.analytics', { request: 1 })).resolves.toEqual({ ok: true })
    expect(executedInputs).toEqual([
      { capabilities: ['document.selection.read'], input: { request: 1 } }
    ])

    runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest,
      timeoutMs: 1_999,
      capabilities: ['document.selection.read']
    })
    await expect(manager.execute('acme.analytics', null)).rejects.toThrow('runtime-digest-changed')
    expect(manager.snapshot().policies[0]).toMatchObject({
      grantedCapabilities: [],
      grantedAt: null,
      revokedAt: null
    })
    const changedReview = await manager.review('acme.analytics')
    await manager.grant('acme.analytics', changedReview)
    const revoked = await manager.revoke('acme.analytics')
    expect(revoked.revokedAt).not.toBeNull()
    expect(revoked.audit.map(({ action }) => action)).toEqual([
      'execute-blocked',
      'grant',
      'execute-succeeded',
      'execute-blocked',
      'grant',
      'revoke'
    ])
    expect(revoked.auditSequence).toBe(6)
  })

  test('refuses a capability change between review and grant', async () => {
    const publisher = await keys()
    const declarative = await verifyPluginPackage(
      await signPluginManifest(pluginPayload(), publisher.privateKey),
      publisher.publicKey
    )
    let runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest,
      capabilities: []
    })
    const manager = createPluginRuntimeManager({
      resolveInstalledPlugin: () => ({
        package: {
          trustSource: 'publisher-signature',
          manifest: declarative.manifest,
          digest: declarative.verifiedDigest,
          verifiedPackage: declarative
        },
        enabled: true,
        pinnedDigest: null
      }),
      loadRuntime: async () => ({ runtime, source: 'network', refreshError: null })
    })

    await manager.load()
    const displayedReview = await manager.review('acme.analytics')
    runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest,
      capabilities: ['document.nodes.read']
    })

    await expect(manager.grant('acme.analytics', displayedReview)).rejects.toThrow(
      'changed after review'
    )
    expect(manager.snapshot().policies).toHaveLength(0)
  })

  test('captures the reviewed runtime authority before grant enters the queue', async () => {
    const publisher = await keys()
    const declarative = await verifyPluginPackage(
      await signPluginManifest(pluginPayload(), publisher.privateKey),
      publisher.publicKey
    )
    const runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest
    })
    let gate: Promise<void> | null = null
    let releaseGate: (() => void) | null = null
    const manager = createPluginRuntimeManager({
      publisherPrivilegeLock: async (operation) => {
        if (gate) await gate
        return operation()
      },
      resolveInstalledPlugin: () => ({
        package: {
          trustSource: 'publisher-signature',
          manifest: declarative.manifest,
          digest: declarative.verifiedDigest,
          verifiedPackage: declarative
        },
        enabled: true,
        pinnedDigest: null
      }),
      loadRuntime: async () => ({ runtime, source: 'network', refreshError: null })
    })
    await manager.load()
    const reviewed = await manager.review('acme.analytics')
    gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const grant = manager.grant('acme.analytics', reviewed)
    Reflect.set(reviewed, 'runtimePackageDigest', declarative.verifiedDigest)
    Reflect.set(reviewed, 'capabilities', ['document.nodes.read'])
    releaseGate?.()

    await expect(grant).resolves.toMatchObject({
      runtimePackageDigest: runtime.verifiedRuntimePackage.verifiedDigest,
      grantedCapabilities: []
    })
  })

  test('aborts an in-flight worker before persisting revocation', async () => {
    const publisher = await keys()
    const declarative = await verifyPluginPackage(
      await signPluginManifest(pluginPayload(), publisher.privateKey),
      publisher.publicKey
    )
    const runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest
    })
    let workerStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      workerStarted = resolve
    })
    let workerAborted = false
    const manager = createPluginRuntimeManager({
      resolveInstalledPlugin: () => ({
        package: {
          trustSource: 'publisher-signature',
          manifest: declarative.manifest,
          digest: declarative.verifiedDigest,
          verifiedPackage: declarative
        },
        enabled: true,
        pinnedDigest: null
      }),
      loadRuntime: async () => ({ runtime, source: 'network', refreshError: null }),
      executor: {
        execute: ({ signal }) =>
          new Promise<JSONValue>((_resolve, reject) => {
            workerStarted?.()
            signal?.addEventListener(
              'abort',
              () => {
                workerAborted = true
                reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
              },
              { once: true }
            )
          })
      }
    })

    await manager.load()
    const reviewed = await manager.review('acme.analytics')
    await manager.grant('acme.analytics', reviewed)
    const execution = manager.execute('acme.analytics', null)
    await started
    const revocation = manager.revoke('acme.analytics')

    await expect(execution).rejects.toThrow('revoked')
    await expect(revocation).resolves.toMatchObject({ revokedAt: expect.any(String) })
    expect(workerAborted).toBe(true)
    expect(
      manager
        .snapshot()
        .policies[0]?.audit.slice(-2)
        .map(({ action, reasonCode }) => ({
          action,
          reasonCode
        }))
    ).toEqual([
      { action: 'execute-failed', reasonCode: 'revoked-during-execution' },
      { action: 'revoke', reasonCode: null }
    ])
  })

  test('tombstones a grant before app uninstall and requires a new grant after reinstall', async () => {
    const publisher = await keys()
    const declarative = await verifyPluginPackage(
      await signPluginManifest(pluginPayload(), publisher.privateKey),
      publisher.publicKey
    )
    const runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest
    })
    let installed = true
    let blockExecution = true
    let workerStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      workerStarted = resolve
    })
    let workerAborted = false
    let executorCalls = 0
    const storage = createMemoryPluginRuntimePolicyStorage()
    const manager = createPluginRuntimeManager({
      storage,
      resolveInstalledPlugin: () =>
        installed
          ? {
              package: {
                trustSource: 'publisher-signature',
                manifest: declarative.manifest,
                digest: declarative.verifiedDigest,
                verifiedPackage: declarative
              },
              enabled: true,
              pinnedDigest: null
            }
          : undefined,
      loadRuntime: async () => ({ runtime, source: 'network', refreshError: null }),
      executor: {
        execute: ({ signal }) => {
          executorCalls += 1
          if (!blockExecution) return Promise.resolve({ ok: true })
          return new Promise<JSONValue>((_resolve, reject) => {
            workerStarted?.()
            signal?.addEventListener(
              'abort',
              () => {
                workerAborted = true
                reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
              },
              { once: true }
            )
          })
        }
      }
    })

    await manager.load()
    const reviewed = await manager.review('acme.analytics')
    await manager.grant('acme.analytics', reviewed)
    const execution = manager.execute('acme.analytics', null)
    await started
    const uninstall = manager.uninstall('acme.analytics', async () => {
      expect(workerAborted).toBe(true)
      expect(manager.snapshot().policies[0]).toMatchObject({
        grantedAt: expect.any(String),
        revokedAt: expect.any(String)
      })
      installed = false
    })

    await expect(execution).rejects.toThrow('uninstalled')
    await expect(uninstall).resolves.toBeUndefined()
    expect(await storage.get('acme.analytics')).toMatchObject({
      revokedAt: expect.any(String),
      audit: expect.arrayContaining([expect.objectContaining({ action: 'revoke' })])
    })

    installed = true
    blockExecution = false
    await expect(manager.execute('acme.analytics', null)).rejects.toThrow('grant-required')
    const reinstalledReview = await manager.review('acme.analytics')
    await manager.grant('acme.analytics', reinstalledReview)
    await expect(manager.execute('acme.analytics', null)).resolves.toEqual({ ok: true })
    expect(executorCalls).toBe(2)

    const queuedExecution = manager.execute('acme.analytics', null)
    const queuedUninstall = manager.uninstall('acme.analytics', async () => {
      installed = false
    })
    await expect(queuedExecution).rejects.toThrow('uninstall-requested')
    await expect(queuedUninstall).resolves.toBeUndefined()
    expect(executorCalls).toBe(2)
  })

  test('does not classify a success-audit storage failure as execute-failed', async () => {
    const auditFailure = new Error('success audit storage failed')
    const { storage, attemptedActions } = storageRejectingAction('execute-succeeded', auditFailure)
    let executed = false
    const manager = await createGrantedManagerFixture({
      storage,
      executor: {
        async execute() {
          executed = true
          return { ok: true }
        }
      }
    })

    let thrown: unknown
    try {
      await manager.execute('acme.analytics', null)
    } catch (cause) {
      thrown = cause
    }

    expect(executed).toBe(true)
    expect(thrown).toBe(auditFailure)
    expect(attemptedActions).toEqual(['grant', 'execute-succeeded'])
    expect(manager.snapshot().policies[0]?.audit.map(({ action }) => action)).toEqual(['grant'])
  })

  test('preserves execution and failure-audit storage errors in an AggregateError', async () => {
    const executionFailure = new Error('runtime execution failed')
    const auditFailure = new Error('failure audit storage failed')
    const { storage, attemptedActions } = storageRejectingAction('execute-failed', auditFailure)
    const manager = await createGrantedManagerFixture({
      storage,
      executor: {
        async execute() {
          throw executionFailure
        }
      }
    })

    let thrown: unknown
    try {
      await manager.execute('acme.analytics', null)
    } catch (cause) {
      thrown = cause
    }

    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as AggregateError).errors).toEqual([executionFailure, auditFailure])
    expect(attemptedActions).toEqual(['grant', 'execute-failed'])
    expect(manager.snapshot().policies[0]?.audit.map(({ action }) => action)).toEqual(['grant'])
  })

  test('requires a new exact runtime grant when marketplace authority changes', async () => {
    const publisher = await keys()
    const declarative = await verifyPluginPackage(
      await signPluginManifest(pluginPayload(), publisher.privateKey),
      publisher.publicKey
    )
    const runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest
    })
    const runtimeDigest = runtime.verifiedRuntimePackage.verifiedDigest
    const grantedAt = '2026-08-05T00:00:00.000Z'
    const legacyPolicy: PluginRuntimePolicyRecordV1 = {
      schemaVersion: 1,
      pluginId: declarative.manifest.plugin.id,
      declarativeManifestDigest: declarative.verifiedDigest,
      runtimePackageDigest: runtimeDigest,
      grantedCapabilities: [],
      grantedAt,
      revokedAt: null,
      auditSequence: 1,
      audit: [
        {
          sequence: 1,
          occurredAt: grantedAt,
          action: 'grant',
          runtimePackageDigest: runtimeDigest,
          reasonCode: null
        }
      ]
    }
    let authority = MARKETPLACE_AUTHORITY
    let now = Date.parse('2026-08-05T00:01:00.000Z')
    const manager = createPluginRuntimeManager({
      storage: createMemoryPluginRuntimePolicyStorage([legacyPolicy]),
      now: () => now++,
      resolveInstalledPlugin: () => ({
        package: {
          trustSource: 'publisher-signature',
          manifest: declarative.manifest,
          digest: declarative.verifiedDigest,
          verifiedPackage: declarative,
          marketplaceAuthority: authority
        },
        enabled: true,
        pinnedDigest: null
      }),
      loadRuntime: async () => ({ runtime, source: 'network', refreshError: null }),
      executor: { execute: async () => ({ ok: true }) }
    })

    await manager.load()
    await expect(manager.execute(declarative.manifest.plugin.id, null)).rejects.toThrow(
      'marketplace-authority-changed'
    )
    const firstReview = await manager.review(declarative.manifest.plugin.id)
    await manager.grant(declarative.manifest.plugin.id, firstReview)
    await expect(manager.execute(declarative.manifest.plugin.id, null)).resolves.toEqual({
      ok: true
    })

    authority = { ...MARKETPLACE_AUTHORITY, sourceGeneration: 2 }
    await expect(manager.execute(declarative.manifest.plugin.id, null)).rejects.toThrow(
      'marketplace-authority-changed'
    )
    const replacementReview = await manager.review(declarative.manifest.plugin.id)
    await manager.grant(declarative.manifest.plugin.id, replacementReview)
    await expect(manager.execute(declarative.manifest.plugin.id, null)).resolves.toEqual({
      ok: true
    })
    expect(manager.snapshot().policies[0]).toMatchObject({
      schemaVersion: 2,
      marketplaceAuthority: authority,
      grantedAt: expect.any(String),
      revokedAt: null
    })
  })

  test('captures the input document context when execution is requested', async () => {
    let activeDocument = { id: 'document-a' }
    const observedContexts: unknown[] = []
    const manager = await createGrantedManagerFixture({
      storage: createMemoryPluginRuntimePolicyStorage(),
      captureInputContext: () => activeDocument,
      prepareInput: async (_capabilities, input, capturedContext) => {
        observedContexts.push(capturedContext)
        return input
      },
      executor: { execute: async () => ({ ok: true }) }
    })

    const execution = manager.execute('acme.analytics', null)
    activeDocument = { id: 'document-b' }
    await expect(execution).resolves.toEqual({ ok: true })
    expect(observedContexts).toEqual([{ id: 'document-a' }])
  })

  test('keeps revoke and uninstall audit time monotonic after the wall clock rolls back', async () => {
    const publisher = await keys()
    const declarative = await verifyPluginPackage(
      await signPluginManifest(pluginPayload(), publisher.privateKey),
      publisher.publicKey
    )
    const runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest
    })
    const storage = createMemoryPluginRuntimePolicyStorage()
    let now = Date.parse('2026-08-05T12:00:00.000Z')
    const managerOptions = {
      storage,
      now: () => now,
      resolveInstalledPlugin: () => ({
        package: {
          trustSource: 'publisher-signature' as const,
          manifest: declarative.manifest,
          digest: declarative.verifiedDigest,
          verifiedPackage: declarative
        },
        enabled: true,
        pinnedDigest: null
      }),
      loadRuntime: async () => ({ runtime, source: 'network' as const, refreshError: null })
    }
    const firstManager = createPluginRuntimeManager(managerOptions)
    await firstManager.load()
    await firstManager.grant('acme.analytics', await firstManager.review('acme.analytics'))
    const grantedAt = firstManager.snapshot().policies[0].grantedAt
    expect(grantedAt).toBe('2026-08-05T12:00:00.000Z')

    now = Date.parse('2026-08-05T11:00:00.000Z')
    const restartedManager = createPluginRuntimeManager(managerOptions)
    await restartedManager.load()
    let removed = false
    await restartedManager.uninstall('acme.analytics', async () => {
      removed = true
    })

    expect(removed).toBe(true)
    const persisted = parsePluginRuntimePolicyRecord(await storage.get('acme.analytics'))
    expect(persisted.revokedAt).toBe(grantedAt)
    expect(persisted.audit.at(-1)).toMatchObject({
      action: 'revoke',
      occurredAt: grantedAt
    })
  })

  test('reloads a cross-window grant before uninstalling and persists its revocation', async () => {
    const publisher = await keys()
    const declarative = await verifyPluginPackage(
      await signPluginManifest(pluginPayload(), publisher.privateKey),
      publisher.publicKey
    )
    const runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest
    })
    const storage = createMemoryPluginRuntimePolicyStorage()
    let installed = true
    let lockTail: Promise<void> = Promise.resolve()
    let lockRequests = 0
    const sharedLock = <T>(operation: () => Promise<T>): Promise<T> => {
      lockRequests += 1
      const result = lockTail.then(operation, operation)
      lockTail = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
    let executorCalls = 0
    const options = {
      storage,
      publisherPrivilegeLock: sharedLock,
      checkpointPublisherTrust: async () => {
        if (!installed) throw new Error('publisher plugin was removed')
      },
      resolveInstalledPlugin: () =>
        installed
          ? {
              package: {
                trustSource: 'publisher-signature' as const,
                manifest: declarative.manifest,
                digest: declarative.verifiedDigest,
                verifiedPackage: declarative
              },
              enabled: true,
              pinnedDigest: null
            }
          : undefined,
      loadRuntime: async () => ({ runtime, source: 'network' as const, refreshError: null }),
      executor: {
        async execute() {
          executorCalls += 1
          return { ok: true }
        }
      }
    }
    const uninstallingWindow = createPluginRuntimeManager(options)
    const grantingWindow = createPluginRuntimeManager(options)
    await uninstallingWindow.load()
    await grantingWindow.load()
    const uninstallingWindowReview = await uninstallingWindow.review('acme.analytics')
    const review = await grantingWindow.review('acme.analytics')
    await grantingWindow.grant('acme.analytics', review)
    expect(uninstallingWindow.snapshot().policies).toHaveLength(0)

    let queuedGrant: ReturnType<typeof uninstallingWindow.grant> | undefined
    await sharedLock(async () => {
      const requestsBeforeGrant = lockRequests
      queuedGrant = uninstallingWindow.grant('acme.analytics', uninstallingWindowReview)
      await Promise.resolve()
      expect(lockRequests).toBe(requestsBeforeGrant + 1)
      await uninstallingWindow.uninstallWhilePublisherLocked('acme.analytics', async () => {
        installed = false
      })
    })
    if (!queuedGrant) throw new Error('Expected queued grant')
    await expect(queuedGrant).rejects.toThrow('publisher plugin was removed')
    expect(installed).toBe(false)
    expect(await storage.get('acme.analytics')).toMatchObject({
      grantedAt: expect.any(String),
      revokedAt: expect.any(String),
      audit: expect.arrayContaining([expect.objectContaining({ action: 'revoke' })])
    })

    installed = true
    const restarted = createPluginRuntimeManager(options)
    await restarted.load()
    await expect(restarted.execute('acme.analytics', null)).rejects.toThrow('grant-required')
    expect(executorCalls).toBe(0)
  })

  test('invalidates queued reviews across an exact publisher uninstall and reinstall', async () => {
    const publisher = await keys()
    const declarative = await verifyPluginPackage(
      await signPluginManifest(pluginPayload(), publisher.privateKey),
      publisher.publicKey
    )
    const runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest
    })
    const storage = createMemoryPluginRuntimePolicyStorage()
    let installed = true
    let lockTail: Promise<void> = Promise.resolve()
    let lockRequests = 0
    let notifyFirstQueuedGrant: (() => void) | undefined
    const firstQueuedGrantRequestedLock = new Promise<void>((resolve) => {
      notifyFirstQueuedGrant = resolve
    })
    const sharedLock = <T>(operation: () => Promise<T>): Promise<T> => {
      lockRequests += 1
      if (lockRequests === 3) notifyFirstQueuedGrant?.()
      const result = lockTail.then(operation, operation)
      lockTail = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
    const manager = createPluginRuntimeManager({
      storage,
      publisherPrivilegeLock: sharedLock,
      checkpointPublisherTrust: async () => {
        if (!installed) throw new Error('publisher plugin was removed')
      },
      resolveInstalledPlugin: () =>
        installed
          ? {
              package: {
                trustSource: 'publisher-signature' as const,
                manifest: declarative.manifest,
                digest: declarative.verifiedDigest,
                verifiedPackage: declarative,
                marketplaceAuthority: MARKETPLACE_AUTHORITY
              },
              enabled: true,
              pinnedDigest: null
            }
          : undefined,
      loadRuntime: async () => ({ runtime, source: 'network' as const, refreshError: null })
    })
    await manager.load()
    const pluginId = declarative.manifest.plugin.id
    const reviewedBeforeUninstall = await manager.review(pluginId)

    let queuedGrantX: ReturnType<typeof manager.grant> | undefined
    let queuedGrantY: ReturnType<typeof manager.grant> | undefined
    await sharedLock(async () => {
      queuedGrantX = manager.grant(pluginId, reviewedBeforeUninstall)
      void queuedGrantX.catch(() => undefined)
      queuedGrantY = manager.grant(pluginId, reviewedBeforeUninstall)
      void queuedGrantY.catch(() => undefined)
      await firstQueuedGrantRequestedLock
      expect(lockRequests).toBe(3)

      await manager.uninstallWhilePublisherLocked(pluginId, async () => {
        installed = false
        installed = true
      })
    })
    if (!queuedGrantX || !queuedGrantY) throw new Error('Expected queued grants')

    await expect(queuedGrantX).rejects.toThrow('review is stale')
    await expect(queuedGrantY).rejects.toThrow('review is stale')
    expect(lockRequests).toBe(4)
    expect(await storage.get(pluginId)).toBeNull()

    const lockRequestsBeforeEntryCheck = lockRequests
    await expect(manager.grant(pluginId, reviewedBeforeUninstall)).rejects.toThrow(
      'review is stale'
    )
    expect(lockRequests).toBe(lockRequestsBeforeEntryCheck)

    const reviewedAfterReinstall = await manager.review(pluginId)
    expect(reviewedAfterReinstall.installationIncarnation).not.toBe(
      reviewedBeforeUninstall.installationIncarnation
    )
    await expect(manager.grant(pluginId, reviewedAfterReinstall)).resolves.toMatchObject({
      marketplaceAuthority: MARKETPLACE_AUTHORITY,
      grantedAt: expect.any(String),
      revokedAt: null
    })
  })

  test('does not remove a publisher plugin when its lock-held runtime tombstone fails', async () => {
    const tombstoneFailure = new Error('runtime tombstone persist failed')
    const { storage } = storageRejectingAction('revoke', tombstoneFailure)
    const manager = await createGrantedManagerFixture({
      storage,
      executor: {
        async execute() {
          return null
        }
      }
    })
    let removed = false

    await expect(
      manager.uninstallWhilePublisherLocked('acme.analytics', async () => {
        removed = true
      })
    ).rejects.toBe(tombstoneFailure)
    expect(removed).toBe(false)
  })

  test('checks publisher trust inside the privilege lock before review, grant, and execute', async () => {
    const publisher = await keys()
    const declarative = await verifyPluginPackage(
      await signPluginManifest(pluginPayload(), publisher.privateKey),
      publisher.publicKey
    )
    const runtime = await runtimeFixture({
      publicKey: publisher.publicKey,
      privateKey: publisher.privateKey,
      declarativeDigest: declarative.verifiedDigest
    })
    const events: string[] = []
    let checkpointFailure: Error | null = null
    let executorCalls = 0
    const manager = createPluginRuntimeManager({
      publisherPrivilegeLock: async (operation) => {
        events.push('lock:start')
        try {
          return await operation()
        } finally {
          events.push('lock:end')
        }
      },
      async checkpointPublisherTrust() {
        events.push('checkpoint')
        if (checkpointFailure) throw checkpointFailure
      },
      resolveInstalledPlugin: () => ({
        package: {
          trustSource: 'publisher-signature',
          manifest: declarative.manifest,
          digest: declarative.verifiedDigest,
          verifiedPackage: declarative
        },
        enabled: true,
        pinnedDigest: null
      }),
      loadRuntime: async () => {
        events.push('load')
        return { runtime, source: 'network', refreshError: null }
      },
      executor: {
        async execute() {
          executorCalls += 1
          return { ok: true }
        }
      }
    })
    await manager.load()
    const review = await manager.review('acme.analytics')
    await manager.grant('acme.analytics', review)
    expect(events).toEqual([
      'lock:start',
      'checkpoint',
      'load',
      'lock:end',
      'lock:start',
      'checkpoint',
      'load',
      'lock:end'
    ])

    events.length = 0
    checkpointFailure = new Error('publisher trust checkpoint failed')
    await expect(manager.execute('acme.analytics', null)).rejects.toBe(checkpointFailure)
    expect(events).toEqual(['lock:start', 'checkpoint', 'lock:end'])
    expect(executorCalls).toBe(0)

    await expect(manager.revoke('acme.analytics')).resolves.toMatchObject({
      revokedAt: expect.any(String)
    })
  })
})
