import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

for (const custom of [false, true]) {
  test(`Select ${custom ? 'custom icon' : 'default value'} trigger preserves keyboard selection`, async ({
    page
  }) => {
    await page.goto('/?test')
    await new CanvasHelper(page).waitForInit()
    const fixture = await page.evaluateHandle(async (custom) => {
      const vuePath = '/node_modules/.vite/deps/vue.js'
      const selectPath = '/src/components/ui/select/AppSelect.vue'
      const buttonPath = '/src/components/ui/button/IconButton.vue'
      const { createApp, h, ref } = await import(vuePath)
      const { default: AppSelect } = await import(selectPath)
      const { default: IconButton } = await import(buttonPath)
      const value = ref('first')
      const disabled = ref(false)
      const host = document.createElement('div')
      host.dataset.slot = 'select-contract-fixture'
      document.body.append(host)
      const app = createApp(() =>
        h(
          AppSelect,
          {
            modelValue: value.value,
            disabled: disabled.value,
            'data-command': 'choose-test-style',
            'onUpdate:modelValue': (next: string) => {
              value.value = next
            },
            label: 'Choose style',
            options: [
              { value: 'first', label: 'First' },
              { value: 'second', label: 'Second' }
            ]
          },
          custom ? { trigger: () => h(IconButton, { label: 'Choose style' }) } : undefined
        )
      )
      app.mount(host)
      return {
        value: () => value.value,
        disable: () => {
          disabled.value = true
        },
        dispose() {
          app.unmount()
          host.remove()
        }
      }
    }, custom)
    try {
      const host = page.locator('[data-slot="select-contract-fixture"]')
      const trigger = host.getByRole('combobox', { name: 'Choose style' })
      const openTrigger = host.getByRole('combobox', {
        name: 'Choose style',
        includeHidden: true
      })
      await expect(trigger).toHaveCount(1)
      await expect(host.locator('button button')).toHaveCount(0)
      await trigger.focus()
      await trigger.press('Enter')
      const popupId = await openTrigger.getAttribute('aria-controls')
      if (!popupId) throw new Error('The open Select trigger must identify its popup')
      const popup = page.locator(`[id="${popupId}"]`)
      await expect(popup).toHaveRole('listbox')
      await expect(popup.getByRole('option', { name: 'Second', exact: true })).toBeVisible()
      await expect(popup.getByRole('option', { name: 'First', exact: true })).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(popup.getByRole('option', { name: 'Second', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect.poll(() => fixture.evaluate((state) => state.value())).toBe('second')
      await expect(trigger).toBeFocused()
      await trigger.press('Enter')
      await expect(openTrigger).toHaveAttribute('aria-controls', popupId)
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
      if (!custom) await expect(trigger).toHaveText('Second')
      await expect(trigger).toHaveAttribute('data-command', 'choose-test-style')
      await fixture.evaluate((state) => state.disable())
      await expect(trigger).toBeDisabled()
      await trigger.dispatchEvent('click')
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await expect(trigger).not.toHaveAttribute('aria-controls', /.+/)
      await expect(popup).toBeHidden()
      await expect(popup.getByRole('option')).toHaveCount(0)
    } finally {
      await fixture.evaluate((state) => state.dispose())
      await fixture.dispose()
    }
  })
}
