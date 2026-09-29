import { ALERT_CLOSE_PATH, ALERT_ICON_PATHS, ALERT_TONE_PALETTE } from '@open-pencil/core/plugins'

export const ALERT_CONFIG_SOURCE = `export interface OpenPencilAlertConfig {
  tone: 'info' | 'success' | 'warning' | 'error'
  variant: 'soft' | 'outlined' | 'filled'
  title: string
  description: string
  showIcon: boolean
  closable: boolean
  closeLabel: string
  fontSize: number
  borderRadius: number
  announcement: 'polite' | 'assertive' | 'off'
}`

export const ALERT_RUNTIME_SOURCE = `const alertPalette = ${JSON.stringify(ALERT_TONE_PALETTE)}
const alertIcons = ${JSON.stringify(ALERT_ICON_PATHS)}
const alertClosePath = ${JSON.stringify(ALERT_CLOSE_PATH)}
function alertKey(config: OpenPencilAlertConfig): string {
  return JSON.stringify([config.tone,config.variant,config.title,config.description,config.showIcon,config.closable,config.closeLabel,config.fontSize,config.borderRadius,config.announcement])
}
function alertColors(config: OpenPencilAlertConfig) {
  const palette = alertPalette[config.tone]
  return {background:config.variant === 'filled' ? palette.accent : config.variant === 'outlined' ? '#FFFFFF' : palette.background,
    color:config.variant === 'filled' ? '#FFFFFF' : palette.foreground,
    borderColor:config.variant === 'filled' ? palette.accent : palette.border,
    borderRadius:config.borderRadius+'px',fontSize:config.fontSize+'px'}
}
function alertRole(config: OpenPencilAlertConfig): 'status' | 'alert' | 'group' {
  return config.announcement === 'assertive' ? 'alert' : config.announcement === 'off' ? 'group' : 'status'
}
const alertFocusable = 'button,a[href],input,select,textarea,[tabindex]'
function alertFocusCandidate(node: Element): HTMLElement | undefined {
  const candidates = [node,...node.querySelectorAll(alertFocusable)]
  return candidates.find((candidate): candidate is HTMLElement => candidate instanceof HTMLElement && candidate.matches(alertFocusable)
    && candidate.tabIndex >= 0 && !candidate.matches(':disabled,[aria-disabled="true"]') && !candidate.closest('[hidden],[inert],[aria-hidden="true"]')
    && getComputedStyle(candidate).visibility !== 'hidden' && candidate.getClientRects().length > 0)
}
/** Search only neighboring siblings in this alert's parent. Never jump to global navigation. */
function focusAfterAlertDismiss(host: HTMLElement): void {
  if (!host.contains(document.activeElement)) return
  const parent = host.parentElement
  if (!parent) return
  const siblings = Array.from(parent.children), index = siblings.indexOf(host)
  const neighbors = [...siblings.slice(index+1),...siblings.slice(0,index).reverse()]
  for (const sibling of neighbors) {
    const candidate = alertFocusCandidate(sibling)
    if (candidate) { candidate.focus({preventScroll:true}); return }
  }
  if (parent === document.body || parent === document.documentElement || parent.closest('[hidden],[inert]')) return
  const tabindex = parent.getAttribute('tabindex')
  if (tabindex !== null) { parent.focus({preventScroll:true}); return }
  parent.setAttribute('tabindex','-1')
  // Removing tabindex while focused makes browsers drop focus. Clean up only after leaving.
  const restore = (): void => { if(parent.getAttribute('tabindex') === '-1') parent.removeAttribute('tabindex') }
  parent.addEventListener('blur',restore,{once:true})
  parent.focus({preventScroll:true})
  if (document.activeElement !== parent) { parent.removeEventListener('blur',restore);restore() }
}
`

const HOST = '[data-openpencil-alert]'
export const ALERT_STYLE_SOURCE = `${HOST}{box-sizing:border-box;min-width:0;min-height:0;overflow:auto;border:1px solid;padding:15px;font-family:system-ui,sans-serif;line-height:1.5;text-align:start}
${HOST}[hidden]{display:none!important}
${HOST} [data-alert-layout]{display:flex;align-items:flex-start;gap:12px;min-width:0}
${HOST} [data-alert-icon]{display:block;flex:0 0 20px;width:20px;height:20px;margin-top:0}
${HOST} [data-alert-copy]{flex:1 1 0;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}
${HOST} [data-alert-title]{display:block;font-weight:600;margin:0}
${HOST} [data-alert-description]{margin:0}
${HOST} [data-alert-title]+[data-alert-description]{margin-top:4px}
${HOST} [data-alert-close]{box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;padding:4px;margin:-4px 0 0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:inherit}
${HOST} [data-alert-close]:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
${HOST} [data-alert-close]:focus-visible{outline:2px solid currentColor;outline-offset:1px}
${HOST} [data-alert-close] svg{display:block;width:20px;height:20px;flex-shrink:0}
`
