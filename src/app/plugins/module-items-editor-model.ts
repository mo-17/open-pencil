export interface ModuleEditorItemIdentity {
  readonly id: string
}

export function nextModuleEditorItemId(
  items: readonly ModuleEditorItemIdentity[],
  prefix: string
): string {
  const existingIds = new Set(items.map((item) => item.id))
  for (let suffix = 1; suffix <= items.length + 1; suffix++) {
    const candidate = `${prefix}-${suffix}`
    if (!existingIds.has(candidate)) return candidate
  }
  throw new Error('Unable to allocate a module editor item id')
}

export function appendBoundedModuleEditorItem<T>(
  items: readonly T[],
  item: T,
  maximum: number
): T[] | undefined {
  if (items.length >= maximum) return undefined
  return [...items, item]
}

export function removeBoundedModuleEditorItem<T>(
  items: readonly T[],
  index: number,
  minimum: number
): T[] | undefined {
  if (items.length <= minimum || !Number.isInteger(index) || index < 0 || index >= items.length) {
    return undefined
  }
  return items.filter((_item, itemIndex) => itemIndex !== index)
}

export function replaceModuleEditorItem<T>(
  items: readonly T[],
  index: number,
  replace: (item: T) => T
): T[] | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return undefined
  return items.map((item, itemIndex) => (itemIndex === index ? replace(item) : item))
}

export function reconcileInitialModuleItemId(
  items: readonly ModuleEditorItemIdentity[],
  currentId: unknown
): string {
  if (typeof currentId === 'string' && items.some((item) => item.id === currentId)) {
    return currentId
  }
  return items[0]?.id ?? ''
}

export function filterReferencedModuleItemIds(
  items: readonly ModuleEditorItemIdentity[],
  currentIds: unknown
): string[] {
  if (!Array.isArray(currentIds)) return []
  const availableIds = new Set(items.map((item) => item.id))
  return currentIds.filter((id): id is string => typeof id === 'string' && availableIds.has(id))
}
