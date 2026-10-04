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
export interface StepperInputs {
  currentIndex?: unknown
  currentIndexBound?: boolean
  disabled?: boolean
  readOnly?: boolean
}
export interface StepperChangeDetail { currentIndex: number; previousIndex: number }
function stepState(item: OpenPencilStepperItem, index: number, current: number | null): string {
  if (current === null) return item.status === 'auto' ? 'pending' : item.status
  return item.status !== 'auto' ? item.status : index < current ? 'completed' : index === current ? 'current' : 'pending'
}
function stepMark(item: OpenPencilStepperItem, index: number, current: number | null, numbers: boolean): string {
  const state = stepState(item, index, current)
  return state === 'completed' ? '✓' : state === 'error' ? '!' : numbers ? String(index + 1) : '•'
}
`

/** Typed shared runtime source stays stable through compiler minification. Core parity is tested. */
export const STEPPER_RUNTIME_SOURCE = `
function stepperCurrentIndex(config: OpenPencilStepperConfig, value: unknown, bound: boolean): number | null {
  const index = bound ? value : config.currentIndex
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 &&
    index < config.items.length && !config.items[index]?.disabled ? index : null
}
function stepperProjection(config: OpenPencilStepperConfig, inputs: StepperInputs, local: number, writable: boolean) {
  const current = stepperCurrentIndex(config, inputs.currentIndexBound ? inputs.currentIndex : local, true)
  const readOnly = Boolean(inputs.readOnly) || (Boolean(inputs.currentIndexBound) && !writable)
  return { current, invalid: current === null, disabled: Boolean(inputs.disabled), readOnly,
    interactive: current !== null && config.allowStepClick && !inputs.disabled && !readOnly }
}
function stepperKeyboardIndex(config: OpenPencilStepperConfig, focused: number, key: string): number | null {
  const indices = config.items.flatMap((item, index) => item.disabled ? [] : [index])
  if (!indices.length) return null
  if (key === 'Home') return indices[0]
  if (key === 'End') return indices[indices.length - 1]
  const direction = config.orientation === 'vertical'
    ? key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0
    : key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
  if (!direction) return null
  const position = indices.indexOf(focused)
  return indices[Math.max(0, Math.min(indices.length - 1, position + direction))]
}
function stepperStatus(current: number | null, count: number, language: string | undefined): string {
  const zh = typeof language === 'string' && /^zh(?:-|$)/i.test(language)
  if (current === null) return zh ? '当前步骤不可用，请检查数值绑定' : 'Current step unavailable; check numeric binding'
  return zh ? '步骤 ' + (current + 1) + ' / ' + count : 'Step ' + (current + 1) + ' of ' + count
}
function dispatchStepperChange(host: HTMLElement | null, currentIndex: number, previousIndex: number): void {
  const view = host?.ownerDocument.defaultView
  if (host && view) host.dispatchEvent(new view.CustomEvent<StepperChangeDetail>('stepschange', {
    bubbles: true, detail: { currentIndex, previousIndex }
  }))
}
function installStepperEvents(host: HTMLElement | null, change: (event: CustomEvent<StepperChangeDetail>) => void, reset: () => void): () => void {
  if (!host) return () => {}
  const form = host.closest('form'), view = host.ownerDocument.defaultView
  const changed = (event: Event) => {
    if (view && event instanceof view.CustomEvent && event.target === host)
      change(event as CustomEvent<StepperChangeDetail>)
  }
  const resetForm = (event: Event) => {
    if (event.target !== form) return
    queueMicrotask(() => { if (!event.defaultPrevented && host.isConnected && host.closest('form') === form) reset() })
  }
  host.addEventListener('stepschange', changed)
  form?.addEventListener('reset', resetForm)
  return () => { host.removeEventListener('stepschange', changed); form?.removeEventListener('reset', resetForm) }
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
${HOST}[data-disabled=true]{opacity:.5}
${HOST}>[data-step-status]{display:block;padding:0 16px 8px;font-size:.85em;overflow-wrap:anywhere}
${HOST}:not([data-invalid=true])>[data-step-status]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
${HOST}[data-invalid=true]{display:flex;flex-direction:column}
${HOST}[data-invalid=true]>[data-step-status]{order:-1;flex:none;padding:8px 16px 0;color:var(--op-step-error)}
${HOST}[data-invalid=true]>ol{flex:none}
`
