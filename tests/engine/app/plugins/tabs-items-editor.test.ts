import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(import.meta.dir, '../../../../src/components/properties/Lowcode/TabsItemsEditor.vue'),
  'utf8'
)

describe('Tabs module item editor', () => {
  test('edits exact id, title, and content fields as inert text', () => {
    expect(source).toContain('id: item.id, label: item.label, content: item.content')
    expect(source).toContain('@input="updateItem(index, \'id\', $event)"')
    expect(source).toContain('@input="updateItem(index, \'label\', $event)"')
    expect(source).toContain('@input="updateItem(index, \'content\', $event)"')
    expect(source).not.toContain('v-html')
    expect(source).not.toContain('innerHTML')
  })

  test('uses the core min, max, and text limits', () => {
    expect(source).toContain('draft.length >= TABS_MODULE_LIMITS.tabsMax')
    expect(source).toContain('draft.length <= TABS_MODULE_LIMITS.tabsMin')
    expect(source).toContain(':maxlength="TABS_MODULE_LIMITS.id"')
    expect(source).toContain(':maxlength="TABS_MODULE_LIMITS.label"')
    expect(source).toContain(':maxlength="TABS_MODULE_LIMITS.content"')
  })

  test('emits defensive whole-list values and receives all user-facing labels as props', () => {
    expect(source).toContain("emit('commit', cloneItems(draft.value))")
    expect(source).toContain("nextModuleEditorItemId(draft.value, 'tab')")
    expect(source).toContain('addLabel: string')
    expect(source).toContain('removeLabel: string')
    expect(source).toContain('titleLabel: string')
    expect(source).toContain('contentLabel: string')
    expect(source).not.toContain('useI18n')
  })
})
