export const OPENPENCIL_MICROFRONTEND_ABI_V1 = 'openpencil.microfrontend.v1' as const

export const OPENPENCIL_MICROFRONTEND_MANIFEST_FORMAT = 'openpencil-microfrontend' as const
export const OPENPENCIL_MICROFRONTEND_MANIFEST_SCHEMA_VERSION = 1 as const
export const OPENPENCIL_MICROFRONTEND_MANIFEST_FILENAME = 'openpencil.microfrontend.json' as const

export const OPENPENCIL_MICROFRONTEND_COMPOSITION_FORMAT =
  'openpencil-microfrontend-composition' as const
export const OPENPENCIL_MICROFRONTEND_COMPOSITION_SCHEMA_VERSION = 1 as const
export const OPENPENCIL_MICROFRONTEND_COMPOSITION_FILENAME = 'openpencil.composition.json' as const

export const OPENPENCIL_MICROFRONTEND_LIMITS = Object.freeze({
  maxRuntimeManifestJsonBytes: 256 * 1024,
  maxCompositionManifestJsonBytes: 512 * 1024,
  maxIdentityLength: 128,
  maxNameLength: 128,
  maxPathLength: 512,
  maxRouteLength: 512,
  maxUrlLength: 2_048,
  maxAssetByteLength: 512 * 1024 * 1024,
  maxManifestByteLength: 512 * 1024,
  maxStyles: 64,
  maxRoutes: 128,
  maxSlots: 32,
  maxApps: 64
})
