import { lowcodeSelectOptions, type LowcodeSelectOption } from '@open-pencil/lowcode'

type SelectProperties = Record<string, unknown>
type SelectOptionEdit =
  | { kind: 'add'; label: string }
  | { kind: 'update'; index: number; patch: Partial<LowcodeSelectOption> }
  | { kind: 'remove'; index: number }
  | { kind: 'move'; index: number; offset: -1 | 1 }

/** Keep option edits and their literal default atomic. Never rewrite bound state. */
export function editSelectOptions(
  props: SelectProperties,
  edit: SelectOptionEdit
): SelectProperties {
  const previous = lowcodeSelectOptions(props.options)
  if (edit.kind !== 'add' && (!Number.isInteger(edit.index) || !previous[edit.index])) return props
  const options = previous.slice()
  if (edit.kind === 'add') {
    let suffix = 1
    while (options.some((option) => option.value === `option-${suffix}`)) suffix++
    options.push({ label: edit.label, value: `option-${suffix}` })
  } else if (edit.kind === 'remove') options.splice(edit.index, 1)
  else if (edit.kind === 'update') options[edit.index] = { ...options[edit.index], ...edit.patch }
  else {
    const target = edit.index + edit.offset
    if (!options[target]) return props
    ;[options[edit.index], options[target]] = [options[target], options[edit.index]]
  }
  const next: SelectProperties = { ...props, options }
  if (props.multiple === true && Array.isArray(props.value)) {
    next.value = [
      ...new Set(
        props.value.flatMap((value) => {
          if (typeof value !== 'string') return []
          if (edit.kind === 'remove' && previous[edit.index].value === value) return []
          if (edit.kind === 'update' && previous[edit.index].value === value)
            return [options[edit.index].value]
          return [value]
        })
      )
    ]
    return next
  }
  if (typeof props.value !== 'string' || options.some((option) => option.value === props.value))
    return next
  // Preserve unrelated stale defaults for review; only adjust the option the user edited.
  if (edit.kind === 'update' && previous[edit.index].value === props.value) {
    next.value = options[edit.index].value
  } else if (edit.kind === 'remove' && previous[edit.index].value === props.value) {
    Reflect.deleteProperty(next, 'value')
  }
  return next
}

/** Index-based UI values keep empty strings and sentinel-looking values unambiguous. */
export function selectDefaultOption(props: SelectProperties, index: number): SelectProperties {
  const option =
    Number.isInteger(index) && index >= 0
      ? lowcodeSelectOptions(props.options).at(index)
      : undefined
  const next = { ...props }
  if (option) next.value = option.value
  else if (index === -1) Reflect.deleteProperty(next, 'value')
  return next
}

export function selectOptionIssues(props: SelectProperties): ('duplicate' | 'label' | 'missing')[] {
  const options = lowcodeSelectOptions(props.options)
  const issues: ('duplicate' | 'label' | 'missing')[] = []
  if (new Set(options.map((option) => option.value)).size !== options.length)
    issues.push('duplicate')
  if (options.some((option) => !option.label.trim())) issues.push('label')
  if (
    typeof props.value === 'string' &&
    !options.some((option) => option.value === props.value) &&
    !(
      props.value === '' &&
      ((typeof props.placeholder === 'string' && props.placeholder !== '') ||
        props.allowClear === true)
    )
  )
    issues.push('missing')
  if (
    props.multiple === true &&
    Array.isArray(props.value) &&
    props.value.some((value) => !options.some((option) => option.value === value))
  )
    issues.push('missing')
  return issues
}

/** A mode change converts literal defaults atomically; callers guard bound controls. */
export function selectMultipleMode(props: SelectProperties, multiple: boolean): SelectProperties {
  const current = props.value
  let value: unknown = current ?? ''
  if (multiple) {
    if (Array.isArray(current)) value = current
    else if (typeof current === 'string') {
      const isPlaceholder =
        current === '' &&
        !props.optionsSource &&
        !lowcodeSelectOptions(props.options).some((option) => option.value === '')
      value = isPlaceholder ? [] : [current]
    } else value = []
  } else if (Array.isArray(current)) {
    value = current.find((item) => typeof item === 'string') ?? ''
  }
  return { ...props, multiple, value }
}

export function toggleSelectDefault(props: SelectProperties, value: string): SelectProperties {
  const current = Array.isArray(props.value)
    ? props.value.filter((item): item is string => typeof item === 'string')
    : []
  return {
    ...props,
    value: current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
  }
}
