import {
  MOTION_PRESET_IDS,
  MOTION_PRESET_REGISTRY,
  createMotionPreset,
  type SharedMotionPresetLibraryState,
  type UserMotionPreset,
  type UserMotionPresetLibrary
} from '@open-pencil/scene-graph'

import {
  builtinMotionPresetKey,
  sharedMotionPresetKey,
  userMotionPresetKey,
  type MotionPresetLibraryItem
} from './types'

const BUILTIN_NAMES = {
  'fade-in': 'Fade in',
  'slide-up': 'Slide up',
  'scale-in': 'Scale in',
  'bounce-in': 'Bounce in',
  'hover-lift': 'Hover lift',
  press: 'Press',
  pulse: 'Pulse',
  float: 'Float'
} as const

function itemTiming(preset: UserMotionPreset['motion']): {
  trigger: MotionPresetLibraryItem['trigger']
  durationMs?: number
} {
  const triggers = new Set(preset.tracks.map((track) => track.trigger))
  return {
    trigger: triggers.size === 1 ? preset.tracks[0]?.trigger : 'mixed',
    durationMs:
      preset.tracks.length > 0
        ? Math.max(...preset.tracks.map((track) => track.timing.durationMs))
        : undefined
  }
}

export function builtinMotionPresetItems(): MotionPresetLibraryItem[] {
  return MOTION_PRESET_IDS.map((id) => {
    const definition = MOTION_PRESET_REGISTRY[id]
    const motion = createMotionPreset(id)
    return {
      key: builtinMotionPresetKey(id),
      source: 'builtin',
      name: BUILTIN_NAMES[id],
      category: definition.category,
      ...itemTiming(motion),
      keywords: [id, ...definition.keywords, motion.tracks[0]?.trigger ?? '']
    }
  })
}

function userMotionPresetItem(preset: UserMotionPreset): MotionPresetLibraryItem {
  return {
    key: userMotionPresetKey(preset.id),
    source: 'user',
    name: preset.name,
    description: preset.description,
    category: preset.category,
    ...itemTiming(preset.motion),
    keywords: [preset.id, preset.category]
  }
}

function sharedMotionPresetItems(
  libraries: readonly SharedMotionPresetLibraryState[]
): MotionPresetLibraryItem[] {
  return libraries.flatMap((state) =>
    state.manifest.presets.map((preset) => ({
      key: sharedMotionPresetKey(state.manifest.library.id, preset.id),
      source: 'shared' as const,
      name: preset.name,
      description: preset.description,
      category: preset.category,
      ...itemTiming(preset.motion),
      keywords: [
        preset.id,
        preset.category,
        state.manifest.publisher.name,
        state.manifest.library.name,
        state.manifest.source.ref,
        state.manifest.sourceVersion
      ],
      readonly: state.manifest.readonly,
      libraryId: state.manifest.library.id,
      libraryName: state.manifest.library.name,
      publisherName: state.manifest.publisher.name,
      sourceKind: state.manifest.source.kind,
      sourceRef: state.manifest.source.ref,
      sourceVersion: state.manifest.sourceVersion,
      observedVersion: state.sourceVersion,
      updateAvailable: state.updateAvailable
    }))
  )
}

export function motionPresetLibraryItems(
  library: UserMotionPresetLibrary,
  sharedLibraries: readonly SharedMotionPresetLibraryState[] = []
): MotionPresetLibraryItem[] {
  return [
    ...builtinMotionPresetItems(),
    ...library.presets.map(userMotionPresetItem).sort((left, right) => {
      const byName = left.name.localeCompare(right.name, undefined, {
        sensitivity: 'base',
        numeric: true
      })
      return byName || left.key.localeCompare(right.key, 'en')
    }),
    ...sharedMotionPresetItems(sharedLibraries).sort((left, right) => {
      const byLibrary = (left.libraryName ?? '').localeCompare(right.libraryName ?? '', undefined, {
        sensitivity: 'base',
        numeric: true
      })
      if (byLibrary) return byLibrary
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
    })
  ]
}
