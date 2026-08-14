export type PopoutInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type PopoutListen = (
  event: string,
  handler: (event: { payload: unknown }) => void
) => Promise<() => void>

export async function invokePopoutCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function listenToPopoutEvent(
  event: string,
  handler: (event: { payload: unknown }) => void
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen(event, handler)
}

export function assertExactBooleanFields<const K extends string>(
  value: unknown,
  keys: readonly K[],
  message: string
): asserts value is { readonly [P in K]: boolean } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  const allowed = new Set<PropertyKey>(keys)
  const actual = Reflect.ownKeys(value)
  if (
    actual.length !== allowed.size ||
    actual.some((key) => !allowed.has(key)) ||
    keys.some((key) => typeof Reflect.get(value, key) !== 'boolean')
  ) {
    throw new Error(message)
  }
}
