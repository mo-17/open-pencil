import type { ModulePropertyFieldKind } from '@open-pencil/plugin-contracts'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export type { ModulePropertyFieldKind } from '@open-pencil/plugin-contracts'

export interface ModulePropertyField {
  path: readonly (string | number)[]
  kind: ModulePropertyFieldKind
  label: string
  i18nLabelKey?: string
  min?: number
  max?: number
  step?: number
  options?: readonly string[]
}

export type ModuleResolution<TConfig extends JSONObject = JSONObject> =
  | null
  | { ok: false; reason: string }
  | { ok: true; instance: ModuleInstanceV1; config: TConfig }

export interface ModuleDefinition<TConfig extends JSONObject = JSONObject> {
  pluginId: string
  moduleType: string
  name: string
  description: string
  i18nNameKey?: string
  i18nDescriptionKey?: string
  configVersion: number
  defaultSize: Readonly<Pick<SceneNode, 'width' | 'height'>>
  defaultConfig: TConfig
  fields: readonly ModulePropertyField[]
  createInstance: (config?: unknown) => ModuleInstanceV1
  createFrameOverrides: (config?: unknown) => Partial<SceneNode>
  resolve: (value: unknown) => ModuleResolution<TConfig>
}

export interface PluginDefinition {
  id: string
  name: string
  version: string
  modules: readonly ModuleDefinition[]
}
