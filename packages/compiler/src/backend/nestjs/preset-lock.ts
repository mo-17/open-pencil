import type { BackendArtifactSource, BackendProviderDescriptor } from '../contracts'
import { sameBackendProviderDescriptor } from '../descriptor'
import { NESTJS_BACKEND_PROVIDER_DESCRIPTOR } from './descriptor'
import presetLock from './preset-lock.json'

/** Reviewed source bytes captured once; later mutation of an imported JSON object cannot rebind them. */
export const NESTJS_PRESET_LOCK_SOURCE = JSON.stringify(presetLock, null, 2) + '\n'

/** A specific reviewed static artifact, never a path-based or generic integrity-string exemption. */
export function isReviewedNestJSPresetLockArtifact(
  artifact: BackendArtifactSource,
  descriptor: BackendProviderDescriptor
): boolean {
  return (
    sameBackendProviderDescriptor(descriptor, NESTJS_BACKEND_PROVIDER_DESCRIPTOR) &&
    artifact.path === 'backend/nestjs/package-lock.json' &&
    artifact.kind === 'server-runtime' &&
    artifact.mediaType === 'application/json' &&
    artifact.content === NESTJS_PRESET_LOCK_SOURCE
  )
}
