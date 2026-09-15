/** Compiler-owned hooks only; these strings are never read from the Backend IR. */
export interface NestJSCommandServiceExtension {
  readonly imports: string
  readonly authorize: string
  readonly operation: 'foodOrderingOperation' | 'commerceOperation'
  readonly execute: string
}

function replaceBoundary(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error('NestJS command service boundary changed.')
  return source.replace(before, () => after)
}

export function withReviewedCommandServices(
  source: string,
  extensions: readonly NestJSCommandServiceExtension[]
): string {
  if (!extensions.length) return source
  const imported = extensions.map((entry) => entry.imports).join('') + source
  const authorized = replaceBoundary(
    imported,
    '      const inserted = await client.query(',
    extensions.map((entry) => '      ' + entry.authorize + '\n').join('') +
      '      const inserted = await client.query('
  )
  const fallback = 'await executeCommand(client, plan, input, principal.subject)'
  const dispatch =
    extensions
      .map((entry) => 'plan.' + entry.operation + '\n        ? ' + entry.execute + '\n        : ')
      .join('') + fallback
  return replaceBoundary(
    authorized,
    '      const response = ' + fallback,
    '      const response = ' + dispatch
  )
}
