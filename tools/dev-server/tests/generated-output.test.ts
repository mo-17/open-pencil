import { expect, spyOn, test } from 'bun:test'
import { once } from 'node:events'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { createDevServerOptions } from '#vite-config/server'
import { createServer, type ViteDevServer } from 'vite'

const WATCH_TIMEOUT_MS = 5000
const POLL_INTERVAL_MS = 20

async function waitUntil(check: () => boolean | Promise<boolean>, description: string) {
  const deadline = Date.now() + WATCH_TIMEOUT_MS
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(description)
    await Bun.sleep(POLL_INTERVAL_MS)
  }
}

async function writeFixture(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

async function verifyOutputIsolation(server: ViteDevServer, root: string) {
  const source = join(root, 'src', 'output', 'entry.ts')
  const generatedConfig = join(root, 'output', 'gallery', 'sources', 'tsconfig.json')
  const siblingConfig = join(root, 'output-source', 'tsconfig.json')
  const transformed = await server.transformRequest('/src/output/entry.ts')
  expect(transformed?.code).toContain('version = 1')
  await waitUntil(
    () => server.watcher.getWatched()[dirname(source)]?.includes('entry.ts') ?? false,
    'Source in an output-named directory must still be watched'
  )
  const send = spyOn(server.environments.client.hot, 'send')
  try {
    await writeFile(generatedConfig, '{"compilerOptions":{"strict":true}}\n')
    await writeFixture(join(root, 'output', 'new-project', 'tsconfig.json'), '{}\n')
    // Polling observes this fixture deterministically; allow several cycles for an unwanted event.
    await Bun.sleep(POLL_INTERVAL_MS * 10)
    expect(
      send.mock.calls.filter(
        ([payload]) => typeof payload === 'object' && payload.type === 'full-reload'
      )
    ).toEqual([])
    expect(await server.transformRequest('/src/output/entry.ts')).toBe(transformed)

    const changed = once(server.watcher, 'change', {
      signal: AbortSignal.timeout(WATCH_TIMEOUT_MS)
    })
    await writeFile(source, 'export const version = 2\n')
    expect((await changed)[0]).toBe(source)
    await waitUntil(
      async () =>
        (await server.transformRequest('/src/output/entry.ts'))?.code.includes('version = 2') ??
        false,
      'Normal source changes must invalidate the cached transform'
    )

    send.mockClear()
    await writeFile(siblingConfig, '{"compilerOptions":{"strict":true}}\n')
    await waitUntil(
      () =>
        send.mock.calls.some(
          ([payload]) =>
            typeof payload === 'object' && payload.type === 'full-reload' && payload.path === '*'
        ),
      'An ordinary tsconfig outside the root output directory must still reload the app'
    )
  } finally {
    send.mockRestore()
  }
}

test('generated output tsconfigs do not reload the editor or invalidate source transforms', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'open-pencil-output-watch-')))
  let server: ViteDevServer | undefined
  try {
    // The active checkout may itself be named output and live inside .worktrees.
    const root = join(directory, '.worktrees', 'output')
    await writeFixture(join(root, 'src', 'output', 'entry.ts'), 'export const version = 1\n')
    await writeFixture(join(root, 'output', 'gallery', 'sources', 'tsconfig.json'), '{}\n')
    await writeFixture(join(root, 'output-source', 'tsconfig.json'), '{}\n')
    const options = createDevServerOptions(undefined, root)
    server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      server: {
        ...options,
        middlewareMode: true,
        watch: { ...options.watch, usePolling: true, interval: POLL_INTERVAL_MS }
      },
      optimizeDeps: { noDiscovery: true }
    })
    await verifyOutputIsolation(server, root)
  } finally {
    try {
      await server?.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
