import {
  cloneMotionSpec,
  parseMotionSpec,
  type MotionSpec,
  type MotionTrack
} from '@open-pencil/scene-graph'

export function requireMotionTrack(spec: MotionSpec, trackId: string): MotionTrack {
  const track = spec.tracks.find((candidate) => candidate.id === trackId)
  if (!track) throw new Error(`Unknown motion track: ${trackId}`)
  return track
}

/** Validate an immutable timeline edit and clear preset provenance once the
 * authored values no longer exactly represent that preset. */
export function editAuthoredMotionSpec(
  spec: MotionSpec,
  edit: (draft: MotionSpec) => void
): MotionSpec {
  const draft = cloneMotionSpec(spec)
  edit(draft)
  delete draft.preset
  return parseMotionSpec(draft)
}
