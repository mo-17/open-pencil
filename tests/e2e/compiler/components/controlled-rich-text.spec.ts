import { expect, test } from '@playwright/test'

import { withControlledLocalData } from '#tests/helpers/compiler/components/controlled-local-data/browser'

test('React RichText API projects bounded safe AST without change events and preserves local drafts', async ({
  page
}) => {
  await withControlledLocalData(page, 'react', 'rich-text', async () => {
    const host = page.getByTestId('controlled')
    const editor = host.getByRole('textbox')
    const changes = page.getByTestId('changes')
    const local = page.getByTestId('uncontrolled').getByRole('textbox')
    await expect(editor).toHaveText('Seed body')
    await expect(changes).toHaveText('0')
    await page.getByRole('button', { name: 'External document', exact: true }).click()
    await expect(editor).toHaveText('External <script>safe</script>')
    await expect(editor.locator('script, img, iframe')).toHaveCount(0)
    await expect(changes).toHaveText('0')
    await editor.fill('User document')
    await expect(editor).toHaveText('User document')
    await expect.poll(async () => Number(await changes.textContent())).toBeGreaterThan(0)
    const acceptedChanges = await changes.textContent()
    await editor.blur()
    await expect(changes).toHaveText(acceptedChanges ?? '')
    await local.fill('Instance local draft')
    await page.getByRole('button', { name: 'Rerender parent', exact: true }).click()
    await expect(local).toHaveText('Instance local draft')
    await expect(editor).toHaveText('User document')
    await expect(changes).toHaveText(acceptedChanges ?? '')
    const values = await page
      .getByTestId('local-form')
      .evaluate((element) => Object.fromEntries(new FormData(element as HTMLFormElement)))
    expect(JSON.parse(values['controlled-document'] as string).blocks[0].children[0].text).toBe(
      'User document'
    )
    expect(JSON.parse(values['local-document'] as string).blocks[0].children[0].text).toBe(
      'Instance local draft'
    )
  })
})

test('React RichText API locks invalid or read-only values and restores ignored controlled edits', async ({
  page
}) => {
  await withControlledLocalData(page, 'react', 'rich-text', async () => {
    const host = page.getByTestId('controlled')
    const editor = host.getByRole('textbox')
    const changes = page.getByTestId('changes')
    await page.getByRole('button', { name: 'Toggle read only', exact: true }).click()
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(host.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'External document', exact: true }).click()
    await expect(editor).toHaveText('External <script>safe</script>')
    await expect(changes).toHaveText('0')
    for (const name of ['Missing document', 'Invalid document', 'Unsafe document link']) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(host).toHaveAttribute('data-openpencil-rich-text-unavailable', 'true')
      await expect(editor).toHaveText('')
      await expect(editor).toHaveAttribute('contenteditable', 'false')
      await expect(host.locator('input[type="hidden"]')).toBeDisabled()
      await expect(changes).toHaveText('0')
    }
    await page.getByRole('button', { name: 'External document', exact: true }).click()
    await page.getByRole('button', { name: 'Toggle read only', exact: true }).click()
    await page.getByRole('button', { name: 'Toggle ignored change', exact: true }).click()
    await editor.fill('Ignored replacement')
    await expect(editor).toHaveText('External <script>safe</script>')
    await expect.poll(async () => Number(await changes.textContent())).toBeGreaterThan(0)
    await expect(editor.locator('script, img, iframe')).toHaveCount(0)
  })
})

test('React RichText API defers external AST projection until Chinese composition ends', async ({
  page
}) => {
  await withControlledLocalData(page, 'react', 'rich-text', async () => {
    const host = page.getByTestId('controlled')
    const editor = host.getByRole('textbox')
    const changes = page.getByTestId('changes')
    await editor.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' }))
      const paragraph = element.querySelector('p')
      if (!paragraph) throw new Error('Missing editable paragraph')
      paragraph.textContent = '中文组合草稿'
      paragraph.setAttribute('data-composition-marker', '')
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          isComposing: true,
          inputType: 'insertCompositionText',
          data: '中文'
        })
      )
    })
    await page.getByRole('button', { name: 'Rerender parent', exact: true }).click()
    await expect(editor).toHaveText('中文组合草稿')
    await expect(editor.locator('[data-composition-marker]')).toHaveCount(1)
    await expect(changes).toHaveText('0')
    await page.getByRole('button', { name: 'External document', exact: true }).click()
    await expect(editor).toHaveText('中文组合草稿')
    await expect(editor.locator('[data-composition-marker]')).toHaveCount(1)
    await editor.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }))
    )
    await expect(editor).toHaveText('External <script>safe</script>')
    await expect(editor.locator('[data-composition-marker]')).toHaveCount(0)
    await editor.evaluate((element) =>
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          isComposing: false,
          inputType: 'insertText',
          data: '中文'
        })
      )
    )
    await expect(editor).toHaveText('External <script>safe</script>')
    await expect(changes).toHaveText('0')
    await editor.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' }))
      element.textContent = '中文完整输入'
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          isComposing: true,
          inputType: 'insertCompositionText',
          data: '中文完整输入'
        })
      )
      element.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: '中文完整输入' })
      )
    })
    await expect(editor).toHaveText('中文完整输入')
    await expect(changes).toHaveText('1')
  })
})

test('React RichText API discards composition drafts when its owner removes write authority', async ({
  page
}) => {
  await withControlledLocalData(page, 'react', 'rich-text', async () => {
    const host = page.getByTestId('controlled')
    const editor = host.getByRole('textbox')
    const changes = page.getByTestId('changes')
    await editor.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' }))
      const paragraph = element.querySelector('p')
      if (!paragraph) throw new Error('Missing editable paragraph')
      paragraph.textContent = '未获接受的中文草稿'
      paragraph.setAttribute('data-composition-marker', '')
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          isComposing: true,
          inputType: 'insertCompositionText',
          data: '中文'
        })
      )
    })
    await page.getByRole('button', { name: 'Toggle read only', exact: true }).click()
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await editor.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }))
    )
    await expect(editor).toHaveText('Seed body')
    await expect(editor.locator('[data-composition-marker]')).toHaveCount(0)
    await editor.evaluate((element) =>
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          isComposing: false,
          inputType: 'insertText',
          data: '中文'
        })
      )
    )
    await expect(editor).toHaveText('Seed body')
    await expect(changes).toHaveText('0')
    expect(
      JSON.parse(await host.locator('input[type="hidden"]').inputValue()).blocks[0].children[0].text
    ).toBe('Seed body')
    await page.getByRole('button', { name: 'Toggle read only', exact: true }).click()
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await expect(editor).toHaveText('Seed body')
    await expect(changes).toHaveText('0')
  })
})
