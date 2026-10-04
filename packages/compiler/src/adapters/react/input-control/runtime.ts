export function reactInputControlSource(): string {
  return `import * as React from 'react'
import { mountInputControl, listenInputReset, inputControlCSS, type InputControlConfig } from '../lib/open-pencil-input-control'
import { parseNumericDraft, incompleteNumberMessage } from '../lib/open-pencil-number-draft'
type Props = React.InputHTMLAttributes<HTMLInputElement> & { config: InputControlConfig; formResetFieldKey?: string; onExternalRebase?: () => void; 'data-node-id'?: string }
export function OpenPencilInputControl({ config, formResetFieldKey, onExternalRebase, className, style, 'data-node-id': nodeId, ...attributes }: Props) {
  const input = React.useRef<HTMLInputElement>(null), wrapper = React.useRef<HTMLSpanElement>(null)
  const controller = React.useRef<ReturnType<typeof mountInputControl> | null>(null)
  const latest = React.useRef({config,attributes,formResetFieldKey}); latest.current = {config,attributes,formResetFieldKey}
  const ownNumber = React.useRef<number | undefined>(undefined)
  const ownValue = React.useRef<string | undefined>(undefined)
  const acceptedValue = React.useRef<string | undefined>(undefined)
  const uncommitted = React.useRef(false)
  const previousValue = React.useRef(attributes.value)
  const previousKind = React.useRef(config.kind)
  React.useLayoutEffect(() => {
    const element = input.current
    const valueChanged = previousValue.current !== attributes.value
    const changed = valueChanged || previousKind.current !== config.kind
    previousValue.current = attributes.value; previousKind.current = config.kind
    if (!element || !changed) return
    const nextValue = String(attributes.value ?? attributes.defaultValue ?? '')
    const ownCommit = config.kind === 'number'
      ? typeof attributes.value === 'number' && ownNumber.current === attributes.value
      : ownValue.current !== undefined && ownValue.current === nextValue
    const acceptedReset = acceptedValue.current !== undefined && acceptedValue.current === nextValue
    ownValue.current = undefined; acceptedValue.current = undefined
    if (ownCommit || acceptedReset) {
      ownNumber.current = undefined
      if (config.kind === 'number') element.defaultValue = nextValue
      return
    }
    ownNumber.current = undefined
    uncommitted.current = false
    if (config.kind === 'number') {
      element.value = nextValue
      element.defaultValue = nextValue
      element.setCustomValidity('')
    }
    if (valueChanged) onExternalRebase?.()
  }, [attributes.value, attributes.defaultValue, config.kind, onExternalRebase])
  function restoreBusinessNumber() {
    const element = input.current
    if (!element || latest.current.config.kind !== 'number') return
    element.value = String(latest.current.attributes.value ?? latest.current.attributes.defaultValue ?? '')
    element.defaultValue = element.value
    ownNumber.current = undefined
    uncommitted.current = false
    element.setCustomValidity('')
  }
  function numberRequired(element: HTMLInputElement) { return element.required || element.getAttribute('aria-required') === 'true' }
  function remember(event: React.ChangeEvent<HTMLInputElement>) {
    if (config.kind === 'number') {
      const raw = event.currentTarget.value
      ownNumber.current = parseNumericDraft(raw, event.currentTarget, event.nativeEvent)
      ownValue.current = ownNumber.current === undefined ? undefined : String(ownNumber.current)
      uncommitted.current = ownNumber.current === undefined
      event.currentTarget.setCustomValidity(uncommitted.current && numberRequired(event.currentTarget) && raw !== '' ? incompleteNumberMessage(event.currentTarget) : '')
    } else ownValue.current = event.currentTarget.value
    attributes.onChange?.(event)
  }
  function blur(event: React.FocusEvent<HTMLInputElement>) {
    if (config.kind === 'number' && uncommitted.current && !numberRequired(event.currentTarget)) restoreBusinessNumber()
    attributes.onBlur?.(event)
  }
  React.useEffect(() => {
    const element = input.current, host = wrapper.current
    if (!element || !host) return
    controller.current = mountInputControl(host,element,latest.current.config,value => {
      const win = element.ownerDocument.defaultView
      if (!win || element.disabled || (latest.current.config.kind === 'color' ? latest.current.config.readOnly : element.readOnly)) return
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value')?.set?.call(element,value)
      element.dispatchEvent(new win.Event('input',{bubbles:true,composed:true}))
      element.dispatchEvent(new win.Event('change',{bubbles:true,composed:true}))
    })
    const form = element.form
    let accepted = false
    const startingReset = () => { accepted = false }
    const submitting = () => { if (latest.current.config.kind === 'number' && uncommitted.current && !numberRequired(element)) restoreBusinessNumber() }
    const acceptedReset = (event: Event) => {
      const key = latest.current.formResetFieldKey
      const values = (event as CustomEvent<{ values?: Record<string, unknown> }>).detail?.values
      if (!key || !values || !Object.prototype.hasOwnProperty.call(values,key)) return
      const next = values[key]
      if (typeof next !== 'number' && typeof next !== 'string') return
      accepted = true
      acceptedValue.current = String(next)
      element.value = String(next)
      if (latest.current.config.kind === 'number') {
        ownNumber.current = undefined
        uncommitted.current = false
        element.defaultValue = String(next)
        element.setCustomValidity('')
      }
      controller.current?.reset()
    }
    form?.addEventListener('reset',startingReset)
    form?.addEventListener('submit',submitting,true)
    form?.addEventListener('__openPencilFormResetAccepted',acceptedReset)
    const unbindReset = listenInputReset(element, () => {
      if (accepted) return
      if (latest.current.attributes.value !== undefined) element.value = String(latest.current.attributes.value)
      if (latest.current.config.kind === 'number') {
        ownNumber.current = undefined
        uncommitted.current = false
        element.value = String(latest.current.attributes.value ?? latest.current.attributes.defaultValue ?? '')
        element.setCustomValidity('')
      }
      controller.current?.reset()
    })
    return () => { unbindReset();form?.removeEventListener('reset',startingReset);form?.removeEventListener('submit',submitting,true);form?.removeEventListener('__openPencilFormResetAccepted',acceptedReset);controller.current?.destroy(); controller.current = null }
  },[attributes.form])
  React.useEffect(() => { controller.current?.update(config,attributes.type as InputControlConfig['kind'] | undefined) })
  return <><style>{inputControlCSS}</style><span ref={wrapper} data-op-input-control={config.kind} data-node-id={nodeId} className={className} style={style}><input {...attributes} ref={input} type={config.kind === 'color' ? 'text' : config.kind} value={config.kind === 'number' ? undefined : attributes.value} defaultValue={config.kind === 'number' ? attributes.value ?? attributes.defaultValue : attributes.defaultValue} onChange={remember} onBlur={blur} required={config.kind === 'number' ? attributes.required ?? (attributes['aria-required'] === true || attributes['aria-required'] === 'true') : attributes.required} readOnly={config.kind === 'color' ? config.readOnly : attributes.readOnly} pattern={config.kind === 'color' ? '#[0-9a-fA-F]{6}' : attributes.pattern} placeholder={config.kind === 'color' ? attributes.placeholder ?? '—' : attributes.placeholder}/></span></>
}
`
}
