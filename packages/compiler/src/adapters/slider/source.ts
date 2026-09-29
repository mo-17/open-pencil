/** Shared static source keeps React and Vue arithmetic, bounds, keyboard and appearance aligned. */
export const SLIDER_CONFIG_SOURCE = `export interface OpenPencilSliderConfig {
  label: string
  range: boolean
  min: number
  max: number
  step: number
  initialValue: number
  initialEndValue: number
  disabled: boolean
  readOnly: boolean
  showValue: boolean
  showBounds: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
  trackColor: string
  fontSize: number
}`

export const SLIDER_VALUE_SOURCE = `type SliderValues = [number, number]

function snapSliderValue(value: number, config: OpenPencilSliderConfig): number {
  const scale = 1000000
  const min = Math.round(config.min * scale), max = Math.round(config.max * scale)
  const step = Math.round(config.step * scale)
  const last = Math.floor((max - min) / step)
  const index = Math.max(0, Math.min(last, Math.round((value * scale - min) / step)))
  return (min + index * step) / scale
}

function initialSliderValues(config: OpenPencilSliderConfig): SliderValues {
  return [snapSliderValue(config.initialValue, config), snapSliderValue(config.initialEndValue, config)]
}

function changeSliderValue(values: SliderValues, index: number, value: number, config: OpenPencilSliderConfig): SliderValues {
  if (config.disabled || config.readOnly || !Number.isFinite(value)) return values
  const snapped = snapSliderValue(value, config)
  return index === 0
    ? [config.range ? Math.min(snapped, values[1]) : snapped, values[1]]
    : [values[0], Math.max(snapped, values[0])]
}

function sliderKeyValue(key: string, value: number, config: OpenPencilSliderConfig): number | null {
  if (key === 'Home') return config.min
  if (key === 'End') return config.max
  if (key === 'ArrowRight' || key === 'ArrowUp') return value + config.step
  if (key === 'ArrowLeft' || key === 'ArrowDown') return value - config.step
  if (key === 'PageUp') return value + config.step * 10
  if (key === 'PageDown') return value - config.step * 10
  return null
}

function sliderPercent(value: number, config: OpenPencilSliderConfig): string {
  return ((value - config.min) / (config.max - config.min) * 100) + '%'
}

function sliderValueText(values: SliderValues, config: OpenPencilSliderConfig): string {
  return config.range ? values[0] + ' – ' + values[1] : String(values[0])
}

function sliderPointerTarget(clientX: number, left: number, width: number, values: SliderValues, config: OpenPencilSliderConfig): [number, number] | null {
  if (config.disabled || config.readOnly || width <= 20) return null
  const ratio = Math.max(0, Math.min(1, (clientX - left - 10) / (width - 20)))
  const value = snapSliderValue(config.min + ratio * (config.max - config.min), config)
  const index = config.range && Math.abs(value - values[1]) < Math.abs(value - values[0]) ? 1 : 0
  return [index, value]
}`

export const SLIDER_STYLE_SOURCE = `[data-openpencil-slider]{box-sizing:border-box;min-width:0;max-width:100%;padding:16px;overflow:hidden;font-size:var(--openpencil-slider-font-size,14px);line-height:1.4}
[data-openpencil-slider][data-disabled=true]{opacity:.5}
[data-openpencil-slider] [data-slider-header]{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0;margin-bottom:4px}
[data-openpencil-slider] [data-slider-label]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
[data-openpencil-slider] output{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600;flex-shrink:0;color:var(--openpencil-slider-accent)}
[data-openpencil-slider] [data-slider-control]{position:relative;height:40px;min-width:0;direction:ltr}
[data-openpencil-slider] [data-slider-track]{position:absolute;inset:17px 10px auto;height:6px;background:var(--openpencil-slider-track);border-radius:999px;pointer-events:none}
[data-openpencil-slider] [data-slider-fill]{position:absolute;height:100%;border-radius:inherit;background:var(--openpencil-slider-accent)}
[data-openpencil-slider] input[type=range]{appearance:none;-webkit-appearance:none;position:absolute;inset:0;width:100%;min-width:0;height:40px;margin:0;padding:0;background:transparent;border:0;color:inherit;pointer-events:none;direction:ltr}
[data-openpencil-slider] input[type=range]::-webkit-slider-runnable-track{height:6px;background:transparent;border:0}
[data-openpencil-slider] input[type=range]::-moz-range-track{height:6px;background:transparent;border:0}
[data-openpencil-slider] input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:20px;height:20px;margin-top:-7px;background:var(--openpencil-slider-accent);border:3px solid var(--openpencil-slider-background);border-radius:50%;box-shadow:0 0 0 1px var(--openpencil-slider-accent);cursor:grab;pointer-events:auto}
[data-openpencil-slider] input[type=range]::-moz-range-thumb{box-sizing:border-box;width:20px;height:20px;background:var(--openpencil-slider-accent);border:3px solid var(--openpencil-slider-background);border-radius:50%;box-shadow:0 0 0 1px var(--openpencil-slider-accent);cursor:grab;pointer-events:auto}
[data-openpencil-slider] input[type=range]:focus-visible{outline:2px solid var(--openpencil-slider-accent);outline-offset:2px;border-radius:4px}
[data-openpencil-slider] input[type=range]:disabled::-webkit-slider-thumb,[data-openpencil-slider] input[type=range][aria-readonly=true]::-webkit-slider-thumb{cursor:default}
[data-openpencil-slider] input[type=range]:disabled::-moz-range-thumb,[data-openpencil-slider] input[type=range][aria-readonly=true]::-moz-range-thumb{cursor:default}
[data-openpencil-slider] [data-slider-bounds]{display:flex;justify-content:space-between;gap:8px;font-size:.85em;line-height:1.4;opacity:.7;font-variant-numeric:tabular-nums}
[data-openpencil-slider] [data-slider-bounds] span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`

export const SLIDER_FIELD_SOURCE = `function validSliderValue(value:unknown,config:OpenPencilSliderConfig):value is number {return typeof value==='number'&&Number.isFinite(value)&&value>=config.min&&value<=config.max&&Math.abs(snapSliderValue(value,config)-value)<0.0000001}
function sliderFieldValues(config:OpenPencilSliderConfig,props:OpenPencilModuleRangeProps<number>,local:SliderValues){
 const first=moduleFieldValue(props.value,props.valueBound,local[0],(value):value is number=>validSliderValue(value,config))
 const last=moduleFieldValue(props.endValue,props.endValueBound,local[1],(value):value is number=>validSliderValue(value,config))
 const crossed=config.range&&first.value!==undefined&&last.value!==undefined&&first.value>last.value
 return {fields:[first,last],shown:[first.value??config.min,last.value??snapSliderValue(config.max,config)] as SliderValues,crossed}
}`
