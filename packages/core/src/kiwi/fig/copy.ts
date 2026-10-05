import { cloneDeepWith } from 'es-toolkit/object'

/** Copy opaque FIG payloads without Bun's shared-GUID corruption or Buffer-backed byte aliases. */
export function cloneFigPayload<T>(value: T): T {
  return cloneDeepWith(
    value,
    (
      part: unknown,
      _key: PropertyKey | undefined,
      _source: unknown,
      copies: Map<unknown, unknown>
    ) => {
      if (!(part instanceof Uint8Array)) return undefined
      const existing = copies.get(part)
      if (existing instanceof Uint8Array) return existing
      const bytes = new Uint8Array(part)
      copies.set(part, bytes)
      return bytes
    }
  )
}
