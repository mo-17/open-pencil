import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { SLIDER_CONFIG_SOURCE, SLIDER_VALUE_SOURCE } from '#compiler/adapters/slider/source'

import { SLIDER_MODULE_DEFAULT_CONFIG, type SliderModuleConfigV1 } from '#core/plugins/slider'

import { sliderFixture } from '#tests/helpers/compiler/modules/slider/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

interface SliderRuntimeMath {
  initialSliderValues(config: SliderModuleConfigV1): [number, number]
  changeSliderValue(
    values: [number, number],
    index: number,
    value: number,
    config: SliderModuleConfigV1
  ): [number, number]
  sliderKeyValue(key: string, value: number, config: SliderModuleConfigV1): number | null
  sliderPointerTarget(
    clientX: number,
    left: number,
    width: number,
    values: [number, number],
    config: SliderModuleConfigV1
  ): [number, number] | null
}

const source = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(
  SLIDER_CONFIG_SOURCE + '\n' + SLIDER_VALUE_SOURCE
)
const math = runInNewContext(
  source + '\n({ initialSliderValues, changeSliderValue, sliderKeyValue, sliderPointerTarget })'
) as SliderRuntimeMath

test('shared generated Slider state clamps crossing handles and snaps fractional steps', () => {
  const config = {
    ...SLIDER_MODULE_DEFAULT_CONFIG,
    range: true,
    min: -0.3,
    max: 0.65,
    step: 0.1,
    initialValue: 0.1,
    initialEndValue: 0.6
  }
  const values = math.initialSliderValues(config)
  expect(values).toEqual([0.1, 0.6])
  expect(math.changeSliderValue(values, 0, 500, config)).toEqual([0.6, 0.6])
  expect(math.changeSliderValue(values, 1, -500, config)).toEqual([0.1, 0.1])
  expect(math.changeSliderValue(values, 0, 0.1 + 0.2, config)).toEqual([0.3, 0.6])
  expect(math.changeSliderValue(values, 0, Number.NaN, config)).toEqual(values)
})

test('disabled and read-only sliders reject interaction while ordinary single values update', () => {
  const config = { ...SLIDER_MODULE_DEFAULT_CONFIG }
  const values: [number, number] = [30, 70]
  expect(math.changeSliderValue(values, 0, 80, config)).toEqual([80, 70])
  expect(math.changeSliderValue(values, 0, 80, { ...config, readOnly: true })).toEqual(values)
  expect(math.changeSliderValue(values, 0, 80, { ...config, disabled: true })).toEqual(values)
})

test('Slider keyboard exposes directional, Home, End and page increments', () => {
  const config = { ...SLIDER_MODULE_DEFAULT_CONFIG, step: 0.5 }
  expect(math.sliderKeyValue('ArrowRight', 3, config)).toBe(3.5)
  expect(math.sliderKeyValue('ArrowDown', 3, config)).toBe(2.5)
  expect(math.sliderKeyValue('Home', 3, config)).toBe(0)
  expect(math.sliderKeyValue('End', 3, config)).toBe(100)
  expect(math.sliderKeyValue('PageUp', 3, config)).toBe(8)
  expect(math.sliderKeyValue('Tab', 3, config)).toBeNull()
})

test('Slider track chooses the nearest range handle and ignores readonly or collapsed controls', () => {
  const config = { ...SLIDER_MODULE_DEFAULT_CONFIG, range: true }
  expect(math.sliderPointerTarget(20, 0, 120, [30, 70], config)).toEqual([0, 10])
  expect(math.sliderPointerTarget(90, 0, 120, [30, 70], config)).toEqual([1, 80])
  expect(math.sliderPointerTarget(90, 0, 120, [30, 70], { ...config, readOnly: true })).toBeNull()
  expect(math.sliderPointerTarget(90, 0, 20, [30, 70], config)).toBeNull()
})

test.each(['react', 'vue'] as const)(
  '%s Slider compiles and generated source type checks',
  (target) => {
    const result = sliderFixture(target)
    expect(result.warnings).toEqual([])
    expect(result.files.has(`src/__openpencil_slider.${target === 'react' ? 'tsx' : 'vue'}`)).toBe(
      true
    )
    const files = new Map<string, string>()
    for (const [path, content] of result.files)
      if (typeof content === 'string') files.set(path, content)
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  },
  35_000
)
