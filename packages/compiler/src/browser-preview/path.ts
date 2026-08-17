const SAFE_PATH_SEGMENT = /^[A-Za-z0-9@._+-]+$/

export function extension(path: string): string {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  return dot > slash ? path.slice(dot).toLowerCase() : ''
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function hasForbiddenASCII(value: string, includeSpace = false): boolean {
  const maximum = includeSpace ? 0x20 : 0x1f
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= maximum || code === 0x7f) return true
  }
  return false
}

export function normalizeRelativePath(path: string): string | null {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('?') ||
    path.includes('#') ||
    path.includes(':') ||
    hasForbiddenASCII(path)
  ) {
    return null
  }
  const output: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (output.length === 0) return null
      output.pop()
      continue
    }
    if (!SAFE_PATH_SEGMENT.test(segment)) return null
    output.push(segment)
  }
  return output.length > 0 ? output.join('/') : null
}

export function joinRelativePath(base: string, value: string): string | null {
  return normalizeRelativePath(base ? `${base}/${value}` : value)
}

export function safeAssetReference(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('%') ||
    hasForbiddenASCII(value, true)
  ) {
    return false
  }
  return value
    .split('/')
    .every(
      (segment, index) =>
        segment === '..' || (segment === '.' && index === 0) || SAFE_PATH_SEGMENT.test(segment)
    )
}
