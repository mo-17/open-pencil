import {
  isIsoTime,
  timeInputSeconds,
  validateTimeInputProps,
  type TimeInputIssue
} from './time-input'

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

/** A real Gregorian local date and time; never a timestamp or a timezone conversion. */
export function isIsoLocalDateTime(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    (value.length !== 16 && value.length !== 19) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
  )
    return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (year < 1 || month < 1 || month > 12 || !isIsoTime(value.slice(11))) return false
  const days = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= days[month - 1]
}

/** Deterministic civil seconds since 0001-01-01, used only for range and step arithmetic. */
export function dateTimeInputSeconds(value: unknown): number | undefined {
  if (!isIsoLocalDateTime(value)) return undefined
  const year = Number(value.slice(0, 4)),
    priorYear = year - 1
  const month = Number(value.slice(5, 7)),
    day = Number(value.slice(8, 10))
  const priorMonths = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  const days =
    priorYear * 365 +
    Math.floor(priorYear / 4) -
    Math.floor(priorYear / 100) +
    Math.floor(priorYear / 400) +
    priorMonths[month - 1] +
    day -
    1 +
    (month > 2 && leapYear(year) ? 1 : 0)
  return days * 86400 + (timeInputSeconds(value.slice(11)) ?? 0)
}

export type DateTimeInputIssueCode =
  | 'date-time-input-invalid-value'
  | 'date-time-input-invalid-min'
  | 'date-time-input-invalid-max'
  | 'date-time-input-invalid-step'
  | 'date-time-input-range-inverted'
  | 'date-time-input-value-out-of-range'
  | 'date-time-input-step-mismatch'

export type DateTimeInputIssue = Omit<TimeInputIssue, 'code'> & { code: DateTimeInputIssueCode }

/** Unlike a time-only input, a date-time range cannot cross its upper bound. */
export function validateDateTimeInputProps(ip: Record<string, unknown>): DateTimeInputIssue[] {
  const issues: DateTimeInputIssue[] = []
  for (const key of ['value', 'min', 'max'] as const) {
    if (ip[key] === undefined || ip[key] === '' || isIsoLocalDateTime(ip[key])) continue
    issues.push({
      code: `date-time-input-invalid-${key}`,
      key,
      severity: 'error',
      reason: `${key} must be empty or a real YYYY-MM-DDTHH:mm[:ss] local date and time.`
    })
  }
  for (const issue of validateTimeInputProps({ step: ip.step }))
    issues.push({ ...issue, code: 'date-time-input-invalid-step' })
  const min = dateTimeInputSeconds(ip.min),
    max = dateTimeInputSeconds(ip.max)
  if (min !== undefined && max !== undefined && min > max) {
    issues.push({
      code: 'date-time-input-range-inverted',
      key: 'min',
      severity: 'error',
      reason: 'The minimum date and time must not be after the maximum.'
    })
    return issues
  }
  const value = dateTimeInputSeconds(ip.value)
  if (value === undefined) return issues
  if ((min !== undefined && value < min) || (max !== undefined && value > max))
    issues.push({
      code: 'date-time-input-value-out-of-range',
      key: 'value',
      severity: 'warning',
      reason: 'The initial date and time is outside min/max; kept for native browser validation.'
    })
  const interval = ip.step === undefined ? 60 : ip.step
  if (
    typeof interval === 'number' &&
    Number.isSafeInteger(interval) &&
    interval > 0 &&
    (value - (min ?? value)) % interval !== 0
  )
    issues.push({
      code: 'date-time-input-step-mismatch',
      key: 'value',
      severity: 'warning',
      reason:
        'The initial date and time does not match step from min; kept for native browser validation.'
    })
  return issues
}
