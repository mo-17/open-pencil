import { describe, expect, test } from 'bun:test'

import {
  USER_MOTION_PRESET_FORMAT,
  mergeUserMotionPresetLibraries,
  parseUserMotionPresetLibrary,
  parseUserMotionPresetLibraryJSON,
  serializeUserMotionPresetLibrary,
  withMotionStagger,
  type MotionSpec,
  type UserMotionPresetCategory,
  type UserMotionPresetLibrary
} from '@open-pencil/scene-graph'

import { createEditorStore } from '@/app/editor/session'
import { applyMotionPreset } from '@/app/properties/motion'

const LIBRARY_SIZE = 100
const LIBRARY_ROUNDS = 20
const LIBRARY_CEILING_MS = 5_000
const STAGGER_COUNT = 500
const STAGGER_CEILING_MS = 5_000
const APPLY_CEILING_MS = 5_000

const CATEGORIES: readonly UserMotionPresetCategory[] = [
  'entrance',
  'interaction',
  'emphasis',
  'loop',
  'custom'
]

function benchmarkMotion(seed: number, trackCount = 1): MotionSpec {
  return {
    version: 1,
    tracks: Array.from({ length: trackCount }, (_, trackIndex) => ({
      id: `track-${seed}-${trackIndex}`,
      trigger: 'mount' as const,
      keyframes: [
        { offset: 0, opacity: 0, x: 0, y: seed % 13, scaleX: 0.9, scaleY: 0.9 },
        { offset: 0.33, opacity: 0.35, x: 12, y: 6, scaleX: 0.95, scaleY: 0.95 },
        { offset: 0.66, opacity: 0.75, x: 28, y: -4, scaleX: 1.05, scaleY: 1.05 },
        { offset: 1, opacity: 1, x: 40, y: 0, scaleX: 1, scaleY: 1 }
      ],
      timing: {
        durationMs: 320 + (seed % 7),
        delayMs: trackIndex,
        easing: 'ease-in-out' as const,
        fill: 'both' as const
      },
      exit: 'none' as const
    })),
    reducedMotion: 'reduce'
  }
}

function rawPreset(index: number, legacy: boolean) {
  const shared = {
    id: `user-preset-${index}`,
    revision: (index % 10) + 1,
    name: `Preset ${index}`,
    description: `Portable preset 性能样本 ${index}`
  }
  if (legacy) return { ...shared, spec: benchmarkMotion(index) }
  return {
    ...shared,
    category: CATEGORIES[index % CATEGORIES.length],
    motion: benchmarkMotion(index)
  }
}

function rawLibrary(size: number, legacy: boolean): unknown {
  return {
    format: USER_MOTION_PRESET_FORMAT,
    schemaVersion: legacy ? 0 : 1,
    presets: Array.from({ length: size }, (_, index) => rawPreset(index, legacy))
  }
}

function mergeLibrary(prefix: string, start: number, size: number): UserMotionPresetLibrary {
  return parseUserMotionPresetLibrary({
    format: USER_MOTION_PRESET_FORMAT,
    schemaVersion: 1,
    presets: Array.from({ length: size }, (_, offset) => {
      const index = start + offset
      return {
        id: `user-${prefix}-${index}`,
        revision: 1,
        name: `${prefix} ${index}`,
        category: CATEGORIES[index % CATEGORIES.length],
        motion: benchmarkMotion(index)
      }
    })
  })
}

interface LibraryBenchmarkResult {
  elapsedMs: number
  checksum: number
  currentJson: string
  migratedJson: string
  mergedJson: string
}

function runLibraryBaseline(
  currentRaw: unknown,
  legacyRaw: unknown,
  base: UserMotionPresetLibrary,
  incoming: UserMotionPresetLibrary
): LibraryBenchmarkResult {
  let checksum = 0
  let currentJSON = ''
  let migratedJSON = ''
  let mergedJSON = ''
  const startedAt = performance.now()
  for (let round = 0; round < LIBRARY_ROUNDS; round++) {
    const current = parseUserMotionPresetLibrary(currentRaw)
    const migrated = parseUserMotionPresetLibrary(legacyRaw)
    currentJSON = serializeUserMotionPresetLibrary(current)
    migratedJSON = serializeUserMotionPresetLibrary(migrated)
    const reparsed = parseUserMotionPresetLibraryJSON(currentJSON)
    const merged = mergeUserMotionPresetLibraries(base, incoming)
    mergedJSON = serializeUserMotionPresetLibrary(merged)
    checksum +=
      current.presets.length +
      migrated.presets.length +
      reparsed.presets.length +
      merged.presets.length +
      currentJSON.length +
      migratedJSON.length +
      mergedJSON.length
  }
  return {
    elapsedMs: performance.now() - startedAt,
    checksum,
    currentJson: currentJSON,
    migratedJson: migratedJSON,
    mergedJson: mergedJSON
  }
}

interface StaggerBenchmarkResult {
  elapsedMs: number
  checksum: number
  snapshots: MotionSpec[]
}

function runStaggerBaseline(source: MotionSpec): StaggerBenchmarkResult {
  const startedAt = performance.now()
  const snapshots = Array.from({ length: STAGGER_COUNT }, (_, index) =>
    withMotionStagger(source, index, STAGGER_COUNT, {
      stepMs: 100,
      direction: 'forward',
      rhythm: 'ease-in-out'
    })
  )
  const elapsedMs = performance.now() - startedAt
  const checksum = snapshots.reduce(
    (total, snapshot) =>
      total +
      snapshot.tracks.reduce((trackTotal, track) => trackTotal + (track.timing.delayMs ?? 0), 0),
    0
  )
  return { elapsedMs, checksum, snapshots }
}

describe('Motion preset library performance baselines', () => {
  test('100 presets parse, migrate, serialize, and merge deterministically within budget', () => {
    const currentRaw = rawLibrary(LIBRARY_SIZE, false)
    const legacyRaw = rawLibrary(LIBRARY_SIZE, true)
    const base = mergeLibrary('Base', 0, LIBRARY_SIZE / 2)
    const incoming = mergeLibrary('Incoming', LIBRARY_SIZE / 2, LIBRARY_SIZE / 2)

    runLibraryBaseline(currentRaw, legacyRaw, base, incoming)
    const first = runLibraryBaseline(currentRaw, legacyRaw, base, incoming)
    const second = runLibraryBaseline(currentRaw, legacyRaw, base, incoming)

    expect(first.checksum).toBe(second.checksum)
    expect(first.currentJson).toBe(second.currentJson)
    expect(first.migratedJson).toBe(second.migratedJson)
    expect(first.mergedJson).toBe(second.mergedJson)
    expect(parseUserMotionPresetLibraryJSON(first.currentJson).presets).toHaveLength(LIBRARY_SIZE)
    expect(parseUserMotionPresetLibraryJSON(first.migratedJson).presets).toHaveLength(LIBRARY_SIZE)
    expect(parseUserMotionPresetLibraryJSON(first.mergedJson).presets).toHaveLength(LIBRARY_SIZE)
    // Seconds-wide and repeated: robust on shared CI, but catches validation or merge blowups.
    expect(Math.max(first.elapsedMs, second.elapsedMs)).toBeLessThan(LIBRARY_CEILING_MS)
  })

  test('500 stagger snapshots remain deterministic, bounded, and deeply isolated', () => {
    const source = {
      ...benchmarkMotion(7, 8),
      preset: { id: 'user-benchmark', version: 1, parameters: { source: 'benchmark' } }
    } satisfies MotionSpec

    runStaggerBaseline(source)
    const first = runStaggerBaseline(source)
    const second = runStaggerBaseline(source)

    expect(first.snapshots).toHaveLength(STAGGER_COUNT)
    expect(first.checksum).toBe(second.checksum)
    expect(first.snapshots.at(-1)?.tracks[0].timing.delayMs).toBe(49_900)
    expect(first.snapshots[0]).not.toBe(source)
    expect(first.snapshots[0].tracks).not.toBe(source.tracks)
    expect(first.snapshots[0].tracks[0].keyframes).not.toBe(source.tracks[0].keyframes)
    expect(first.snapshots[0].preset?.parameters).not.toBe(source.preset.parameters)
    expect(first.snapshots[0].tracks[0].keyframes).not.toBe(first.snapshots[1].tracks[0].keyframes)

    first.snapshots[0].tracks[0].keyframes[0].x = 999
    if (first.snapshots[0].preset) first.snapshots[0].preset.parameters.source = 'mutated'
    expect(source.tracks[0].keyframes[0].x).toBe(0)
    expect(source.preset.parameters.source).toBe('benchmark')
    expect(first.snapshots[1].tracks[0].keyframes[0].x).toBe(0)
    expect(first.snapshots[1].preset).toBeUndefined()
    expect(Math.max(first.elapsedMs, second.elapsedMs)).toBeLessThan(STAGGER_CEILING_MS)
  })

  test('applies one spatially staggered preset to 500 graph nodes in one undo step', () => {
    const store = createEditorStore()
    const ids = Array.from(
      { length: STAGGER_COUNT },
      (_, index) =>
        store.graph.createNode('RECTANGLE', store.state.currentPageId, {
          x: (index % 20) * 24,
          y: Math.floor(index / 20) * 24,
          width: 20,
          height: 20
        }).id
    )

    const startedAt = performance.now()
    const changed = applyMotionPreset(store, ids.toReversed(), 'fade-in', 'Apply 500 presets', {
      stepMs: 80,
      direction: 'forward',
      rhythm: 'linear'
    })
    const elapsedMs = performance.now() - startedAt

    expect(changed).toBe(STAGGER_COUNT)
    expect(store.undo.undoLabel).toBe('Apply 500 presets')
    expect(store.graph.getNode(ids[0])?.motion?.tracks[0]?.timing.delayMs).toBe(0)
    expect(store.graph.getNode(ids.at(-1) ?? '')?.motion?.tracks[0]?.timing.delayMs).toBe(39_920)
    expect(elapsedMs).toBeLessThan(APPLY_CEILING_MS)

    store.undo.undo()
    expect(ids.every((id) => store.graph.getNode(id)?.motion === undefined)).toBe(true)
  })
})
