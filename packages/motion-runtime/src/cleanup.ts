/** Runs every lifecycle cleanup step before surfacing one or more host callback failures. */
export function runMotionCleanup(steps: readonly (() => void)[], message: string): void {
  const errors: unknown[] = []
  for (const step of steps) {
    try {
      step()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, message)
}
