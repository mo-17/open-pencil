import type { Page } from '@playwright/test'

/** Fixture creation only. Tests edit and select through visible editor controls. */
export function colorPickerFixture(page: Page) {
  return page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const color = editor.createShape('INPUT', 120, 140, 320, 44),
      other = editor.createShape('INPUT', 120, 225, 320, 44)
    editor.updateNode(color, {
      name: '主题颜色',
      fontSize: 16,
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      interactiveProps: { inputType: 'color', value: '#2563eb', textColor: '#172B4D' }
    })
    editor.updateNode(other, { name: 'Other input', interactiveProps: { value: 'Keep me' } })
    editor.updateNode(editor.state.currentPageId, {
      state: [
        { id: 'color-value', name: 'colorValue', type: 'string', defaultValue: '#f97316' },
        { id: 'number-value', name: 'numberValue', type: 'number', defaultValue: 3 }
      ]
    })
    editor.select([color])
    return { color, other }
  })
}
