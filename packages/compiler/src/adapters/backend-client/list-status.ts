import type { IRList } from '#compiler/ir/types'

import { escapeAttr } from '../vue/shared'

const STATUS_STYLE = {
  maxWidth: 'calc(100% - 16px)',
  boxSizing: 'border-box',
  zIndex: '1',
  padding: '6px 10px',
  border: '1px solid GrayText',
  borderRadius: '6px',
  background: 'Canvas',
  color: 'CanvasText',
  fontSize: '14px',
  lineHeight: '20px',
  overflowWrap: 'anywhere',
  pointerEvents: 'none'
}
const RETAINED_POSITION = { position: 'absolute', insetBlockStart: '8px', insetInlineEnd: '8px' }
const EMPTY_POSITION = {
  position: 'relative',
  gridColumn: '1 / -1',
  alignSelf: 'start',
  justifySelf: 'start',
  margin: '8px'
}
const RETRY_STYLE = {
  marginInlineStart: '8px',
  padding: '4px 10px',
  minHeight: '44px',
  maxWidth: '100%',
  border: '1px solid currentColor',
  borderRadius: '4px',
  background: 'Canvas',
  color: 'CanvasText',
  font: 'inherit',
  cursor: 'pointer',
  pointerEvents: 'auto'
}
function cssStyle(style: Record<string, string>): string {
  return Object.entries(style)
    .map(
      ([key, value]) => `${key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())}: ${value}`
    )
    .join('; ')
}
export function backendListStatusStyleExpression(state: string): string {
  return `{ ...(${JSON.stringify(STATUS_STYLE)} as const), ...(${state}.hasRows ? (${JSON.stringify(RETAINED_POSITION)} as const) : (${JSON.stringify(EMPTY_POSITION)} as const)) }`
}

/** Render inside the authored LIST container without wrapping or restyling its rows. */
export function emitReactBackendListStatus(node: IRList, indent: number): string {
  if (!node.backendResourceId) return ''
  const pad = '  '.repeat(indent)
  const state = `${node.arrayName}Status`
  const retry = `${node.arrayName}Control.subscription?.retry()`
  const resource = JSON.stringify(node.backendResourceId)
  return `${pad}<div data-backend-list-status=${resource} data-list-state={${state}.phase} hidden={${state}.phase === 'idle' || ${state}.phase === 'ready'} role="status" aria-live="polite" aria-busy={${state}.phase === 'loading' || ${state}.phase === 'refreshing'} style={${backendListStatusStyleExpression(state)}}>
${pad}  <span>{__opBackend.backendResourceText(${state})}</span>
${pad}  {${state}.phase === 'error' && <button type="button" data-backend-list-retry=${resource} style={${JSON.stringify(RETRY_STYLE)}} onClick={() => ${retry}}>{__opBackend.backendResourceRetryText()}</button>}
${pad}</div>\n`
}

export function emitVueBackendListStatus(node: IRList, rows: string, indent: number): string {
  if (!node.backendResourceId) return ''
  const pad = '  '.repeat(indent)
  const state = `${rows}Status`
  const resource = escapeAttr(node.backendResourceId)
  return `${pad}<div data-backend-list-status="${resource}" :data-list-state="${state}.phase" :hidden="${state}.phase === 'idle' || ${state}.phase === 'ready'" role="status" aria-live="polite" :aria-busy="${state}.phase === 'loading' || ${state}.phase === 'refreshing'" :style="${rows}Style">
${pad}  <span>{{ __opBackend.backendResourceText(${state}) }}</span>
${pad}  <button v-if="${state}.phase === 'error'" type="button" data-backend-list-retry="${resource}" style="${cssStyle(RETRY_STYLE)}" @click="${rows}Control.subscription?.retry()">{{ __opBackend.backendResourceRetryText() }}</button>
${pad}</div>\n`
}
