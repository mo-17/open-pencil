import type {
  LayoutMode,
  LayoutSizing,
  LowcodePageViewportV1,
  SceneNode
} from '@open-pencil/scene-graph'

/** Explicit page geometry, measured from the emitted top-level design boxes. */
export interface IRPageViewport extends LowcodePageViewportV1 {
  designWidth: number
  designHeight: number
  originX: number
  originY: number
  backgroundColor?: string
}

/** Layout semantics remain independent of emitted CSS class syntax. */
export interface IRLayout extends Pick<
  SceneNode,
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'layoutMode'
  | 'layoutDirection'
  | 'layoutWrap'
  | 'layoutPositioning'
  | 'layoutGrow'
  | 'layoutAlignSelf'
  | 'primaryAxisSizing'
  | 'counterAxisSizing'
  | 'primaryAxisAlign'
  | 'counterAxisAlign'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'itemSpacing'
  | 'counterAxisSpacing'
  | 'minWidth'
  | 'maxWidth'
  | 'minHeight'
  | 'maxHeight'
  | 'gridTemplateColumns'
  | 'gridTemplateRows'
  | 'gridColumnGap'
  | 'gridRowGap'
  | 'gridPosition'
  | 'clipsContent'
  | 'visible'
  | 'fontSize'
  | 'lineHeight'
> {
  sourceType: SceneNode['type']
  parentType?: SceneNode['type']
  position: 'absolute' | 'flow'
  parentLayoutMode?: LayoutMode
  widthSizing: LayoutSizing
  heightSizing: LayoutSizing
  /** Wrapped-run distribution; optional for IR collected before this field was carried. */
  counterAxisAlignContent?: SceneNode['counterAxisAlignContent']
}

/** Ordered, disjoint logical-pixel ranges; maxWidth is exclusive. */
export interface IRResponsiveLayout {
  minWidth: number
  maxWidth?: number
  layout: IRLayout
  /** Resolved presentation classes without media prefixes. Layout above is authoritative. */
  className: string
}
