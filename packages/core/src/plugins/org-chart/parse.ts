import * as values from '@open-pencil/plugin-contracts/adapter-helpers'

import {
  parseBoundedModuleObjectArray,
  parseExactModuleConfig
} from '#core/plugins/module-contract'

import {
  ORG_CHART_MODULE_LIMITS as LIMITS,
  type OrgChartItem,
  type OrgChartModuleConfigV1
} from './types'

function assertDataArray(value: unknown): void {
  if (!Array.isArray(value)) throw new TypeError('org chart lists must be JSON arrays')
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)
      throw new TypeError('org chart lists must not contain custom or symbol keys')
  }
}
export function parseOrgChartItems(value: unknown): OrgChartItem[] {
  assertDataArray(value)
  const items = parseBoundedModuleObjectArray(
    value,
    1,
    LIMITS.items,
    'org chart needs 1–64 items',
    () => 'org chart items must be plain data objects',
    (source) => {
      if (!values.hasExactPluginKeys(source, new Set(['id', 'parentId', 'label', 'description'])))
        throw new TypeError('org chart item has unknown or missing fields')
      const id = values.parseBoundedPluginText(source.id, 'org chart item id', 1, LIMITS.id)
      const parentId = values.parseBoundedPluginText(
        source.parentId,
        'org chart parentId',
        0,
        LIMITS.id
      )
      if (
        !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) ||
        (parentId && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(parentId))
      )
        throw new TypeError(
          'org chart IDs must start with a letter and contain only letters, numbers, _ or -'
        )
      return {
        id,
        parentId,
        label: values.parseBoundedPluginText(source.label, 'org chart item label', 1, LIMITS.label),
        description: values.parseBoundedPluginText(
          source.description,
          'org chart description',
          0,
          LIMITS.description
        )
      }
    }
  )
  if (items.some((item) => !item.label.trim()))
    throw new TypeError('org chart items need readable labels')
  const byId = new Map(items.map((item) => [item.id, item]))
  if (byId.size !== items.length) throw new TypeError('org chart IDs must be unique')
  for (const item of items) {
    const visited = new Set<string>()
    let current = item
    for (let depth = 1; ; depth++) {
      if (visited.has(current.id))
        throw new TypeError('org chart parent links must not contain cycles')
      visited.add(current.id)
      if (!current.parentId) break
      const parent = byId.get(current.parentId)
      if (!parent) throw new TypeError('org chart parent must reference an existing item')
      if (depth >= LIMITS.depth) throw new TypeError('org chart supports at most 8 levels')
      current = parent
    }
  }
  return items
}
function collapsedIds(value: unknown, items: OrgChartItem[]): string[] {
  assertDataArray(value)
  if (!Array.isArray(value) || value.length > LIMITS.items)
    throw new TypeError('org chart initialCollapsedIds must be a bounded ID list')
  const ids = Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index))
    if (
      !property?.enumerable ||
      !('value' in property) ||
      typeof property.value !== 'string' ||
      !items.some((item) => item.id === property.value) ||
      !items.some((item) => item.parentId === property.value)
    )
      throw new TypeError('org chart only branches can initially collapse')
    return property.value
  })
  if (new Set(ids).size !== ids.length)
    throw new TypeError('org chart initialCollapsedIds contains duplicate IDs')
  return ids
}
export function parseOrgChartConfig(value: unknown, keys: ReadonlySet<string>) {
  return parseExactModuleConfig(
    value,
    keys,
    'org chart config must contain exactly the declared fields',
    (source) => {
      const items = parseOrgChartItems(source.items)
      const color = (key: string) =>
        values.parseCanonicalPluginColor(source[key], 'org chart ' + key)
      const config: OrgChartModuleConfigV1 = {
        label: values.parseBoundedPluginText(source.label, 'org chart label', 1, LIMITS.label),
        items,
        direction: values.parsePluginStringEnum(
          source.direction,
          'org chart direction',
          new Set(['vertical', 'horizontal'] as const),
          'vertical or horizontal'
        ),
        collapsible: values.parsePluginBoolean(source.collapsible, 'org chart collapsible'),
        initialCollapsedIds: collapsedIds(source.initialCollapsedIds, items),
        backgroundColor: color('backgroundColor'),
        cardColor: color('cardColor'),
        textColor: color('textColor'),
        mutedColor: color('mutedColor'),
        accentColor: color('accentColor'),
        borderColor: color('borderColor'),
        connectorColor: color('connectorColor'),
        fontSize: values.parseBoundedPluginInteger(source.fontSize, 'org chart fontSize', 10, 24),
        borderRadius: values.parseBoundedPluginInteger(
          source.borderRadius,
          'org chart borderRadius',
          0,
          24
        )
      }
      if (!config.label.trim()) throw new TypeError('org chart needs a readable accessible label')
      values.assertBoundedPluginConfigBytes(config, 'org chart config', LIMITS.configBytes)
      return config
    }
  )
}
