import { STEPPER_MODULE_DEFINITION } from '@open-pencil/core/plugins'
import type { ActionDef } from '@open-pencil/scene-graph'

import { TEMPLATE_COLORS, type TemplateContext } from '../presentation'
import { addProfileFields } from './profile-fields'

function stageForm(
  ctx: TemplateContext,
  parent: string,
  label: string,
  condition: string,
  actions: ActionDef[]
): string {
  return ctx.node('FORM', parent, label, {
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisAlign: 'STRETCH',
    itemSpacing: 12,
    renderCondition: condition,
    events: { onSubmit: actions }
  })
}

/** Each mounted stage owns an ordinary FORM; Stepper itself grants no validation authority. */
export function addStepperFormTemplate(ctx: TemplateContext, root: string): void {
  const { copy } = ctx
  const step = ctx.localState('step', 'number', 0)
  const name = ctx.state('name', 'string', '')
  const email = ctx.state('email', 'string', '')
  const direction = ctx.state('direction', 'string', '')
  const pending = JSON.stringify(copy('Not completed', '尚未完成'))
  const result = ctx.state('result', 'string', copy('Not completed', '尚未完成'))
  const frame = STEPPER_MODULE_DEFINITION.createFrameOverrides({
    label: copy('Profile setup', '资料填写进度'),
    currentIndex: 0,
    allowStepClick: false,
    items: [
      { title: copy('Profile', '资料'), description: '', status: 'auto', disabled: false },
      { title: copy('Preferences', '偏好'), description: '', status: 'auto', disabled: false },
      { title: copy('Review', '检查'), description: '', status: 'auto', disabled: false }
    ],
    backgroundColor: TEMPLATE_COLORS.paper,
    textColor: TEMPLATE_COLORS.ink,
    accentColor: TEMPLATE_COLORS.accent
  })
  ctx.node('FRAME', root, copy('Profile steps', '资料步骤'), {
    ...frame,
    counterAxisSizing: 'FILL',
    bindings: { currentIndex: { kind: 'ref', stateId: step } },
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
  const profile = stageForm(ctx, root, copy('Profile stage', '资料阶段'), `${step} === 0`, [
    ctx.set(result, pending),
    ctx.set(step, '1')
  ])
  addProfileFields(ctx, profile, name, email)
  ctx.button(profile, copy('Continue to preferences', '继续填写偏好'), [], false, true)
  const preferences = stageForm(ctx, root, copy('Preferences stage', '偏好阶段'), `${step} === 1`, [
    ctx.set(result, pending),
    ctx.set(step, '2')
  ])
  ctx.field(preferences, 'SELECT', copy('Project direction', '项目方向'), direction, {
    placeholder: copy('Choose a direction', '选择项目方向'),
    options: [
      { label: copy('Design', '设计'), value: 'design' },
      { label: copy('Development', '开发'), value: 'development' },
      { label: copy('Research', '研究'), value: 'research' }
    ],
    validation: {
      required: true,
      messages: { required: copy('Choose a project direction', '请选择项目方向') }
    }
  })
  ctx.button(preferences, copy('Continue to review', '继续检查内容'), [], false, true)
  const review = ctx.stack(root, copy('Review stage', '检查阶段'), {
    renderCondition: `${step} === 2`
  })
  ctx.feedback(review, name, copy('Name', '姓名'))
  ctx.feedback(review, email, copy('Email', '邮箱'))
  ctx.feedback(
    review,
    `${direction} === "design" ? ${JSON.stringify(copy('Design', '设计'))} : ${direction} === "development" ? ${JSON.stringify(copy('Development', '开发'))} : ${direction} === "research" ? ${JSON.stringify(copy('Research', '研究'))} : ""`,
    copy('Project direction', '项目方向')
  )
  ctx.button(review, copy('Complete locally', '在本地完成'), [
    ctx.set(result, JSON.stringify(copy('Completed for this run', '已在本次运行中完成')))
  ])
  const canReturn = `${step} + 0 === ${step} && ${step} % 1 === 0 && ${step} > 0 && ${step} <= 2`
  const previous = ctx.button(
    root,
    copy('Previous step', '上一步'),
    [ctx.set(result, pending), ctx.set(step, `(${canReturn}) ? ${step} - 1 : ${step}`)],
    true
  )
  ctx.editor.updateNodeWithUndo(previous, {
    bindings: { disabled: { kind: 'expr', expr: `!(${canReturn})` } }
  })
  // Cross-stage restart is explicit state mutation, not the mounted FORM reset contract.
  ctx.button(
    root,
    copy('Start again', '开始重填'),
    [
      ctx.set(name, '""'),
      ctx.set(email, '""'),
      ctx.set(direction, '""'),
      ctx.set(result, pending),
      ctx.set(step, '0')
    ],
    true
  )
  ctx.feedback(root, result, copy('Status', '状态'))
  ctx.text(
    root,
    copy(
      'Continue after completing each step. Going back keeps your draft; completion stays in this run.',
      '每步填写有效内容后继续。返回保留草稿；完成结果仅保留在本次运行。'
    ),
    { fontSize: 12 }
  )
}
