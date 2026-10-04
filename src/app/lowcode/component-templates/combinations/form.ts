import { TEMPLATE_COLORS, templateSurface, type TemplateContext } from '../presentation'
import { addProfileFields } from './profile-fields'

export function addProfileForm(
  ctx: TemplateContext,
  parent: string,
  contentName?: string,
  defaults?: { name: string; email: string; reset: boolean }
) {
  const { copy } = ctx
  const name = ctx.state('name', 'string', defaults?.name ?? '')
  const email = ctx.state('email', 'string', defaults?.email ?? '')
  const result = ctx.state('result', 'string', copy('Not submitted', '尚未提交'))
  const form = ctx.node('FORM', parent, contentName ?? copy('Profile form', '资料表单'), {
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    itemSpacing: 12,
    counterAxisAlign: 'STRETCH',
    events: {
      onSubmit: [
        ctx.set(result, JSON.stringify(copy('Saved locally for this run', '已保存到本次运行')))
      ]
    }
  })
  addProfileFields(ctx, form, name, email)
  ctx.button(form, copy('Save locally', '本地保存'), [], false, true)
  ctx.feedback(
    form,
    result,
    defaults?.reset ? copy('Last submit', '上次提交') : copy('Status', '状态')
  )
  if (defaults?.reset) {
    ctx.node('BUTTON', form, copy('Reset draft', '重置草稿'), {
      ...templateSurface(TEMPLATE_COLORS.paper, true),
      interactiveProps: {
        text: copy('Reset draft', '重置草稿'),
        ariaLabel: copy('Reset draft', '重置草稿'),
        type: 'reset',
        textColor: TEMPLATE_COLORS.ink
      }
    })
  }
  return { form, name, email, result }
}
