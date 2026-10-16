export function hasOnlyBackendArrayIndexes(value: readonly unknown[], length: number): boolean {
  return Reflect.ownKeys(value).every((key) => {
    if (key === 'length') return true
    const index = typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : -1
    return Number.isSafeInteger(index) && index >= 0 && index < length
  })
}
