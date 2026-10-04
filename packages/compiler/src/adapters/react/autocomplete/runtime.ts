/** A real input remains the only successful form control and event target. */
export function reactAutocompleteSource(microfrontend = false): string {
  const portalImport = microfrontend
    ? 'import { microfrontendPortalTarget } from "../__microfrontend-context"\n'
    : ''
  return `import * as React from "react"
import { mountAutocomplete, type AutocompleteConfig } from "../lib/open-pencil-autocomplete"
${portalImport}
type Props = React.InputHTMLAttributes<HTMLInputElement> & { suggestions: string[]; formResetFieldKey?: string; onExternalRebase?: () => void }
export function OpenPencilAutocomplete({ suggestions, formResetFieldKey, onExternalRebase, ...attributes }: Props) {
  const input = React.useRef<HTMLInputElement>(null)
  const controller = React.useRef<ReturnType<typeof mountAutocomplete> | null>(null)
  const attributesRef = React.useRef(attributes)
  attributesRef.current = attributes
  const resetKey = React.useRef(formResetFieldKey)
  resetKey.current = formResetFieldKey
  const previousValue = React.useRef(attributes.value)
  const ownValue = React.useRef<string | undefined>(undefined)
  const acceptedValue = React.useRef<string | undefined>(undefined)
  React.useLayoutEffect(() => {
    if (previousValue.current === attributes.value) return
    previousValue.current = attributes.value
    const next = String(attributes.value ?? '')
    const own = ownValue.current === next || acceptedValue.current === next
    ownValue.current = undefined; acceptedValue.current = undefined
    if (!own) onExternalRebase?.()
  }, [attributes.value, onExternalRebase])
  function remember(event: React.ChangeEvent<HTMLInputElement>) {
    ownValue.current = event.currentTarget.value
    attributes.onChange?.(event)
  }
  const config: AutocompleteConfig = {
    suggestions,
    ${microfrontend ? 'portalRoot: microfrontendPortalTarget() ?? undefined,' : ''}
    onSelect(value) {
      const element = input.current
      const win = element?.ownerDocument.defaultView
      if (!element || !win || element.disabled || element.readOnly) return
      // Bypass React's value tracker so its existing onChange receives one native input event.
      const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")?.set
      setter?.call(element, value)
      element.dispatchEvent(new win.Event("input", { bubbles: true, composed: true }))
      element.dispatchEvent(new win.Event("change", { bubbles: true, composed: true }))
    }
  }
  const latest = React.useRef(config)
  latest.current = config
  React.useEffect(() => {
    const element = input.current
    if (!element) return
    controller.current = mountAutocomplete(element, latest.current)
    const form = element.form
    let accepted = false
    const reset = (event: Event) => {
      accepted = false
      queueMicrotask(() => {
        if (accepted || event.defaultPrevented || !element.isConnected) return
        const value = attributesRef.current.value
        if (value !== undefined) element.value = String(value)
        controller.current?.update(latest.current)
      })
    }
    const acceptedReset = (event: Event) => {
      const key = resetKey.current
      const values = (event as CustomEvent<{ values?: Record<string, unknown> }>).detail?.values
      if (!key || !values || !Object.prototype.hasOwnProperty.call(values,key)) return
      const next = values[key]
      if (typeof next !== 'string') return
      accepted = true
      acceptedValue.current = next
      element.value = next
      controller.current?.update(latest.current)
    }
    form?.addEventListener("reset", reset)
    form?.addEventListener('__openPencilFormResetAccepted', acceptedReset)
    return () => { form?.removeEventListener("reset", reset); form?.removeEventListener('__openPencilFormResetAccepted', acceptedReset);controller.current?.destroy(); controller.current = null }
  }, [attributes.form])
  React.useEffect(() => { controller.current?.update(latest.current) })
  return <input {...attributes} ref={input} onChange={remember} role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" autoComplete="off" />
}
`
}
