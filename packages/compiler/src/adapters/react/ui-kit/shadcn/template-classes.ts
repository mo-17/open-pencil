import { scanSourceLiterals } from '#compiler/tailwind/source-literals'

/** Only host-owned component templates reach this collector. Tailwind ignores
 * non-utility words, just as it does while scanning standalone project files.
 * Exclude directive delimiters before using the existing @source serializer.
 */
export function templateClassCandidates(sources: Iterable<string>): string[] {
  const candidates = new Set<string>()
  for (const source of sources) {
    scanSourceLiterals(source, (literal) => {
      for (const candidate of literal.split(/\s+/)) {
        if (candidate && !/[\\"'{}]/.test(candidate)) candidates.add(candidate)
      }
    })
  }
  return [...candidates].sort()
}
