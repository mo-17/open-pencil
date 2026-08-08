export const DEFAULT_DOCS_NODE_OPTIONS = '--max-old-space-size=4096'

const MAX_OLD_SPACE_SIZE = /(?:^|\s)--max(?:-|_)old(?:-|_)space(?:-|_)size(?:=|\s+)/

/** Preserve operator-supplied Node flags while ensuring the docs build has a usable heap. */
export function docsNodeOptions(configured: string | undefined): string {
  const normalized = configured?.trim()
  if (!normalized) return DEFAULT_DOCS_NODE_OPTIONS
  if (MAX_OLD_SPACE_SIZE.test(normalized)) return normalized
  return `${normalized} ${DEFAULT_DOCS_NODE_OPTIONS}`
}
