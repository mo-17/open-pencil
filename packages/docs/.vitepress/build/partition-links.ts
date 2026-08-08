import { existsSync } from 'node:fs'
import { join, posix } from 'node:path'

interface CrossPartitionLinkFilterOptions {
  docsRoot: string
  partition: string
  localePrefixes: readonly string[]
  enabledPartitions?: readonly string[]
  fileExists?: (path: string) => boolean
}

function internalLinkPath(link: string): string | undefined {
  const rawPath = link.split(/[?#]/, 1)[0]
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) return undefined

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(rawPath)
  } catch {
    return undefined
  }
  if (decodedPath.split('/').includes('..')) return undefined
  return posix.normalize(decodedPath)
}

function markdownCandidates(docsRoot: string, pathname: string): string[] {
  const relativePath = pathname.replace(/^\/+|\/+$/g, '')
  let documentPath = relativePath || 'index'
  if (documentPath.endsWith('.html')) documentPath = documentPath.slice(0, -'.html'.length)

  if (documentPath.endsWith('.md')) return [join(docsRoot, documentPath)]
  return [join(docsRoot, `${documentPath}.md`), join(docsRoot, documentPath, 'index.md')]
}

export function createCrossPartitionLinkFilter({
  docsRoot,
  partition,
  localePrefixes,
  enabledPartitions = ['en', ...localePrefixes],
  fileExists = existsSync
}: CrossPartitionLinkFilterOptions): (link: string, source: string) => boolean {
  const localizedPrefixes = new Set(localePrefixes)
  const enabled = new Set(enabledPartitions)
  return (link) => {
    const pathname = internalLinkPath(link)
    if (!pathname) return false

    const firstSegment = pathname.split('/').find(Boolean)
    const targetPartition =
      firstSegment && localizedPrefixes.has(firstSegment) ? firstSegment : 'en'
    if (targetPartition === partition || !enabled.has(targetPartition)) return false

    return markdownCandidates(docsRoot, pathname).some(fileExists)
  }
}
