import {
  requireStorageProfileID,
  type StorageDocumentAuthority,
  type StorageDocumentBinding,
  type StorageProviderID
} from '@/app/integrations/storage/types'

export type StorageProfileMutationScope = Readonly<{
  providerId: StorageProviderID
  profileId: string
}>

export type StorageBindingReader = Readonly<{
  getStorageBinding(): StorageDocumentBinding | null
}>

export type OpenStorageProfileScope = StorageProfileMutationScope &
  Readonly<{ accountId?: StorageDocumentAuthority['accountId'] }>

type DrainState = {
  activeLeases: number
  frozen: boolean
  waiters: Set<() => void>
}

declare const storageProfileMutationLeaseBrand: unique symbol

export type StorageProfileMutationLease = Readonly<{
  [storageProfileMutationLeaseBrand]: true
}>

const drainStates = new Map<string, DrainState>()
const activeLeaseTokens = new WeakMap<StorageProfileMutationLease, string>()

export class StorageProfileMutationFrozenError extends Error {
  constructor() {
    super('Storage profile changes are temporarily frozen')
    this.name = 'StorageProfileMutationFrozenError'
  }
}

export class StorageProfileOpenDocumentsError extends Error {
  constructor() {
    super('Close documents from this storage profile before changing its authorization')
    this.name = 'StorageProfileOpenDocumentsError'
  }
}

function normalizedScope(scope: StorageProfileMutationScope): StorageProfileMutationScope {
  return {
    providerId: scope.providerId,
    profileId: requireStorageProfileID(scope.profileId)
  }
}

function scopeKey(scope: StorageProfileMutationScope): string {
  const normalized = normalizedScope(scope)
  return JSON.stringify([normalized.providerId, normalized.profileId])
}

function stateFor(key: string): DrainState {
  let state = drainStates.get(key)
  if (!state) {
    state = { activeLeases: 0, frozen: false, waiters: new Set() }
    drainStates.set(key, state)
  }
  return state
}

function releaseState(key: string, state: DrainState): void {
  if (state.activeLeases > 0 || state.frozen || state.waiters.size > 0) return
  drainStates.delete(key)
}

function waitForActiveLeases(state: DrainState, signal?: AbortSignal): Promise<void> {
  if (state.activeLeases === 0) return Promise.resolve()
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const drained = () => {
      state.waiters.delete(drained)
      cleanup()
      resolve()
    }
    const abort = () => {
      state.waiters.delete(drained)
      cleanup()
      const reason = signal?.reason
      reject(
        reason instanceof Error
          ? reason
          : new DOMException('Storage operation cancelled', 'AbortError')
      )
    }
    state.waiters.add(drained)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Hold a shared profile lease for the complete local-write + outbox mutation. */
export async function withStorageProfileMutationLease<T>(
  scope: StorageProfileMutationScope,
  operation: (lease: StorageProfileMutationLease) => Promise<T>,
  inheritedLease?: StorageProfileMutationLease
): Promise<T> {
  const key = scopeKey(scope)
  if (inheritedLease) {
    if (activeLeaseTokens.get(inheritedLease) !== key) {
      throw new TypeError('Storage profile mutation lease is not active for this profile')
    }
    return operation(inheritedLease)
  }
  const state = stateFor(key)
  if (state.frozen) throw new StorageProfileMutationFrozenError()
  const lease = Object.freeze({}) as StorageProfileMutationLease
  activeLeaseTokens.set(lease, key)
  state.activeLeases++
  try {
    return await operation(lease)
  } finally {
    activeLeaseTokens.delete(lease)
    state.activeLeases--
    if (state.activeLeases === 0) {
      for (const waiter of state.waiters) waiter()
    }
    releaseState(key, state)
  }
}

/**
 * Stop new profile persistence, drain in-flight leases, then run one exclusive
 * lifecycle mutation. Failure and cancellation always release the freeze.
 */
export async function withStorageProfileMutationDrain<T>(
  scope: StorageProfileMutationScope,
  operation: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const key = scopeKey(scope)
  const state = stateFor(key)
  if (state.frozen) throw new StorageProfileMutationFrozenError()
  state.frozen = true
  try {
    await waitForActiveLeases(state, signal)
    signal?.throwIfAborted()
    return await operation()
  } finally {
    state.frozen = false
    releaseState(key, state)
  }
}

/** Stable account-aware tab preflight used immediately inside a profile drain. */
export function storageProfileHasOpenTabs(
  scope: OpenStorageProfileScope,
  readers: readonly StorageBindingReader[]
): boolean {
  const normalized = normalizedScope(scope)
  return readers.some((reader) => {
    const binding = reader.getStorageBinding()
    if (
      !binding ||
      binding.providerId !== normalized.providerId ||
      binding.profileId !== normalized.profileId
    ) {
      return false
    }
    return scope.accountId === undefined || binding.authority?.accountId === scope.accountId
  })
}
