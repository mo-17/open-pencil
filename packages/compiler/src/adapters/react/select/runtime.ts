/** Framework ownership stays in this small adapter; the shared controller owns
 * the trigger's children and popup, never the hidden select's option. */
export function reactSelectSource(microfrontend = false): string {
  const portalImport = microfrontend
    ? 'import { microfrontendPortalTarget } from "../__microfrontend-context"\n'
    : ''
  return `import * as React from "react"
import { flushSync } from "react-dom"
import { mountSelect, type SelectConfig, type SelectOption } from "../lib/open-pencil-select"
export { selectOptionText } from "../lib/open-pencil-select"
${portalImport}
type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children" | "size"> & {
  options: SelectOption[]
  showSearch: boolean
  virtual: boolean
  searchLabel?: string
  emptyLabel?: string
  allowClear?: boolean
  placeholder?: string
}

type SelectValue = string | string[]
function requestedValue(value: unknown, multiple = false): SelectValue {
  return multiple ? Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [] : String(value ?? "")
}
function initialValue(value: Props["defaultValue"], options: SelectOption[], multiple = false): SelectValue {
  if (multiple) return (requestedValue(value, true) as string[]).filter(item => options.some(option => option.value === item))
  const requested = value === undefined ? undefined : String(value)
  if (requested !== undefined && options.some(option => option.value === requested)) return requested
  return options.find(option => !option.disabled)?.value ?? ""
}

export function OpenPencilSelect(props: Props) {
  const { options, showSearch, virtual, value, defaultValue, className, style, id,
    disabled, autoFocus, tabIndex, title, name, form, required, onChange, onClick, onInvalid,
    onFocus, onBlur, searchLabel, emptyLabel, multiple = false, allowClear, placeholder, ...attributes } = props
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const selectRef = React.useRef<HTMLSelectElement>(null)
  const controller = React.useRef<ReturnType<typeof mountSelect> | null>(null)
  const [internal, setInternal] = React.useState(() =>
    value === undefined ? initialValue(defaultValue, options, multiple) : requestedValue(value, multiple))
  const controlled = value !== undefined
  const selected = controlled ? requestedValue(value, multiple) : multiple
    ? (Array.isArray(internal) ? internal : []).filter(item => options.some(option => option.value === item))
    : options.some(option => option.value === internal) ? internal : initialValue(defaultValue, options)
  const latest = React.useRef({ selected, controlled, defaultValue, options, disabled, multiple })
  latest.current = { selected, controlled, defaultValue, options, disabled, multiple }

  React.useLayoutEffect(() => { setInternal(previous => JSON.stringify(previous) === JSON.stringify(selected) ? previous : selected) }, [JSON.stringify(selected)])

  const config: SelectConfig = {
    options, showSearch, virtual, value: selected, disabled, searchLabel, emptyLabel, multiple, allowClear, placeholder,
    ${microfrontend ? 'portalRoot: microfrontendPortalTarget() ?? undefined,' : ''}
    onSelect(next) {
      const select = selectRef.current
      if (!select || latest.current.disabled) return
      // Commit the one rendered option before dispatching the native event.
      // Existing generated handlers therefore read the requested value, even
      // when the document-state write and validation occur in the same event.
      flushSync(() => setInternal(next))
      if (Array.isArray(next)) { for (const option of select.options) option.selected = next.includes(option.value) }
      else select.value = next
      flushSync(() => select.dispatchEvent(new Event("change", { bubbles: true })))
      if (latest.current.controlled) setInternal(latest.current.selected)
    },
    onFocus() { selectRef.current?.dispatchEvent(new FocusEvent("focusin", { bubbles: true })) },
    onBlur() { selectRef.current?.dispatchEvent(new FocusEvent("focusout", { bubbles: true })) }
  }
  const configRef = React.useRef(config)
  configRef.current = config
  React.useLayoutEffect(() => {
    const trigger = triggerRef.current
    const select = selectRef.current
    if (!trigger || !select) return
    controller.current = mountSelect(trigger, select, configRef.current)
    const reset = (event: Event) => {
      queueMicrotask(() => {
        const element = selectRef.current
        if (event.defaultPrevented || !element) return
        if (latest.current.controlled) {
          const next = latest.current.selected
          if (Array.isArray(next)) { for (const option of element.options) option.selected = next.includes(option.value) }
          else element.value = next
        } else setInternal(initialValue(latest.current.defaultValue, latest.current.options, latest.current.multiple))
      })
    }
    const owner = select.form
    owner?.addEventListener("reset", reset)
    return () => {
      owner?.removeEventListener("reset", reset)
      controller.current?.destroy()
      controller.current = null
    }
  }, [form])
  React.useLayoutEffect(() => { controller.current?.update(configRef.current) })

  const chosen = Array.isArray(internal) ? internal : [internal]
  const selectedOptions = options.filter(option => chosen.includes(option.value))
  const visualAttributes: React.HTMLAttributes<HTMLButtonElement> = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => key.startsWith("aria-") || key.startsWith("data-") ||
      key === "role" || key === "dir" || key === "lang"))
  return <>
    <button {...visualAttributes} ref={triggerRef} type="button" id={id} className={className}
      aria-required={required ? true : attributes["aria-required"]}
      style={style} disabled={disabled} autoFocus={autoFocus} tabIndex={tabIndex} title={title}
      onFocus={event => event.stopPropagation()} onBlur={event => event.stopPropagation()}
      onClick={onClick ? event => {
        event.stopPropagation()
        selectRef.current?.dispatchEvent(new MouseEvent("click", { bubbles: true,
          clientX: event.clientX, clientY: event.clientY, button: event.button,
          ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey }))
      } : undefined} />
    <select ref={selectRef} multiple={multiple} name={name} form={form} required={required} disabled={disabled}
      tabIndex={-1} aria-hidden="true" value={internal}
      style={{ position: "absolute", width: 1, height: 1, padding: 0, border: 0,
        overflow: "hidden", clipPath: "inset(50%)", pointerEvents: "none" }}
      onChange={event => { setInternal(multiple ? Array.from(event.currentTarget.selectedOptions, option => option.value) : event.currentTarget.value); onChange?.(event) }}
      onInvalid={event => { event.preventDefault(); triggerRef.current?.focus(); onInvalid?.(event) }}
      onClick={onClick} onFocus={onFocus} onBlur={onBlur}>
      {selectedOptions.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  </>
}
`
}
