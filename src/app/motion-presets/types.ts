import type {
  MotionPresetCategory,
  MotionPresetId,
  MotionTrigger,
  UserMotionPresetCategory
} from '@open-pencil/scene-graph'

export type MotionPresetLibraryKey =
  | `builtin:${MotionPresetId}`
  | `user:${string}`
  | `shared:${string}:${string}`

export type MotionPresetLibraryCategory = UserMotionPresetCategory

export type MotionPresetLibraryFilter = 'all' | 'favorites' | MotionPresetCategory | 'my' | 'shared'

export type MotionPresetStaggerDirection = 'forward' | 'reverse'
export type MotionPresetStaggerRhythm = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

export interface MotionPresetLibraryItem {
  key: MotionPresetLibraryKey
  source: 'builtin' | 'user' | 'shared'
  name: string
  category: MotionPresetLibraryCategory
  trigger: MotionTrigger | 'mixed'
  durationMs?: number
  description?: string
  keywords?: readonly string[]
  readonly?: boolean
  libraryId?: string
  libraryName?: string
  publisherName?: string
  sourceKind?: 'file' | 'url'
  sourceRef?: string
  sourceVersion?: string
  observedVersion?: string
  updateAvailable?: boolean
}

export interface MotionPresetStaggerOptions {
  enabled: boolean
  stepMs: number
  direction: MotionPresetStaggerDirection
  rhythm: MotionPresetStaggerRhythm
}

export interface MotionPresetEditorValue {
  name: string
  description?: string
  category: MotionPresetLibraryCategory
}

export function builtinMotionPresetKey(id: MotionPresetId): MotionPresetLibraryKey {
  return `builtin:${id}`
}

export function userMotionPresetKey(id: string): MotionPresetLibraryKey {
  return `user:${id}`
}

export function sharedMotionPresetKey(
  libraryId: string,
  presetId: string
): `shared:${string}:${string}` {
  return `shared:${libraryId}:${presetId}`
}

export function isUserMotionPresetKey(key: string): key is `user:${string}` {
  return key.startsWith('user:') && key.length > 'user:'.length
}

export function motionUserPresetIdFromKey(key: `user:${string}`): string {
  return key.slice('user:'.length)
}

export function isSharedMotionPresetKey(key: string): key is `shared:${string}:${string}` {
  const parts = key.split(':')
  return parts.length === 3 && parts[0] === 'shared' && Boolean(parts[1]) && Boolean(parts[2])
}

export function motionSharedPresetIdsFromKey(key: `shared:${string}:${string}`): {
  libraryId: string
  presetId: string
} {
  const [, libraryId, presetId] = key.split(':')
  return { libraryId, presetId }
}
