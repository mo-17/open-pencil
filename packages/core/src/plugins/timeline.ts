import * as parser from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import { parseNavigationAppearance, type NavigationAppearance } from './navigation/shared'
import { TIMELINE_FIELDS } from './timeline/fields'
import type { ModuleResolution } from './types'

export { TIMELINE_ITEM_FIELDS } from './timeline/fields'
export { TIMELINE_LAYOUT, TIMELINE_MARK_PATHS, timelineColumns } from './timeline/layout'

export const TIMELINE_PLUGIN_ID = 'open-pencil.timeline'
export const TIMELINE_MODULE_TYPE = 'timeline'
export const TIMELINE_MODULE_CONFIG_VERSION = 1
export const TIMELINE_MODULE_DEFAULT_SIZE = Object.freeze({ width: 360, height: 340 })
export const TIMELINE_MODULE_LIMITS = Object.freeze({
  itemsMin: 0,
  itemsMax: 24,
  id: 64,
  title: 120,
  description: 600,
  time: 80,
  configBytes: 65536
})
export interface TimelineItemV1 extends JSONObject {
  id: string
  title: string
  description: string
  time: string
  status: 'completed' | 'current' | 'pending' | 'error'
}
export interface TimelineModuleConfigV1 extends NavigationAppearance {
  items: TimelineItemV1[]
  layout: 'start' | 'alternate'
  emptyText: string
  completedColor: string
  errorColor: string
  lineColor: string
  itemGap: number
  markerSize: number
  lineWidth: number
}
export type TimelineModuleConfig = TimelineModuleConfigV1
export const TIMELINE_DEFAULT_ITEM: Readonly<TimelineItemV1> = Object.freeze({
  id: 'event',
  title: 'Event',
  description: '',
  time: '',
  status: 'pending'
})
const items: TimelineItemV1[] = [
  {
    id: 'created',
    title: 'Created',
    description: 'The local example was created.',
    time: '09:00',
    status: 'completed'
  },
  {
    id: 'review',
    title: 'In review',
    description: 'Review the details.',
    time: '10:30',
    status: 'current'
  },
  {
    id: 'next',
    title: 'Next event',
    description: 'Add another event when ready.',
    time: '',
    status: 'pending'
  }
]
items.forEach(Object.freeze)
Object.freeze(items)
export const TIMELINE_MODULE_DEFAULT_CONFIG: Readonly<TimelineModuleConfigV1> = Object.freeze({
  label: 'Timeline',
  items,
  layout: 'start',
  emptyText: 'No events yet',
  backgroundColor: '#FFFFFF',
  textColor: '#172B4D',
  accentColor: '#2563EB',
  completedColor: '#15803D',
  errorColor: '#DC2626',
  lineColor: '#CBD5E1',
  fontSize: 14,
  itemGap: 24,
  markerSize: 16,
  lineWidth: 2
})
const ITEM_KEYS = new Set(['id', 'title', 'description', 'time', 'status'])
const CONFIG_KEYS = new Set(Object.keys(TIMELINE_MODULE_DEFAULT_CONFIG))
function parseItems(value: unknown): TimelineItemV1[] {
  const ids = new Set<string>()
  return contract.parseBoundedModuleObjectArray(
    value,
    0,
    24,
    'timeline must contain 0 to 24 events',
    (index) => `timeline items[${index}] must be a plain object`,
    (entry) => {
      if (!parser.hasExactPluginKeys(entry, ITEM_KEYS))
        throw new TypeError('timeline event must contain id, title, description, time, and status')
      const id = parser.parseBoundedPluginText(entry.id, 'event id', 1, TIMELINE_MODULE_LIMITS.id)
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || ids.has(id))
        throw new TypeError(
          'timeline event ids must be unique letters, numbers, underscores, or hyphens'
        )
      ids.add(id)
      return {
        id,
        title: parser.parseBoundedPluginText(
          entry.title,
          'event title',
          1,
          TIMELINE_MODULE_LIMITS.title
        ),
        description: parser.parseBoundedPluginText(
          entry.description,
          'event description',
          0,
          TIMELINE_MODULE_LIMITS.description
        ),
        time: parser.parseBoundedPluginText(
          entry.time,
          'event time',
          0,
          TIMELINE_MODULE_LIMITS.time
        ),
        status: parser.parsePluginStringEnum(
          entry.status,
          'event status',
          new Set(['completed', 'current', 'pending', 'error'] as const),
          'completed, current, pending, or error'
        )
      }
    }
  )
}
const CONTRACT: contract.ModuleContract<TimelineModuleConfigV1> = {
  pluginId: TIMELINE_PLUGIN_ID,
  moduleType: TIMELINE_MODULE_TYPE,
  configVersion: 1,
  displayName: 'timeline',
  defaultConfig: TIMELINE_MODULE_DEFAULT_CONFIG,
  parseConfig: (value) =>
    contract.parseExactModuleConfig(
      value,
      CONFIG_KEYS,
      'timeline config must contain exactly its declared fields',
      (source) => {
        const config: TimelineModuleConfigV1 = {
          ...parseNavigationAppearance(source),
          items: parseItems(source.items),
          layout: parser.parsePluginStringEnum(
            source.layout,
            'timeline layout',
            new Set(['start', 'alternate'] as const),
            'start or alternate'
          ),
          emptyText: parser.parseBoundedPluginText(source.emptyText, 'timeline emptyText', 1, 200),
          completedColor: parser.parseCanonicalPluginColor(
            source.completedColor,
            'timeline completedColor'
          ),
          errorColor: parser.parseCanonicalPluginColor(source.errorColor, 'timeline errorColor'),
          lineColor: parser.parseCanonicalPluginColor(source.lineColor, 'timeline lineColor'),
          itemGap: parser.parseBoundedPluginInteger(source.itemGap, 'timeline itemGap', 8, 64),
          markerSize: parser.parseBoundedPluginInteger(
            source.markerSize,
            'timeline markerSize',
            8,
            24
          ),
          lineWidth: parser.parseBoundedPluginInteger(source.lineWidth, 'timeline lineWidth', 1, 4)
        }
        parser.assertBoundedPluginConfigBytes(
          config,
          'timeline config',
          TIMELINE_MODULE_LIMITS.configBytes
        )
        return config
      }
    )
}
export function createTimelineModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolveTimelineModule(value: unknown): ModuleResolution<TimelineModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createTimelineModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Timeline',
      defaultSize: TIMELINE_MODULE_DEFAULT_SIZE,
      fillColor: { r: 1, g: 1, b: 1, a: 0 },
      strokeColor: { r: 1, g: 1, b: 1, a: 0 },
      module: createTimelineModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0
  }
}
export const TIMELINE_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Timeline',
  description: 'A local sequence of events with status markers and optional alternating layout.',
  i18nNameKey: 'lowcodeModuleTimelineName',
  i18nDescriptionKey: 'lowcodeModuleTimelineDescription',
  defaultSize: TIMELINE_MODULE_DEFAULT_SIZE,
  fields: TIMELINE_FIELDS,
  createInstance: createTimelineModuleInstance,
  createFrameOverrides: createTimelineModuleFrameOverrides,
  resolve: resolveTimelineModule
})
export const TIMELINE_PLUGIN = contract.createSingleModulePlugin(
  TIMELINE_PLUGIN_ID,
  'OpenPencil Timeline',
  TIMELINE_MODULE_DEFINITION
)
