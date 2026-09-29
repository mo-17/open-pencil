import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export interface ChartPath extends JSONObject {
  d: string
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
}
export interface ChartRect extends JSONObject {
  x: number
  y: number
  width: number
  height: number
  radius: number
  fill: string
  opacity: number
}
export interface ChartCircle extends JSONObject {
  x: number
  y: number
  radius: number
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
}
export interface ChartText extends JSONObject {
  text: string
  fullText: string
  kind: 'category' | 'value' | 'empty' | 'overflow'
  count: number
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  align: 'left' | 'center' | 'right'
  color: string
  fontWeight: number
}
export interface ChartLayout extends JSONObject {
  width: number
  height: number
  backgroundColor: string
  empty: boolean
  compact: boolean
  paths: ChartPath[]
  rects: ChartRect[]
  circles: ChartCircle[]
  texts: ChartText[]
  hiddenLabelCount: number
}
