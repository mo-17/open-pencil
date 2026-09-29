/** Bounded sRGB hex input; never accepts alpha, CSS names or wider color spaces. */
export function isHexColorInputValue(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

export interface ColorInputIssue {
  code: 'color-input-invalid-value'
  key: 'value'
  severity: 'error'
  reason: string
}

/** Empty is an unselected business value, distinct from the native picker's black fallback. */
export function validateColorInputProps(props: Record<string, unknown>): ColorInputIssue[] {
  if (props.value === undefined || props.value === '' || isHexColorInputValue(props.value))
    return []
  return [
    {
      code: 'color-input-invalid-value',
      key: 'value',
      severity: 'error',
      reason: 'Color input values must be empty or a six-digit #RRGGBB string.'
    }
  ]
}
