export function isCLIOutputRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asCLIOutputError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

export function boundedCLIOutputString(
  value: unknown,
  options: {
    readonly label: string
    readonly maximum: number
    readonly subject: string
    readonly allowEmpty?: boolean
    readonly measureBytes?: boolean
  }
): string {
  let length = Number.POSITIVE_INFINITY
  if (typeof value === 'string') {
    length = options.measureBytes ? new TextEncoder().encode(value).byteLength : value.length
  }
  if (
    typeof value !== 'string' ||
    (!options.allowEmpty && value.length === 0) ||
    length > options.maximum
  ) {
    throw new Error(`${options.subject} has an invalid ${options.label}.`)
  }
  return value
}
