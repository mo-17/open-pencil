export async function settleRuntimeDisposals(
  operations: readonly (() => void | Promise<void>)[],
  failureMessage: string
): Promise<void> {
  const results = await Promise.allSettled(
    operations.map((operation) => Promise.resolve().then(operation))
  )
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (failures.length > 0) throw new AggregateError(failures, failureMessage)
}
