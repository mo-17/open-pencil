import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export interface RefreshableFileChecker {
  reload(): void
  updateFile(path: string, source: string): void
}

export interface RefreshingChecker<TChecker extends RefreshableFileChecker> {
  checker: TChecker
  refreshConfig(): void
  refreshFile(path: string): void
}

function sourceDigest(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

/** Keep a long-lived checker synchronized without rebuilding its full program for every loader. */
export function createRefreshingChecker<TChecker extends RefreshableFileChecker>(
  checker: TChecker,
  configPath: string,
  readSource: (path: string) => string = (path) => readFileSync(path, 'utf8')
): RefreshingChecker<TChecker> {
  let configDigest = sourceDigest(readSource(configPath))
  const fileDigests = new Map<string, string>()

  return {
    checker,
    refreshConfig() {
      const nextDigest = sourceDigest(readSource(configPath))
      if (nextDigest === configDigest) return

      checker.reload()
      configDigest = nextDigest
      fileDigests.clear()
    },
    refreshFile(path) {
      const source = readSource(path)
      const nextDigest = sourceDigest(source)
      const previousDigest = fileDigests.get(path)
      fileDigests.set(path, nextDigest)
      if (previousDigest !== undefined && previousDigest !== nextDigest) {
        checker.updateFile(path, source)
      }
    }
  }
}
