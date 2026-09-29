import type { TemplateContext } from './presentation'

export function addBoundInputTemplate(
  ctx: TemplateContext,
  root: string,
  id: 'autocomplete' | 'time-picker'
): void {
  const time = id === 'time-picker'
  const value = ctx.localState(time ? 'time' : 'destination', 'string', time ? '09:30' : '')
  ctx.field(
    root,
    'INPUT',
    time ? ctx.copy('Start time', '开始时间') : ctx.copy('Destination', '目的地'),
    value,
    time
      ? { inputType: 'time', min: '08:00', max: '18:00', step: 900 }
      : {
          inputType: 'text',
          placeholder: ctx.copy('Type or choose a city', '输入或选择城市'),
          suggestions: ctx.zh ? ['厦门', '泉州', '福州'] : ['Xiamen', 'Quanzhou', 'Fuzhou'],
          autoComplete: 'off'
        }
  )
  ctx.feedback(root, value)
}
