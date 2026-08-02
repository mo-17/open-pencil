export {
  Frame,
  Text,
  Rectangle,
  Ellipse,
  Line,
  Star,
  Polygon,
  Vector,
  Group,
  Section,
  Component,
  ComponentSet,
  Instance,
  Button,
  Input,
  Select,
  Checkbox,
  Form,
  List,
  Radio,
  Textarea,
  DatePicker,
  Switch,
  View,
  Rect,
  Page,
  INTRINSIC_ELEMENTS
} from './components'

export { LOWCODE_INTRINSIC_ELEMENTS, type LowcodeNodeType } from './lowcode'

export {
  type TreeNode,
  type BaseProps,
  type TextProps,
  type StyleProps,
  type PaintProp,
  isTreeNode,
  node,
  resolveToTree,
  resolveToTreeAsync,
  type ResolveTreeOptions
} from './tree'

export { renderTree, type RenderResult } from './renderer'

export {
  backgroundBlur,
  dropShadow,
  foregroundBlur,
  innerShadow,
  layerBlur,
  type BlurEffectOptions,
  type EffectColor,
  type ShadowEffectOptions
} from './effects'

export {
  angularGradient,
  diamondGradient,
  gradient,
  linearGradient,
  radialGradient,
  solid,
  type GradientPaintOptions,
  type PaintColor,
  type PaintStop,
  type SolidPaintOptions
} from './paints'

export { defineVars, designVar, isVariable, type DesignVariable, type VarDef } from './vars'

export { createElement } from './mini-react'

export { renderJSX, renderTreeNode, buildComponent } from './render'
export {
  applyRenderPlacement,
  renderPlacementSiblings,
  resolveRenderPlacement,
  type AppliedRenderPlacement,
  type RenderPlacementInput,
  type ResolvedRenderPlacement
} from './render-placement'

import jsxReference from '#core/tools/prompts/jsx-reference.md'

export { sceneNodeToJSX, selectionToJSX, type JSXFormat } from '#core/io/formats/jsx'
export const JSX_REFERENCE: string = jsxReference
