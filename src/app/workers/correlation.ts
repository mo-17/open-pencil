/** Shared fail-closed helpers for correlated disposable and reusable module Workers. */
export function normalizeWorkerError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

export function hasCorrelatedWorkerRequestId(value: unknown, expected: string): boolean {
  if (value === null || typeof value !== 'object') return false
  return Object.getOwnPropertyDescriptor(value, 'requestId')?.value === expected
}
