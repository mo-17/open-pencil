import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(
    import.meta.dir,
    '../../../../src/components/properties/Lowcode/SlideMenuItemsEditor.vue'
  ),
  'utf8'
)
const panelSource = readFileSync(
  resolve(import.meta.dir, '../../../../src/components/properties/Lowcode/ModulePropsPanel.vue'),
  'utf8'
)

describe('Slide Menu module item editor', () => {
  test('edits link labels and destinations as structured plain text', () => {
    expect(source).toContain('value.map((item) => ({ label: item.label, href: item.href }))')
    expect(source).toContain('@input="updateItem(index, \'label\', $event)"')
    expect(source).toContain('@input="updateItem(index, \'href\', $event)"')
    expect(source).not.toContain('v-html')
    expect(source).not.toContain('innerHTML')
  })

  test('shares the core item count and text limits', () => {
    expect(source).toContain('draft.value.length >= SLIDE_MENU_MODULE_LIMITS.items')
    expect(source).toContain(':maxlength="SLIDE_MENU_MODULE_LIMITS.itemLabel"')
    expect(source).toContain(':maxlength="SLIDE_MENU_MODULE_LIMITS.itemHref"')
  })

  test('commits defensive copies on blur, explicit shortcut, add, and delete', () => {
    expect(source).toContain("emit('commit', cloneItems(draft.value))")
    expect(source).toContain('@blur="commit"')
    expect(source).toContain('@keydown="commitShortcut"')
    expect(source).toContain('draft.value.push')
    expect(source).toContain('draft.value.splice(index, 1)')
    expect(source).toContain('() => modelValue')
    expect(source).toContain('if (!invalid && sameItems(draft.value, modelValue)) return')
  })

  test('renders validation once and clears stale errors when the selected module changes', () => {
    expect(source).not.toContain('slide-menu-items-error')
    expect(panelSource).toContain(
      '() => [selectedNode.value?.id, instance.value?.pluginId, instance.value?.moduleType]'
    )
    expect(panelSource).toContain('for (const key of Object.keys(jsonErrors))')
  })
})
