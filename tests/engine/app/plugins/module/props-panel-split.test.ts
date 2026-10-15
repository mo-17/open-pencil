import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { repoPath } from '#tests/helpers/paths'

const propertyRoot = repoPath('src/components/properties/Lowcode')
const readPropertySource = (file: string): string =>
  readFileSync(resolve(propertyRoot, file), 'utf8')

const panelSource = readPropertySource('ModulePropsPanel.vue')
const fieldSource = readPropertySource('ModulePropertyFieldEditor.vue')
const scalarSource = readPropertySource('ModuleScalarFieldEditor.vue')
const specializedSource = readPropertySource('ModuleSpecializedFieldEditor.vue')
const structuredSource = readPropertySource('ModuleStructuredFieldEditor.vue')
const controllerSource = readPropertySource('module-props-panel-controller.ts')
const identitySource = readPropertySource('module-property-field.ts')

describe('module property panel split', () => {
  test('keeps every property-section SFC below the architecture limit', () => {
    for (const source of [
      panelSource,
      fieldSource,
      scalarSource,
      specializedSource,
      structuredSource
    ]) {
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
    expect(controllerSource).toContain('commitAccordionEditor(editor, request)')
  })

  test('dispatches every structured editor and localizes field and option labels', () => {
    for (const kind of [
      'rich-text-content',
      'html-content',
      'table-content',
      'data-grid-data',
      'dropdown-menu-items',
      'upload-accept',
      'slide-menu-items',
      'modal-content',
      'tabs-items',
      'accordion-items',
      'markdown-source',
      'code-block-code'
    ]) {
      expect(identitySource).toContain(`kind: '${kind}'`)
      expect(specializedSource + structuredSource).toContain(`kind === '${kind}'`)
    }
    expect(controllerSource).toContain('localizedAppPluginModulePropertyText(field.i18nLabelKey')
    expect(controllerSource).toContain('localizedAppPluginModulePropertyText(key, locale.value)')
    expect(scalarSource).toContain('{{ optionLabel(field, option) }}')
  })
})
