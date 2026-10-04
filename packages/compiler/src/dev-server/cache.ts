import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

interface CacheServer {
  listen(): Promise<unknown>
  close(): Promise<void>
  httpServer?: {
    closeIdleConnections?(): void
    closeAllConnections?(): void
  } | null
}

/** A running optimizer owns its cache until close has drained its pending work. */
export async function startPreviewCacheServer<T extends CacheServer>(
  scanRoot: string,
  create: (ownedDirectory: string) => Promise<T>,
  dispose?: () => void,
  allocationMode: 'cache' | 'vfs' = 'cache'
): Promise<{ server: T; close: () => Promise<void> }> {
  // A preview owns its complete VFS directory; standalone cache consumers keep
  // the established allocation below .vite. Never remove either shared parent.
  const allocationRoot = allocationMode === 'vfs' ? scanRoot : join(scanRoot, '.vite')
  let ownedDirectory: string | undefined
  let server: T | undefined
  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    closePromise ??= Promise.resolve().then(async () => {
      const errors: unknown[] = []
      let drained = server === undefined
      try {
        dispose?.()
      } catch (error) {
        errors.push(error)
      }
      if (server) {
        let closed: Promise<void> | undefined
        try {
          closed = server.close()
        } catch (error) {
          errors.push(error)
        }
        for (const method of ['closeIdleConnections', 'closeAllConnections'] as const) {
          try {
            server.httpServer?.[method]?.()
          } catch (error) {
            errors.push(error)
          }
        }
        if (closed) {
          try {
            await closed
            drained = true
          } catch (error) {
            errors.push(error)
          }
        }
      }
      if (ownedDirectory && drained) {
        try {
          await rm(ownedDirectory, { recursive: true, force: true })
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'Preview cache cleanup failed')
      return undefined
    })
    return closePromise
  }
  try {
    await mkdir(allocationRoot, { recursive: true })
    ownedDirectory = await mkdtemp(join(allocationRoot, 'server-'))
    server = await create(ownedDirectory)
    await server.listen()
    return { server, close }
  } catch (error) {
    try {
      await close()
    } catch {
      // Preserve the startup failure even if its partial-server cleanup fails.
      console.warn('[preview-dev-server] Startup cleanup failed')
    }
    throw error
  }
}
