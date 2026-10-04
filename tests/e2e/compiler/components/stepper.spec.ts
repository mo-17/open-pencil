import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  captureStepperChanges,
  stepperChanges,
  withStepperBinding
} from '#tests/helpers/compiler/components/stepper/browser'

function flow(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true })
}

async function expectCurrent(stepper: Locator, index: number | null): Promise<void> {
  const current = stepper.locator('li[aria-current="step"]')
  await expect(current).toHaveCount(index === null ? 0 : 1)
  if (index !== null)
    await expect(stepper.locator('li').nth(index)).toHaveAttribute('aria-current', 'step')
}

async function expectStatusLayout(stepper: Locator, invalid: boolean): Promise<void> {
  const status = stepper.locator(':scope > [data-step-status]')
  await expect(status).toHaveAttribute('role', 'status')
  await expect(status).toHaveAttribute('aria-live', 'polite')
  if (!invalid) {
    await expect
      .poll(() =>
        status.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return {
            width: bounds.width,
            height: bounds.height,
            clip: getComputedStyle(element).clip
          }
        })
      )
      .toEqual({ width: 1, height: 1, clip: 'rect(0px, 0px, 0px, 0px)' })
    return
  }
  await expect(status).toBeVisible()
  await expect(status).toContainText('Current step unavailable')
  await expect
    .poll(() =>
      stepper.evaluate((element) => {
        const message = element.querySelector('[data-step-status]')
        if (!message) return false
        const host = element.getBoundingClientRect()
        const bounds = message.getBoundingClientRect()
        return (
          bounds.width > 1 &&
          bounds.height > 1 &&
          bounds.top >= host.top &&
          bounds.left >= host.left &&
          bounds.right <= host.right + 1 &&
          bounds.bottom <= host.bottom + 1
        )
      })
    )
    .toBe(true)
}

function formValues(form: Locator): Promise<[string, FormDataEntryValue][]> {
  return form.evaluate((element) => [...new FormData(element as HTMLFormElement)])
}

test.setTimeout(120_000)
test.use({ viewport: { width: 1440, height: 1000 } })

for (const target of ['react', 'vue'] as const) {
  test(`${target} compiled Stepper shares bound state, isolates local instances and emits one user event with current and previous steps`, async ({
    page
  }) => {
    await withStepperBinding(page, target, 'base', async () => {
      await captureStepperChanges(page)
      const first = flow(page, 'Shared page A')
      const shared = flow(page, 'Shared page B')
      const documentFlow = flow(page, 'Document flow')
      const local = flow(page, 'Local flow A')
      const localOther = flow(page, 'Local flow B')
      const state = page.getByText(/^State:/)
      const event = page.getByText(/^Event:/)
      await expectCurrent(first, 0)
      await expectCurrent(shared, 0)
      await expectCurrent(documentFlow, 1)
      await expectCurrent(local, 0)
      await expectCurrent(localOther, 0)
      await expectStatusLayout(first, false)
      await expectStatusLayout(local, false)
      await expect(state).toHaveText('State:0/1/3/0/0')
      await first.getByRole('button').nth(1).focus()
      await page.keyboard.press('Enter')
      await expectCurrent(first, 1)
      await expectCurrent(shared, 1)
      await expect(state).toHaveText('State:1/1/3/1/0')
      await expect(event).toHaveText('Event:1/1/0/Shared page A')
      await expect
        .poll(() => stepperChanges(page))
        .toEqual([{ label: 'Shared page A', currentIndex: 1, previousIndex: 0 }])
      await shared.getByRole('button').nth(1).click()
      await expect(state).toHaveText('State:1/1/3/1/0')
      await expect.poll(() => stepperChanges(page).then((events) => events.length)).toBe(1)
      await shared.getByRole('button').nth(3).focus()
      await page.keyboard.press('Space')
      await expectCurrent(first, 3)
      await expectCurrent(shared, 3)
      await expect(event).toHaveText('Event:3/3/1/Shared page B')
      await expect(state).toHaveText('State:3/1/3/2/0')
      await expect(first.getByRole('button').nth(2)).toBeDisabled()
      await documentFlow.getByRole('button').nth(0).click()
      await expectCurrent(documentFlow, 0)
      await expect(event).toHaveText('Event:0/0/1/Document flow')
      await expect(state).toHaveText('State:3/0/3/3/0')
      await page.getByRole('button', { name: 'External page step', exact: true }).click()
      await page.getByRole('button', { name: 'External document step', exact: true }).click()
      await expectCurrent(first, 0)
      await expectCurrent(shared, 0)
      await expectCurrent(documentFlow, 3)
      await expect(state).toHaveText('State:0/3/3/3/0')
      await expect.poll(() => stepperChanges(page).then((events) => events.length)).toBe(3)
      await local.getByRole('button').nth(1).click()
      await expectCurrent(local, 1)
      await expectCurrent(localOther, 0)
      await expectCurrent(first, 0)
      await expect(state).toHaveText('State:0/3/3/4/0')
      await expect(event).toHaveText('Event:1/1/0/Local flow A')
      await expect
        .poll(() => stepperChanges(page))
        .toEqual([
          { label: 'Shared page A', currentIndex: 1, previousIndex: 0 },
          { label: 'Shared page B', currentIndex: 3, previousIndex: 1 },
          { label: 'Document flow', currentIndex: 0, previousIndex: 1 },
          { label: 'Local flow A', currentIndex: 1, previousIndex: 0 }
        ])
    })
  })

  test(`${target} compiled Stepper keeps invalid values unavailable and blocks readonly, disabled and display-only writes`, async ({
    page
  }) => {
    await withStepperBinding(page, target, 'invalid', async () => {
      await captureStepperChanges(page)
      const unavailable = [
        'Fractional flow',
        'Negative flow',
        'Out of range flow',
        'Disabled current flow',
        'Missing binding flow',
        'Wrong type flow',
        'Computed flow',
        'Expression flow'
      ]
      const status = page.getByText(/^Invalid:/)
      await expect(status).toHaveText('Invalid:0.5/-1/99/2/0/1/0')
      for (const label of unavailable) {
        const stepper = flow(page, label)
        await expectCurrent(stepper, null)
        await expectStatusLayout(stepper, true)
        await stepper
          .getByRole('button')
          .nth(1)
          .evaluate((element) => {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          })
        await expectCurrent(stepper, null)
      }
      for (const [label, index] of [
        ['Disabled flow', 0],
        ['Readonly flow', 1]
      ] as const) {
        const stepper = flow(page, label)
        await expectCurrent(stepper, index)
        await stepper
          .getByRole('button')
          .nth(3)
          .evaluate((element) => {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          })
        await expectCurrent(stepper, index)
      }
      const display = flow(page, 'No step clicks')
      await expect(display.getByRole('button')).toHaveCount(0)
      await display
        .locator('li')
        .nth(3)
        .evaluate((element) => {
          element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
      await expectCurrent(display, 0)
      await expect(status).toHaveText('Invalid:0.5/-1/99/2/0/1/0')
      await expect(page.getByText(/^Event:/)).toHaveText('Event:-1/-1/-1/none')
      await expect.poll(() => stepperChanges(page)).toEqual([])
      await page.getByRole('button', { name: 'Repair numeric steps', exact: true }).click()
      for (const label of unavailable.slice(0, 4)) await expectCurrent(flow(page, label), 0)
      await expectStatusLayout(flow(page, 'Fractional flow'), false)
      for (const label of unavailable.slice(4)) await expectCurrent(flow(page, label), null)
      await expect(status).toHaveText('Invalid:0/0/0/0/0/1/0')
      await expect.poll(() => stepperChanges(page)).toEqual([])
      await flow(page, 'Fractional flow').getByRole('button').nth(1).click()
      await expect(status).toHaveText('Invalid:1/0/0/0/0/1/1')
      await expectCurrent(flow(page, 'Fractional flow'), 1)
      await expect
        .poll(() => stepperChanges(page))
        .toEqual([{ label: 'Fractional flow', currentIndex: 1, previousIndex: 0 }])
    })
  })

  test(`${target} compiled FORM reset restores declared Stepper state without submitting steps or emitting changes, and cancelled reset keeps edits`, async ({
    page
  }) => {
    await withStepperBinding(page, target, 'base', async () => {
      await captureStepperChanges(page)
      const main = page.locator('form').first()
      const other = page.locator('form').nth(1)
      const first = flow(page, 'Shared page A')
      const shared = flow(page, 'Shared page B')
      const documentFlow = flow(page, 'Document flow')
      const otherFlow = flow(page, 'Other form flow')
      const person = page.getByRole('textbox', { name: 'Person', exact: true })
      const state = page.getByText(/^State:/)
      // Native INPUT has no authored name here; Stepper must add no submitted field.
      await expect.poll(() => formValues(main)).toEqual([])
      await expect.poll(() => formValues(other)).toEqual([])
      await first.getByRole('button').nth(1).click()
      await documentFlow.getByRole('button').nth(3).click()
      await otherFlow.getByRole('button').nth(1).click()
      await person.fill('Grace')
      await expect(state).toHaveText('State:1/3/1/3/0')
      await expect.poll(() => formValues(main)).toEqual([])
      await main.evaluate((element) => {
        element.addEventListener('reset', (event) => event.preventDefault(), { once: true })
        ;(element as HTMLFormElement).reset()
      })
      await expect(state).toHaveText('State:1/3/1/3/0')
      await expectCurrent(first, 1)
      await expectCurrent(documentFlow, 3)
      await expect(person).toHaveValue('Grace')
      await main.evaluate((element) => (element as HTMLFormElement).reset())
      await expect(state).toHaveText('State:0/1/1/3/0')
      await expectCurrent(first, 0)
      await expectCurrent(shared, 0)
      await expectCurrent(documentFlow, 1)
      await expectCurrent(otherFlow, 1)
      await expect(person).toHaveValue('Ada')
      await expect.poll(() => formValues(main)).toEqual([])
      await expect.poll(() => stepperChanges(page).then((events) => events.length)).toBe(3)
      await other.evaluate((element) => (element as HTMLFormElement).reset())
      await expect(state).toHaveText('State:0/1/3/3/0')
      await expectCurrent(otherFlow, 3)
      await expect.poll(() => stepperChanges(page).then((events) => events.length)).toBe(3)
      await main.getByRole('button', { name: 'Submit form', exact: true }).click()
      await expect(state).toHaveText('State:0/1/3/3/1')
      await expect.poll(() => formValues(main)).toEqual([])
    })
  })
}
