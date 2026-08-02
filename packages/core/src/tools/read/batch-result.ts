export interface BatchReadResult<T> {
  results: T[]
  missing: string[]
}
