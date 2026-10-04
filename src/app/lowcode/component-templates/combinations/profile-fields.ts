import type { TemplateContext } from '../presentation'

export function addProfileFields(
  ctx: TemplateContext,
  parent: string,
  name: string,
  email: string
): void {
  const { copy } = ctx
  ctx.field(parent, 'INPUT', copy('Name', '姓名'), name, {
    autoComplete: 'name',
    maxLength: 80,
    validation: { required: true, messages: { required: copy('Enter your name', '请输入姓名') } }
  })
  ctx.field(parent, 'INPUT', copy('Email', '邮箱'), email, {
    inputType: 'email',
    autoComplete: 'email',
    maxLength: 120,
    validation: {
      required: true,
      pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      messages: {
        required: copy('Enter your email', '请输入邮箱'),
        pattern: copy('Enter a valid email', '请输入有效邮箱')
      }
    }
  })
}
