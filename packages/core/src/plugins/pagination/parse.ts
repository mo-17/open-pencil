import * as values from '@open-pencil/plugin-contracts/adapter-helpers'

import { parseExactModuleConfig } from '#core/plugins/module-contract'
import type { PaginationModuleConfigV1 } from '#core/plugins/pagination'

const KEYS = new Set([
  'label',
  'total',
  'pageSize',
  'initialPage',
  'showFirstLast',
  'disabled',
  'size',
  'backgroundColor',
  'textColor',
  'accentColor',
  'borderColor',
  'borderRadius',
  'fontSize'
])

export function parsePaginationConfig(value: unknown) {
  return parseExactModuleConfig(
    value,
    KEYS,
    'pagination config must contain exactly its declared fields',
    (source) => {
      const integer = (key: string, min: number, max: number) =>
        values.parseBoundedPluginInteger(source[key], `pagination ${key}`, min, max)
      const color = (key: string) =>
        values.parseCanonicalPluginColor(source[key], `pagination ${key}`)
      const config: PaginationModuleConfigV1 = {
        label: values.parseBoundedPluginText(source.label, 'pagination label', 1, 120),
        total: integer('total', 0, 1_000_000_000),
        pageSize: integer('pageSize', 1, 1000),
        initialPage: integer('initialPage', 1, 1_000_000_000),
        showFirstLast: values.parsePluginBoolean(source.showFirstLast, 'pagination showFirstLast'),
        disabled: values.parsePluginBoolean(source.disabled, 'pagination disabled'),
        size: values.parsePluginStringEnum(
          source.size,
          'pagination size',
          new Set(['comfortable', 'compact'] as const),
          'comfortable or compact'
        ),
        backgroundColor: color('backgroundColor'),
        textColor: color('textColor'),
        accentColor: color('accentColor'),
        borderColor: color('borderColor'),
        borderRadius: integer('borderRadius', 0, 24),
        fontSize: integer('fontSize', 10, 24)
      }
      if (!config.label.trim()) throw new TypeError('Pagination needs a readable accessible label')
      values.assertBoundedPluginConfigBytes(config, 'pagination config', 4096)
      return config
    }
  )
}
