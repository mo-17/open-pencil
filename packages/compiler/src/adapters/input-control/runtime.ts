import { colorInputRuntimeSource } from './color'

/** Shared native-input behavior; no document access until a mounted adapter calls it. */
export function inputControlRuntimeSource(): string {
  return `export type InputControlConfig = { kind: 'number'; showStepper: boolean; placement: 'end' | 'sides' } | { kind: 'password' } | { kind: 'color'; readOnly: boolean }
export const inputControlCSS = \`
@layer components {
[data-op-input-control]{display:inline-flex;align-items:stretch;box-sizing:border-box;min-width:0;gap:8px}
[data-op-input-control]:focus-within{outline:2px solid Highlight;outline-offset:2px}
[data-op-input-control] > input{min-width:0;width:0;flex:1 1 0%;height:100%;box-sizing:border-box;margin:0;padding:0;border:0;border-radius:inherit;background:transparent;color:inherit;font:inherit;letter-spacing:inherit;outline:none}
[data-op-input-control] > input[type=number]{appearance:textfield;-moz-appearance:textfield}
[data-op-input-control] > input::-webkit-inner-spin-button,[data-op-input-control] > input::-webkit-outer-spin-button{appearance:none;margin:0}
[data-op-input-control] > [data-input-actions]{display:flex;flex:none;align-self:stretch;min-height:0}
[data-op-input-control] > [data-input-actions=end]{flex-direction:column;width:28px;border-inline-start:1px solid color-mix(in srgb,currentColor 18%,transparent)}
[data-op-input-control] > [data-input-actions] > button{display:flex;align-items:center;justify-content:center;flex:1 1 0%;min-width:0;min-height:0;width:28px;box-sizing:border-box;padding:0;border:0;border-radius:3px;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1;cursor:pointer}
[data-op-input-control] > [data-input-actions] > button:hover:not(:disabled){background:color-mix(in srgb,currentColor 9%,transparent)}
[data-op-input-control] > [data-input-actions] > button:focus-visible{outline:2px solid currentColor;outline-offset:-3px}
[data-op-input-control] > [data-input-actions] > button:disabled{opacity:.4;cursor:default}
[data-op-input-control] > [data-input-actions] svg{width:16px;height:16px;pointer-events:none}
[data-op-input-control] > [data-input-actions=toggle] > button{width:24px}
[data-color-swatch]{position:relative;display:block;flex:0 0 auto;width:28px;max-width:50%;height:28px;max-height:100%;align-self:center;overflow:hidden;border:1px solid #94a3b8;border-radius:4px}
[data-color-swatch] > input{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;opacity:0;cursor:pointer}
[data-color-swatch]:focus-within{outline:2px solid Highlight;outline-offset:2px}
[data-color-swatch] > input:disabled{cursor:default}
}
\`

/** A deliberate click uses native decimal/step-base/clamping behavior, never parseFloat arithmetic. */
export function stepInput(input: HTMLInputElement, direction: 1 | -1): string | undefined {
  if (input.disabled || input.readOnly || input.type !== 'number' || input.step === 'any') return undefined
  const previous = input.value
  try { if (direction === 1) input.stepUp(); else input.stepDown() }
  catch (error) { if (error instanceof Error && error.name === 'InvalidStateError') return undefined; throw error }
  const next = input.value
  // Leave framework ownership intact until its adapter dispatches one native input event.
  input.value = previous
  return next === previous ? undefined : next
}

/** Wait for all reset listeners and the native default action, including cancellation. */
export function listenInputReset(input: HTMLInputElement, restore: () => void): () => void {
  const form = input.form, win = input.ownerDocument.defaultView
  if (!form || !win) return () => {}
  const pending = new Set<number>()
  let disposed = false
  const reset = (event: Event) => {
    const timer = win.setTimeout(() => {
      pending.delete(timer)
      if (!disposed && !event.defaultPrevented && input.isConnected && input.form === form) restore()
    }, 0)
    pending.add(timer)
  }
  form.addEventListener('reset', reset)
  return () => { disposed = true; form.removeEventListener('reset', reset); for (const timer of pending) win.clearTimeout(timer); pending.clear() }
}

${colorInputRuntimeSource()}
export function mountInputControl(wrapper: HTMLElement, input: HTMLInputElement, initial: InputControlConfig, commit: (value: string) => void) {
  const document = input.ownerDocument
  let config = initial, identity = '', revealed = false, disposed = false
  let groups: HTMLElement[] = [], buttons: HTMLButtonElement[] = []
  let colorControl: ReturnType<typeof mountColorInput> | undefined
  const label = (english: string, chinese: string) => (input.closest('[lang]')?.getAttribute('lang') ?? document.documentElement.lang).toLowerCase().startsWith('zh') ? chinese : english
  function clear() { colorControl?.destroy(); colorControl=undefined; for (const group of groups) group.remove(); groups = []; buttons = [] }
  function group(position: string) {
    const element = document.createElement('span')
    element.setAttribute('data-input-actions', position)
    if (position === 'start') wrapper.insertBefore(element, input); else wrapper.append(element)
    groups.push(element)
    return element
  }
  function button(parent: HTMLElement, action: 'up' | 'down' | 'reveal') {
    const element = document.createElement('button')
    element.type = 'button'; element.setAttribute('data-input-action', action)
    element.addEventListener('click', () => {
      if (disposed || input.disabled) return
      if (action === 'reveal') {
        revealed = !revealed
        input.type = revealed ? 'text' : 'password'
        refresh()
      } else {
        const next = stepInput(input, action === 'up' ? 1 : -1)
        if (next !== undefined) commit(next)
        refresh()
      }
    })
    parent.append(element); buttons.push(element)
    return element
  }
  function eye(element: HTMLElement) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','1.8'); svg.setAttribute('aria-hidden','true')
    const outline = document.createElementNS(svg.namespaceURI, 'path')
    outline.setAttribute('d','M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0')
    svg.append(outline)
    if (revealed) { const slash = document.createElementNS(svg.namespaceURI,'path'); slash.setAttribute('d','m3 3 18 18'); svg.append(slash) }
    element.replaceChildren(svg)
  }
  function refresh() {
    colorControl?.refresh()
    for (const element of buttons) {
      const action = element.getAttribute('data-input-action')
      element.disabled = input.disabled || (action !== 'reveal' && (input.readOnly || input.step === 'any'))
      if (action === 'reveal') {
        element.setAttribute('aria-label', revealed ? label('Hide password','隐藏密码') : label('Show password','显示密码'))
        element.setAttribute('aria-pressed', String(revealed)); eye(element)
      } else {
        element.setAttribute('aria-label', action === 'up' ? label('Increase value','增加数值') : label('Decrease value','减少数值'))
        element.textContent = config.kind === 'number' && config.placement === 'end' ? action === 'up' ? '⌃' : '⌄' : action === 'up' ? '+' : '−'
      }
    }
  }
  function update(next: InputControlConfig, authoredType = next.kind) {
    if (disposed) return
    config = next
    const nextIdentity = JSON.stringify([next, authoredType])
    if (identity !== nextIdentity) {
      identity = nextIdentity; clear(); revealed = false
      if (next.kind === 'color') { input.type='text'; colorControl=mountColorInput(wrapper,input,()=>config.kind==='color' && config.readOnly,commit,label) }
      else if (next.kind === 'password') { input.type = 'password'; button(group('toggle'),'reveal') }
      else {
        input.type = 'number'
        if (next.showStepper) {
          if (next.placement === 'sides') { button(group('start'),'down'); button(group('finish'),'up') }
          else { const actions = group('end'); button(actions,'up'); button(actions,'down') }
        }
      }
    } else if (next.kind === 'password') input.type = revealed ? 'text' : 'password'
    refresh()
  }
  const reset = () => { colorControl?.refresh(); if (config.kind === 'password') { revealed = false; input.type = 'password'; refresh() } }
  // Ancestor locale changes need not rerender a Vue child whose props are stable.
  const Observer = document.defaultView?.MutationObserver
  const localeObserver = Observer ? new Observer(() => { if (!disposed) refresh() }) : undefined
  if (localeObserver) {
    for (let ancestor: Element | null = input; ancestor; ancestor = ancestor.parentElement)
      localeObserver.observe(ancestor, { attributes: true, attributeFilter: ['lang'] })
    localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }
  input.addEventListener('input', refresh)
  update(initial)
  return { update, reset, destroy() { disposed = true; localeObserver?.disconnect(); clear(); input.removeEventListener('input',refresh); if (config.kind === 'password') input.type = 'password' } }
}
`
}
