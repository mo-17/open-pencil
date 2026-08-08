import type { CompileWarning } from '#compiler/types'

export type FlutterWarningSink = (warning: CompileWarning) => void

export interface FlutterStyle {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  position?: 'absolute'
  left?: number
  top?: number
  right?: number
  bottom?: number
  padding?: FlutterEdges
  margin?: FlutterEdges
  backgroundColor?: string
  color?: string
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
  opacity?: number
  fontSize?: number
  fontWeight?: number
  fontFamily?: string
  fontStyle?: 'italic' | 'normal'
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  letterSpacing?: number
  lineHeight?: number
  flexDirection?: 'row' | 'column'
  mainAxisAlignment?: 'start' | 'end' | 'center' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly'
  crossAxisAlignment?: 'start' | 'end' | 'center' | 'stretch' | 'baseline'
  gap?: number
  backgroundAsset?: string
  imageFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scaleDown'
  placeholderColor?: string
}

export interface FlutterEdges {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export interface FlutterComponentPlan {
  sourceName: string
  className: string
  fileName: string
  importAlias: string
  propNames: ReadonlyMap<string, string>
}
