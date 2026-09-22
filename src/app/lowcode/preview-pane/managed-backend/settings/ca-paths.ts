import { useStorage, type StorageLike } from '@vueuse/core'
import * as v from 'valibot'

import { isBackendOIDCIssuer } from '@open-pencil/lowcode/backend'

import { isManagedPresetCAPath, isManagedPresetJWKS } from '../presets/identity'

export const MANAGED_BACKEND_CA_PATHS_KEY = 'open-pencil:managed-backend-ca-paths:v1'
const MAX_SAVED_PATHS = 32
const MAX_STORED_CHARACTERS = 256 * 1024
const savedPathSchema = v.strictObject({
  issuer: v.pipe(
    v.string(),
    v.check((value) => isBackendOIDCIssuer(value))
  ),
  jwksURL: v.pipe(v.string(), v.check(isManagedPresetJWKS)),
  caFile: v.pipe(v.string(), v.check(isManagedPresetCAPath))
})
const preferencesSchema = v.strictObject({
  version: v.literal(1),
  paths: v.pipe(v.array(savedPathSchema), v.maxLength(MAX_SAVED_PATHS))
})
type CAPathPreferences = v.InferOutput<typeof preferencesSchema>

function emptyPreferences(): CAPathPreferences {
  return { version: 1, paths: [] }
}

function readPreferences(raw: string): CAPathPreferences {
  if (raw.length > MAX_STORED_CHARACTERS) return emptyPreferences()
  try {
    const result = v.safeParse(preferencesSchema, JSON.parse(raw))
    return result.success ? result.output : emptyPreferences()
  } catch {
    return emptyPreferences()
  }
}

/** Device-local preferences only; never part of a document or its exported configuration. */
export function useManagedBackendCAPaths(storage?: StorageLike) {
  const preferences = useStorage(MANAGED_BACKEND_CA_PATHS_KEY, emptyPreferences(), storage, {
    writeDefaults: false,
    flush: 'sync',
    serializer: { read: readPreferences, write: JSON.stringify }
  })

  return {
    read(issuer: string, jwksURL: string): string {
      return (
        preferences.value.paths.find((path) => path.issuer === issuer && path.jwksURL === jwksURL)
          ?.caFile ?? ''
      )
    },
    write(issuer: string, jwksURL: string, caFile: string): void {
      if (!isBackendOIDCIssuer(issuer) || !isManagedPresetJWKS(jwksURL)) return
      const path = caFile.trim()
      if (path && !isManagedPresetCAPath(path)) return
      const paths = preferences.value.paths.filter(
        (saved) => saved.issuer !== issuer || saved.jwksURL !== jwksURL
      )
      if (path) paths.push({ issuer, jwksURL, caFile: path })
      preferences.value = { version: 1, paths: paths.slice(-MAX_SAVED_PATHS) }
    }
  }
}
