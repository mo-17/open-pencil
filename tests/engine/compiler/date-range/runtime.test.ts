import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import {
  DATE_RANGE_CONFIG_SOURCE,
  DATE_RANGE_VALUE_SOURCE
} from '#compiler/adapters/date-range/source'
import { DATE_RANGE_COMPILER_MODULE_LOWERER } from '#compiler/modules/date-range'

import { createDateRangeModuleInstance } from '#core/plugins/date-range'

import { dateRangeFixture } from '#tests/helpers/compiler/modules/date-range/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test('date range lowerer rejects incompatible contracts and round-trips authored empty strings', () => {
  const instance = createDateRangeModuleInstance()
  expect(DATE_RANGE_COMPILER_MODULE_LOWERER.lower(instance)).toEqual({
    ok: true,
    payload: instance.config
  })
  expect(DATE_RANGE_COMPILER_MODULE_LOWERER.lower({ ...instance, configVersion: 2 }).ok).toBe(false)
})
test.each(['react', 'vue'] as const)(
  '%s date range export and local lifecycle fixture typecheck',
  (target) => {
    for (const lifecycle of [false, true]) {
      const result = dateRangeFixture(target, lifecycle)
      expect(result.warnings).toEqual([])
      expect(() =>
        typeCheckCompilerFiles(
          new Map(
            [...result.files].filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          ),
          target
        )
      ).not.toThrow()
    }
  },
  35000
)
test('actual generated range model keeps editable inversion, bounds feedback, empties and disabled values', () => {
  const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    DATE_RANGE_CONFIG_SOURCE +
      '\n' +
      DATE_RANGE_VALUE_SOURCE +
      '\nglobalThis.dateRangeRuntime={initialDateRange,dateRangeStatus,changeDateRange,dateRangeKey,dateRangeCopy}'
  )
  const runtime = runInNewContext(source) as {
    initialDateRange: (config: Record<string, unknown>) => [string, string]
    dateRangeStatus: (values: [string, string], config: Record<string, unknown>) => string
    changeDateRange: (
      values: [string, string],
      index: 0 | 1,
      value: string,
      config: Record<string, unknown>
    ) => [string, string]
    dateRangeKey: (config: Record<string, unknown>) => string
    dateRangeCopy: (language: string) => { start: string; order: string }
  }
  const config = createDateRangeModuleInstance({ min: '2026-01-01', max: '2026-12-31' }).config
  let values = runtime.initialDateRange(config)
  expect(runtime.dateRangeStatus(values, config)).toBe('empty')
  values = runtime.changeDateRange(values, 1, '2026-02-01', config)
  expect(runtime.dateRangeStatus(values, config)).toBe('partial')
  values = runtime.changeDateRange(values, 0, '2026-02-02', config)
  expect(values).toEqual(['2026-02-02', '2026-02-01'])
  expect(runtime.dateRangeStatus(values, config)).toBe('order')
  values = runtime.changeDateRange(values, 1, '2026-02-02', config)
  expect(runtime.dateRangeStatus(values, config)).toBe('ready')
  expect(runtime.dateRangeStatus(['2025-12-31', '2026-02-02'], config)).toBe('bounds')
  expect(runtime.changeDateRange(values, 0, '', { ...config, disabled: true })).toBe(values)
  expect(runtime.dateRangeKey({ ...config })).toBe(runtime.dateRangeKey(config))
  expect(runtime.dateRangeKey({ ...config, initialStart: '2026-05-01' })).not.toBe(
    runtime.dateRangeKey(config)
  )
  expect(runtime.dateRangeCopy('zh-CN').start).toBe('开始日期')
  expect(runtime.dateRangeCopy('en').order).toBe('Start date must not be after end date.')
})
