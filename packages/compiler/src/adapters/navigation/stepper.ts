import { STEPPER_LAYOUT } from '@open-pencil/core/plugins'

export const STEPPER_CONFIG_SOURCE = `export interface OpenPencilStepperItem {
  title: string
  description: string
  status: 'auto' | 'completed' | 'error'
  disabled: boolean
}
export interface OpenPencilStepperConfig {
  label: string
  items: readonly OpenPencilStepperItem[]
  currentIndex: number
  orientation: 'horizontal' | 'vertical'
  allowStepClick: boolean
  showNumbers: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
  errorColor: string
  fontSize: number
}
function stepState(item: OpenPencilStepperItem, index: number, current: number): string {
  return item.status !== 'auto' ? item.status : index < current ? 'completed' : index === current ? 'current' : 'pending'
}
function stepMark(item: OpenPencilStepperItem, index: number, current: number, numbers: boolean): string {
  const state = stepState(item, index, current)
  return state === 'completed' ? '✓' : state === 'error' ? '!' : numbers ? String(index + 1) : '•'
}
`
const HOST = '[data-openpencil-stepper]'
const ROW = `${HOST}>ol>li`
export const STEPPER_STYLE_SOURCE = `${HOST}{box-sizing:border-box;min-width:0;min-height:0;overflow:auto;font:var(--op-step-font)/1.4 system-ui,sans-serif}
${HOST}>ol{display:flex;list-style:none;margin:0;padding:16px;gap:12px;box-sizing:border-box;min-width:100%}
${ROW}{flex:1;min-width:${STEPPER_LAYOUT.horizontalMinWidth}px;position:relative}
${ROW}:not(:last-child)::after{content:'';position:absolute;top:15px;left:40px;right:0;height:2px;background:var(--op-step-muted)}
${ROW}[data-state=completed]:not(:last-child)::after{background:var(--op-step-accent)}
${ROW}>button,${ROW}>div{border:0;padding:0;display:flex;flex-direction:column;align-items:flex-start;gap:8px;color:inherit;background:transparent;font:inherit;text-align:start;width:100%;min-height:44px}
${ROW}>button{cursor:pointer;border-radius:6px}
${ROW}>button:focus-visible{outline:2px solid var(--op-step-accent);outline-offset:4px}
${ROW}>button:disabled{cursor:not-allowed}
${ROW}[data-disabled=true]{opacity:.5}
${ROW} [data-step-mark]{z-index:1;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:32px;height:32px;border:1px solid var(--op-step-muted);border-radius:50%;flex:none;font-weight:600;background:var(--op-step-background)}
${ROW}[data-state=current] [data-step-mark],${ROW}[data-state=completed] [data-step-mark]{background:var(--op-step-accent);color:white;border-color:var(--op-step-accent)}
${ROW}[data-state=error] [data-step-mark]{background:var(--op-step-error);color:white;border-color:var(--op-step-error)}
${ROW} [data-step-copy]{display:block;min-width:0;width:100%;padding-right:8px;box-sizing:border-box}
${ROW} [data-step-title]{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;line-height:${STEPPER_LAYOUT.titleLineHeight}}
${ROW} [data-step-description]{display:-webkit-box;-webkit-line-clamp:${STEPPER_LAYOUT.descriptionLines};-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;opacity:.75;font-size:${STEPPER_LAYOUT.descriptionTextScale}em;line-height:${STEPPER_LAYOUT.descriptionLineHeight}}
${HOST}[data-orientation=vertical]>ol{flex-direction:column;gap:0}
${HOST}[data-orientation=vertical]>ol>li{min-width:0;min-height:max(${STEPPER_LAYOUT.verticalMinHeight}px,calc(var(--op-step-font) * ${STEPPER_LAYOUT.titleLineHeight + STEPPER_LAYOUT.descriptionTextScale * STEPPER_LAYOUT.descriptionLineHeight * STEPPER_LAYOUT.descriptionLines} + ${STEPPER_LAYOUT.verticalGap}px));flex:none}
${HOST}[data-orientation=vertical]>ol>li>button,${HOST}[data-orientation=vertical]>ol>li>div{flex-direction:row;gap:12px}
${HOST}[data-orientation=vertical]>ol>li:not(:last-child)::after{top:40px;bottom:8px;left:15px;right:auto;width:2px;height:auto}
`
