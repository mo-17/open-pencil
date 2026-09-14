/** Compatibility templates must match exactly; drift must never silently omit an authorization guard. */
export function replaceTenantSource(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error('NestJS tenant template boundary changed.')
  return source.replace(before, () => after)
}
