import { isPlainJSONObject } from './module'
import type { GridTrack } from './types'

export function isNonnegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Strict data-only Grid tracks used by native preferences and legacy lowcode metadata. */
export function isGridTrackList(value: unknown): value is GridTrack[] {
  return (
    Array.isArray(value) &&
    value.length <= 4096 &&
    value.every(
      (track: unknown) =>
        isPlainJSONObject(track) &&
        Object.keys(track).length === 2 &&
        typeof track.sizing === 'string' &&
        ['FIXED', 'FR', 'AUTO'].includes(track.sizing) &&
        isNonnegativeFiniteNumber(track.value)
    )
  )
}
