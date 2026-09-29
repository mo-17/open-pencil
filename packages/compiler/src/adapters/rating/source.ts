export const RATING_CONFIG_SOURCE = `export interface OpenPencilRatingConfig {
  label: string
  max: number
  initialValue: number
  allowHalf: boolean
  disabled: boolean
  readOnly: boolean
  showValue: boolean
  allowClear: boolean
  clearLabel: string
  activeColor: string
  inactiveColor: string
  textColor: string
  backgroundColor: string
  starSize: number
  fontSize: number
}
`

/** Shared interaction math; framework adapters own controlled or local state. */
export const RATING_INTERACTION_SOURCE = `function ratingKeyValue(key: string, value: number, max: number, step: number, rtl: boolean): number | null {
  if (key === 'Home') return 0
  if (key === 'End') return max
  const direction = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : key === 'ArrowRight' ? (rtl ? -1 : 1) : key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0
  return direction ? Math.max(0, Math.min(max, value + direction * step)) : null
}
function ratingPointerValue(event: {clientX: number}, element: HTMLElement, max: number, step: number): number {
  const bounds = element.getBoundingClientRect()
  if (bounds.width <= 0) return 0
  const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
  const position = getComputedStyle(element).direction === 'rtl' ? 1 - ratio : ratio
  return Math.min(max, Math.max(step, Math.ceil(position * max / step) * step))
}
`

const HOST = '[data-openpencil-rating]'
export const RATING_STYLE_SOURCE = `${HOST}{box-sizing:border-box;min-width:0;min-height:0;padding:12px;overflow:hidden;font:var(--rating-font-size)/1.4 system-ui,sans-serif}
${HOST} [data-rating-label]{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 0 8px}
${HOST} [data-rating-stars]{display:flex;direction:ltr;align-items:center;width:min(100%,calc(var(--rating-count) * var(--rating-size)));height:max(44px,var(--rating-size));max-width:100%;outline-offset:2px;border-radius:4px;cursor:pointer;touch-action:pan-y;user-select:none}
${HOST} [data-rating-stars]:focus-visible{outline:2px solid var(--rating-active)}
${HOST} [data-rating-stars][aria-disabled=true]{opacity:.45;cursor:not-allowed}
${HOST} [data-rating-stars][aria-readonly=true]{cursor:default}
${HOST} [data-rating-star]{flex:1 1 0;min-width:0;max-width:var(--rating-size);aspect-ratio:1;position:relative}
${HOST} [data-rating-star]>svg{display:block;width:100%;height:100%}
${HOST} [data-rating-fill]{position:absolute;inset:0;overflow:hidden}
${HOST} [data-rating-fill]>svg{display:block;width:100%;height:100%}
${HOST} [data-rating-footer]{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;margin-top:4px;min-width:0}
${HOST} output{white-space:nowrap;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
${HOST} [data-rating-clear]{background:transparent;border:0;color:inherit;border-radius:4px;font:inherit;cursor:pointer;min-height:32px;min-width:0;padding:4px 0;text-decoration:underline;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-inline-start:auto}
${HOST} [data-rating-clear]:focus-visible{outline:2px solid var(--rating-active);outline-offset:-2px}
${HOST} [data-rating-clear]:disabled{opacity:.45;cursor:default}
`

export const RATING_FIELD_SOURCE = `function ratingFieldValue(config:OpenPencilRatingConfig,props:OpenPencilModuleValueProps<number>,local:number){
 const result=moduleFieldValue(props.value,props.valueBound,local,(value):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=config.max&&Number.isInteger(value/(config.allowHalf?0.5:1)))
 return {...result,empty:result.empty||result.value===0}
}`
