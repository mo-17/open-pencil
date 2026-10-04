import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { applicationSessionRuntimeSource } from '#compiler/adapters/application-session/runtime'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { parsePreviewPageSessionSnapshot } from '@/app/lowcode/preview-pane/iframe/messages'

import { applicationSessionFixture } from '#tests/helpers/compiler/application-session/fixture'

type Key = { pageId: string; pathname: string; search: string }
type Snapshot = {
  version: 1
  entries: Array<Key & { values: Record<string, unknown>; scroll: Vector }>
}
interface Runtime {
  writeApplicationState(key: Key, name: string, value: unknown): void
  readApplicationState<T>(key: Key, name: string, initial: T): T
  getSnapshot(): Snapshot
  restore(snapshot: unknown): void
  subscribe(listener: (snapshot: Snapshot) => void): () => void
  observeApplicationRestore(listener: () => void): () => void
}
async function withRuntime(run: (runtime: Runtime, pageId: string) => void | Promise<void>) {
  const { graph, home } = applicationSessionFixture()
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-application-session-'))
  try {
    const file = join(directory, 'runtime.ts')
    const ir = { ...collectTree(graph, home.id), applicationStateRetention: 'preserve' as const }
    await writeFile(file, applicationSessionRuntimeSource([ir]))
    await run((await import(pathToFileURL(file).href)) as Runtime, home.id)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('isolates page identity, concrete params and exact queries and returns detached snapshots', async () => {
  await withRuntime((runtime, pageId) => {
    const key = { pageId, pathname: '/products/42', search: '?filter=one' }
    runtime.writeApplicationState(key, 'filter', 'first')
    runtime.writeApplicationState(key, 'page', 2)
    expect(runtime.readApplicationState(key, 'filter', '')).toBe('first')
    expect(runtime.readApplicationState({ ...key, pathname: '/products/43' }, 'filter', '')).toBe(
      ''
    )
    expect(runtime.readApplicationState({ ...key, search: '?filter=two' }, 'filter', '')).toBe('')
    expect(runtime.readApplicationState({ ...key, pageId: 'different' }, 'filter', '')).toBe('')
    const snapshot = runtime.getSnapshot()
    snapshot.entries[0].values.filter = 'mutated snapshot'
    expect(runtime.readApplicationState(key, 'filter', '')).toBe('first')
  })
})

test('rejects File, nonportable values and accessors without reading them; excludes computed and undeclared values', async () => {
  await withRuntime((runtime, pageId) => {
    const key = { pageId, pathname: '/home', search: '' }
    let reads = 0
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        reads++
        return 'secret'
      }
    })
    for (const value of [
      new File(['sensitive'], 'draft.txt'),
      new Date(),
      accessor,
      Number.NaN,
      Infinity,
      undefined,
      { unsupported: undefined }
    ])
      runtime.writeApplicationState(key, 'filter', value)
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    for (const value of [
      { file: new File(['draft'], 'draft.txt') },
      accessor,
      cycle,
      { unsupported: undefined },
      { stringify: () => 'secret' }
    ])
      runtime.writeApplicationState(key, 'draftData', value)
    const sparse: unknown[] = []
    sparse.length = 3
    runtime.writeApplicationState(key, 'selectedItems', sparse)
    runtime.writeApplicationState(key, 'page', Number.NaN)
    runtime.writeApplicationState(key, 'page', Infinity)
    runtime.writeApplicationState(key, 'summary', 'computed')
    runtime.writeApplicationState(key, 'backendRows', [{ secret: 'not declared' }])
    runtime.writeApplicationState(key, 'page', 'wrong type')
    expect(reads).toBe(0)
    expect(runtime.getSnapshot().entries[0].values).toEqual({})
    expect(runtime.readApplicationState(key, 'page', 1)).toBe(1)
  })
})

test('revalidates restored page declarations and notifies current bindings; malformed snapshots do not clear state', async () => {
  await withRuntime((runtime, pageId) => {
    const key = { pageId, pathname: '/home', search: '' }
    const snapshot = {
      version: 1,
      entries: [
        {
          ...key,
          values: { filter: 'restored', page: 'wrong', summary: 'computed', secret: 'unbound' },
          scroll: { x: 0, y: 350 }
        },
        { ...key, pageId: 'missing', values: { filter: 'wrong page' }, scroll: { x: 0, y: 0 } }
      ]
    }
    let notifications = 0
    const remove = runtime.observeApplicationRestore(() => {
      notifications++
      expect(runtime.readApplicationState(key, 'filter', '')).toBe('restored')
    })
    runtime.restore(snapshot)
    expect(notifications).toBe(1)
    expect(runtime.getSnapshot().entries).toEqual([
      { ...key, values: { filter: 'restored' }, scroll: { x: 0, y: 350 } }
    ])
    snapshot.entries[0].values.filter = 'changed inbound'
    expect(runtime.readApplicationState(key, 'filter', '')).toBe('restored')
    runtime.restore({ ...snapshot, unknown: true })
    expect(runtime.readApplicationState(key, 'filter', '')).toBe('restored')
    remove()
  })
})

test('evicts oldest sessions under entry and UTF8 snapshot budgets; active sessions remain bounded', async () => {
  await withRuntime((runtime, pageId) => {
    for (let index = 0; index < 65; index++)
      runtime.writeApplicationState(
        { pageId, pathname: `/item/${index}`, search: '' },
        'filter',
        `value ${index}`
      )
    expect(runtime.getSnapshot().entries).toHaveLength(64)
    expect(
      runtime.readApplicationState({ pageId, pathname: '/item/0', search: '' }, 'filter', '')
    ).toBe('')
    for (let index = 65; index < 80; index++)
      runtime.writeApplicationState(
        { pageId, pathname: `/item/${index}`, search: '' },
        'filter',
        '汉'.repeat(20000)
      )
    expect(
      new TextEncoder().encode(JSON.stringify(runtime.getSnapshot())).byteLength
    ).toBeLessThanOrEqual(256 * 1024)
    expect(runtime.getSnapshot().entries.at(-1)?.pathname).toBe('/item/79')
  })
})

test('coalesces updates and releases subscriptions', async () => {
  await withRuntime(async (runtime, pageId) => {
    let emitted = 0
    const remove = runtime.subscribe(() => {
      emitted++
    })
    const key = { pageId, pathname: '/home', search: '' }
    runtime.writeApplicationState(key, 'page', 2)
    runtime.writeApplicationState(key, 'page', 3)
    await Promise.resolve()
    expect(emitted).toBe(1)
    remove()
    runtime.writeApplicationState(key, 'page', 4)
    await Promise.resolve()
    expect(emitted).toBe(1)
  })
})

test('evicts old query instances before exceeding the complete 4096-value wire budget', async () => {
  await withRuntime(async (runtime, pageId) => {
    const emitted: Snapshot[] = []
    const remove = runtime.subscribe((snapshot) => {
      emitted.push(snapshot)
    })
    for (let index = 0; index < 5; index++) {
      const key = { pageId, pathname: '/home', search: `?category=${index}` }
      runtime.writeApplicationState(
        key,
        'selectedItems',
        Array.from({ length: 1000 }, (_, item) => item)
      )
      await Promise.resolve()
      expect(parsePreviewPageSessionSnapshot(runtime.getSnapshot())).not.toBeNull()
    }
    expect(runtime.getSnapshot().entries).toHaveLength(4)
    expect(runtime.getSnapshot().entries[0].search).toBe('?category=1')
    expect(runtime.getSnapshot().entries.at(-1)?.search).toBe('?category=4')
    expect(
      runtime.readApplicationState(
        { pageId, pathname: '/home', search: '?category=4' },
        'selectedItems',
        []
      )
    ).toHaveLength(1000)
    expect(emitted).toHaveLength(5)
    expect(emitted.every((snapshot) => parsePreviewPageSessionSnapshot(snapshot) !== null)).toBe(
      true
    )
    remove()
  })
})

test('accepts the exact complete value limit and drops only an oversized active field', async () => {
  await withRuntime((runtime, pageId) => {
    const previous = { pageId, pathname: '/home', search: '?previous=1' }
    const active = { pageId, pathname: '/home', search: '?active=1' }
    runtime.writeApplicationState(previous, 'filter', 'previous session')
    runtime.writeApplicationState(
      active,
      'selectedItems',
      Array.from({ length: 4084 }, () => 0)
    )
    const accepted = runtime.getSnapshot()
    expect(accepted.entries).toHaveLength(1)
    expect(accepted.entries[0].search).toBe('?active=1')
    expect(runtime.readApplicationState(active, 'selectedItems', [])).toHaveLength(4084)
    expect(parsePreviewPageSessionSnapshot(accepted)).not.toBeNull()
    runtime.writeApplicationState(
      active,
      'selectedItems',
      Array.from({ length: 4085 }, () => 0)
    )
    expect(runtime.readApplicationState(active, 'selectedItems', [])).toEqual([])
    expect(runtime.getSnapshot().entries[0].search).toBe('?active=1')
    expect(parsePreviewPageSessionSnapshot(runtime.getSnapshot())).not.toBeNull()
    runtime.writeApplicationState(previous, 'filter', 'retained previous session')
    runtime.writeApplicationState(
      active,
      'selectedItems',
      Array.from({ length: 4085 }, () => 0)
    )
    expect(runtime.readApplicationState(previous, 'filter', '')).toBe('retained previous session')
    expect(parsePreviewPageSessionSnapshot(runtime.getSnapshot())).not.toBeNull()
  })
})

test('uses the conservative UTF16 estimate and protocol overhead in addition to real UTF8 bytes', async () => {
  await withRuntime((runtime, pageId) => {
    const text = 'a'.repeat(60000)
    for (let index = 0; index < 4; index++)
      runtime.writeApplicationState(
        { pageId, pathname: '/home', search: `?category=${index}` },
        'filter',
        text
      )
    const snapshot = runtime.getSnapshot()
    expect(snapshot.entries).toHaveLength(2)
    expect(snapshot.entries.at(-1)?.search).toBe('?category=3')
    expect(parsePreviewPageSessionSnapshot(snapshot)).not.toBeNull()
    expect(
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength + 1024
    ).toBeLessThanOrEqual(256 * 1024)
    const active = { pageId, pathname: '/home', search: '?category=active' }
    runtime.writeApplicationState(active, 'draftData', {
      first: text,
      second: text,
      third: text,
      fourth: text
    })
    expect(runtime.readApplicationState(active, 'draftData', {})).toEqual({})
    expect(parsePreviewPageSessionSnapshot(runtime.getSnapshot())).not.toBeNull()
  })
})

test('keeps nested data keys inside the parent protocol limit and rejects oversize restored envelopes', async () => {
  await withRuntime((runtime, pageId) => {
    const key = { pageId, pathname: '/home', search: '' }
    const accepted = { ['a'.repeat(128)]: 'bound value' }
    runtime.writeApplicationState(key, 'draftData', accepted)
    expect(runtime.readApplicationState(key, 'draftData', {})).toEqual(accepted)
    expect(parsePreviewPageSessionSnapshot(runtime.getSnapshot())).not.toBeNull()
    runtime.writeApplicationState(key, 'draftData', { ['a'.repeat(129)]: 'unportable key' })
    expect(runtime.readApplicationState(key, 'draftData', {})).toEqual({})
    runtime.writeApplicationState(key, 'filter', 'current value')
    runtime.restore({
      version: 1,
      entries: Array.from({ length: 5 }, (_, index) => ({
        ...key,
        search: `?category=${index}`,
        values: { selectedItems: Array.from({ length: 1000 }, () => 0) },
        scroll: { x: 0, y: 0 }
      }))
    })
    expect(runtime.readApplicationState(key, 'filter', '')).toBe('current value')
    runtime.restore({
      version: 1,
      entries: Array.from({ length: 4 }, (_, index) => ({
        ...key,
        search: `?category=${index}`,
        values: { filter: 'a'.repeat(60000) },
        scroll: { x: 0, y: 0 }
      }))
    })
    expect(runtime.readApplicationState(key, 'filter', '')).toBe('current value')
  })
})
