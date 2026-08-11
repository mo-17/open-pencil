import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const propertyRoot = resolve(import.meta.dir, '../../../../../src/components/properties/Lowcode')
const source = readFileSync(resolve(propertyRoot, 'DropdownMenuItemsEditor.vue'), 'utf8')
const specializedSource = readFileSync(
  resolve(propertyRoot, 'ModuleSpecializedFieldEditor.vue'),
  'utf8'
)
const identitySource = readFileSync(resolve(propertyRoot, 'module-property-field.ts'), 'utf8')

describe('Dropdown Menu module item editor', () => {
  test('keeps item and divider creation separate and bounded by the core contract', () => {
    expect(source).toContain('DROPDOWN_MENU_MODULE_LIMITS.itemsMax')
    expect(source).toContain('function addItem(): void')
    expect(source).toContain("draft.value.push({ type: 'separator' })")
    expect(source).toContain('data-test-id="dropdown-menu-add-item"')
    expect(source).toContain('data-test-id="dropdown-menu-add-separator"')
    expect(source).toContain(':maxlength="DROPDOWN_MENU_MODULE_LIMITS.itemLabel"')
    expect(source).toContain(':maxlength="DROPDOWN_MENU_MODULE_LIMITS.itemHref"')
    expect(source).toContain(':maxlength="DROPDOWN_MENU_MODULE_LIMITS.itemShortcut"')
  })

  test('preserves the flat discriminated union and at least one real menu item', () => {
    expect(source).toContain("entry.type === 'separator'")
    expect(source).toContain("? { type: 'separator' }")
    expect(source).toContain("type: 'item'")
    expect(source).toContain(
      "draft.value[index]?.type === 'separator' || itemCount() > DROPDOWN_MENU_MODULE_LIMITS.itemsMin"
    )
    expect(source).not.toContain('submenu')
    expect(source).not.toContain('callback')
    expect(source).not.toContain('v-html')
    expect(source).not.toContain('innerHTML')
  })

  test('uses collapsible groups and explicit text controls for disabled and danger states', () => {
    expect(source).toContain('<details')
    expect(source).toContain('<summary')
    expect(source).toContain('data-test-id="dropdown-menu-item-disabled"')
    expect(source).toContain('data-test-id="dropdown-menu-item-danger"')
    expect(source).toContain('{{ panels.lowcodeDropdownMenuItemDisabled }}')
    expect(source).toContain('{{ panels.lowcodeDropdownMenuItemDanger }}')
    expect(source).toContain('type="checkbox"')
  })

  test('pairs theme-aware input contrast with visible keyboard focus and defensive commits', () => {
    for (const testId of [
      'dropdown-menu-item-label',
      'dropdown-menu-item-href',
      'dropdown-menu-item-shortcut'
    ]) {
      expect(source).toMatch(
        new RegExp(
          `data-test-id="${testId}"[\\s\\S]*?class="[^"]*bg-surface[^"]*text-input[^"]*focus:border-accent[^"]*focus-visible:ring-2[^"]*"`
        )
      )
    }
    expect(source).toContain("emit('commit', cloneEntries(draft.value))")
    expect(source).toContain('@blur="commit"')
    expect(source).toContain('@keydown="commitShortcut"')
    expect(source).toContain('() => modelValue')
  })

  test('moves focus to an adjacent entry after deletion and keeps an add-item fallback', () => {
    expect(source).toContain('await nextTick()')
    expect(source).toContain('data-dropdown-entry-index')
    expect(source).toContain('data-dropdown-entry-focus')
    expect(source).toContain('adjacentControl ?? addItemButton.value')
  })

  test('wires the items field through the dedicated specialized editor', () => {
    expect(identitySource).toContain("kind: 'dropdown-menu-items'")
    expect(identitySource).toContain('pluginId: DROPDOWN_MENU_PLUGIN_ID')
    expect(identitySource).toContain('moduleType: DROPDOWN_MENU_MODULE_TYPE')
    expect(specializedSource).toContain("kind === 'dropdown-menu-items'")
    expect(specializedSource).toContain('<DropdownMenuItemsEditor')
  })
})
