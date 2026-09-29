import type { TemplateContext } from './presentation'

type AdvancedInputTemplateId = 'date-time-picker' | 'number-input' | 'password-input'

export function isAdvancedInputTemplateId(id: string): id is AdvancedInputTemplateId {
  return id === 'date-time-picker' || id === 'number-input' || id === 'password-input'
}

export function addAdvancedInputTemplate(
  ctx: TemplateContext,
  root: string,
  id: AdvancedInputTemplateId
): void {
  if (id === 'password-input') {
    const value = ctx.localState('password', 'string', '')
    ctx.field(root, 'INPUT', ctx.copy('Password', '密码'), value, {
      inputType: 'password',
      showPasswordToggle: true,
      autoComplete: 'new-password',
      placeholder: ctx.copy('Enter a password', '输入密码')
    })
    ctx.text(
      root,
      ctx.copy(
        'The reveal button changes visibility only. This example does not save credentials.',
        '显隐按钮只改变显示方式，此示例不保存凭据。'
      ),
      { fontSize: 12 }
    )
    return
  }
  const dateTime = id === 'date-time-picker'
  const value = ctx.localState(
    dateTime ? 'appointment' : 'quantity',
    'string',
    dateTime ? '2026-09-28T09:30' : '2'
  )
  ctx.field(
    root,
    'INPUT',
    dateTime ? ctx.copy('Appointment', '预约时间') : ctx.copy('Quantity', '数量'),
    value,
    dateTime
      ? {
          inputType: 'datetime-local',
          min: '2026-01-01T00:00',
          max: '2026-12-31T23:59',
          step: 900
        }
      : {
          inputType: 'number',
          min: 0,
          max: 99,
          step: 1,
          showStepper: true,
          stepperPlacement: 'sides'
        }
  )
  ctx.feedback(root, value)
}
