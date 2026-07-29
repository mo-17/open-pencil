import { link, mkdir, readdir, rm, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

function alreadyExists(path: string, cause: unknown): Error {
  return new Error(`Output already exists: ${path}`, { cause })
}

function compareEntryNames(left: { name: string }, right: { name: string }): number {
  if (left.name < right.name) return -1
  if (left.name > right.name) return 1
  return 0
}

/**
 * Publish a complete staged file without ever replacing an existing path.
 *
 * A hard link gives same-filesystem callers an atomic, fully-written publish.
 * Callers deliberately stage beside the destination. If that filesystem cannot
 * create hard links, fail closed instead of exposing a partially copied file.
 */
export async function publishFileNoClobber(stagedFile: string, output: string): Promise<void> {
  try {
    await link(stagedFile, output)
  } catch (error) {
    const code = errorCode(error)
    if (code === 'EEXIST') throw alreadyExists(output, error)
    throw new Error(
      `Atomic Motion export publication is unavailable for this filesystem: ${output}`,
      { cause: error }
    )
  }
}

/**
 * Claim a sibling directory exclusively, then publish every staged regular file
 * through a no-replace hard link. This never replaces an empty directory created
 * in the old lstat-to-rename race window. If the filesystem cannot provide the
 * required same-filesystem link semantics, publication fails closed.
 */
export async function publishDirectoryNoClobber(
  stagedDirectory: string,
  output: string
): Promise<void> {
  const entries = (await readdir(stagedDirectory, { withFileTypes: true })).sort(compareEntryNames)
  if (entries.length === 0 || entries.some((entry) => !entry.isFile())) {
    throw new Error('Motion export staging directories must contain only regular files')
  }
  try {
    await mkdir(output)
  } catch (error) {
    if (errorCode(error) === 'EEXIST') throw alreadyExists(output, error)
    throw error
  }

  const published: string[] = []
  try {
    for (const entry of entries) {
      const destination = join(output, entry.name)
      try {
        await link(join(stagedDirectory, entry.name), destination)
      } catch (error) {
        if (errorCode(error) === 'EEXIST') throw alreadyExists(destination, error)
        throw new Error(
          `Atomic Motion sequence publication is unavailable for this filesystem: ${output}`,
          { cause: error }
        )
      }
      published.push(destination)
    }
  } catch (error) {
    const cleanupErrors: unknown[] = []
    for (const destination of published.reverse()) {
      try {
        await unlink(destination)
      } catch (cleanupError) {
        if (errorCode(cleanupError) !== 'ENOENT') cleanupErrors.push(cleanupError)
      }
    }
    try {
      await rmdir(output)
    } catch (cleanupError) {
      if (errorCode(cleanupError) !== 'ENOENT' && errorCode(cleanupError) !== 'ENOTEMPTY') {
        cleanupErrors.push(cleanupError)
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], 'Motion sequence publication failed')
    }
    throw error
  }

  try {
    await rm(stagedDirectory, { recursive: true })
  } catch (error) {
    console.warn(`Could not remove published Motion staging directory: ${stagedDirectory}`, error)
  }
}
