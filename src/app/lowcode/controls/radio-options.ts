type RadioProps = Record<string, unknown>

type RadioOptionEdit =
  | { kind: 'add' }
  | { kind: 'rename'; index: number; value: string }
  | { kind: 'remove'; index: number }

export function radioOptions(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : []
}

/** Keep the literal default and its option list in one undoable change. Bindings
 * and their state belong to separate domains and are never rewritten here. */
export function editRadioOptions(props: RadioProps, edit: RadioOptionEdit): RadioProps {
  const previous = radioOptions(props.options)
  if (edit.kind !== 'add' && (!Number.isInteger(edit.index) || !(edit.index in previous))) {
    return props
  }
  let options: string[]
  if (edit.kind === 'add') options = [...previous, '']
  else if (edit.kind === 'remove') options = previous.filter((_, index) => index !== edit.index)
  else options = previous.map((value, index) => (index === edit.index ? edit.value : value))
  const next = { ...props, options }
  if (typeof props.value !== 'string') return next
  if (props.value !== '' && options.includes(props.value)) return next
  if (edit.kind === 'rename' && previous[edit.index] === props.value && edit.value !== '') {
    return { ...next, value: edit.value }
  }
  Reflect.deleteProperty(next, 'value')
  return next
}

/** The select uses option indexes, so every authored string (including the
 * generic panel's default sentinel) remains a legal radio value. */
export function selectRadioDefault(props: RadioProps, index: number): RadioProps {
  const value = radioOptions(props.options)[index]
  const next = { ...props }
  if (typeof value === 'string' && value !== '') next.value = value
  else Reflect.deleteProperty(next, 'value')
  return next
}
