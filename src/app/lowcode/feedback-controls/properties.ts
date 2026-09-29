import type { JSONObject } from '@open-pencil/scene-graph/primitives'

/** Hidden fields keep their configured value when an author changes presentation mode. */
export function feedbackPropertyVisible(
  pluginId: string | undefined,
  key: string,
  config: JSONObject
): boolean {
  const inputVisible = inputPropertyVisible(pluginId, key, config)
  if (inputVisible !== undefined) return inputVisible
  if (pluginId === 'open-pencil.skeleton') return skeletonPropertyVisible(key, config)
  if (pluginId === 'open-pencil.empty-state' && ['iconSize', 'illustrationColor'].includes(key))
    return config.illustration !== 'none'
  if (pluginId === 'open-pencil.alert' && key === 'closeLabel') return config.closable === true
  if (pluginId === 'open-pencil.avatar' && key === 'borderRadius') return config.shape === 'rounded'
  if (pluginId === 'open-pencil.badge' && ['count', 'max', 'showZero', 'label'].includes(key))
    return config.mode === 'count'
  if (pluginId === 'open-pencil.chip') {
    if (key === 'initialSelected') return config.selectable === true
    if (key === 'deleteLabel' || key === 'removedLabel') return config.deletable === true
  }
  if (pluginId === 'open-pencil.progress') {
    if (key === 'diameter') return config.variant === 'circular'
    if (key === 'pendingLabel') return config.indeterminate === true
    if (key === 'value' || key === 'showValue') return config.indeterminate !== true
  }
  return true
}

export function feedbackControlHint(pluginId: string | undefined, locale: string): string {
  const zh = locale.toLowerCase().startsWith('zh')
  const inputHint = inputControlHint(pluginId, zh)
  if (inputHint) return inputHint
  if (pluginId === 'open-pencil.tooltip')
    return zh
      ? '画布显示触发器；在运行预览中悬停或聚焦查看提示，按 Escape 关闭。仅支持纯文本补充说明。'
      : 'The canvas shows the trigger. Hover or focus it in the running preview; press Escape to dismiss. Plain-text supplemental hints only.'
  if (pluginId === 'open-pencil.skeleton')
    return zh
      ? '画布为静态占位；运行预览支持脉冲动画并尊重减少动态效果设置。请通过显示条件连接真实加载状态。'
      : 'The canvas shows a static placeholder. Runtime pulse respects reduced motion. Connect visibility to your actual loading state.'
  if (pluginId === 'open-pencil.empty-state')
    return zh
      ? '这是内容占位，不会自动判断业务数据。可通过显示条件控制出现时机，操作按钮请使用普通按钮并配置事件。'
      : 'This is a presentation placeholder, not automatic data detection. Configure its visibility; use ordinary buttons and events for actions.'
  if (pluginId === 'open-pencil.avatar')
    return zh
      ? '使用下方填充面板选择本地图片；没有可用图片时显示回退文字。'
      : 'Choose a local image in the Fill panel below. Unavailable images display fallback text.'
  if (pluginId === 'open-pencil.badge')
    return zh
      ? '数字为配置示例，不是实时未读数；圆点仅作装饰。目前支持文字宿主。'
      : 'Counts are authored examples, not live unread data. Dots are decorative. Text hosts are supported.'
  if (pluginId === 'open-pencil.timeline')
    return zh
      ? '本地事件展示；时间为文字，顺序由项目列表决定。'
      : 'Local event presentation. Time is text; the item list determines order.'
  if (pluginId === 'open-pencil.progress')
    return zh
      ? '这里配置展示进度，尚未连接真实任务。不确定进度不显示百分比；画布静态示意，运行预览支持动画。'
      : 'Configured presentation only; no live task connection. Indeterminate progress has no percentage. The canvas is static; runtime animation is supported.'
  if (pluginId === 'open-pencil.alert' || pluginId === 'open-pencil.chip')
    return zh
      ? '选择、关闭或移除仅作用于当前预览实例；不会删除设计节点或保存业务数据。修改配置或重新挂载后重置。'
      : 'Selection and dismissal affect this preview instance only; no design node or business data is deleted. Configuration changes or remounting reset the instance.'
  return ''
}

function skeletonPropertyVisible(key: string, config: JSONObject): boolean {
  if (['rows', 'lineHeight', 'gap', 'lastLineWidth'].includes(key)) return config.variant === 'text'
  if (key === 'borderRadius') return config.variant !== 'circle'
  if (['textColor', 'fontSize'].includes(key)) return config.showLabel === true
  return true
}

function inputPropertyVisible(
  pluginId: string | undefined,
  key: string,
  config: JSONObject
): boolean | undefined {
  if (pluginId === 'open-pencil.chart') return key !== 'labels'
  if (
    pluginId === 'open-pencil.popover' &&
    ['confirmLabel', 'cancelLabel', 'accentColor'].includes(key)
  )
    return config.mode === 'confirm'
  if (pluginId === 'open-pencil.tree' && key === 'placeholder')
    return config.presentation === 'select'
  return undefined
}

function inputControlHint(pluginId: string | undefined, zh: boolean): string {
  if (pluginId === 'open-pencil.popover')
    return zh
      ? '画布显示触发器；内容子图层替代正文。确认与取消仅显示本地反馈，不执行业务操作。'
      : 'The canvas shows the trigger; a content layer replaces the body text. Confirm and cancel provide local feedback only, without business actions.'
  if (pluginId === 'open-pencil.date-range' || pluginId === 'open-pencil.tree')
    return zh
      ? '选择只保存在当前预览实例中；尚未接入表单提交、页面状态或远程数据。配置变化或重新挂载后重置。'
      : 'Selection stays in this preview instance; FORM submission, page-state and remote data are not connected. Configuration changes or remounting reset it.'
  return ''
}
