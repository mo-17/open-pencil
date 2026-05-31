/**
 * Phase 3 §3.v7 — DATEPICKER `interactiveProps` validation.
 *
 * Single source of truth for the date checks that three consumers share
 * (经验 I, same pattern as §3.v3 `supabase-payload-entries.ts`):
 *   - the AI tool boundary (`update_lowcode_node`) rejects an invalid
 *     `value` / `min` / `max` format outright,
 *   - the compiler IR collect pass (`applyDatePickerProps`) surfaces every
 *     issue as an IRWarning and skips emitting format-invalid attrs,
 *   - the editor UI (`InteractivePropsPanel`) renders a warning bar for the
 *     selected DATEPICKER node.
 *
 * A native `<input type="date">` only accepts ISO `YYYY-MM-DD`; the display
 * format is the browser's locale concern and not configurable, so there is
 * no custom-format validation here — just "is this a real ISO calendar day"
 * plus the `min`/`max` range relationships.
 *
 * Range / out-of-range issues are NOT format errors: per decision §3.v7.2 (h)
 * they are warn-and-keep (the emit still writes the attrs and the browser
 * disables the invalid selection). Only `datepicker-invalid-*` means the
 * value is unusable and should be dropped from emit.
 */

export type DatePickerIssueCode =
  | 'datepicker-invalid-value'
  | 'datepicker-invalid-min'
  | 'datepicker-invalid-max'
  | 'datepicker-range-inverted'
  | 'datepicker-value-out-of-range'

export interface DatePickerIssue {
  code: DatePickerIssueCode
  /** The offending field, when the issue is about a single one. `range-inverted`
   *  has no single key (it's the min/max relationship). */
  key?: 'value' | 'min' | 'max'
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a strict zero-padded `YYYY-MM-DD` string that is also a real
 *  calendar day. A bare regex would pass `2026-13-45`; the local-`Date`
 *  round-trip is the only reliable rejection of impossible dates
 *  (`2026-02-30` → false, leap `2024-02-29` → true). Runtime-probed in
 *  §3.v7 design (经验 K). */
export function isIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s)
  if (!m) return false
  const [, y, mo, d] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const dt = new Date(year, month - 1, day)
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day
}

/** Read an `interactiveProps` field as a non-empty string. Empty string /
 *  absent / non-string = "not set" (§3.v7 次默 1): the caller skips it. */
function setString(ip: Record<string, unknown>, key: 'value' | 'min' | 'max'): string | undefined {
  const raw = ip[key]
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/** Validate a DATEPICKER node's `interactiveProps`. Returns one issue per
 *  problem; an empty array means "clean / nothing set". Ordering bias:
 *  format issues first (per field), then range relationships — so a caller
 *  that only cares about format can stop at the `datepicker-invalid-*`
 *  prefix. ISO `YYYY-MM-DD` is zero-padded, so its lexicographic order is
 *  its chronological order (§3.v7 决 d, runtime-probed) — the min/max/range
 *  comparisons are plain string compares, no Date parsing. */
export function validateDatePickerProps(ip: Record<string, unknown>): DatePickerIssue[] {
  const issues: DatePickerIssue[] = []

  const value = setString(ip, 'value')
  const min = setString(ip, 'min')
  const max = setString(ip, 'max')

  const valueOk = value === undefined || isIsoDate(value)
  const minOk = min === undefined || isIsoDate(min)
  const maxOk = max === undefined || isIsoDate(max)

  if (!valueOk) issues.push({ code: 'datepicker-invalid-value', key: 'value' })
  if (!minOk) issues.push({ code: 'datepicker-invalid-min', key: 'min' })
  if (!maxOk) issues.push({ code: 'datepicker-invalid-max', key: 'max' })

  // Range relationships only make sense between well-formed dates.
  if (minOk && maxOk && min !== undefined && max !== undefined && min > max) {
    issues.push({ code: 'datepicker-range-inverted' })
  }
  if (valueOk && value !== undefined) {
    const belowMin = minOk && min !== undefined && value < min
    const aboveMax = maxOk && max !== undefined && value > max
    if (belowMin || aboveMax) {
      issues.push({ code: 'datepicker-value-out-of-range', key: 'value' })
    }
  }

  return issues
}
