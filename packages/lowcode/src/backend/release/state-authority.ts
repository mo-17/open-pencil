import type { BackendReleaseStateV1 } from './types'

const AUTHENTICATED_STATES = new WeakSet<object>()

export function freezeBackendReleaseData<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) freezeBackendReleaseData(descriptor.value, seen)
  }
  return Object.freeze(value)
}

/** Internal-only state authority. This module is deliberately absent from the public barrel. */
export function sealBackendReleaseState(state: BackendReleaseStateV1): BackendReleaseStateV1 {
  const frozen = freezeBackendReleaseData(state)
  AUTHENTICATED_STATES.add(frozen)
  return frozen
}

export function isAuthenticatedBackendReleaseState(value: unknown): value is BackendReleaseStateV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.isFrozen(value) &&
    AUTHENTICATED_STATES.has(value)
  )
}
