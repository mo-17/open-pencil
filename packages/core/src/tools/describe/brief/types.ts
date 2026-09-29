import type { BindingExpr, SceneNode } from '@open-pencil/scene-graph'

export type DesignBriefLocale = 'en' | 'zh-CN'
export type DesignBriefScope =
  | { kind: 'document' }
  | { kind: 'page'; pageId: string }
  | { kind: 'selection'; nodeIds: readonly string[] }

export interface DesignBriefOptions {
  scope: DesignBriefScope
  locale?: DesignBriefLocale
}

export type DesignBriefWarningCode =
  | 'nodes-truncated'
  | 'details-truncated'
  | 'text-truncated'
  | 'depth-truncated'
  | 'invalid-hierarchy'
  | 'missing-reference'
  | 'private-reference'
  | 'expressions-omitted'
  | 'module-config-omitted'
  | 'sensitive-text-omitted'
  | 'custom-code-omitted'
  | 'runtime-not-verified'

export interface DesignBriefWarning {
  code: DesignBriefWarningCode
}

export interface DesignBriefBinding {
  property: string
  kind: BindingExpr['kind']
  reference?: string
  resolved?: boolean
}

export interface DesignBriefAction {
  kind: string
  branch: string
  target?: string
  referenceStatus?: 'in-scope' | 'outside-scope' | 'missing' | 'private'
}

export interface DesignBriefEvent {
  event: string
  actions: DesignBriefAction[]
}

export interface DesignBriefNode {
  id: string
  parentId: string | null
  depth: number
  type: SceneNode['type']
  name: string
  visible: boolean
  text?: string
  geometry: Pick<SceneNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>
  layout: Pick<
    SceneNode,
    | 'layoutMode'
    | 'layoutWrap'
    | 'primaryAxisAlign'
    | 'counterAxisAlign'
    | 'primaryAxisSizing'
    | 'counterAxisSizing'
    | 'layoutPositioning'
    | 'itemSpacing'
    | 'paddingTop'
    | 'paddingRight'
    | 'paddingBottom'
    | 'paddingLeft'
  >
  style: {
    fillTypes: string[]
    solidColors: string[]
    cornerRadius: number
    fontFamily?: string
    fontSize?: number
    fontWeight?: number
  }
  route?: string
  requiresAuth?: boolean
  bindings: DesignBriefBinding[]
  events: DesignBriefEvent[]
  variableBindings: Array<{ property: string; variableId: string }>
  responsive: Array<{ breakpoint: string; fields: string[] }>
  motion?: {
    version: number
    tracks: number
    triggers: string[]
    reducedMotion: string
  }
  motionScene: boolean
  motionDrivers: boolean
  module?: { pluginId: string; moduleType: string }
}

export interface DesignBriefVariable {
  id: string
  name: string
  type: string
  collectionName: string
  modes: string[]
}

export interface DesignBriefBackend {
  coverage: 'referenced-bindings'
  resources: Array<{ resourceId: string; operations: string[] }>
  commands: Array<{ commandId: string; operations: string[] }>
}

export interface DesignBrief {
  version: 1
  locale: DesignBriefLocale
  scope: DesignBriefScope
  nodes: DesignBriefNode[]
  variables: DesignBriefVariable[]
  backend: DesignBriefBackend
  warnings: DesignBriefWarning[]
  truncated: boolean
}

export type DesignBriefErrorCode = 'empty-selection' | 'invalid-scope' | 'scope-limit'
export type DesignBriefResult =
  | { ok: true; brief: DesignBrief; markdown: string }
  | { ok: false; error: { code: DesignBriefErrorCode; message: string } }
