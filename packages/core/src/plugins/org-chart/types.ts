import type { JSONObject, Vector } from '@open-pencil/scene-graph/primitives'

export interface OrgChartItem extends JSONObject {
  id: string
  parentId: string
  label: string
  description: string
}
export interface OrgChartModuleConfigV1 extends JSONObject {
  label: string
  items: OrgChartItem[]
  direction: 'vertical' | 'horizontal'
  collapsible: boolean
  initialCollapsedIds: string[]
  backgroundColor: string
  cardColor: string
  textColor: string
  mutedColor: string
  accentColor: string
  borderColor: string
  connectorColor: string
  fontSize: number
  borderRadius: number
}
export const ORG_CHART_MODULE_LIMITS = Object.freeze({
  items: 64,
  depth: 8,
  id: 48,
  label: 120,
  description: 240,
  configBytes: 65536
})
export interface OrgChartCard extends OrgChartItem {
  x: number
  y: number
  width: number
  height: number
  depth: number
  hasChildren: boolean
  collapsed: boolean
}
export interface OrgChartConnector {
  fromId: string
  toId: string
  points: Vector[]
}
export interface OrgChartLayout {
  cards: OrgChartCard[]
  connectors: OrgChartConnector[]
  width: number
  height: number
  mode: 'tree' | 'compact'
}
