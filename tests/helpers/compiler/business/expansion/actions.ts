import { expect, type Page } from '@playwright/test'

import type { BusinessActionDefinition } from '@/app/lowcode/backend/business/types'

import type { BusinessTestRow } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'
import {
  finishBusinessRequest,
  submitBusinessAction,
  type withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'

type Session = Parameters<Parameters<typeof withBusinessBrowser>[3]>[0]

export async function fillExpansionAction(
  page: Page,
  action: BusinessActionDefinition,
  values: BusinessTestRow
) {
  let selectIndex = 0
  const selectCount = action.inputs.filter((input) => input.kind === 'select').length
  for (const input of action.inputs) {
    const value = values[input.key]
    if (input.kind === 'relation') {
      if (input.fromSelection) {
        await expect(page.getByText('Selected: ' + value, { exact: true })).toBeVisible()
      } else {
        await page.getByRole('button', { name: 'Choose · ' + input.label.en, exact: true }).click()
      }
    } else if (input.kind === 'select') {
      const controls = page.getByRole('combobox')
      const control = controls.nth((await controls.count()) - selectCount + selectIndex++)
      const choice = input.choices?.find((entry) => entry.value === value)
      if (!choice) throw new Error('Missing select option ' + input.key)
      // The page's optional list filter comes before controls in the active action form.
      if (input.fromSelection) await expect(control).toHaveValue(choice.label.en)
      else await control.selectOption({ label: choice.label.en })
    } else {
      const control = page.getByPlaceholder(input.label.en, { exact: true })
      if (input.fromSelection) await expect(control).toHaveValue(String(value))
      else await control.fill(String(value))
    }
  }
}

export async function submitExpansionAction(
  session: Session,
  action: BusinessActionDefinition,
  payload: object,
  selected: BusinessTestRow
) {
  const { page, api } = session
  const before = api.calls.length
  api.steps.push({ commandId: action.commandId, payload, result: selected })
  await submitBusinessAction(page, action.label.en)
  await expect
    .poll(() => ({ calls: api.calls.length, failures: api.failures }))
    .toEqual({ calls: before + 1, failures: [] })
  await finishBusinessRequest(page)
}
