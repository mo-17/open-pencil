/** With Unicode mode, a valid surrogate pair is one code point outside this range. */
export function isWellFormedBackendText(value: string): boolean {
  return !/[\uD800-\uDFFF]/u.test(value)
}

const CANONICAL_DATE = /^\d{4}-\d{2}-\d{2}$/u

/** A four-digit Gregorian calendar date with no rollover or timezone normalization. */
export function isCanonicalBackendDate(value: string): boolean {
  if (!CANONICAL_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
