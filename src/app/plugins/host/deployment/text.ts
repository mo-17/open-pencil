interface BoundedDeploymentTextOptions {
  readonly collapseWhitespace?: boolean
  readonly countUtf16CodeUnits?: boolean
}

function isUnsafeTextPoint(point: number): boolean {
  return (
    point <= 0x1f ||
    (point >= 0x7f && point <= 0x9f) ||
    (point >= 0x202a && point <= 0x202e) ||
    (point >= 0x2066 && point <= 0x2069)
  )
}

/** Host-only text boundary for deployment labels, notices, and errors. */
export function boundedDeploymentText(
  value: unknown,
  fallback: string,
  maxLength: number,
  options: BoundedDeploymentTextOptions = {}
): string {
  let source = fallback
  if (value instanceof Error) source = value.message
  else if (typeof value === 'string') source = value
  const characters: string[] = []
  let measuredLength = 0
  for (const character of source.normalize('NFC')) {
    let safeCharacter = isUnsafeTextPoint(character.codePointAt(0) ?? 0) ? ' ' : character
    if (options.collapseWhitespace && /\s/u.test(safeCharacter)) {
      if (characters.length === 0 || characters.at(-1) === ' ') continue
      safeCharacter = ' '
    }
    const nextLength = options.countUtf16CodeUnits ? safeCharacter.length : 1
    if (measuredLength + nextLength > maxLength) break
    characters.push(safeCharacter)
    measuredLength += nextLength
    if (measuredLength >= maxLength) break
  }
  return characters.join('').trim() || fallback
}
