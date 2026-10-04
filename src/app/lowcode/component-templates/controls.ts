import {
  BREADCRUMB_MODULE_DEFINITION,
  RATING_MODULE_DEFINITION,
  SLIDER_MODULE_DEFINITION,
  STEPPER_MODULE_DEFINITION
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import { TEMPLATE_COLORS, type TemplateContext } from './presentation'

export type ControlTemplateId = 'slider' | 'range-slider' | 'rating' | 'stepper' | 'breadcrumb'
const CONTROL_IDS: ReadonlySet<string> = new Set<ControlTemplateId>([
  'slider',
  'range-slider',
  'rating',
  'stepper',
  'breadcrumb'
])

export function isControlTemplateId(id: string): id is ControlTemplateId {
  return CONTROL_IDS.has(id)
}

function controlFrame(ctx: TemplateContext, id: ControlTemplateId): Partial<SceneNode> {
  const { copy } = ctx
  const appearance = { backgroundColor: TEMPLATE_COLORS.paper, textColor: TEMPLATE_COLORS.ink }
  switch (id) {
    case 'slider':
    case 'range-slider':
      return SLIDER_MODULE_DEFINITION.createFrameOverrides({
        ...appearance,
        label: id === 'slider' ? copy('Volume', '音量') : copy('Preferred range', '偏好范围'),
        range: id === 'range-slider',
        min: 0,
        max: 100,
        step: 5,
        initialValue: id === 'slider' ? 40 : 25,
        initialEndValue: 75,
        accentColor: TEMPLATE_COLORS.accent
      })
    case 'rating':
      return RATING_MODULE_DEFINITION.createFrameOverrides({
        ...appearance,
        label: copy('Your experience', '使用体验'),
        clearLabel: copy('Clear rating', '清空评分'),
        allowHalf: true,
        initialValue: 3.5
      })
    case 'stepper':
      return STEPPER_MODULE_DEFINITION.createFrameOverrides({
        ...appearance,
        label: copy('Setup progress', '配置进度'),
        currentIndex: 1,
        allowStepClick: true,
        items: [
          {
            title: copy('Details', '资料'),
            description: copy('Add details', '填写资料'),
            status: 'auto',
            disabled: false
          },
          {
            title: copy('Review', '检查'),
            description: copy('Check details', '检查内容'),
            status: 'auto',
            disabled: false
          },
          {
            title: copy('Complete', '完成'),
            description: copy('Finish setup', '完成设置'),
            status: 'auto',
            disabled: false
          }
        ],
        accentColor: TEMPLATE_COLORS.accent
      })
    case 'breadcrumb':
      return BREADCRUMB_MODULE_DEFINITION.createFrameOverrides({
        ...appearance,
        label: copy('Page hierarchy', '页面层级'),
        items: [
          { label: copy('Home', '首页'), href: '#top' },
          { label: copy('Library', '组件库'), href: '' },
          { label: copy('Current page', '当前页面'), href: '' }
        ],
        accentColor: TEMPLATE_COLORS.accent
      })
  }
  throw new TypeError('Unsupported control template')
}

function controlHint(ctx: TemplateContext, id: ControlTemplateId): string {
  if (id === 'breadcrumb')
    return ctx.copy(
      'Home returns to the page top. Replace links with your existing page paths.',
      '首页返回页面顶部；请按需将链接替换为已有页面路径。'
    )
  if (id === 'stepper')
    return ctx.copy(
      'The step and navigation buttons share page state. Switching steps does not validate or submit a form.',
      '步骤与导航按钮共用页面状态；切换步骤不会校验或提交表单。'
    )
  return ctx.copy(
    'Bound to page state. Form rules and submission must be configured explicitly; no persistence.',
    '已绑定页面状态；表单校验与提交需单独配置，不持久化。'
  )
}

export function addTemplateControl(
  ctx: TemplateContext,
  parent: string,
  id: ControlTemplateId
): void {
  const frame = controlFrame(ctx, id)
  const values = { slider: 40, 'range-slider': 25, rating: 3.5, stepper: 1, breadcrumb: 0 }
  const initialValue = values[id]
  const value = id !== 'breadcrumb' ? ctx.localState('value', 'number', initialValue) : undefined
  const end = id === 'range-slider' ? ctx.localState('endValue', 'number', 75) : undefined
  if (value)
    frame.bindings = {
      [id === 'stepper' ? 'currentIndex' : 'value']: { kind: 'ref', stateId: value },
      ...(end ? { endValue: { kind: 'ref' as const, stateId: end } } : {})
    }
  ctx.node('FRAME', parent, frame.name ?? id, {
    ...frame,
    width: 320,
    counterAxisSizing: 'FILL',
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
  if (value && id === 'stepper') addStepNavigation(ctx, parent, value)
  if (value)
    ctx.feedback(
      parent,
      value,
      id === 'stepper' ? ctx.copy('Current step index', '当前步骤索引') : undefined
    )
  if (end) ctx.feedback(parent, end, ctx.copy('End value', '结束值'))
  ctx.text(parent, controlHint(ctx, id), { fontSize: 12 })
}

function addStepNavigation(ctx: TemplateContext, parent: string, value: string): void {
  for (const [label, delta] of [
    [ctx.copy('Previous step', '上一步'), -1],
    [ctx.copy('Next step', '下一步'), 1]
  ] as const) {
    const valid = `${value} + 0 === ${value} && ${value} >= 0 && ${value} <= 2 && ${value} % 1 === 0`
    const canMove = `${valid} && ${value} ${delta === -1 ? '> 0' : '< 2'}`
    const move = ctx.set(value, `(${canMove}) ? ${value} + (${delta}) : ${value}`)
    const button = ctx.button(parent, label, [move], true)
    ctx.editor.updateNodeWithUndo(button, {
      bindings: {
        disabled: {
          kind: 'expr',
          expr: `!(${canMove})`
        }
      }
    })
  }
  ctx.button(parent, ctx.copy('Reset steps', '重置步骤'), [ctx.set(value, '1')], true)
}
