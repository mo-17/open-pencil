import {
  verifiedPluginRuntimeAssetBytes,
  type PluginRuntimeCapabilityV1,
  type VerifiedIndexedPluginRuntimePackage,
  type VerifiedPluginPackage
} from '@open-pencil/core/plugins'
import type { JsonValue } from '@open-pencil/scene-graph/primitives'

import type { InstalledAppPlugin } from '../types'
import { createWasmPluginExecutor } from './executor'
import {
  PLUGIN_RUNTIME_POLICY_LIMITS,
  PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION,
  createMemoryPluginRuntimePolicyStorage,
  parsePluginRuntimePolicyRecord,
  type PluginRuntimeAuditAction,
  type PluginRuntimePolicyRecordV1,
  type PluginRuntimePolicyStorage
} from './storage'

export interface PluginRuntimeReview {
  pluginId: string
  declarativeManifestDigest: string
  runtimePackageDigest: string
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
  policies: readonly PluginRuntimePolicyRecordV1[]
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
    userInput: JsonValue,
    capturedContext: unknown
  ): Promise<JsonValue>
  captureInputContext?(): unknown
  executor?: ReturnType<typeof createWasmPluginExecutor>
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
    left.declarativeManifestDigest === right.declarativeManifestDigest &&
    left.runtimePackageDigest === right.runtimePackageDigest &&
    left.kind === right.kind &&
    left.executionStatus === right.executionStatus &&
    sameCapabilities(left.capabilities, right.capabilities)
  )
}

function executionBlockReason(
  policy: PluginRuntimePolicyRecordV1 | undefined,
  review: PluginRuntimeReview
): string | null {
  if (review.executionStatus !== 'eligible') return 'runtime-unavailable'
  if (!policy?.grantedAt || policy.revokedAt) return 'grant-required'
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
  loaded: Awaited<ReturnType<CreatePluginRuntimeManagerOptions['loadRuntime']>>
): PluginRuntimeReview {
  const runtime = loaded.runtime.verifiedRuntimePackage
  return {
    pluginId: runtime.runtimePackage.plugin.id,
    declarativeManifestDigest: runtime.runtimePackage.declarativeManifestDigest,
    runtimePackageDigest: runtime.verifiedDigest,
    kind: runtime.runtimePackage.runtime.kind,
    capabilities: runtime.runtimePackage.runtime.capabilities,
    executionStatus: runtime.executionStatus,
    executionReason: runtime.executionReason,
    source: loaded.source
  }
}

function emptyPolicy(
  review: PluginRuntimeReview,
  audit: PluginRuntimePolicyRecordV1['audit'] = [],
  auditSequence = 0
): PluginRuntimePolicyRecordV1 {
  return {
    schemaVersion: PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION,
    pluginId: review.pluginId,
    declarativeManifestDigest: review.declarativeManifestDigest,
    runtimePackageDigest: review.runtimePackageDigest,
    grantedCapabilities: [],
    grantedAt: null,
    revokedAt: null,
    auditSequence,
    audit
  }
}

function auditPolicy(
  current: PluginRuntimePolicyRecordV1 | undefined,
  review: PluginRuntimeReview,
  action: PluginRuntimeAuditAction,
  occurredAt: string,
  reasonCode: string | null,
  state: Partial<
    Pick<PluginRuntimePolicyRecordV1, 'grantedCapabilities' | 'grantedAt' | 'revokedAt'>
  > = {}
): PluginRuntimePolicyRecordV1 {
  const sameRuntime =
    current?.runtimePackageDigest === review.runtimePackageDigest &&
    current.declarativeManifestDigest === review.declarativeManifestDigest
  const base = sameRuntime
    ? current
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
  return parsePluginRuntimePolicyRecord({ ...base, ...state, auditSequence: sequence, audit })
}

export function createPluginRuntimeManager(options: CreatePluginRuntimeManagerOptions) {
  const storage = options.storage ?? createMemoryPluginRuntimePolicyStorage()
  const executor = options.executor ?? createWasmPluginExecutor()
  const now = options.now ?? Date.now
  const policies = new Map<string, PluginRuntimePolicyRecordV1>()
  const listeners = new Set<Listener>()
  let issues: PluginRuntimePolicyIssue[] = []
  let ready = false
  let error: Error | null = null
  let mutationTail: Promise<void> = Promise.resolve()
  const activeExecutions = new Map<string, AbortController>()
  const pendingRevocations = new Set<string>()
  const pendingUninstalls = new Set<string>()

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
      const next = new Map<string, PluginRuntimePolicyRecordV1>()
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

  async function loadReview(pluginId: string) {
    const declarative = installedDeclarativePackage(options.resolveInstalledPlugin(pluginId))
    const loaded = await options.loadRuntime(declarative)
    return { loaded, review: reviewOf(loaded) }
  }

  async function review(pluginId: string): Promise<PluginRuntimeReview> {
    return (await loadReview(pluginId)).review
  }

  async function persist(policy: PluginRuntimePolicyRecordV1): Promise<void> {
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
  ): Promise<PluginRuntimePolicyRecordV1> {
    return mutation(async () => {
      if (pendingUninstalls.has(pluginId)) {
        throw new Error('Plugin runtime is pending uninstall')
      }
      const { review } = await loadReview(pluginId)
      if (!sameReviewedRuntime(review, expectedReview)) {
        throw new Error(
          'Plugin runtime changed after review; review its digest and capabilities again'
        )
      }
      if (review.executionStatus !== 'eligible') {
        throw new Error(review.executionReason ?? 'Plugin runtime is unavailable')
      }
      const occurredAt = new Date(now()).toISOString()
      const policy = auditPolicy(policies.get(pluginId), review, 'grant', occurredAt, null, {
        grantedCapabilities: review.capabilities,
        grantedAt: occurredAt,
        revokedAt: null
      })
      await persist(policy)
      return structuredClone(policy)
    })
  }

  function revoke(pluginId: string): Promise<PluginRuntimePolicyRecordV1> {
    pendingRevocations.add(pluginId)
    activeExecutions.get(pluginId)?.abort(new Error('Plugin runtime was revoked'))
    return mutation(async () => {
      const current = policies.get(pluginId)
      if (!current?.grantedAt || current.revokedAt) throw new Error('Plugin runtime is not granted')
      const review: PluginRuntimeReview = {
        pluginId,
        declarativeManifestDigest: current.declarativeManifestDigest,
        runtimePackageDigest: current.runtimePackageDigest,
        kind: 'wasm',
        capabilities: current.grantedCapabilities,
        executionStatus: 'eligible',
        executionReason: null,
        source: 'cache'
      }
      const occurredAt = new Date(now()).toISOString()
      const policy = auditPolicy(current, review, 'revoke', occurredAt, null, {
        revokedAt: occurredAt
      })
      await persist(policy)
      return structuredClone(policy)
    }).finally(() => pendingRevocations.delete(pluginId))
  }

  function uninstall(pluginId: string, removePlugin: () => Promise<void>): Promise<void> {
    if (pendingUninstalls.has(pluginId)) {
      return Promise.reject(new Error('Plugin runtime uninstall is already pending'))
    }
    pendingUninstalls.add(pluginId)
    activeExecutions.get(pluginId)?.abort(new Error('Plugin runtime was uninstalled'))
    return mutation(async () => {
      if (!ready) throw new Error('Plugin runtime policies are still loading')
      if (error) throw new Error(`Plugin runtime policies are unavailable: ${error.message}`)
      const current = policies.get(pluginId)
      if (current?.grantedAt && !current.revokedAt) {
        const occurredAt = new Date(now()).toISOString()
        const review: PluginRuntimeReview = {
          pluginId,
          declarativeManifestDigest: current.declarativeManifestDigest,
          runtimePackageDigest: current.runtimePackageDigest,
          kind: 'wasm',
          capabilities: current.grantedCapabilities,
          executionStatus: 'eligible',
          executionReason: null,
          source: 'cache'
        }
        await persist(
          auditPolicy(current, review, 'revoke', occurredAt, null, { revokedAt: occurredAt })
        )
      }
      await removePlugin()
    }).finally(() => pendingUninstalls.delete(pluginId))
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
      new Date(now()).toISOString(),
      reasonCode
    )
    await persist(policy)
  }

  async function execute(pluginId: string, userInput: JsonValue): Promise<JsonValue> {
    const capturedContext = options.captureInputContext?.()
    return mutation(async () => {
      if (pendingUninstalls.has(pluginId)) {
        throw new Error('Plugin runtime execution blocked: uninstall-requested')
      }
      const { loaded, review } = await loadReview(pluginId)
      const policy = policies.get(pluginId)
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
        let output: JsonValue
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
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { snapshot, subscribe, load, review, grant, revoke, uninstall, execute }
}
