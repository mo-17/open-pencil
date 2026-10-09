import { EFFECT_PICK_CATALOG_DATA } from './catalog-data'
import { EFFECT_PICK_CATALOG_BATCH2_DATA } from './catalog-data/batch2'
import type { EffectPickCatalogEntry } from './types'

/** Preserve the original approved batch identity; each catalog entry owns its version. */
export const EFFECT_PICK_COLLECTION_VERSION = '0.6.0'
export const EFFECT_PICK_COLLECTION_VERSIONS = Object.freeze([
  EFFECT_PICK_COLLECTION_VERSION,
  '0.7.0'
] as const)
export const EFFECT_PICK_RUNTIME_REVISION = 'effect-pick-css-v1'

function freezeEntry(entry: EffectPickCatalogEntry): EffectPickCatalogEntry {
  return Object.freeze({
    ...entry,
    tags: Object.freeze([...entry.tags]),
    source: Object.freeze({ ...entry.source }),
    sourceSha256: Object.freeze({ ...entry.sourceSha256 }),
    defaultConfig: Object.freeze({ ...entry.defaultConfig }),
    defaultSize: Object.freeze({ ...entry.defaultSize }),
    events: Object.freeze([...entry.events]),
    editableFields: Object.freeze([...entry.editableFields]),
    artifact: Object.freeze({ ...entry.artifact })
  })
}

/** This reviewed allowlist is the complete execution input; the full collection registry is excluded. */
export const EFFECT_PICK_CATALOG: readonly EffectPickCatalogEntry[] = Object.freeze(
  [...EFFECT_PICK_CATALOG_DATA, ...EFFECT_PICK_CATALOG_BATCH2_DATA].map(freezeEntry)
)

export function getEffectPickCatalogEntry(id: string): EffectPickCatalogEntry | undefined {
  return EFFECT_PICK_CATALOG.find((entry) => entry.id === id)
}
