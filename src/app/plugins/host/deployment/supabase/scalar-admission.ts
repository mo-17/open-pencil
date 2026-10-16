export function createSupabaseScalarAdmission(invalid: () => never) {
  function boolean(value: unknown): boolean {
    if (typeof value !== 'boolean') return invalid()
    return value
  }
  function integer(value: unknown, minimum: number, maximum: number): number {
    if (
      !Number.isSafeInteger(value) ||
      Object.is(value, -0) ||
      (value as number) < minimum ||
      (value as number) > maximum
    )
      return invalid()
    return value as number
  }
  return { boolean, integer }
}

export function canonicalSupabaseTimestamp(value: unknown, invalid: () => never): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return invalid()
  const canonical = new Date(value).toISOString()
  if (canonical !== value) return invalid()
  return value
}
