import { parseBoundedManifestArray } from '@open-pencil/scene-graph'

export function parsePresentationText(value: unknown, path: string, maximum = 2_048): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    new TextEncoder().encode(value).byteLength > maximum ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0)
      return code !== undefined && (code <= 0x1f || code === 0x7f)
    })
  ) {
    throw new TypeError(`${path} must be bounded text without control characters`)
  }
  return value
}

export function parsePositivePresentationInteger(
  value: unknown,
  path: string,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value as number
}

export function parseSortedPresentationStrings(
  value: unknown,
  path: string,
  maximum: number,
  parse: (entry: unknown, path: string) => string = parsePresentationText
): readonly string[] {
  const entries = parseBoundedManifestArray(value, path, maximum).map((entry, index) =>
    parse(entry, `${path}[${index}]`)
  )
  if (
    new Set(entries).size !== entries.length ||
    [...entries].sort().join('\0') !== entries.join('\0')
  ) {
    throw new TypeError(`${path} must be sorted and unique`)
  }
  return Object.freeze(entries)
}
