import * as values from '@open-pencil/plugin-contracts/adapter-helpers'

import { parseExactModuleConfig } from '#core/plugins/module-contract'
import { parseTreeItems } from '#core/plugins/tree/parse'

import {
  CASCADER_MODULE_LIMITS,
  cascaderDataArray,
  parseCascaderPath,
  type CascaderModuleConfigV1
} from './types'

export function parseCascaderItems(value: unknown) {
  if (!cascaderDataArray(value, CASCADER_MODULE_LIMITS.items))
    throw new TypeError('cascader items must be a bounded plain data array')
  return parseTreeItems(value)
}

export function parseCascaderConfig(value: unknown, keys: ReadonlySet<string>) {
  return parseExactModuleConfig(
    value,
    keys,
    'cascader config must contain exactly the declared fields',
    (source) => {
      const items = parseCascaderItems(source.items)
      const initialPath = parseCascaderPath(items, source.initialPath)
      if (!initialPath)
        throw new TypeError('cascader initialPath must be empty or an enabled root-to-leaf path')
      const text = (key: string) => {
        const parsed = values.parseBoundedPluginText(source[key], 'cascader ' + key, 1, 120)
        if (!parsed.trim()) throw new TypeError('cascader ' + key + ' must contain readable text')
        return parsed
      }
      const color = (key: string) =>
        values.parseCanonicalPluginColor(source[key], 'cascader ' + key)
      const boolean = (key: string) => values.parsePluginBoolean(source[key], 'cascader ' + key)
      const config: CascaderModuleConfigV1 = {
        label: text('label'),
        placeholder: text('placeholder'),
        items,
        initialPath,
        searchable: boolean('searchable'),
        clearable: boolean('clearable'),
        disabled: boolean('disabled'),
        backgroundColor: color('backgroundColor'),
        textColor: color('textColor'),
        accentColor: color('accentColor'),
        borderColor: color('borderColor'),
        fontSize: values.parseBoundedPluginInteger(source.fontSize, 'cascader fontSize', 10, 24),
        rowHeight: values.parseBoundedPluginInteger(source.rowHeight, 'cascader rowHeight', 32, 64),
        borderRadius: values.parseBoundedPluginInteger(
          source.borderRadius,
          'cascader borderRadius',
          0,
          24
        )
      }
      values.assertBoundedPluginConfigBytes(
        config,
        'cascader config',
        CASCADER_MODULE_LIMITS.configBytes
      )
      return config
    }
  )
}
