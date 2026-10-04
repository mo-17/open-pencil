/** Track only keys in the bounded AST returned by the strict parser, without reading source getters. */
export const RICH_TEXT_VUE_DEPENDENCIES_RUNTIME = `
function trackRichTextDependencies(source: unknown, normalized: unknown): boolean {
  if (!source || typeof source !== 'object' || !normalized || typeof normalized !== 'object') return false
  const observable = reactive(source)
  for (const key of Reflect.ownKeys(normalized)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Reflect.has(observable, key)) return false
    const next = Object.getOwnPropertyDescriptor(normalized, key)?.value
    if (next && typeof next === 'object' && !trackRichTextDependencies(descriptor.value, next)) return false
  }
  return true
}

function projectReactiveRichText(value: unknown): OpenPencilRichTextDocument | null {
  const normalized = projectRichText(value)
  if (!normalized) return null
  try { return trackRichTextDependencies(value, normalized) ? normalized : null } catch { return null }
}
`
