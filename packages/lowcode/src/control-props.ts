/** Reviewed native-control values shared by authoring and generated web targets. */
export const LOWCODE_INPUT_TYPES = [
  'text',
  'email',
  'password',
  'number',
  'tel',
  'url',
  'search',
  'time',
  'datetime-local',
  'color'
] as const
export const LOWCODE_INPUT_MODES = [
  'none',
  'text',
  'decimal',
  'numeric',
  'tel',
  'search',
  'email',
  'url'
] as const
export const LOWCODE_AUTOCOMPLETE_VALUES = [
  'on',
  'off',
  'name',
  'given-name',
  'family-name',
  'email',
  'username',
  'new-password',
  'current-password',
  'one-time-code',
  'organization',
  'street-address',
  'address-line1',
  'address-line2',
  'postal-code',
  'country',
  'tel',
  'url'
] as const

export interface LowcodeSelectOption {
  label: string
  value: string
  disabled?: boolean
}

/** Fallback for clearable authored controls without a localized placeholder. */
export const DEFAULT_LOWCODE_SELECT_PLACEHOLDER = 'Select an option'

export function isLowcodeControlChoice(values: readonly string[], value: unknown): value is string {
  return typeof value === 'string' && values.includes(value)
}

/** Native number drafts stay strings; an empty draft is not the number zero. */
export function isLowcodeNumberValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === '' ||
      (/^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value))))
  )
}

/** Old string options retain the same display label and submitted value. */
export function parseLowcodeSelectOption(value: unknown): LowcodeSelectOption | undefined {
  if (typeof value === 'string') return { label: value, value }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== 'string' || !['label', 'value', 'disabled'].includes(key)
    )
  )
    return undefined
  const label = Object.getOwnPropertyDescriptor(value, 'label')
  const optionValue = Object.getOwnPropertyDescriptor(value, 'value')
  const disabled = Object.getOwnPropertyDescriptor(value, 'disabled')
  if (!label || !('value' in label) || typeof label.value !== 'string') return undefined
  if (!optionValue || !('value' in optionValue) || typeof optionValue.value !== 'string')
    return undefined
  if (disabled && (!('value' in disabled) || typeof disabled.value !== 'boolean')) return undefined
  return {
    label: label.value,
    value: optionValue.value,
    ...(disabled?.value === true ? { disabled: true } : {})
  }
}

export function lowcodeSelectOptions(value: unknown): LowcodeSelectOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const option = parseLowcodeSelectOption(entry)
    return option ? [option] : []
  })
}
