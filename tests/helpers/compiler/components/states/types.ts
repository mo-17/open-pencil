export const STATE_FAMILIES = [
  'slider',
  'range',
  'rating',
  'date-range',
  'cascader',
  'tree',
  'tree-select',
  'stepper'
] as const
export type StateFamily = (typeof STATE_FAMILIES)[number]
export type StateLocale = 'en' | 'zh-CN'
export const CONTROL_STATES = ['normal', 'disabled', 'readonly'] as const
export const CANVAS_STATE_FAMILIES = [...STATE_FAMILIES, 'rich-text'] as const
export type CanvasStateFamily = (typeof CANVAS_STATE_FAMILIES)[number]
