/** Per-instance native input draft; business state remains a finite number. */
export function reactNumberInputSource(): string {
  return `import * as React from 'react'
import { incompleteNumberMessage, parseNumericDraft } from '../lib/open-pencil-number-draft'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue'> & {
  value: number
  formResetFieldKey?: string
  onExternalRebase?: () => void
  as?: React.ElementType
}

export function OpenPencilNumberInput({ value, formResetFieldKey, onExternalRebase, as, onChange, onBlur, ...attributes }: Props) {
  const input = React.useRef<HTMLInputElement>(null)
  const priorValue = React.useRef(value)
  const committedValue = React.useRef(value)
  const ownCommit = React.useRef<number | undefined>(undefined)
  const uncommittedDraft = React.useRef(false)
  const Element = as ?? 'input'

  const restoreDraft = (element: HTMLInputElement, next: number) => {
    element.value = String(next)
    element.defaultValue = String(next)
    element.setCustomValidity('')
    committedValue.current = next
    uncommittedDraft.current = false
    ownCommit.current = undefined
  }

  React.useLayoutEffect(() => {
    const element = input.current
    if (!element || Object.is(priorValue.current, value)) return
    const external = !Object.is(ownCommit.current, value)
    if (external) restoreDraft(element, value)
    element.defaultValue = String(value)
    priorValue.current = value
    committedValue.current = value
    ownCommit.current = undefined
    if (external) onExternalRebase?.()
  }, [value, onExternalRebase])

  React.useEffect(() => {
    const element = input.current
    const form = element?.form
    if (!element || !form) return
    const restore = (event: Event) => {
      const detail = (event as CustomEvent<{ values?: Record<string, unknown> }>).detail
      const next = formResetFieldKey ? detail?.values?.[formResetFieldKey] : undefined
      if (typeof next !== 'number' || !Number.isFinite(next) || element.form !== form) return
      restoreDraft(element, next)
      priorValue.current = next
    }
    const submit = () => {
      if (element.form === form && uncommittedDraft.current && !element.required)
        restoreDraft(element, committedValue.current)
    }
    if (formResetFieldKey) form.addEventListener('__openPencilFormResetAccepted', restore)
    form.addEventListener('submit', submit, true)
    return () => {
      form.removeEventListener('__openPencilFormResetAccepted', restore)
      form.removeEventListener('submit', submit, true)
    }
  }, [formResetFieldKey, attributes.form])

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const element = event.currentTarget
    const next = parseNumericDraft(element.value, element, event.nativeEvent)
    ownCommit.current = next
    uncommittedDraft.current = next === undefined
    if (next !== undefined) committedValue.current = next
    element.setCustomValidity(next === undefined && element.required && element.value !== ''
      ? incompleteNumberMessage(element)
      : '')
    onChange?.(event)
  }

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    const element = event.currentTarget
    if (uncommittedDraft.current && !element.required)
      restoreDraft(element, committedValue.current)
    onBlur?.(event)
  }

  const required = attributes.required ?? (attributes['aria-required'] === true || attributes['aria-required'] === 'true')
  return <Element {...attributes} ref={input} defaultValue={value} required={required} onChange={handleChange} onBlur={handleBlur} />
}
`
}
