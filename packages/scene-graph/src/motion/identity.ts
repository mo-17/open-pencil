import type { MotionKeyframe, MotionSpec } from './types'
import { cloneMotionSpec, parseMotionSpec } from './validation'

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key))}`)
      .join(',')}}`
  }
  const serialized = JSON.stringify(value)
  return typeof serialized === 'string' ? serialized : 'null'
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function keyframeFingerprint(trackId: string, keyframe: MotionKeyframe): string {
  const { id: _, ...content } = keyframe
  return `${trackId}:${canonicalJson(content)}`
}

/**
 * Add deterministic stable ids to legacy MotionSpec v3 keyframes.
 *
 * The migration is deliberately opt-in instead of part of parseMotionSpec so
 * opening/saving an old document remains byte-compatible until a collaborative
 * timeline needs identity. Existing ids are preserved. Equal frames receive a
 * deterministic occurrence suffix, and hash collisions are resolved without
 * changing already-authored ids.
 */
export function ensureMotionTimelineIds(value: unknown): MotionSpec {
  const parsed = parseMotionSpec(value)
  if (parsed.version !== 3) return cloneMotionSpec(parsed)

  const copy = cloneMotionSpec(parsed)
  for (const track of copy.tracks) {
    const used = new Set(track.keyframes.flatMap((keyframe) => (keyframe.id ? [keyframe.id] : [])))
    const occurrences = new Map<string, number>()
    for (const keyframe of track.keyframes) {
      if (keyframe.id) continue
      const fingerprint = keyframeFingerprint(track.id, keyframe)
      const occurrence = occurrences.get(fingerprint) ?? 0
      occurrences.set(fingerprint, occurrence + 1)
      const base = `kf_${stableHash(fingerprint)}_${occurrence + 1}`
      let candidate = base
      let collision = 1
      while (used.has(candidate)) candidate = `${base}_${++collision}`
      keyframe.id = candidate
      used.add(candidate)
    }
  }
  return parseMotionSpec(copy)
}
