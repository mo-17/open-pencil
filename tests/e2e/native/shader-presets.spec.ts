import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'

import {
  createNativeShaderPresetFixture,
  nativeShaderPresetSources,
  selectNativeShaderPresetTargets
} from '#tests/helpers/product-workflows/shader-presets'
import { openNativeEditorDocument } from '#tests/helpers/tauri/editor-ready'
import { invokeNative } from '#tests/helpers/tauri/invoke'

const librarySelector = '[data-property="shader-preset-library"]'
const parameterSelector = '[data-property="shader-content-parameter"]'

async function parameterEquals(value: number) {
  await browser.waitUntil(
    async () => {
      const field = await $(parameterSelector)
      return Number(await field.getAttribute('aria-valuenow')) === value
    },
    { timeout: 5000, timeoutMsg: `Native Shader parameter did not become ${value}` }
  )
}

async function editParameter(value: number) {
  const field = await $(parameterSelector)
  await field.click()
  const input = await $(`${parameterSelector} input`)
  await input.waitForExist()
  await input.setValue(String(value))
  await browser.keys('Enter')
  await parameterEquals(value)
}

async function choosePreset(name: string) {
  const select = await $(`${librarySelector} [role="combobox"]`)
  // The embedded driver's click() focuses via HTMLElement.click(), without pointer events.
  // Reka Select exposes Enter activation on both its trigger and its focused option.
  await select.click()
  await browser.keys('Enter')
  await browser.waitUntil(
    () => select.getAttribute('aria-expanded').then((value) => value === 'true'),
    {
      timeout: 5000,
      timeoutMsg: 'Native preset keyboard activation did not open its listbox'
    }
  )
  const option = await $(`//*[@role="option" and normalize-space(.)="${name}"]`)
  await option.waitForDisplayed({ timeout: 5000 })
  await option.click()
  await browser.keys('Enter')
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const listboxes = document.querySelectorAll<HTMLElement>('[role="listbox"]')
        return [...listboxes].every(
          (listbox) =>
            listbox.getClientRects().length === 0 ||
            getComputedStyle(listbox).visibility === 'hidden'
        )
      }),
    { timeout: 5000, timeoutMsg: 'Native preset listbox did not close' }
  )
  // Visibility alone misses the aria-hidden leak caused by a closing Select portal.
  const accessible = await browser.execute(() => {
    const root = document.querySelector('[data-property="shader-preset-library"]')
    const button = [...(root?.querySelectorAll('button') ?? [])].find((candidate) =>
      /^(Apply to selection|应用到选择)$/u.test(candidate.textContent?.trim() ?? '')
    )
    return !!button && !button.disabled && !button.closest('[aria-hidden="true"]')
  })
  assert.equal(accessible, true, 'Preset Apply must remain enabled and accessible after selection')
  const apply = await $(
    '//*[@data-property="shader-preset-library"]//button[normalize-space(.)="Apply to selection" or normalize-space(.)="应用到选择"]'
  )
  await apply.waitForDisplayed()
  await apply.click()
}

describe('native personal Shader presets', () => {
  it('saved-frame fixture: saves through UI, reads back and undoes a source-preserving batch', async () => {
    await openNativeEditorDocument()
    const name = `QA-Shader-${randomUUID().slice(0, 8)}`
    const fixture = await browser.execute(createNativeShaderPresetFixture, name)
    assert.equal(fixture.mode, 'saved-frame-fixture')
    assert.ok(fixture.frameBytes.every((length) => length > 100))
    assert.equal(fixture.ids.length, 2)
    const original = await browser.execute(nativeShaderPresetSources, fixture.ids)
    await parameterEquals(8)
    await editParameter(12)
    const input = await $(
      `${librarySelector} input[aria-label="Preset name"], ${librarySelector} input[aria-label="预设名称"]`
    )
    await input.setValue(name)
    const save = await $(
      '//*[@data-property="shader-preset-library"]//button[normalize-space(.)="Save current filter" or normalize-space(.)="保存当前滤镜"]'
    )
    await save.click()
    await browser.waitUntil(
      async () => {
        const alert = await $(`${librarySelector} [data-slot="alert"]`)
        return (await alert.getAttribute('data-tone')) === 'info'
      },
      { timeout: 5000, timeoutMsg: 'Native preset save did not report success' }
    )
    await editParameter(8)
    // Recreate the inspector to read the persisted library in the same native WebView.
    // This does not claim persistence across application restarts or page reloads.
    const noTargets: string[] = []
    await browser.execute(selectNativeShaderPresetTargets, noTargets)
    await $(librarySelector).waitForExist({ reverse: true })
    await browser.execute(selectNativeShaderPresetTargets, [fixture.ids[0]])
    await $(librarySelector).waitForDisplayed()
    await choosePreset(name)
    await parameterEquals(12)
    assert.deepEqual(await browser.execute(nativeShaderPresetSources, fixture.ids), original)

    await editParameter(8)
    await browser.execute(selectNativeShaderPresetTargets, fixture.ids)
    await choosePreset(name)
    for (const id of fixture.ids) {
      await browser.execute(selectNativeShaderPresetTargets, [id])
      await parameterEquals(12)
    }
    assert.deepEqual(await browser.execute(nativeShaderPresetSources, fixture.ids), original)
    // Exercise the native menu command once; inspector selection changes do not add history.
    await invokeNative('plugin:event|emit', { event: 'menu-event', payload: 'edit.undo' })
    for (const [index, id] of fixture.ids.entries()) {
      await browser.execute(selectNativeShaderPresetTargets, [id])
      await parameterEquals(index === 0 ? 8 : 4)
    }
    assert.deepEqual(await browser.execute(nativeShaderPresetSources, fixture.ids), original)
  })
})
