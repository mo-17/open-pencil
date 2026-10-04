import { createSlideMenuModuleFrameOverrides } from '@open-pencil/core/plugins'

import { type TemplateContext } from '../presentation'
import { addProfileForm } from './form'

export function addDrawerDetailsTemplate(ctx: TemplateContext, root: string): void {
  const { copy } = ctx
  const contentName = copy('Drawer profile form', '抽屉资料表单')
  const drawer = ctx.node('FRAME', root, copy('Profile drawer', '资料抽屉'), {
    ...createSlideMenuModuleFrameOverrides({
      presentation: 'menu',
      direction: 'right',
      triggerLabel: copy('Edit details', '编辑详情'),
      title: copy('Profile details', '资料详情'),
      description: copy('Changes stay in this run.', '更改仅保留在本次运行。'),
      items: [],
      contentChildName: contentName,
      panelSize: 360
    }),
    width: 320,
    height: 52,
    counterAxisSizing: 'FILL'
  })
  const profile = addProfileForm(ctx, drawer, contentName, {
    name: copy('Alex Chen', '陈明'),
    email: 'alex@example.com',
    reset: true
  })
  ctx.feedback(root, profile.name, copy('Draft name', '草稿姓名'))
  ctx.feedback(root, profile.email, copy('Draft email', '草稿邮箱'))
  ctx.feedback(root, profile.result, copy('Last submit', '上次提交'))
}
