import { describe, expect, test } from 'bun:test'

import {
  SHARED_MOTION_PRESET_MANIFEST_FORMAT,
  SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION,
  USER_MOTION_PRESET_FORMAT,
  USER_MOTION_PRESET_LIMITS,
  USER_MOTION_PRESET_SCHEMA_VERSION,
  createMotionPreset,
  parseUserMotionPresetLibraryJSON
} from '@open-pencil/scene-graph'

import {
  MOTION_PRESET_LIBRARY_FILE_NAME,
  readBrowserMotionPresetLibraryFile
} from '@/app/motion-presets/files'
import {
  MOTION_PRESET_LIBRARY_STORAGE_KEY,
  type MotionPresetKeyValueStorage
} from '@/app/motion-presets/storage'
import {
  MotionPresetLibraryStoreError,
  createMotionPresetLibraryStore
} from '@/app/motion-presets/store'
import { builtinMotionPresetKey, userMotionPresetKey } from '@/app/motion-presets/types'

class MemoryStorage implements MotionPresetKeyValueStorage {
  readonly values = new Map<string, string>()
  writes = 0

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes += 1
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function storedValue(storage: MemoryStorage): string {
  const value = storage.getItem(MOTION_PRESET_LIBRARY_STORAGE_KEY)
  if (!value) throw new Error('Expected a stored motion preset library')
  return value
}

describe('app motion preset library store', () => {
  test('reads bounded browser JSON files and exposes a stable export name', async () => {
    expect(MOTION_PRESET_LIBRARY_FILE_NAME).toBe('openpencil-motion-presets.json')
    const file = new File(['{"ok":true}'], 'presets.json', { type: 'application/json' })
    expect(await readBrowserMotionPresetLibraryFile(file)).toBe('{"ok":true}')

    const oversized = new File(
      [new Uint8Array(USER_MOTION_PRESET_LIMITS.maxJsonBytes + 1)],
      'oversized.json'
    )
    await expect(readBrowserMotionPresetLibraryFile(oversized)).rejects.toThrow(/may not exceed/)
  })

  test('persists Chinese user presets and favorites through injected storage', () => {
    const storage = new MemoryStorage()
    const store = createMotionPresetLibraryStore({ storage })

    const created = store.createPreset({
      id: 'user-travel-card',
      name: '旅行卡片浮现',
      description: '用于中文旅行卡片',
      category: 'entrance',
      motion: createMotionPreset('slide-up')
    })
    store.toggleFavorite(userMotionPresetKey(created.id))
    store.toggleFavorite(builtinMotionPresetKey('fade-in'))

    expect(JSON.parse(storedValue(storage))).toMatchObject({
      format: 'openpencil-motion-preset-settings',
      schemaVersion: 2,
      favorites: [builtinMotionPresetKey('fade-in'), userMotionPresetKey(created.id)]
    })

    const restored = createMotionPresetLibraryStore({ storage }).snapshot()
    expect(restored.error).toBeNull()
    expect(restored.blocked).toBe(false)
    expect(restored.library.presets[0]).toMatchObject({
      id: 'user-travel-card',
      name: '旅行卡片浮现',
      description: '用于中文旅行卡片'
    })
    expect(restored.favorites).toEqual([
      builtinMotionPresetKey('fade-in'),
      userMotionPresetKey('user-travel-card')
    ])
  })

  test('rename is normalized and delete removes the matching favorite', () => {
    const storage = new MemoryStorage()
    const store = createMotionPresetLibraryStore({ storage })
    store.createPreset({
      id: 'user-one',
      name: 'First',
      motion: createMotionPreset('fade-in')
    })
    store.createPreset({
      id: 'user-two',
      name: 'Second',
      motion: createMotionPreset('float')
    })
    store.toggleFavorite(userMotionPresetKey('user-one'))

    expect(store.renamePreset('user-one', '  中文名称  ').name).toBe('中文名称')
    expect(() => store.renamePreset('user-one', 'SECOND')).toThrow(MotionPresetLibraryStoreError)
    store.deletePreset('user-one')

    expect(store.snapshot().library.presets.map((preset) => preset.id)).toEqual(['user-two'])
    expect(store.snapshot().favorites).toEqual([])
  })

  test('edits personal metadata atomically and updates the stored snapshot from current motion', () => {
    const store = createMotionPresetLibraryStore({ storage: null })
    store.createPreset({
      id: 'user-editable',
      name: 'Editable',
      description: 'Before',
      category: 'custom',
      motion: createMotionPreset('fade-in')
    })

    const edited = store.editPreset('user-editable', {
      name: '  Edited preset  ',
      description: 'After',
      category: 'emphasis'
    })
    expect(edited).toMatchObject({
      name: 'Edited preset',
      description: 'After',
      category: 'emphasis',
      revision: 2
    })

    const current = createMotionPreset('float')
    current.tracks[0].timing.durationMs = 777
    const updated = store.updatePreset('user-editable', { motion: current })
    expect(updated).toMatchObject({ revision: 3, category: 'emphasis' })
    expect(store.instantiatePreset('user-editable')).toMatchObject({
      preset: { id: 'user-editable', version: 3 },
      tracks: [{ timing: { durationMs: 777 } }]
    })
  })

  test('corrupt and future data are preserved without an automatic overwrite', () => {
    for (const raw of [
      '{broken',
      JSON.stringify({
        format: 'openpencil-motion-presets',
        schemaVersion: 99,
        presets: [],
        favorites: []
      })
    ]) {
      const storage = new MemoryStorage()
      storage.values.set(MOTION_PRESET_LIBRARY_STORAGE_KEY, raw)
      const store = createMotionPresetLibraryStore({ storage })

      expect(store.snapshot().blocked).toBe(true)
      expect(store.snapshot().error?.message.length).toBeGreaterThan(0)
      expect(storage.writes).toBe(0)
      expect(storedValue(storage)).toBe(raw)
      expect(() =>
        store.createPreset({ name: 'Blocked', motion: createMotionPreset('fade-in') })
      ).toThrow(/preserved/)
      expect(storedValue(storage)).toBe(raw)
    }
  })

  test('exports deterministic JSON and imports with explicit merge policy', () => {
    const source = createMotionPresetLibraryStore({ storage: null })
    source.createPreset({
      id: 'user-shared',
      name: '共享预设',
      category: 'emphasis',
      motion: createMotionPreset('pulse')
    })
    source.toggleFavorite(userMotionPresetKey('user-shared'))
    source.toggleFavorite(builtinMotionPresetKey('slide-up'))

    const firstExport = source.exportJSON()
    expect(source.exportJSON()).toBe(firstExport)
    expect(parseUserMotionPresetLibraryJSON(firstExport).presets[0]?.name).toBe('共享预设')
    expect(JSON.parse(firstExport)).not.toHaveProperty('favorites')

    const storage = new MemoryStorage()
    const target = createMotionPresetLibraryStore({ storage })
    target.importJSON(firstExport, 'error')
    expect(target.exportJSON()).toBe(firstExport)
    expect(target.snapshot().favorites).toEqual([])
    expect(target.instantiatePreset('user-shared').preset).toEqual({
      id: 'user-shared',
      version: 1,
      parameters: {}
    })

    expect(() => target.importJSON(firstExport, 'error')).toThrow(/conflict/i)
    const beforeSkip = target.exportJSON()
    target.importJSON(firstExport, 'skip')
    expect(target.exportJSON()).toBe(beforeSkip)
  })

  test('migrates the legacy app envelope while keeping portable exports interoperable', () => {
    const portable = {
      format: USER_MOTION_PRESET_FORMAT,
      schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
      presets: []
    }
    const storage = new MemoryStorage()
    storage.values.set(
      MOTION_PRESET_LIBRARY_STORAGE_KEY,
      JSON.stringify({ ...portable, favorites: [builtinMotionPresetKey('slide-up')] })
    )

    const store = createMotionPresetLibraryStore({ storage })
    expect(store.snapshot().blocked).toBe(false)
    expect(store.snapshot().favorites).toEqual([builtinMotionPresetKey('slide-up')])
    expect(parseUserMotionPresetLibraryJSON(store.exportJSON())).toEqual(portable)

    store.toggleFavorite(builtinMotionPresetKey('fade-in'))
    expect(JSON.parse(storedValue(storage)).format).toBe('openpencil-motion-preset-settings')
  })

  test('migrates the v1 local envelope without losing personal presets or favorites', () => {
    const storage = new MemoryStorage()
    const source = createMotionPresetLibraryStore({ storage: null })
    source.createPreset({
      id: 'user-local-v1',
      name: '旧本地预设',
      motion: createMotionPreset('fade-in')
    })
    storage.values.set(
      MOTION_PRESET_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        format: 'openpencil-motion-preset-settings',
        schemaVersion: 1,
        library: JSON.parse(source.exportJSON()),
        favorites: [userMotionPresetKey('user-local-v1')]
      })
    )

    const store = createMotionPresetLibraryStore({ storage })
    expect(store.snapshot()).toMatchObject({
      library: { presets: [{ id: 'user-local-v1', name: '旧本地预设' }] },
      favorites: [userMotionPresetKey('user-local-v1')],
      sharedLibraries: []
    })

    store.renamePreset('user-local-v1', '已迁移')
    expect(JSON.parse(storedValue(storage))).toMatchObject({
      schemaVersion: 2,
      sharedLibraries: []
    })
  })

  test('persists shared libraries, checks updates without replacing, and accepts explicitly', () => {
    const storage = new MemoryStorage()
    const store = createMotionPresetLibraryStore({ storage })
    const sharedManifest = (sourceVersion: string, durationMs: number) => ({
      format: SHARED_MOTION_PRESET_MANIFEST_FORMAT,
      schemaVersion: SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION,
      publisher: { id: 'design-team', name: '设计团队' },
      library: { id: 'travel-motion', name: '旅行产品动效' },
      source: { kind: 'file' as const, ref: './team/travel-motion.json' },
      readonly: true,
      sourceVersion,
      presets: [
        {
          id: 'user-shared-enter',
          revision: sourceVersion === 'v1' ? 1 : 2,
          name: '共享进入',
          category: 'entrance',
          motion: {
            version: 1 as const,
            tracks: [
              {
                id: 'fade',
                trigger: 'mount' as const,
                keyframes: [
                  { offset: 0, opacity: 0 },
                  { offset: 1, opacity: 1 }
                ],
                timing: { durationMs }
              }
            ]
          }
        }
      ]
    })

    const acceptedV1 = store.acceptSharedLibrary(sharedManifest('v1', 200))
    expect(acceptedV1).toMatchObject({
      manifest: {
        readonly: true,
        publisher: { id: 'design-team' },
        library: { id: 'travel-motion' },
        sourceVersion: 'v1'
      },
      sourceVersion: 'v1',
      updateAvailable: false
    })

    expect(store.checkSharedLibrary(sharedManifest('v2', 480))).toMatchObject({
      status: 'update-available',
      acceptedVersion: 'v1',
      sourceVersion: 'v2'
    })
    let snapshot = store.snapshot()
    expect(snapshot.sharedLibraries[0]).toMatchObject({
      manifest: {
        sourceVersion: 'v1',
        presets: [{ motion: { tracks: [{ timing: { durationMs: 200 } }] } }]
      },
      sourceVersion: 'v2',
      updateAvailable: true
    })

    const beforeAccept = store.instantiateSharedPreset('travel-motion', 'user-shared-enter')
    expect(beforeAccept.tracks[0].timing.durationMs).toBe(200)
    expect(beforeAccept.preset?.parameters).toEqual({
      publisherId: 'design-team',
      libraryId: 'travel-motion',
      sourceVersion: 'v1'
    })

    store.acceptSharedLibrary(sharedManifest('v2', 480))
    snapshot = createMotionPresetLibraryStore({ storage }).snapshot()
    expect(snapshot.sharedLibraries[0]).toMatchObject({
      manifest: {
        sourceVersion: 'v2',
        presets: [{ motion: { tracks: [{ timing: { durationMs: 480 } }] } }]
      },
      sourceVersion: 'v2',
      updateAvailable: false
    })

    const restored = createMotionPresetLibraryStore({ storage })
    const applied = restored.instantiateSharedPreset('travel-motion', 'user-shared-enter')
    expect(applied.tracks[0].timing.durationMs).toBe(480)
    applied.tracks[0].keyframes[0].opacity = 0.75
    expect(
      restored.snapshot().sharedLibraries[0].manifest.presets[0].motion.tracks[0].keyframes[0]
        .opacity
    ).toBe(0)
    expect(JSON.parse(restored.exportJSON())).not.toHaveProperty('sharedLibraries')
  })

  test('bounds and strictly validates local and imported JSON before accepting it', () => {
    const oversized = ' '.repeat(USER_MOTION_PRESET_LIMITS.maxJsonBytes + 16_385)
    const storage = new MemoryStorage()
    storage.values.set(MOTION_PRESET_LIBRARY_STORAGE_KEY, oversized)
    const blocked = createMotionPresetLibraryStore({ storage })
    expect(blocked.snapshot().blocked).toBe(true)
    expect(blocked.snapshot().error?.message).toMatch(/may not exceed/)

    const store = createMotionPresetLibraryStore({ storage: null })
    expect(() => store.importJSON(oversized)).toThrow(/may not exceed/)
    expect(() =>
      store.importJSON(
        JSON.stringify({
          format: USER_MOTION_PRESET_FORMAT,
          schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
          presets: [],
          unexpected: true
        })
      )
    ).toThrow(/Unknown motion preset library field/)
    expect(() =>
      store.importJSON(
        JSON.stringify({
          format: USER_MOTION_PRESET_FORMAT,
          schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
          presets: [],
          favorites: Array.from({ length: 109 }, () => builtinMotionPresetKey('fade-in'))
        })
      )
    ).toThrow(/at most 108/)
    expect(() =>
      store.importJSON(
        JSON.stringify({
          format: USER_MOTION_PRESET_FORMAT,
          schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
          presets: [],
          favorites: [`builtin:${'x'.repeat(100)}`]
        })
      )
    ).toThrow(/too long/)
  })

  test('failed writes do not mutate the in-memory snapshot', () => {
    const storage: MotionPresetKeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      }
    }
    const store = createMotionPresetLibraryStore({ storage })

    expect(() =>
      store.createPreset({
        id: 'user-write-failure',
        name: 'Will fail',
        motion: createMotionPreset('fade-in')
      })
    ).toThrow(/save/)
    expect(store.snapshot().library.presets).toEqual([])
    expect(store.snapshot().error?.code).toBe('write-failed')
  })

  test('snapshots and returned presets cannot mutate the stored library by reference', () => {
    const store = createMotionPresetLibraryStore({ storage: null })
    const created = store.createPreset({
      id: 'user-isolated',
      name: 'Isolated',
      motion: createMotionPreset('slide-up')
    })
    created.name = 'Mutated return value'
    created.motion.tracks[0].timing.durationMs = 999

    const snapshot = store.snapshot()
    snapshot.library.presets[0].name = 'Mutated snapshot'
    snapshot.library.presets[0].motion.tracks[0].timing.durationMs = 888

    expect(store.snapshot().library.presets[0]).toMatchObject({
      name: 'Isolated',
      motion: { tracks: [{ timing: { durationMs: 500 } }] }
    })
  })
})
