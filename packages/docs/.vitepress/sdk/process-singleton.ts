const PROCESS_SINGLETONS = Symbol.for('@open-pencil/docs/process-singletons')

function processSingletons(): Map<string, unknown> {
  const scope = globalThis as unknown as Record<PropertyKey, unknown>
  const existing = scope[PROCESS_SINGLETONS]
  if (existing instanceof Map) return existing as Map<string, unknown>

  const created = new Map<string, unknown>()
  scope[PROCESS_SINGLETONS] = created
  return created
}

/**
 * Share build-only services across Vite's separately bundled data loaders.
 * The identity must include every path and option that affects the value.
 */
export function getOrCreateProcessSingleton<T>(identity: string, create: () => T): T {
  const singletons = processSingletons()
  if (singletons.has(identity)) return singletons.get(identity) as T

  const value = create()
  singletons.set(identity, value)
  return value
}
