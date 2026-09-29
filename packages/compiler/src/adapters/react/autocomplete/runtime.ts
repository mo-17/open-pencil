/** A real input remains the only successful form control and event target. */
export function reactAutocompleteSource(microfrontend = false): string {
  const portalImport = microfrontend
    ? 'import { microfrontendPortalTarget } from "../__microfrontend-context"\n'
    : ''
  return `import * as React from "react"
import { mountAutocomplete, type AutocompleteConfig } from "../lib/open-pencil-autocomplete"
${portalImport}
type Props = React.InputHTMLAttributes<HTMLInputElement> & { suggestions: string[] }
export function OpenPencilAutocomplete({ suggestions, ...attributes }: Props) {
  const input = React.useRef<HTMLInputElement>(null)
  const controller = React.useRef<ReturnType<typeof mountAutocomplete> | null>(null)
  const attributesRef = React.useRef(attributes)
  attributesRef.current = attributes
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
    const reset = (event: Event) => queueMicrotask(() => {
      if (event.defaultPrevented || !element.isConnected) return
      const value = attributesRef.current.value
      if (value !== undefined) element.value = String(value)
      controller.current?.update(latest.current)
    })
    form?.addEventListener("reset", reset)
    return () => { form?.removeEventListener("reset", reset); controller.current?.destroy(); controller.current = null }
  }, [attributes.form])
  React.useEffect(() => { controller.current?.update(latest.current) })
  return <input {...attributes} ref={input} role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" autoComplete="off" />
}
`
}
