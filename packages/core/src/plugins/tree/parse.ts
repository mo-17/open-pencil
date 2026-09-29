import * as values from '@open-pencil/plugin-contracts/adapter-helpers'

import {
  parseBoundedModuleObjectArray,
  parseExactModuleConfig
} from '#core/plugins/module-contract'

import {
  TREE_MODULE_LIMITS,
  treeItemDisabled,
  type TreeItem,
  type TreeModuleConfigV1
} from './types'

export function parseTreeItems(value: unknown): TreeItem[] {
  const items = parseBoundedModuleObjectArray(
    value,
    1,
    TREE_MODULE_LIMITS.items,
    'tree needs 1–128 items',
    () => 'tree items must be plain data objects',
    (source) => {
      if (!values.hasExactPluginKeys(source, new Set(['id', 'label', 'parentId', 'disabled'])))
        throw new TypeError('tree item has unknown or missing fields')
      const id = values.parseBoundedPluginText(source.id, 'tree item id', 1, 48)
      const parentId = values.parseBoundedPluginText(source.parentId, 'tree parentId', 0, 48)
      if (
        !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) ||
        (parentId && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(parentId))
      )
        throw new TypeError(
          'tree identifiers must start with a letter and contain only letters, numbers, _ or -'
        )
      return {
        id,
        parentId,
        label: values.parseBoundedPluginText(source.label, 'tree item label', 1, 120),
        disabled: values.parsePluginBoolean(source.disabled, 'tree item disabled')
      }
    }
  )
  const byId = new Map(items.map((item) => [item.id, item]))
  if (byId.size !== items.length) throw new TypeError('tree item IDs must be unique')
  for (const item of items) {
    const seen = new Set<string>()
    let current = item
    for (let depth = 1; depth <= TREE_MODULE_LIMITS.depth; depth++) {
      if (seen.has(current.id)) throw new TypeError('tree parent links must not contain cycles')
      seen.add(current.id)
      if (!current.parentId) break
      if (depth === TREE_MODULE_LIMITS.depth) throw new TypeError('tree supports at most 6 levels')
      const parent = byId.get(current.parentId)
      if (!parent) throw new TypeError('tree parent must reference an existing item')
      current = parent
    }
  }
  return items
}
function identifiers(value: unknown, items: TreeItem[], field: string): string[] {
  if (!Array.isArray(value) || value.length > TREE_MODULE_LIMITS.items)
    throw new TypeError('tree ' + field + ' must be a bounded ID list')
  const ids = Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string' ||
      !items.some((item) => item.id === descriptor.value)
    )
      throw new TypeError('tree ' + field + ' contains an unknown item')
    return descriptor.value
  })
  if (new Set(ids).size !== ids.length)
    throw new TypeError('tree ' + field + ' contains duplicate IDs')
  return ids
}
export function parseTreeConfig(value: unknown, keys: ReadonlySet<string>) {
  return parseExactModuleConfig(
    value,
    keys,
    'tree config must contain exactly the declared fields',
    (source) => {
      const items = parseTreeItems(source.items)
      const selected = identifiers(source.initialSelectedIds, items, 'initialSelectedIds')
      const expanded = identifiers(source.initialExpandedIds, items, 'initialExpandedIds')
      const selectionMode = values.parsePluginStringEnum(
        source.selectionMode,
        'tree selectionMode',
        new Set(['single', 'multiple'] as const),
        'single or multiple'
      )
      if (selectionMode === 'single' && selected.length > 1)
        throw new TypeError('single tree selection permits only one initial item')
      if (selected.some((id) => treeItemDisabled(items, id)))
        throw new TypeError('tree cannot initially select disabled items')
      if (expanded.some((id) => !items.some((item) => item.parentId === id)))
        throw new TypeError('only tree branches can initially expand')
      const color = (key: string) => values.parseCanonicalPluginColor(source[key], 'tree ' + key)
      const boolean = (key: string) => values.parsePluginBoolean(source[key], 'tree ' + key)
      const config: TreeModuleConfigV1 = {
        presentation: values.parsePluginStringEnum(
          source.presentation,
          'tree presentation',
          new Set(['tree', 'select'] as const),
          'tree or select'
        ),
        label: values.parseBoundedPluginText(source.label, 'tree label', 1, 120),
        placeholder: values.parseBoundedPluginText(source.placeholder, 'tree placeholder', 1, 120),
        items,
        selectionMode,
        initialSelectedIds: selected,
        initialExpandedIds: expanded,
        searchable: boolean('searchable'),
        disabled: boolean('disabled'),
        showValue: boolean('showValue'),
        backgroundColor: color('backgroundColor'),
        textColor: color('textColor'),
        accentColor: color('accentColor'),
        borderColor: color('borderColor'),
        fontSize: values.parseBoundedPluginInteger(source.fontSize, 'tree fontSize', 10, 24),
        rowHeight: values.parseBoundedPluginInteger(source.rowHeight, 'tree rowHeight', 32, 64)
      }
      values.assertBoundedPluginConfigBytes(config, 'tree config', TREE_MODULE_LIMITS.configBytes)
      return config
    }
  )
}
