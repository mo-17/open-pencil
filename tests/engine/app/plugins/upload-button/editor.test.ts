import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const propertyRoot = resolve(import.meta.dir, '../../../../../src/components/properties/Lowcode')
const source = readFileSync(resolve(propertyRoot, 'UploadAcceptEditor.vue'), 'utf8')
const fieldSource = readFileSync(resolve(propertyRoot, 'ModulePropertyFieldEditor.vue'), 'utf8')
const specializedSource = readFileSync(
  resolve(propertyRoot, 'ModuleSpecializedFieldEditor.vue'),
  'utf8'
)
const identitySource = readFileSync(resolve(propertyRoot, 'module-property-field.ts'), 'utf8')
const controllerSource = readFileSync(
  resolve(propertyRoot, 'module-props-panel-controller.ts'),
  'utf8'
)

describe('Upload Button accept editor', () => {
  test('edits bounded accepted-type tokens one at a time through the core validator', () => {
    expect(source).toContain('UPLOAD_BUTTON_MODULE_LIMITS.acceptMax')
    expect(source).toContain(':maxlength="UPLOAD_BUTTON_MODULE_LIMITS.acceptToken"')
    expect(source).toContain('isUploadAcceptToken(token)')
    expect(source).toContain('draft.value[index] = token')
    expect(source).toContain("emit('commit', [...draft.value])")
    expect(source).toContain('data-test-id="upload-accept-add"')
    expect(source).toContain('data-test-id="upload-accept-remove"')
  })

  test('keeps invalid, duplicate, and empty drafts out of the graph', () => {
    expect(source).toContain('lowcodeUploadAcceptInvalidToken')
    expect(source).toContain('lowcodeUploadAcceptDuplicateToken')
    expect(source).toContain('lowcodeUploadAcceptEmptyToken')
    expect(source).toContain('candidate.trim().toLowerCase() === token')
    const commitToken = source.match(
      /function commitToken\(index: number\): void \{([\s\S]*?)\n\}/
    )?.[1]
    expect(commitToken).toBeDefined()
    expect(commitToken).not.toContain('removeToken(')
  })

  test('removes an empty row only through its explicit button and restores adjacent focus', () => {
    expect(source).toContain('@click="removeToken(index)"')
    expect(source).toContain('draft.value.splice(index, 1)')
    expect(source).toContain('const adjacentIndex = Math.min(index, draft.value.length - 1)')
    expect(source).toContain('const focusTarget = adjacent ?? addButton.value')
    expect(source).toContain('focusTarget?.focus()')
  })

  test('uses 44px controls, theme contrast, visible focus, and explicit local-only copy', () => {
    expect(source.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(3)
    expect(source).toMatch(
      /data-test-id="upload-accept-input"[\s\S]*?class="[^"]*bg-surface[^"]*text-input[^"]*focus-visible:ring-2[^"]*"/
    )
    expect(source).toContain('data-test-id="upload-accept-validation-hint"')
    expect(source).toContain('data-test-id="upload-local-only-notice"')
    expect(source).toContain('panels.lowcodeUploadLocalOnlyNotice')
    expect(fieldSource).toContain('data-test-id="upload-boolean-control"')
    expect(fieldSource).toMatch(
      /data-test-id="upload-boolean-control"[\s\S]*?class="[^"]*min-h-11[^"]*focus-within:ring-2[^"]*"/
    )
    expect(fieldSource).toContain("const uploadNumberFieldUi = { root: 'h-11 min-h-11' }")
    expect(fieldSource).toContain(':ui="isUploadNumberField ? uploadNumberFieldUi : undefined"')
  })

  test('atomically couples multiple and maxFiles without an invalid transient state', () => {
    expect(controllerSource).toContain('moduleDefinition.pluginId === UPLOAD_BUTTON_PLUGIN_ID')
    expect(controllerSource).toContain("fieldKey(field) === 'multiple'")
    expect(controllerSource).toContain('multiple: input.checked')
    expect(controllerSource).toContain('Math.max(2,')
    expect(controllerSource).toContain(': 1')
    expect(fieldSource).toContain(':disabled="uploadSingleFileMode"')
    expect(fieldSource).toContain('data-test-id="upload-single-file-max-hint"')
  })

  test('wires accept through the dedicated specialized editor', () => {
    expect(identitySource).toContain("kind: 'upload-accept'")
    expect(identitySource).toContain('pluginId: UPLOAD_BUTTON_PLUGIN_ID')
    expect(identitySource).toContain('moduleType: UPLOAD_BUTTON_MODULE_TYPE')
    expect(specializedSource).toContain("kind === 'upload-accept'")
    expect(specializedSource).toContain('<UploadAcceptEditor')
  })
})
