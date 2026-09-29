import { expect, type Page } from '@playwright/test'

/** Only fixture construction uses the editor API; subsequent edits use the visible panel. */
export async function advancedInputsFixture(page: Page) {
  return page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const dateTime = editor.createShape('INPUT', 120, 140, 360, 44)
    const number = editor.createShape('INPUT', 120, 230, 360, 44)
    const password = editor.createShape('INPUT', 120, 320, 360, 44)
    for (const id of [dateTime, number, password]) {
      editor.updateNode(id, {
        fontSize: 16,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 9,
        paddingBottom: 9
      })
    }
    editor.updateNode(dateTime, {
      name: '预约日期时间',
      interactiveProps: {
        inputType: 'datetime-local',
        value: '2026-09-28T09:30',
        min: '2026-01-01T00:00',
        max: '2026-12-31T23:59',
        step: 900,
        textColor: '#172B4D'
      }
    })
    editor.updateNode(number, {
      name: '数量输入',
      interactiveProps: {
        inputType: 'number',
        value: '2.5',
        min: 0,
        max: 10,
        step: 0.5,
        showStepper: true,
        stepperPlacement: 'sides',
        textColor: '#172B4D'
      }
    })
    editor.updateNode(password, {
      name: '密码输入',
      interactiveProps: {
        inputType: 'password',
        value: '',
        placeholder: '输入密码',
        showPasswordToggle: true,
        textColor: '#172B4D',
        placeholderColor: '#172B4D'
      }
    })
    editor.updateNode(editor.state.currentPageId, {
      state: [
        {
          id: 'local-date-time',
          name: 'appointment',
          type: 'string',
          defaultValue: '2026-10-01T10:30'
        },
        { id: 'quantity-number', name: 'quantity', type: 'number', defaultValue: 4 }
      ]
    })
    editor.select([dateTime])
    return { dateTime, number, password }
  })
}

export async function chooseAdvancedInputProperty(page: Page, label: string, option: string) {
  const control = page.getByRole('combobox', { name: label, exact: true })
  await control.blur()
  await control.click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await expect(control).toContainText(option)
}
