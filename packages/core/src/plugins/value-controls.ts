import type { FormControlFieldDescriptor } from '@open-pencil/lowcode'
import { isPlainJSONObject, type SceneNode } from '@open-pencil/scene-graph'

import { resolveCascaderModule } from './cascader'
import { resolveDateRangeModule } from './date-range'
import { resolveRatingModule } from './rating'
import { resolveSliderModule } from './slider'
import { resolveTreeModule } from './tree'

export type ModuleValueField = FormControlFieldDescriptor

/** An optional HTML field name for a reviewed module endpoint. Empty removes the override. */
export function validModuleFieldName(value: string): boolean {
  return (
    /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(value) &&
    !['__proto__', 'prototype', 'constructor'].includes(value)
  )
}

/** Invalid authored metadata must not silently become a different FormData field. */
export function resolveModuleFieldName(
  node: SceneNode,
  key: ModuleValueField['key'],
  defaultName: string
): string | undefined {
  const raw = node.interactiveProps?.moduleFieldNames
  if (raw === undefined) return defaultName
  if (!isPlainJSONObject(raw)) return undefined
  if (Object.keys(raw).some((name) => name !== 'value' && name !== 'endValue')) return undefined
  const entry = Object.getOwnPropertyDescriptor(raw, key)
  if (!entry) return defaultName
  return typeof entry.value === 'string' && validModuleFieldName(entry.value)
    ? entry.value
    : undefined
}

/** Only host-reviewed, fully parsed modules can become writable controls. */
export function moduleValueFields(node: SceneNode): ModuleValueField[] {
  if (node.type !== 'FRAME') return []
  const raw = node.interactiveProps?.module
  const slider = resolveSliderModule(raw)
  if (slider?.ok)
    return [
      {
        key: 'value',
        validationKey: 'validation',
        type: 'number',
        initialValue: slider.config.initialValue
      },
      ...(slider.config.range
        ? [
            {
              key: 'endValue' as const,
              validationKey: 'endValidation' as const,
              type: 'number' as const,
              initialValue: slider.config.initialEndValue
            }
          ]
        : [])
    ]
  const rating = resolveRatingModule(raw)
  if (rating?.ok)
    return [
      {
        key: 'value',
        validationKey: 'validation',
        type: 'number',
        initialValue: rating.config.initialValue
      }
    ]
  const dates = resolveDateRangeModule(raw)
  if (dates?.ok)
    return [
      {
        key: 'value',
        validationKey: 'validation',
        type: 'string',
        initialValue: dates.config.initialStart
      },
      {
        key: 'endValue',
        validationKey: 'endValidation',
        type: 'string',
        initialValue: dates.config.initialEnd
      }
    ]
  const cascader = resolveCascaderModule(raw)
  if (cascader?.ok)
    return [
      {
        key: 'value',
        validationKey: 'validation',
        type: 'array',
        initialValue: cascader.config.initialPath
      }
    ]
  const tree = resolveTreeModule(raw)
  if (tree?.ok)
    return [
      {
        key: 'value',
        validationKey: 'validation',
        type: tree.config.selectionMode === 'single' ? 'string' : 'array',
        initialValue:
          tree.config.selectionMode === 'single'
            ? (tree.config.initialSelectedIds[0] ?? '')
            : [...tree.config.initialSelectedIds]
      }
    ]
  return []
}
