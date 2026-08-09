import { describe, expect, test } from 'bun:test'

import {
  appendBoundedModuleEditorItem,
  filterReferencedModuleItemIds,
  nextModuleEditorItemId,
  reconcileInitialModuleItemId,
  removeBoundedModuleEditorItem,
  replaceModuleEditorItem
} from '@/app/plugins/module-items-editor-model'

describe('module item editor model', () => {
  test('allocates the first available stable item id', () => {
    expect(nextModuleEditorItemId([{ id: 'tab-1' }, { id: 'tab-3' }], 'tab')).toBe('tab-2')
    expect(nextModuleEditorItemId([], 'section')).toBe('section-1')
  })

  test('appends without mutating and stops at the maximum', () => {
    const original = [{ id: 'first' }]
    const appended = appendBoundedModuleEditorItem(original, { id: 'second' }, 2)

    expect(appended).toEqual([{ id: 'first' }, { id: 'second' }])
    expect(appended).not.toBe(original)
    expect(original).toEqual([{ id: 'first' }])
    expect(appendBoundedModuleEditorItem(appended ?? [], { id: 'third' }, 2)).toBeUndefined()
  })

  test('removes only within the allowed range and replaces immutably', () => {
    const original = [
      { id: 'first', title: 'First' },
      { id: 'second', title: 'Second' }
    ]

    expect(removeBoundedModuleEditorItem(original, 0, 2)).toBeUndefined()
    expect(removeBoundedModuleEditorItem(original, -1, 1)).toBeUndefined()
    expect(removeBoundedModuleEditorItem(original, 1, 1)).toEqual([{ id: 'first', title: 'First' }])

    const replaced = replaceModuleEditorItem(original, 0, (item) => ({
      ...item,
      title: 'Updated'
    }))
    expect(replaced).toEqual([
      { id: 'first', title: 'Updated' },
      { id: 'second', title: 'Second' }
    ])
    expect(original[0]?.title).toBe('First')
    expect(replaceModuleEditorItem(original, 3, (item) => item)).toBeUndefined()
  })

  test('repairs dependent default and open item references after edits', () => {
    const items = [{ id: 'first' }, { id: 'third' }]

    expect(reconcileInitialModuleItemId(items, 'third')).toBe('third')
    expect(reconcileInitialModuleItemId(items, 'second')).toBe('first')
    expect(reconcileInitialModuleItemId([], 'second')).toBe('')
    expect(filterReferencedModuleItemIds(items, ['third', 'second', 1])).toEqual(['third'])
    expect(filterReferencedModuleItemIds(items, null)).toEqual([])
  })
})
