/** Authored local wall-clock time: no date, timezone conversion, or implicit current time. */
export function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
}

export function timeInputSeconds(value: unknown): number | undefined {
  if (!isIsoTime(value)) return undefined
  const [hours, minutes, seconds = 0] = value.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

export type TimeInputIssueCode =
  | 'time-input-invalid-value'
  | 'time-input-invalid-min'
  | 'time-input-invalid-max'
  | 'time-input-invalid-step'
  | 'time-input-value-out-of-range'
  | 'time-input-step-mismatch'

export interface TimeInputIssue {
  code: TimeInputIssueCode
  key: 'value' | 'min' | 'max' | 'step'
  severity: 'error' | 'warning'
  reason: string
}

/** Mirrors native time constraints, including a min > max range crossing midnight. */
export function validateTimeInputProps(ip: Record<string, unknown>): TimeInputIssue[] {
  const issues: TimeInputIssue[] = []
  for (const key of ['value', 'min', 'max'] as const) {
    if (ip[key] === undefined || ip[key] === '' || isIsoTime(ip[key])) continue
    issues.push({
      code: `time-input-invalid-${key}`,
      key,
      severity: 'error',
      reason: `${key} must be empty or a valid HH:mm or HH:mm:ss time.`
    })
  }
  const step = ip.step
  if (
    step !== undefined &&
    step !== 'any' &&
    !(typeof step === 'number' && Number.isSafeInteger(step) && step > 0)
  ) {
    issues.push({
      code: 'time-input-invalid-step',
      key: 'step',
      severity: 'error',
      reason: 'step must be a positive integer number of seconds or "any".'
    })
  }
  const value = timeInputSeconds(ip.value)
  if (value === undefined) return issues
  const min = timeInputSeconds(ip.min)
  const outside = timeOutsideRange(value, min, timeInputSeconds(ip.max))
  if (outside)
    issues.push({
      code: 'time-input-value-out-of-range',
      key: 'value',
      severity: 'warning',
      reason: 'The initial time is outside min/max; kept for native browser validation.'
    })
  // Native step base is min, then the authored value attribute, then midnight.
  const interval = step === undefined ? 60 : step
  if (
    typeof interval === 'number' &&
    Number.isSafeInteger(interval) &&
    interval > 0 &&
    (value - (min ?? value)) % interval !== 0
  ) {
    issues.push({
      code: 'time-input-step-mismatch',
      key: 'value',
      severity: 'warning',
      reason:
        'The initial time does not match the configured step from min; kept for native browser validation.'
    })
  }
  return issues
}

function timeOutsideRange(
  value: number,
  min: number | undefined,
  max: number | undefined
): boolean {
  if (min !== undefined && max !== undefined && min > max) return value < min && value > max
  return (min !== undefined && value < min) || (max !== undefined && value > max)
}
