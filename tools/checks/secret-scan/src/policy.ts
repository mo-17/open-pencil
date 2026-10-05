import { isAbsolute, relative, resolve, sep } from 'node:path'

const MAX_FINDING_PATH_LENGTH = 4096
const MAX_FINDINGS = 10_000

export interface FindingPathProbe {
  exists(path: string): boolean
  isIgnored(path: string): boolean | null
  isTracked(path: string): boolean | null
}

export function parseGitleaksFindingPaths(report: string): string[] | null {
  let value: unknown
  try {
    value = JSON.parse(report)
  } catch {
    return null
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FINDINGS) return null

  const paths: string[] = []
  for (const finding of value) {
    if (typeof finding !== 'object' || finding === null || Array.isArray(finding)) return null
    const path = Reflect.get(finding, 'File')
    if (
      typeof path !== 'string' ||
      path.length === 0 ||
      path.length > MAX_FINDING_PATH_LENGTH ||
      path.includes('\0')
    ) {
      return null
    }
    paths.push(path)
  }
  return paths
}

export function repositoryRelativeFindingPath(
  repositoryRoot: string,
  findingPath: string
): string | null {
  const normalized = relative(repositoryRoot, resolve(repositoryRoot, findingPath))
  if (
    normalized.length === 0 ||
    normalized === '..' ||
    normalized.startsWith('..' + sep) ||
    isAbsolute(normalized)
  ) {
    return null
  }
  return normalized
}

export function isIgnoredUntrackedFinding(
  repositoryRoot: string,
  findingPath: string,
  probe: FindingPathProbe
): boolean {
  const path = repositoryRelativeFindingPath(repositoryRoot, findingPath)
  if (path === null || !probe.exists(path)) return false
  if (probe.isTracked(path) !== false) return false
  if (probe.isIgnored(path) !== true) return false

  // Close the local index race before treating the finding as non-committable.
  return probe.isTracked(path) === false
}
