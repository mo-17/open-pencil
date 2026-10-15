/// <reference types="@figma/plugin-typings" />

import type { FigmaAPI } from './index'
import type {
  FigmaComponentNode,
  FigmaComponentSetNode,
  FigmaInstanceNode,
  FigmaSlotNode
} from './node-types'
import type { FigmaNodeProxy } from './proxy'

type Expect<T extends true> = T

type IncompatibleKeys<Actual, Expected> = {
  [K in keyof Expected]: K extends keyof Actual ? (Actual[K] extends Expected[K] ? never : K) : K
}[keyof Expected]

export type SupportedPluginAPI = Pick<
  PluginAPI,
  | 'base64Decode'
  | 'base64Encode'
  | 'loadFontAsync'
  | 'notify'
  | 'createComponent'
  | 'createEllipse'
  | 'createFrame'
  | 'createLine'
  | 'createNodeFromSvg'
  | 'createPolygon'
  | 'createRectangle'
  | 'createSection'
  | 'createStar'
  | 'createText'
  | 'createVector'
  | 'exclude'
  | 'flatten'
  | 'group'
  | 'intersect'
  | 'subtract'
  | 'ungroup'
  | 'union'
>

export type FigmaAPIIncompatibleKeys = IncompatibleKeys<FigmaAPI, SupportedPluginAPI>
export type FigmaAPICompatibility = Expect<
  [
    FigmaAPIIncompatibleKeys extends never ? true : false,
    ComponentPropertyDefinitionsMatch,
    ComponentPropertyMethodsMatch,
    ComponentSetPropertyMethodsMatch,
    InstancePropertySurfaceMatch,
    SlotSurfaceMatch,
    EffectShapeMatch,
    TextListSurfaceMatch,
    TextMixedMatch
  ] extends readonly true[]
    ? true
    : false
>

type Extends<Actual, Expected> = Actual extends Expected ? true : false

type Equal<Actual, Expected> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? true
    : false
  : false

type ComponentPropertyDefinitionsMatch = Expect<
  Equal<FigmaComponentNode['componentPropertyDefinitions'], ComponentPropertyDefinitions>
>

type ComponentPropertyMethodsMatch = Expect<
  Extends<FigmaComponentNode['addComponentProperty'], ComponentNode['addComponentProperty']>
>

type ComponentSetPropertyMethodsMatch = Expect<
  Extends<FigmaComponentSetNode['editComponentProperty'], ComponentSetNode['editComponentProperty']>
>

type InstancePropertySurfaceMatch = Expect<
  Extends<
    Pick<
      FigmaInstanceNode,
      | 'componentProperties'
      | 'componentPropertyReferences'
      | 'setProperties'
      | 'isExposedInstance'
      | 'exposedInstances'
      | 'getMainComponentAsync'
      | 'detachInstance'
      | 'swapComponent'
    >,
    Pick<
      InstanceNode,
      | 'componentProperties'
      | 'componentPropertyReferences'
      | 'setProperties'
      | 'isExposedInstance'
      | 'exposedInstances'
      | 'getMainComponentAsync'
      | 'detachInstance'
      | 'swapComponent'
    >
  >
>

type SlotSurfaceMatch = Expect<
  Extends<
    Pick<FigmaComponentNode, 'createSlot'> &
      Pick<FigmaSlotNode, 'type' | 'resetSlot' | 'limitViolations'>,
    Pick<ComponentNode, 'createSlot'> & Pick<SlotNode, 'type' | 'resetSlot' | 'limitViolations'>
  >
>

// `Effect` here is Figma's plugin-typings union; OpenPencil reads and writes a subset of it.
type EffectShapeMatch = Expect<Extends<FigmaNodeProxy['effects'][number], Effect>>

type TextListKeys =
  | 'setRangeListOptions'
  | 'setRangeIndentation'
  | 'setRangeListSpacing'
  | 'setRangeParagraphSpacing'
  | 'setRangeParagraphIndent'
  | 'setRangeFontSize'
  | 'setRangeFontName'
  | 'setRangeLetterSpacing'
  | 'setRangeLineHeight'
  | 'setRangeTextDecoration'
  | 'setRangeTextDecorationStyle'
  | 'setRangeTextDecorationOffset'
  | 'setRangeTextDecorationThickness'
  | 'setRangeTextDecorationSkipInk'
  | 'setRangeTextCase'
  | 'setRangeHyperlink'
  | 'setRangeTextStyleId'
  | 'setRangeTextStyleIdAsync'
  | 'setRangeFillStyleId'
  | 'setRangeFillStyleIdAsync'
  | 'hangingList'
type TextListSurfaceMatch = Expect<
  Extends<Pick<FigmaNodeProxy, TextListKeys>, Pick<TextNode, TextListKeys>>
>

// Figma's mixed values are its own `figma.mixed` unique symbol; ours are a plain symbol. Fills
// and decoration colours read and take the paints OpenPencil models, as `fills` does, and Figma
// types OpenType features as every feature while it returns only those set, so they stay out.
type WithoutMixed<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => Exclude<R, symbol>
  : Exclude<T, symbol>
type TextMixedKeys =
  | 'getRangeListOptions'
  | 'getRangeIndentation'
  | 'getRangeListSpacing'
  | 'getRangeParagraphSpacing'
  | 'getRangeParagraphIndent'
  | 'getRangeFontSize'
  | 'getRangeFontName'
  | 'getRangeFontWeight'
  | 'getRangeLetterSpacing'
  | 'getRangeLineHeight'
  | 'getRangeTextDecoration'
  | 'getRangeTextDecorationStyle'
  | 'getRangeTextDecorationOffset'
  | 'getRangeTextDecorationThickness'
  | 'getRangeTextDecorationSkipInk'
  | 'getRangeAllFontNames'
  | 'getRangeTextCase'
  | 'getRangeHyperlink'
  | 'getRangeTextStyleId'
  | 'getRangeFillStyleId'
  | 'getRangeBoundVariable'
  | 'textCase'
  | 'hyperlink'
  | 'textStyleId'
  | 'fillStyleId'
  | 'fontSize'
  | 'fontName'
  | 'fontWeight'
  | 'letterSpacing'
  | 'lineHeight'
  | 'textDecoration'
  | 'listSpacing'
  | 'paragraphSpacing'
  | 'paragraphIndent'
type TextMixedMatch = Expect<
  Extends<
    { [K in TextMixedKeys]: WithoutMixed<FigmaNodeProxy[K]> },
    { [K in TextMixedKeys]: WithoutMixed<TextNode[K]> }
  >
>
