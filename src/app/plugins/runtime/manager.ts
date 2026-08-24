import {
  verifiedPluginRuntimeAssetBytes,
  type PluginRuntimeCapabilityV1,
  type VerifiedIndexedPluginRuntimePackage,
  type VerifiedPluginPackage
} from '@open-pencil/plugin-contracts'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  parseAppPluginMarketplaceAuthority,
  sameAppPluginMarketplaceAuthority,
  type AppPluginMarketplaceAuthority,
  type InstalledAppPlugin
} from '../types'
import { createWasmPluginExecutor } from './executor'
import {
  PLUGIN_RUNTIME_POLICY_LIMITS,
  PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION,
  createMemoryPluginRuntimePolicyStorage,
  parsePluginRuntimePolicyRecord,
  type PluginRuntimeAuditAction,
  type PluginRuntimePolicyRecord,
  type PluginRuntimePolicyRecordV2,
  type PluginRuntimePolicyStorage
} from './storage'

export interface PluginRuntimeReview {
  pluginId: string
  installationIncarnation: string
  declarativeManifestDigest: string
  runtimePackageDigest: string
  marketplaceAuthority: AppPluginMarketplaceAuthority | null
  kind: 'wasm' | 'javascript'
  capabilities: readonly PluginRuntimeCapabilityV1[]
  executionStatus: 'eligible' | 'runtime-unavailable'
  executionReason: string | null
  source: 'network' | 'cache'
}

export interface PluginRuntimePolicyIssue {
  pluginId: string | null
  reason: string
}

export interface PluginRuntimeManagerSnapshot {
  ready: boolean
  policies: readonly PluginRuntimePolicyRecord[]
  issues: readonly PluginRuntimePolicyIssue[]
  error: Error | null
}

export interface CreatePluginRuntimeManagerOptions {
  storage?: PluginRuntimePolicyStorage
  resolveInstalledPlugin(pluginId: string): InstalledAppPlugin | undefined
  loadRuntime(declarativePackage: VerifiedPluginPackage): Promise<{
    runtime: VerifiedIndexedPluginRuntimePackage
    source: 'network' | 'cache'
    refreshError: Error | null
  }>
  prepareInput?(
    capabilities: readonly PluginRuntimeCapabilityV1[],
    userInput: JSONValue,
    capturedContext: unknown
  ): Promise<JSONValue>
  captureInputContext?(): unknown
  executor?: ReturnType<typeof createWasmPluginExecutor>
  publisherPrivilegeLock?<T>(operation: () => Promise<T>): Promise<T>
  checkpointPublisherTrust?(): Promise<unknown>
  now?: () => number
}

type Listener = (snapshot: PluginRuntimeManagerSnapshot) => void

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function sameCapabilities(
  left: readonly PluginRuntimeCapabilityV1[],
  right: readonly PluginRuntimeCapabilityV1[]
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameReviewedRuntime(left: PluginRuntimeReview, right: PluginRuntimeReview): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.installationIncarnation === right.installationIncarnation &&
    left.declarativeManifestDigest === right.declarativeManifestDigest &&
    left.runtimePackageDigest === right.runtimePackageDigest &&
    sameAppPluginMarketplaceAuthority(left.marketplaceAuthority, right.marketplaceAuthority) &&
    left.kind === right.kind &&
    left.executionStatus === right.executionStatus &&
    sameCapabilities(left.capabilities, right.capabilities)
  )
}

function executionBlockReason(
  policy: PluginRuntimePolicyRecord | undefined,
  review: PluginRuntimeReview
): string | null {
  if (review.executionStatus !== 'eligible') return 'runtime-unavailable'
  if (!policy?.grantedAt || policy.revokedAt) return 'grant-required'
  if (
    !sameAppPluginMarketplaceAuthority(
      policy.schemaVersion === PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION
        ? policy.marketplaceAuthority
        : undefined,
      review.marketplaceAuthority
    )
  ) {
    return 'marketplace-authority-changed'
  }
  if (
    policy.runtimePackageDigest !== review.runtimePackageDigest ||
    policy.declarativeManifestDigest !== review.declarativeManifestDigest
  ) {
    return 'runtime-digest-changed'
  }
  return sameCapabilities(policy.grantedCapabilities, review.capabilities)
    ? null
    : 'capability-grant-mismatch'
}

function installedDeclarativePackage(
  plugin: InstalledAppPlugin | undefined
): VerifiedPluginPackage {
  if (!plugin) throw new Error('Plugin is not installed')
  if (!plugin.enabled) throw new Error('Plugin is disabled')
  if (plugin.blockedReason) throw new Error(`Plugin is blocked: ${plugin.blockedReason}`)
  const accepted = plugin.installedState?.accepted ?? plugin.package.verifiedPackage
  if (!accepted || accepted.verifiedDigest !== plugin.package.digest) {
    throw new Error('Plugin does not have an active publisher-signed package')
  }
  return accepted
}

function reviewOf(
  loaded: Awaited<ReturnType<CreatePluginRuntimeManagerOptions['loadRuntime']>>,
  marketplaceAuthority: AppPluginMarketplaceAuthority | null,
  installationIncarnation: string
): PluginRuntimeReview {
  const runtime = loaded.runtime.verifiedRuntimePackage
  return {
    pluginId: runtime.runtimePackage.plugin.id,
    installationIncarnation,
    declarativeManifestDigest: runtime.runtimePackage.declarativeManifestDigest,
    runtimePackageDigest: runtime.verifiedDigest,
    marketplaceAuthority,
    kind: runtime.runtimePackage.runtime.kind,
    capabilities: runtime.runtimePackage.runtime.capabilities,
    executionStatus: runtime.executionStatus,
    executionReason: runtime.executionReason,
    source: loaded.source
  }
}

function emptyPolicy(
  review: PluginRuntimeReview,
  audit: PluginRuntimePolicyRecord['audit'] = [],
  auditSequence = 0
): PluginRuntimePolicyRecordV2 {
  return {
    schemaVersion: PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION,
    pluginId: review.pluginId,
    declarativeManifestDigest: review.declarativeManifestDigest,
    runtimePackageDigest: review.runtimePackageDigest,
    marketplaceAuthority: review.marketplaceAuthority
      ? structuredClone(review.marketplaceAuthority)
      : null,
    grantedCapabilities: [],
    grantedAt: null,
    revokedAt: null,
    auditSequence,
    audit
  }
}

function auditPolicy(
  current: PluginRuntimePolicyRecord | undefined,
  review: PluginRuntimeReview,
  action: PluginRuntimeAuditAction,
  occurredAt: string,
  reasonCode: string | null,
  state: Partial<
    Pick<PluginRuntimePolicyRecordV2, 'grantedCapabilities' | 'grantedAt' | 'revokedAt'>
  > = {}
): PluginRuntimePolicyRecordV2 {
  const sameRuntime =
    current?.runtimePackageDigest === review.runtimePackageDigest &&
    current.declarativeManifestDigest === review.declarativeManifestDigest &&
    sameAppPluginMarketplaceAuthority(
      current.schemaVersion === PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION
        ? current.marketplaceAuthority
        : undefined,
      review.marketplaceAuthority
    )
  const base: PluginRuntimePolicyRecordV2 = sameRuntime
    ? {
        ...current,
        schemaVersion: PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION,
        marketplaceAuthority: review.marketplaceAuthority
          ? structuredClone(review.marketplaceAuthority)
          : null
      }
    : emptyPolicy(review, current?.audit ?? [], current?.auditSequence ?? 0)
  const sequence = base.auditSequence + 1
  const audit = [
    ...base.audit,
    {
      sequence,
      occurredAt,
      action,
      runtimePackageDigest: review.runtimePackageDigest,
      reasonCode
    }
  ].slice(-PLUGIN_RUNTIME_POLICY_LIMITS.maxAuditEvents)
  return parsePluginRuntimePolicyRecord({
    ...base,
    ...state,
    auditSequence: sequence,
    audit
  }) as PluginRuntimePolicyRecordV2
}

export function createPluginRuntimeManager(options: CreatePluginRuntimeManagerOptions) {
  const storage = options.storage ?? createMemoryPluginRuntimePolicyStorage()
  const executor = options.executor ?? createWasmPluginExecutor()
  const wallNow = options.now ?? Date.now
  const policies = new Map<string, PluginRuntimePolicyRecord>()
  const listeners = new Set<Listener>()
  let issues: PluginRuntimePolicyIssue[] = []
  let ready = false
  let error: Error | null = null
  let mutationTail: Promise<void> = Promise.resolve()
  const activeExecutions = new Map<string, AbortController>()
  const pendingRevocations = new Set<string>()
  const pendingUninstalls = new Set<string>()
  const installationIncarnations = new Map<string, string>()
  let lastObservedAuditTime = 0

  function installationIncarnation(pluginId: string): string {
    const current = installationIncarnations.get(pluginId)
    if (current) return current
    const created = crypto.randomUUID()
    installationIncarnations.set(pluginId, created)
    return created
  }

  function invalidateInstallationIncarnation(pluginId: string): void {
    installationIncarnations.set(pluginId, crypto.randomUUID())
  }

  function assertCurrentReviewIncarnation(pluginId: string, review: PluginRuntimeReview): void {
    if (
      pendingUninstalls.has(pluginId) ||
      review.pluginId !== pluginId ||
      review.installationIncarnation !== installationIncarnation(pluginId)
    ) {
      throw new Error('Plugin runtime review is stale after an uninstall request; review it again')
    }
  }

  function observeAuditTime(value: string | null): void {
    if (value === null) return
    lastObservedAuditTime = Math.max(lastObservedAuditTime, Date.parse(value))
  }

  function monotonicAuditTimestamp(): string {
    const observed = wallNow()
    if (!Number.isFinite(observed)) throw new TypeError('Plugin runtime clock must be finite')
    lastObservedAuditTime = Math.max(lastObservedAuditTime, observed)
    return new Date(lastObservedAuditTime).toISOString()
  }

  function withPublisherPrivilege<T>(operation: () => Promise<T>): Promise<T> {
    const checkedOperation = async (): Promise<T> => {
      await options.checkpointPublisherTrust?.()
      return operation()
    }
    return options.publisherPrivilegeLock
      ? options.publisherPrivilegeLock(checkedOperation)
      : checkedOperation()
  }

  function withPublisherLock<T>(operation: () => Promise<T>): Promise<T> {
    return options.publisherPrivilegeLock ? options.publisherPrivilegeLock(operation) : operation()
  }

  function snapshot(): PluginRuntimeManagerSnapshot {
    return Object.freeze({
      ready,
      policies: Object.freeze(
        [...policies.values()]
          .sort((left, right) => left.pluginId.localeCompare(right.pluginId))
          .map((value) => structuredClone(value))
      ),
      issues: Object.freeze(issues.map((value) => ({ ...value }))),
      error
    })
  }

  function emit(): void {
    const value = snapshot()
    for (const listener of listeners) listener(value)
  }

  function mutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(operation, operation)
    mutationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async function load(): Promise<PluginRuntimeManagerSnapshot> {
    return mutation(async () => {
      const next = new Map<string, PluginRuntimePolicyRecord>()
      const nextIssues: PluginRuntimePolicyIssue[] = []
      try {
        for (const value of await storage.list()) {
          try {
            const policy = parsePluginRuntimePolicyRecord(value)
            if (next.has(policy.pluginId)) throw new Error('Duplicate runtime policy')
            if (next.size >= PLUGIN_RUNTIME_POLICY_LIMITS.maxPlugins) {
              throw new Error('Runtime policy count exceeds the limit')
            }
            next.set(policy.pluginId, policy)
            observeAuditTime(policy.grantedAt)
            observeAuditTime(policy.revokedAt)
            for (const event of policy.audit) observeAuditTime(event.occurredAt)
          } catch (cause) {
            nextIssues.push({ pluginId: null, reason: asError(cause).message })
          }
        }
        policies.clear()
        for (const [pluginId, policy] of next) policies.set(pluginId, policy)
        issues = nextIssues
        error = null
      } catch (cause) {
        error = asError(cause)
      }
      ready = true
      emit()
      return snapshot()
    })
  }

  async function loadReview(pluginId: string, incarnation = installationIncarnation(pluginId)) {
    const installed = options.resolveInstalledPlugin(pluginId)
    const declarative = installedDeclarativePackage(installed)
    const marketplaceAuthority = installed?.package.marketplaceAuthority
      ? parseAppPluginMarketplaceAuthority(installed.package.marketplaceAuthority)
      : null
    const loaded = await options.loadRuntime(declarative)
    return { loaded, review: reviewOf(loaded, marketplaceAuthority, incarnation) }
  }

  async function refreshPolicy(pluginId: string): Promise<PluginRuntimePolicyRecord | undefined> {
    const value = await storage.get(pluginId)
    if (value === null || value === undefined) {
      policies.delete(pluginId)
      return undefined
    }
    const policy = parsePluginRuntimePolicyRecord(value)
    if (policy.pluginId !== pluginId) throw new Error('Runtime policy storage identity changed')
    observeAuditTime(policy.grantedAt)
    observeAuditTime(policy.revokedAt)
    for (const event of policy.audit) observeAuditTime(event.occurredAt)
    policies.set(pluginId, policy)
    return policy
  }

  async function review(pluginId: string): Promise<PluginRuntimeReview> {
    const incarnation = installationIncarnation(pluginId)
    return withPublisherPrivilege(async () => {
      if (pendingUninstalls.has(pluginId)) {
        throw new Error('Plugin runtime is pending uninstall')
      }
      const { review: reviewedRuntime } = await loadReview(pluginId, incarnation)
      assertCurrentReviewIncarnation(pluginId, reviewedRuntime)
      return reviewedRuntime
    })
  }

  async function persist(policy: PluginRuntimePolicyRecordV2): Promise<void> {
    if (
      !policies.has(policy.pluginId) &&
      policies.size >= PLUGIN_RUNTIME_POLICY_LIMITS.maxPlugins
    ) {
      throw new Error('Plugin runtime policy storage is full')
    }
    await storage.put(policy)
    policies.set(policy.pluginId, policy)
    emit()
  }

  async function grant(
    pluginId: string,
    expectedReview: PluginRuntimeReview
  ): Promise<PluginRuntimePolicyRecordV2> {
    assertCurrentReviewIncarnation(pluginId, expectedReview)
    const reviewedRuntime = structuredClone(expectedReview)
    return mutation(() =>
      withPublisherPrivilege(async () => {
        assertCurrentReviewIncarnation(pluginId, reviewedRuntime)
        const { review } = await loadReview(pluginId, reviewedRuntime.installationIncarnation)
        assertCurrentReviewIncarnation(pluginId, reviewedRuntime)
        await refreshPolicy(pluginId)
        assertCurrentReviewIncarnation(pluginId, reviewedRuntime)
        if (!sameReviewedRuntime(review, reviewedRuntime)) {
          throw new Error(
            'Plugin runtime changed after review; review its digest and capabilities again'
          )
        }
        if (review.executionStatus !== 'eligible') {
          throw new Error(review.executionReason ?? 'Plugin runtime is unavailable')
        }
        const occurredAt = monotonicAuditTimestamp()
        const policy = auditPolicy(policies.get(pluginId), review, 'grant', occurredAt, null, {
          grantedCapabilities: review.capabilities,
          grantedAt: occurredAt,
          revokedAt: null
        })
        assertCurrentReviewIncarnation(pluginId, reviewedRuntime)
        await persist(policy)
        assertCurrentReviewIncarnation(pluginId, reviewedRuntime)
        return structuredClone(policy)
      })
    )
  }

  function reviewFromPolicy(
    pluginId: string,
    policy: PluginRuntimePolicyRecord
  ): PluginRuntimeReview {
    return {
      pluginId,
      installationIncarnation: installationIncarnation(pluginId),
      declarativeManifestDigest: policy.declarativeManifestDigest,
      runtimePackageDigest: policy.runtimePackageDigest,
      marketplaceAuthority:
        policy.schemaVersion === PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION && policy.marketplaceAuthority
          ? structuredClone(policy.marketplaceAuthority)
          : null,
      kind: 'wasm',
      capabilities: policy.grantedCapabilities,
      executionStatus: 'eligible',
      executionReason: null,
      source: 'cache'
    }
  }

  function revoke(pluginId: string): Promise<PluginRuntimePolicyRecordV2> {
    pendingRevocations.add(pluginId)
    activeExecutions.get(pluginId)?.abort(new Error('Plugin runtime was revoked'))
    return mutation(() =>
      withPublisherLock(async () => {
        const current = await refreshPolicy(pluginId)
        if (!current?.grantedAt || current.revokedAt)
          throw new Error('Plugin runtime is not granted')
        const review = reviewFromPolicy(pluginId, current)
        const occurredAt = monotonicAuditTimestamp()
        const policy = auditPolicy(current, review, 'revoke', occurredAt, null, {
          revokedAt: occurredAt
        })
        await persist(policy)
        return structuredClone(policy)
      })
    ).finally(() => pendingRevocations.delete(pluginId))
  }

  async function performUninstall(
    pluginId: string,
    removePlugin: () => Promise<void>
  ): Promise<void> {
    if (!ready) throw new Error('Plugin runtime policies are still loading')
    if (error) throw new Error(`Plugin runtime policies are unavailable: ${error.message}`)
    const current = await refreshPolicy(pluginId)
    if (current?.grantedAt && !current.revokedAt) {
      const occurredAt = monotonicAuditTimestamp()
      const review = reviewFromPolicy(pluginId, current)
      await persist(
        auditPolicy(current, review, 'revoke', occurredAt, null, { revokedAt: occurredAt })
      )
    }
    await removePlugin()
  }

  function requestUninstall(pluginId: string, operation: () => Promise<void>): Promise<void> {
    if (pendingUninstalls.has(pluginId)) {
      return Promise.reject(new Error('Plugin runtime uninstall is already pending'))
    }
    invalidateInstallationIncarnation(pluginId)
    pendingUninstalls.add(pluginId)
    activeExecutions.get(pluginId)?.abort(new Error('Plugin runtime was uninstalled'))
    return operation().finally(() => pendingUninstalls.delete(pluginId))
  }

  function uninstall(pluginId: string, removePlugin: () => Promise<void>): Promise<void> {
    return requestUninstall(pluginId, () =>
      mutation(() => performUninstall(pluginId, removePlugin))
    )
  }

  /**
   * Store-owned publisher uninstall already holds the shared privilege lock. Bypass the runtime
   * mutation queue here so a previously queued runtime operation waiting on that same lock cannot
   * form a lock/queue inversion. The lock keeps that queued operation out until the plugin record
   * has been removed, after which its live privilege checkpoint fails closed.
   */
  function uninstallWhilePublisherLocked(
    pluginId: string,
    removePlugin: () => Promise<void>
  ): Promise<void> {
    return requestUninstall(pluginId, () => performUninstall(pluginId, removePlugin))
  }

  async function recordExecution(
    review: PluginRuntimeReview,
    action: Extract<PluginRuntimeAuditAction, `execute-${string}`>,
    reasonCode: string | null
  ): Promise<void> {
    const policy = auditPolicy(
      policies.get(review.pluginId),
      review,
      action,
      monotonicAuditTimestamp(),
      reasonCode
    )
    await persist(policy)
  }

  async function execute(pluginId: string, userInput: JSONValue): Promise<JSONValue> {
    const capturedContext = options.captureInputContext?.()
    return mutation(() =>
      withPublisherPrivilege(async () => {
        if (pendingUninstalls.has(pluginId)) {
          throw new Error('Plugin runtime execution blocked: uninstall-requested')
        }
        const { loaded, review } = await loadReview(pluginId)
        const policy = await refreshPolicy(pluginId)
        const blockedReason = executionBlockReason(policy, review)
        if (blockedReason) {
          await recordExecution(review, 'execute-blocked', blockedReason)
          throw new Error(`Plugin runtime execution blocked: ${blockedReason}`)
        }
        const runtime = loaded.runtime.verifiedRuntimePackage
        if (runtime.runtimePackage.runtime.kind !== 'wasm') {
          await recordExecution(review, 'execute-blocked', 'javascript-runtime-disabled')
          throw new Error('JavaScript plugin runtimes are disabled')
        }
        if (pendingRevocations.has(pluginId)) {
          await recordExecution(review, 'execute-blocked', 'revocation-requested')
          throw new Error('Plugin runtime execution blocked: revocation-requested')
        }
        const controller = new AbortController()
        activeExecutions.set(pluginId, controller)
        try {
          let output: JSONValue
          try {
            let input = userInput
            if (options.prepareInput) {
              input = await options.prepareInput(review.capabilities, userInput, capturedContext)
            } else if (review.capabilities.length > 0) {
              throw new Error('Runtime capability input provider is unavailable')
            }
            output = await executor.execute({
              wasmBytes: verifiedPluginRuntimeAssetBytes(runtime),
              input,
              timeoutMs: runtime.runtimePackage.runtime.limits.timeoutMs,
              maxInputBytes: runtime.runtimePackage.runtime.limits.maxInputBytes,
              maxOutputBytes: runtime.runtimePackage.runtime.limits.maxOutputBytes,
              signal: controller.signal
            })
          } catch (executionCause) {
            try {
              await recordExecution(
                review,
                'execute-failed',
                controller.signal.aborted ? 'revoked-during-execution' : 'execution-failed'
              )
            } catch (auditCause) {
              throw new AggregateError(
                [asError(executionCause), asError(auditCause)],
                'Plugin runtime execution failed and its failure audit could not be persisted'
              )
            }
            throw executionCause
          }
          await recordExecution(review, 'execute-succeeded', null)
          return output
        } finally {
          if (activeExecutions.get(pluginId) === controller) activeExecutions.delete(pluginId)
        }
      })
    )
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    snapshot,
    subscribe,
    load,
    review,
    grant,
    revoke,
    uninstall,
    uninstallWhilePublisherLocked,
    execute
  }
}
