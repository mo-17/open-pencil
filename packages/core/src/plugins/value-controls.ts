import type { FormControlFieldDescriptor } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveCascaderModule } from './cascader'
import { resolveDateRangeModule } from './date-range'
import { resolveRatingModule } from './rating'
import { resolveSliderModule } from './slider'

export type ModuleValueField = FormControlFieldDescriptor
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
  return []
}
