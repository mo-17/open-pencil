import { createVideoModuleFrameOverrides } from '@open-pencil/core/plugins'

import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X } from './layout'
import type { BusinessScreen } from './screen'

/** Bind the current detail record; the reviewed player validates URLs again at playback time. */
export function renderBusinessVideo(screen: BusinessScreen): void {
  const player = screen.definition.videoPlayer
  if (!player) return
  const { ctx } = screen
  const title = ctx.label({ en: 'Video player', zh: '视频播放器' })
  const overrides = createVideoModuleFrameOverrides({
    controls: true,
    autoplay: false,
    fit: 'contain'
  })
  const y = screen.reserve(460)
  ctx.layout.text(
    screen.page,
    title,
    { x: BUSINESS_CONTENT_X, y, width: BUSINESS_CONTENT_WIDTH, height: 36 },
    { fontSize: 20 }
  )
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
      interactiveProps: {
        ...overrides.interactiveProps,
        lang: ctx.locale.startsWith('zh') ? 'zh-CN' : 'en'
      },
      width: BUSINESS_CONTENT_WIDTH,
      height: 400,
      renderCondition: screen.selection,
      bindings: {
        src: { kind: 'expr', expr: `${screen.selected}.${player.srcField}` },
        poster: { kind: 'expr', expr: `${screen.selected}.${player.posterField}` }
      }
    }
  )
}
