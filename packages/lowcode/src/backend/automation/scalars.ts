import { releaseDigest, releaseIdentifier, stringValue } from '../release/validation'

/** Shared scalar checks only; each automation contract owns its time and authority semantics. */
export function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new TypeError(`${path} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

export function nullableInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number
): number | null {
  return value === null ? null : integer(value, path, minimum, maximum)
}

export function fixedFalse(value: unknown, path: string): false {
  if (value !== false) throw new TypeError(`${path} must be false`)
  return false
}

export function identifier(value: unknown, path: string): string {
  return releaseIdentifier(stringValue(value, path), path)
}

export function digest(value: unknown, path: string): string {
  return releaseDigest(stringValue(value, path), path)
}
