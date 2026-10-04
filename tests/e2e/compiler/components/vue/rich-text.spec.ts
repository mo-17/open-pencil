import { expect, test } from '@playwright/test'

import {
  beginRichTextComposition,
  finishRichTextComposition,
  withVueRichText
} from '#tests/helpers/compiler/components/vue-rich-text/browser'

test('Vue RichText projects safe AST, accepts update:value and v-model, and preserves local drafts', async ({
  page
}) => {
  await withVueRichText(page, async () => {
    const host = page.getByTestId('controlled'),
      editor = host.getByRole('textbox'),
      changes = page.getByTestId('changes')
    const local = page.getByTestId('uncontrolled').getByRole('textbox')
    await expect(editor).toHaveText('Seed body')
    await page.getByRole('button', { name: 'External document', exact: true }).click()
    await expect(editor).toHaveText('External <script>safe</script>')
    await expect(editor.locator('script, img, iframe')).toHaveCount(0)
    await expect(changes).toHaveText('0')
    await editor.fill('User document')
    await expect(changes).toHaveText('1')
    await editor.blur()
    await expect(changes).toHaveText('1')
    await local.fill('Instance local draft')
    await page.getByRole('button', { name: 'Rerender parent', exact: true }).click()
    await expect(local).toHaveText('Instance local draft')
    await expect(editor).toHaveText('User document')
    const values = await page
      .getByTestId('rich-text-form')
      .evaluate((element) => Object.fromEntries(new FormData(element as HTMLFormElement)))
    expect(JSON.parse(values['controlled-document'] as string).blocks[0].children[0].text).toBe(
      'User document'
    )
    expect(JSON.parse(values['local-document'] as string).blocks[0].children[0].text).toBe(
      'Instance local draft'
    )
    await page.getByTestId('modelled').getByRole('textbox').fill('Standard Vue model')
    await expect(page.getByTestId('model-value')).toContainText('Standard Vue model')
    await expect(changes).toHaveText('1')
  })
})

test('Vue RichText locks invalid values and missing listeners and reconciles ignored controlled changes', async ({
  page
}) => {
  await withVueRichText(page, async () => {
    const host = page.getByTestId('controlled'),
      editor = host.getByRole('textbox'),
      changes = page.getByTestId('changes')
    await page.getByRole('button', { name: 'Toggle listener', exact: true }).click()
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(host.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'External document', exact: true }).click()
    await expect(editor).toHaveText('External <script>safe</script>')
    for (const name of ['Missing document', 'Invalid document', 'Unsafe document link']) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(host.getByRole('alert')).toHaveText('Rich text unavailable.')
      await expect(editor).toHaveText('')
      await expect(editor).toHaveAttribute('contenteditable', 'false')
      await expect(host.locator('input[type="hidden"]')).toBeDisabled()
      await expect(changes).toHaveText('0')
    }
    await page.getByRole('button', { name: 'External document', exact: true }).click()
    await page.getByRole('button', { name: 'Toggle listener', exact: true }).click()
    await page.getByRole('button', { name: 'Toggle ignored change', exact: true }).click()
    await editor.fill('Rejected replacement')
    await expect(editor).toHaveText('External <script>safe</script>')
    await expect(changes).toHaveText('1')
  })
})

test('Vue RichText retains read-only native form JSON and omits disabled fields', async ({
  page
}) => {
  await withVueRichText(page, async () => {
    const host = page.getByTestId('controlled'),
      editor = host.getByRole('textbox'),
      hidden = host.locator('input[type="hidden"]')
    await page.getByRole('button', { name: 'Toggle read only', exact: true }).click()
    await expect(editor).toHaveAttribute('aria-readonly', 'true')
    await expect(hidden).toBeEnabled()
    expect(JSON.parse(await hidden.inputValue()).blocks[0].children[0].text).toBe('Seed body')
    let values = await page
      .getByTestId('rich-text-form')
      .evaluate((element) => Object.fromEntries(new FormData(element as HTMLFormElement)))
    expect(values).toHaveProperty('controlled-document')
    await page.getByRole('button', { name: 'Toggle disabled', exact: true }).click()
    await expect(editor).toHaveAttribute('tabindex', '-1')
    await expect(hidden).toBeDisabled()
    values = await page
      .getByTestId('rich-text-form')
      .evaluate((element) => Object.fromEntries(new FormData(element as HTMLFormElement)))
    expect(values).not.toHaveProperty('controlled-document')
    await page.getByRole('button', { name: 'External document', exact: true }).click()
    await expect(editor).toHaveText('External <script>safe</script>')
    await expect(page.getByTestId('changes')).toHaveText('0')
  })
})

test('Vue RichText defers valid external AST during Chinese composition and commits completed input once', async ({
  page
}) => {
  await withVueRichText(page, async () => {
    const host = page.getByTestId('controlled'),
      editor = host.getByRole('textbox'),
      changes = page.getByTestId('changes')
    await beginRichTextComposition(editor, '中文组合草稿')
    await page.getByRole('button', { name: 'Rerender parent', exact: true }).click()
    await expect(editor.locator('[data-composition-marker]')).toHaveCount(1)
    await page.getByRole('button', { name: 'External document', exact: true }).click()
    await expect(editor).toHaveText('中文组合草稿')
    await expect(changes).toHaveText('0')
    await finishRichTextComposition(editor)
    await expect(editor).toHaveText('External <script>safe</script>')
    await expect(editor.locator('[data-composition-marker]')).toHaveCount(0)
    await expect(changes).toHaveText('0')
    await beginRichTextComposition(editor, '中文完整输入')
    await finishRichTextComposition(editor)
    await expect(editor).toHaveText('中文完整输入')
    await expect(changes).toHaveText('1')
    await page.getByRole('button', { name: 'Seed document', exact: true }).click()
    await beginRichTextComposition(editor, 'owner变更后恢复仍须放弃的草稿')
    await page.getByRole('button', { name: 'External document', exact: true }).click()
    await expect(editor).toHaveText('owner变更后恢复仍须放弃的草稿')
    await page.getByRole('button', { name: 'Seed document', exact: true }).click()
    await finishRichTextComposition(editor)
    await expect(editor).toHaveText('Seed body')
    await expect(changes).toHaveText('1')
    await beginRichTextComposition(editor, '非法替换前的草稿')
    await page.getByRole('button', { name: 'Invalid document', exact: true }).click()
    await expect(editor).toHaveText('')
    await expect(host.getByRole('alert')).toHaveText('Rich text unavailable.')
    await finishRichTextComposition(editor)
    await expect(editor).toHaveText('')
    await expect(changes).toHaveText('1')
  })
})

for (const name of ['Toggle listener', 'Toggle read only', 'Toggle disabled']) {
  test(`Vue RichText rolls back composition when its owner invokes ${name}`, async ({ page }) => {
    await withVueRichText(page, async () => {
      const host = page.getByTestId('controlled'),
        editor = host.getByRole('textbox'),
        changes = page.getByTestId('changes')
      await beginRichTextComposition(editor, '未经接受的中文草稿')
      await page.getByRole('button', { name, exact: true }).click()
      await expect(editor).toHaveAttribute('contenteditable', 'false')
      await finishRichTextComposition(editor)
      await expect(editor).toHaveText('Seed body')
      await expect(editor.locator('[data-composition-marker]')).toHaveCount(0)
      await expect(changes).toHaveText('0')
      expect(
        JSON.parse(await host.locator('input[type="hidden"]').inputValue()).blocks[0].children[0]
          .text
      ).toBe('Seed body')
      await page.getByRole('button', { name, exact: true }).click()
      await expect(editor).toHaveAttribute('contenteditable', 'true')
      await expect(editor).toHaveText('Seed body')
      await expect(changes).toHaveText('0')
      await beginRichTextComposition(editor, '撤销权限后恢复仍须放弃的草稿')
      await page.getByRole('button', { name, exact: true }).click()
      await expect(editor).toHaveAttribute('contenteditable', 'false')
      await page.getByRole('button', { name, exact: true }).click()
      await expect(editor).toHaveAttribute('contenteditable', 'true')
      await finishRichTextComposition(editor)
      await expect(editor).toHaveText('Seed body')
      await expect(changes).toHaveText('0')
      await beginRichTextComposition(editor, '下一次完整组合输入')
      await finishRichTextComposition(editor)
      await expect(editor).toHaveText('下一次完整组合输入')
      await expect(changes).toHaveText('1')
    })
  })
}

test('Vue RichText does not report normalized empty or adjacent-run AST projections as user changes', async ({
  page
}) => {
  await withVueRichText(page, async () => {
    const host = page.getByTestId('controlled'),
      editor = host.getByRole('textbox'),
      changes = page.getByTestId('changes')
    await page.getByRole('button', { name: 'Empty document', exact: true }).click()
    await editor.focus()
    await editor.blur()
    await expect(changes).toHaveText('0')
    expect(JSON.parse(await host.locator('input[type="hidden"]').inputValue()).blocks).toEqual([])
    await page.getByRole('button', { name: 'Adjacent document runs', exact: true }).click()
    await expect(editor).toHaveText('Adjacent runs')
    await editor.focus()
    await editor.blur()
    await editor.dispatchEvent('input', { inputType: 'insertText', data: '' })
    await expect(changes).toHaveText('0')
    expect(
      JSON.parse(await host.locator('input[type="hidden"]').inputValue()).blocks[0].children
    ).toHaveLength(2)
  })
})

test('Vue RichText formatting and paste preserve reviewed AST and reject unsafe link markup', async ({
  page
}) => {
  await withVueRichText(page, async () => {
    const host = page.getByTestId('controlled'),
      editor = host.getByRole('textbox')
    await editor.fill('Formatted words')
    await editor.press('ControlOrMeta+A')
    await host.getByRole('button', { name: 'Bold', exact: true }).click()
    await expect(editor.locator('strong, b')).toHaveText('Formatted words')
    expect(
      JSON.parse(await host.locator('input[type="hidden"]').inputValue()).blocks[0].children[0]
        .marks
    ).toContainEqual({ type: 'bold' })
    page.once('dialog', (dialog) => {
      void dialog.accept(['javascript', 'alert(1)'].join(':'))
    })
    await host.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(host.locator('[aria-live="polite"]')).toHaveText(
      'Link rejected: unsupported or unsafe URL'
    )
    await editor.evaluate((element) => {
      const selection = window.getSelection(),
        range = document.createRange()
      range.selectNodeContents(element)
      selection?.removeAllRanges()
      selection?.addRange(range)
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      const data = new DataTransfer()
      data.setData('text/plain', '<script>plain text</script>')
      data.setData('text/html', '<img src="bad" onerror="alert(1)">')
      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
      )
    })
    await expect(editor).toHaveText('<script>plain text</script>')
    await expect(editor.locator('script, img, iframe')).toHaveCount(0)
  })
})

test('Vue RichText updates reactive nested AST without a parent rerender or change notification', async ({
  page
}) => {
  await withVueRichText(page, async () => {
    const host = page.getByTestId('controlled')
    await page.getByRole('button', { name: 'Mutate document in place', exact: true }).click()
    await expect(host.getByRole('textbox')).toHaveText('In-place body')
    expect(
      JSON.parse(await host.locator('input[type="hidden"]').inputValue()).blocks[0].children[0].text
    ).toBe('In-place body')
    await expect(page.getByTestId('changes')).toHaveText('0')
  })
})

test('Vue RichText updates link colors while preserving the same nodes and active composition', async ({
  page
}) => {
  await withVueRichText(page, async () => {
    const host = page.getByTestId('controlled'),
      editor = host.getByRole('textbox')
    await page.getByRole('button', { name: 'Link document', exact: true }).click()
    const link = editor.getByRole('link', { name: 'Linked body' })
    await expect(link).toHaveCSS('color', 'rgb(37, 99, 235)')
    await link.evaluate((element) => element.setAttribute('data-link-color-marker', 'retained'))
    await editor.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' }))
    )
    await page.getByRole('button', { name: 'Change link color', exact: true }).click()
    await expect(link).toHaveCSS('color', 'rgb(220, 38, 38)')
    await expect(link).toHaveAttribute('data-link-color-marker', 'retained')
    await finishRichTextComposition(editor)
    await expect(link).toHaveAttribute('data-link-color-marker', 'retained')
    await expect(page.getByTestId('changes')).toHaveText('0')
  })
})
