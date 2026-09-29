import {
  RATING_PLUGIN_ID,
  SLIDER_PLUGIN_ID,
  createSliderModuleInstance,
  normalizeSliderValue,
  resolveSliderModule,
  type ModulePropertyField
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

/** Authoring-only reconciliation. Imported configurations still use strict module parsers. */
export function reconcileValueControlConfig(
  pluginId: string | undefined,
  key: string,
  next: JSONObject
): JSONObject {
  if (pluginId === RATING_PLUGIN_ID && (key === 'max' || key === 'allowHalf'))
    return reconcileRatingConfig(next)
  if (
    pluginId === SLIDER_PLUGIN_ID &&
    ['min', 'max', 'step', 'range', 'initialValue', 'initialEndValue'].includes(key)
  )
    return reconcileSliderConfig(key, next)
  return next
}

function reconcileRatingConfig(next: JSONObject): JSONObject {
  if (
    typeof next.max !== 'number' ||
    !Number.isInteger(next.max) ||
    next.max < 1 ||
    next.max > 10 ||
    typeof next.initialValue !== 'number' ||
    typeof next.allowHalf !== 'boolean'
  )
    return next
  const step = next.allowHalf ? 0.5 : 1
  return {
    ...next,
    initialValue: Math.max(0, Math.min(next.max, Math.round(next.initialValue / step) * step))
  }
}

function reconcileSliderConfig(key: string, next: JSONObject): JSONObject {
  const { min, max, step, initialValue, initialEndValue } = next
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    typeof step !== 'number' ||
    typeof initialValue !== 'number' ||
    typeof initialEndValue !== 'number' ||
    min >= max
  )
    return next
  const start = Math.max(min, Math.min(max, initialValue))
  const end = Math.max(min, Math.min(max, initialEndValue))
  const candidate = {
    ...next,
    step: key === 'min' || key === 'max' ? Math.min(step, Number((max - min).toFixed(6))) : step,
    initialValue: start,
    initialEndValue: next.range === true ? Math.max(start, end) : end
  }
  try {
    const result = resolveSliderModule(createSliderModuleInstance(candidate))
    if (!result?.ok) return next
    return {
      ...candidate,
      initialValue: normalizeSliderValue(start, result.config),
      initialEndValue: normalizeSliderValue(candidate.initialEndValue, result.config)
    }
  } catch {
    return next
  }
}

export function valueControlPropertyVisible(
  pluginId: string | undefined,
  key: string,
  config: JSONObject
): boolean {
  if (pluginId === SLIDER_PLUGIN_ID && key === 'initialEndValue') return config.range === true
  if (pluginId === RATING_PLUGIN_ID && key === 'clearLabel') return config.allowClear === true
  return true
}

export function valueControlNumberField(
  pluginId: string | undefined,
  field: ModulePropertyField,
  config: JSONObject
): ModulePropertyField {
  const key = field.path[0]
  if (pluginId === RATING_PLUGIN_ID && key === 'initialValue' && typeof config.max === 'number')
    return { ...field, min: 0, max: config.max, step: config.allowHalf === true ? 0.5 : 1 }
  if (
    pluginId !== SLIDER_PLUGIN_ID ||
    typeof config.min !== 'number' ||
    typeof config.max !== 'number' ||
    typeof config.step !== 'number'
  )
    return field
  if (key === 'initialValue' || key === 'initialEndValue') {
    const min =
      key === 'initialEndValue' && config.range === true && typeof config.initialValue === 'number'
        ? config.initialValue
        : config.min
    const max =
      key === 'initialValue' && config.range === true && typeof config.initialEndValue === 'number'
        ? config.initialEndValue
        : config.max
    return { ...field, min, max, step: config.step }
  }
  return field
}
