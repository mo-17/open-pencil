import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import {
  DATE_RANGE_CONFIG_SOURCE,
  DATE_RANGE_VALUE_SOURCE,
  DATE_RANGE_FIELD_SOURCE
} from '#compiler/adapters/date-range/source'
import { MODULE_FIELD_TYPES_SOURCE } from '#compiler/adapters/module-field/source'
import { RATING_CONFIG_SOURCE, RATING_FIELD_SOURCE } from '#compiler/adapters/rating/source'
import {
  SLIDER_CONFIG_SOURCE,
  SLIDER_VALUE_SOURCE,
  SLIDER_FIELD_SOURCE
} from '#compiler/adapters/slider/source'

import {
  DATE_RANGE_MODULE_DEFAULT_CONFIG,
  RATING_MODULE_DEFAULT_CONFIG,
  SLIDER_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'

import { formModulesFixture } from '#tests/helpers/compiler/components/form-modules/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

interface FieldSnapshot {
  value: unknown
  invalid: boolean
  empty: boolean
}
interface Runtime {
  sliderFieldValues(
    config: unknown,
    props: unknown,
    local: [number, number]
  ): { fields: FieldSnapshot[]; shown: [number, number]; crossed: boolean }
  ratingFieldValue(config: unknown, props: unknown, local: number): FieldSnapshot
  dateRangeFields(
    config: unknown,
    props: unknown,
    local: [string, string]
  ): { fields: FieldSnapshot[]; values: [string, string] }
  moduleFieldMessage(invalid: boolean, empty: boolean, field: unknown, zh: boolean): string
}
const source = [
  MODULE_FIELD_TYPES_SOURCE,
  SLIDER_CONFIG_SOURCE,
  SLIDER_VALUE_SOURCE,
  SLIDER_FIELD_SOURCE,
  RATING_CONFIG_SOURCE,
  RATING_FIELD_SOURCE,
  DATE_RANGE_CONFIG_SOURCE,
  DATE_RANGE_VALUE_SOURCE,
  DATE_RANGE_FIELD_SOURCE
].join('\n')
const runtime = runInNewContext(
  new Bun.Transpiler({ loader: 'ts' }).transformSync(source) +
    '\n({sliderFieldValues,ratingFieldValue,dateRangeFields,moduleFieldMessage})'
) as Runtime

test('controlled module fields never replace missing, nonnumeric or out-of-grid data with authored defaults', () => {
  for (const value of [undefined, null, '', '30', Number.NaN, Infinity, -1, 101, 1.5]) {
    const fields = runtime.sliderFieldValues(
      SLIDER_MODULE_DEFAULT_CONFIG,
      { valueBound: true, value },
      [30, 70]
    )
    expect(fields.fields[0].value).toBeUndefined()
    expect(fields.fields[0].invalid).toBe(true)
  }
  const fields = runtime.sliderFieldValues(
    { ...SLIDER_MODULE_DEFAULT_CONFIG, range: true },
    { valueBound: true, value: 80, endValueBound: true, endValue: 20 },
    [30, 70]
  )
  expect(fields.fields.map((field) => field.value)).toEqual([80, 20])
  expect(fields.crossed).toBe(true)
  expect(
    runtime.sliderFieldValues(SLIDER_MODULE_DEFAULT_CONFIG, { value: 95 }, [30, 70]).fields[0].value
  ).toBe(30)
  expect(
    runtime.sliderFieldValues(
      SLIDER_MODULE_DEFAULT_CONFIG,
      { valueBound: true, value: 0 },
      [30, 70]
    ).fields[0]
  ).toEqual({ value: 0, invalid: false, empty: false })
})
test('rating required treats zero as unselected while half steps remain exact', () => {
  expect(
    runtime.ratingFieldValue(RATING_MODULE_DEFAULT_CONFIG, { valueBound: true, value: 0 }, 3)
  ).toEqual({ value: 0, invalid: false, empty: true })
  expect(
    runtime.ratingFieldValue(RATING_MODULE_DEFAULT_CONFIG, { valueBound: true, value: 2.5 }, 3)
      .invalid
  ).toBe(true)
  expect(
    runtime.ratingFieldValue(
      { ...RATING_MODULE_DEFAULT_CONFIG, allowHalf: true },
      { valueBound: true, value: 2.5 },
      3
    ).value
  ).toBe(2.5)
  expect(
    runtime.ratingFieldValue(RATING_MODULE_DEFAULT_CONFIG, { valueBound: true, value: 99 }, 3).value
  ).toBeUndefined()
  expect(runtime.moduleFieldMessage(false, true, { required: true }, false)).toBe('Choose a value.')
  expect(runtime.moduleFieldMessage(false, true, { required: false }, false)).toBe('')
  expect(runtime.moduleFieldMessage(false, false, { error: '独立字段错误' }, true)).toBe(
    '独立字段错误'
  )
})
test('date endpoints distinguish empty optional text, missing state and impossible calendar dates', () => {
  const config = DATE_RANGE_MODULE_DEFAULT_CONFIG
  for (const value of [undefined, null, 0, '2026-02-30', '2026-13-01', '2026-2-01', 'not a date']) {
    const projection = runtime.dateRangeFields(
      config,
      { valueBound: true, value, endValueBound: true, endValue: '2026-10-01' },
      ['2026-09-01', '2026-09-05']
    )
    expect(projection.values).toEqual(['', '2026-10-01'])
    expect(projection.fields[0].invalid).toBe(true)
  }
  const empty = runtime.dateRangeFields(config, { valueBound: true, value: '' }, ['2026-09-01', ''])
  expect(empty.fields[0]).toEqual({ value: undefined, invalid: false, empty: true })
  expect(
    runtime.dateRangeFields(config, { valueBound: true, value: '2024-02-29' }, ['', '']).values[0]
  ).toBe('2024-02-29')
})
for (const target of ['react', 'vue'] as const)
  test(`${target} real controlled module callbacks and FORM metadata typecheck`, () => {
    const result = formModulesFixture(target)
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
  }, 35000)
