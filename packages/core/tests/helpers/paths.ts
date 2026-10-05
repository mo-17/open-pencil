import { resolve } from 'node:path'

const repository = resolve(import.meta.dir, '../../../..')

/** Resolve source and immutable fixture paths for Core-owned test cases. */
export function repoPath(...segments: string[]): string {
  return resolve(repository, ...segments)
}
