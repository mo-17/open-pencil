import { createVRTourModuleFrameOverrides } from '@open-pencil/core/plugins'

import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X } from './layout'
import type { BusinessScreen } from './screen'

/** The selected record supplies one URL, never executable or arbitrary module configuration. */
export function renderBusinessVRTour(screen: BusinessScreen): void {
  const field = screen.definition.vrTourField
  if (!field) return
  const { ctx } = screen
  const title = ctx.label({ en: 'VR property tour', zh: 'VR 看房' })
  const y = screen.reserve(460)
  ctx.layout.text(
    screen.page,
    title,
    { x: BUSINESS_CONTENT_X, y, width: BUSINESS_CONTENT_WIDTH, height: 36 },
    { fontSize: 20 }
  )
  const overrides = createVRTourModuleFrameOverrides({
    label: title,
    locale: ctx.locale.startsWith('zh') ? 'zh-CN' : 'en'
  })
  ctx.layout.shape(
    'FRAME',
    title,
    screen.page,
    BUSINESS_CONTENT_X,
    y + 44,
    BUSINESS_CONTENT_WIDTH,
    400,
    {
      ...overrides,
      width: BUSINESS_CONTENT_WIDTH,
      height: 400,
      renderCondition: screen.selection,
      bindings: { panoramaUrl: { kind: 'expr', expr: `${screen.selected}.${field}` } }
    }
  )
}
