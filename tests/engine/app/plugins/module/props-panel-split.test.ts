import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const propertyRoot = resolve(import.meta.dir, '../../../../../src/components/properties/Lowcode')
const readPropertySource = (file: string): string =>
  readFileSync(resolve(propertyRoot, file), 'utf8')

const panelSource = readPropertySource('ModulePropsPanel.vue')
const fieldSource = readPropertySource('ModulePropertyFieldEditor.vue')
const specializedSource = readPropertySource('ModuleSpecializedFieldEditor.vue')
const controllerSource = readPropertySource('module-props-panel-controller.ts')
const identitySource = readPropertySource('module-property-field.ts')

describe('module property panel split', () => {
  test('keeps every property-section SFC below the architecture limit', () => {
    for (const source of [panelSource, fieldSource, specializedSource]) {
      expect(source.split('\n').length).toBeLessThanOrEqual(250)
    }
  })

  test('preserves validated module creation, undo, video error cleanup, and item references', () => {
    expect(controllerSource).toContain(
      'const nextInstance = moduleDefinition.createInstance(nextConfig)'
    )
    expect(controllerSource).toContain('editor.updateNodeWithUndo(')
    expect(controllerSource).toContain("Reflect.deleteProperty(jsonErrors, 'muted')")
    expect(controllerSource).toContain("Reflect.deleteProperty(jsonErrors, 'autoplay')")
    expect(controllerSource).toContain(
      'reconcileInitialModuleItemId(value, config.value.initialTabId)'
    )
    expect(controllerSource).toContain(
      'filterReferencedModuleItemIds(value, config.value.initialOpenIds)'
    )
  })

  test('dispatches every structured editor and localizes field and option labels', () => {
    for (const kind of [
      'rich-text-content',
      'html-content',
      'table-content',
      'data-grid-data',
      'slide-menu-items',
      'tabs-items',
      'accordion-items',
      'markdown-source',
      'code-block-code'
    ]) {
      expect(identitySource).toContain(`kind: '${kind}'`)
      expect(specializedSource).toContain(`kind === '${kind}'`)
    }
    expect(controllerSource).toContain('localizedAppPluginModulePropertyText(field.i18nLabelKey')
    expect(controllerSource).toContain('localizedAppPluginModulePropertyText(key, locale.value)')
    expect(fieldSource).toContain('{{ optionLabel(field, option) }}')
  })
})
