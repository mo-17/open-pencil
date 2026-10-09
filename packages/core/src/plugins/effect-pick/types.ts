import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export interface EffectPickConfigV1 extends JSONObject {
  effectId: string
  collectionVersion: string
  artifactDigest: string
  text: string
  color: string
  secondaryColor: string
  speed: number
}

export type EffectPickEvent = 'click'
export type EffectPickEditableField = 'text' | 'color' | 'secondaryColor' | 'speed'
export type EffectPickBehavior =
  | 'button'
  | 'text'
  | 'characters'
  | 'gradient'
  | 'water'
  | 'loader'
  | 'card'

/** Only fixed reviewed templates; original collection JavaScript is never a document field. */
export interface EffectPickArtifact {
  readonly markup: string
  readonly css: string
  readonly durationMs: number
  readonly behavior: EffectPickBehavior
}

export interface EffectPickCatalogEntry {
  readonly runtimeRevision: string
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: string
  readonly tags: readonly string[]
  readonly collectionVersion: string
  readonly artifactDigest: string
  readonly source: {
    readonly url: string
    readonly author: string
    readonly authorName: string
    readonly mode: 'reference'
    readonly license: 'UNLICENSED'
    readonly licenseStatus: 'not-reviewed'
    readonly note: string
  }
  readonly sourceSha256: {
    readonly coreJs: string
    readonly coreCss: string
    readonly metadata: string
    readonly sharedUtils: string
  }
  readonly defaultConfig: Readonly<EffectPickConfigV1>
  readonly defaultSize: Readonly<{ width: number; height: number }>
  readonly events: readonly EffectPickEvent[]
  readonly editableFields: readonly EffectPickEditableField[]
  readonly artifact: Readonly<EffectPickArtifact>
}
