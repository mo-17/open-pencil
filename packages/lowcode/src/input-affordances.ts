/** Optional input controls preserve the existing scalar value and FORM contract. */
export type InputControlConfig =
  | { kind: 'number'; showStepper: boolean; placement: 'end' | 'sides' }
  | { kind: 'password' }
  | { kind: 'color'; readOnly: boolean }

export interface InputAffordanceIssue {
  code: 'input-affordance-invalid-type' | 'input-affordance-incompatible'
  key: 'showStepper' | 'stepperPlacement' | 'showPasswordToggle'
  severity: 'error'
  reason: string
}

export function validateInputAffordances(props: Record<string, unknown>): InputAffordanceIssue[] {
  const issues: InputAffordanceIssue[] = []
  for (const key of ['showStepper', 'stepperPlacement', 'showPasswordToggle'] as const) {
    const value = props[key]
    if (value === undefined) continue
    const valid =
      key === 'stepperPlacement' ? value === 'end' || value === 'sides' : typeof value === 'boolean'
    if (!valid) {
      issues.push({
        code: 'input-affordance-invalid-type',
        key,
        severity: 'error',
        reason:
          key === 'stepperPlacement'
            ? 'Stepper placement must be end or sides.'
            : `${key} must be a boolean.`
      })
    }
    const type = key === 'showPasswordToggle' ? 'password' : 'number'
    if (props.inputType !== type) {
      issues.push({
        code: 'input-affordance-incompatible',
        key,
        severity: 'error',
        reason: `${key} is supported only on ${type} inputs.`
      })
    }
  }
  return issues
}

/** Undefined keeps the existing native input; explicit false hides number spinners. */
export function inputControlConfig(props: Record<string, unknown>): InputControlConfig | undefined {
  if (props.inputType === 'color') return { kind: 'color', readOnly: props.readOnly === true }
  if (validateInputAffordances(props).length > 0) return undefined
  if (props.inputType === 'password' && props.showPasswordToggle === true)
    return { kind: 'password' }
  if (
    props.inputType === 'number' &&
    (props.showStepper !== undefined || props.stepperPlacement !== undefined)
  ) {
    return {
      kind: 'number',
      showStepper: props.showStepper !== false,
      placement: props.stepperPlacement === 'sides' ? 'sides' : 'end'
    }
  }
  return undefined
}
