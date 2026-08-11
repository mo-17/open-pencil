import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  chromium,
  expect as playwrightExpect,
  type Browser,
  type Locator,
  type Page
} from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import {
  createUploadButtonModuleFrameOverrides,
  UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
  type UploadButtonModuleConfig
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

type UploadOverrides = Partial<UploadButtonModuleConfig>

function buildUploadFiles(
  overrides: UploadOverrides = {},
  instanceCount = 1,
  authoredTrigger = false,
  iconOnlyAuthoredTrigger = false,
  disabled = false
) {
  const graph = makeSceneGraph('Compiled Upload Button runtime')
  const pageId = firstPageId(graph)
  for (let index = 0; index < instanceCount; index += 1) {
    const config: UploadButtonModuleConfig = {
      ...UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
      ...overrides,
      accept: [...(overrides.accept ?? UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG.accept)],
      triggerLabel: `${overrides.triggerLabel ?? UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG.triggerLabel} ${index + 1}`
    }
    const frame = graph.createNode('FRAME', pageId, {
      ...createUploadButtonModuleFrameOverrides(config),
      x: 24 + index * 260,
      y: 80
    })
    if (authoredTrigger) {
      if (iconOnlyAuthoredTrigger) {
        graph.createNode('RECTANGLE', frame.id, {
          height: 18,
          name: 'Authored upload icon',
          width: 18,
          x: 91,
          y: 15
        })
      } else {
        graph.createNode('BUTTON', frame.id, {
          width: 168,
          height: 44,
          x: 16,
          y: 2,
          interactiveProps: { text: `Authored upload trigger ${index + 1}` }
        })
      }
    }
  }
  const files = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'upload-button-runtime-browser', devMode: false })
  }).files
  if (disabled) {
    files.set(
      'src/App.tsx',
      String(files.get('src/App.tsx')).replace(
        '<OpenPencilUploadButton config=',
        '<OpenPencilUploadButton disabled config='
      )
    )
  }
  return files
}

async function loadFixture(
  server: PreviewServer,
  page: Page,
  overrides: UploadOverrides = {},
  instanceCount = 1,
  authoredTrigger = false,
  iconOnlyAuthoredTrigger = false,
  disabled = false
): Promise<void> {
  server.updateFiles(
    buildUploadFiles(overrides, instanceCount, authoredTrigger, iconOnlyAuthoredTrigger, disabled)
  )
  await page.goto(server.url, { waitUntil: 'networkidle' })
}

async function chooseFiles(
  page: Page,
  triggerIndex: number,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  keyboard = false
): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser')
  const trigger = page.locator('[data-openpencil-upload-trigger]').nth(triggerIndex)
  if (keyboard) {
    await trigger.focus()
    await trigger.press('Enter')
  } else {
    await trigger.click()
  }
  const chooser = await chooserPromise
  await chooser.setFiles(files)
}

async function uploadDetails(page: Page, root: Locator): Promise<Locator> {
  const owner = await root.getAttribute('data-openpencil-upload-owner')
  if (!owner) throw new Error('Upload Button root is missing its owner identity')
  return page.locator(`[data-openpencil-upload-details][data-openpencil-upload-owner="${owner}"]`)
}

describe('preview browser — compiled Upload Button module', () => {
  const timeoutMs = 40_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildUploadFiles() })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 })
  }, timeoutMs)

  afterEach(async () => {
    try {
      await page?.close()
    } finally {
      try {
        await browser?.close()
      } finally {
        await server?.close()
        page = null
        browser = null
        server = null
      }
    }
  }, timeoutMs)

  test(
    'keeps icon and label independent and isolates an authored interactive trigger',
    async () => {
      if (!server || !page) throw new Error('Missing Upload Button preview runtime')
      for (const [showTriggerLabel, showTriggerIcon] of [
        [true, true],
        [true, false],
        [false, true]
      ] as const) {
        await loadFixture(server, page, { showTriggerLabel, showTriggerIcon })
        const trigger = page.locator('[data-openpencil-upload-trigger]')
        const metrics = await trigger.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return {
            height: rect.height,
            icon: Boolean(element.querySelector('[data-openpencil-upload-trigger-icon]')),
            label: element.querySelector('[data-openpencil-upload-trigger-label]')?.textContent,
            width: rect.width
          }
        })
        expect(metrics).toEqual({
          height: 48,
          icon: showTriggerIcon,
          label: showTriggerLabel ? 'Choose file 1' : undefined,
          width: 200
        })
      }

      await loadFixture(server, page, {}, 1, true)
      const root = page.locator('[data-openpencil-upload-root]')
      await playwrightExpect(
        root.locator('[data-openpencil-upload-trigger-authored]')
      ).toHaveAttribute('inert', '')
      expect(await root.locator('button').count()).toBe(2)
      expect(await root.locator('[data-openpencil-upload-trigger] button').count()).toBe(0)
      await playwrightExpect(root.getByText('Authored upload trigger 1')).toBeVisible()
      await playwrightExpect(root.locator('[data-openpencil-upload-trigger]')).toHaveAccessibleName(
        /Authored upload trigger 1.*Choose file 1/
      )

      await loadFixture(server, page, {}, 1, true, true)
      await playwrightExpect(page.locator('[data-openpencil-upload-trigger]')).toHaveAccessibleName(
        'Choose file 1'
      )
    },
    timeoutMs
  )

  test(
    'uses the native picker, revalidates accept and size, reports local-only state, and restores remove focus',
    async () => {
      if (!server || !page) throw new Error('Missing Upload Button preview runtime')
      await loadFixture(server, page, {
        accept: ['.png', 'text/*'],
        multiple: true,
        maxFiles: 4,
        maxFileBytes: 5,
        helperText: 'Choose a tiny PNG or text file.'
      })
      const input = page.locator('[data-openpencil-upload-input]')
      await playwrightExpect(input).toHaveAttribute('accept', '.png,text/*')
      await playwrightExpect(input).toHaveAttribute('multiple', '')

      await chooseFiles(page, 0, [
        { name: 'Upper.PNG', mimeType: 'application/octet-stream', buffer: Buffer.from('1234') },
        { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('12') },
        { name: 'wrong.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('12') },
        { name: 'large.png', mimeType: 'image/png', buffer: Buffer.from('123456') }
      ])

      await playwrightExpect(page.getByRole('status')).toHaveText(
        '2 files selected locally — not uploaded.'
      )
      await playwrightExpect(page.getByRole('alert')).toContainText(
        '“wrong.jpg” is not an accepted file type.'
      )
      await playwrightExpect(page.getByRole('alert')).toContainText(
        '“large.png” exceeds the 5 B limit.'
      )
      await playwrightExpect(page.locator('[data-openpencil-upload-file]')).toHaveCount(2)
      expect(await page.locator('[data-openpencil-upload-details] img').count()).toBe(0)
      expect(await input.inputValue()).toBe('')
      await playwrightExpect(page.locator('[data-openpencil-upload-trigger]')).toBeFocused()

      const firstRemove = page.getByRole('button', {
        name: 'Remove Upper.PNG from local selection'
      })
      await firstRemove.focus()
      await firstRemove.click()
      await playwrightExpect(
        page.getByRole('button', { name: 'Remove note.txt from local selection' })
      ).toBeFocused()
      await playwrightExpect(page.getByRole('status')).toContainText('1 file selected locally')

      await page.getByRole('button', { name: 'Remove note.txt from local selection' }).click()
      await playwrightExpect(page.locator('[data-openpencil-upload-trigger]')).toBeFocused()
      await playwrightExpect(page.getByRole('alert')).toHaveCount(0)
    },
    timeoutMs
  )

  test(
    'defines single-file replacement and reset semantics while keeping a hidden list status explicit',
    async () => {
      if (!server || !page) throw new Error('Missing Upload Button preview runtime')
      await loadFixture(server, page, {
        accept: ['text/plain'],
        multiple: false,
        maxFiles: 1,
        maxFileBytes: 100,
        showFileList: false
      })
      await chooseFiles(
        page,
        0,
        [{ name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('first') }],
        true
      )
      await playwrightExpect(page.getByRole('status')).toHaveText(
        '1 file selected locally — not uploaded.'
      )
      await playwrightExpect(page.locator('[data-openpencil-upload-file-list]')).toHaveCount(0)
      expect(await page.locator('[data-openpencil-upload-input]').inputValue()).toBe('')

      const cancelChooserPromise = page.waitForEvent('filechooser')
      await page.locator('[data-openpencil-upload-trigger]').click()
      const cancelChooser = await cancelChooserPromise
      await cancelChooser.setFiles([])
      await playwrightExpect(page.getByRole('status')).toHaveText(
        '1 file selected locally — not uploaded.'
      )

      await chooseFiles(page, 0, [
        { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('first') }
      ])
      await playwrightExpect(page.getByRole('status')).toHaveText(
        '1 file selected locally — not uploaded.'
      )

      await chooseFiles(page, 0, [
        { name: 'rejected.png', mimeType: 'image/png', buffer: Buffer.from('png') }
      ])
      await playwrightExpect(page.getByRole('alert')).toContainText('not an accepted file type')
      await chooseFiles(page, 0, [
        { name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('next') }
      ])
      await playwrightExpect(page.getByRole('alert')).toHaveCount(0)
      await playwrightExpect(page.getByRole('status')).toHaveText(
        '1 file selected locally — not uploaded.'
      )
    },
    timeoutMs
  )

  test(
    'uses one synchronous selection snapshot for rapid consecutive changes at the file limit',
    async () => {
      if (!server || !page) throw new Error('Missing Upload Button preview runtime')
      await loadFixture(server, page, {
        accept: ['text/plain'],
        multiple: true,
        maxFiles: 2,
        maxFileBytes: 100,
        showFileList: false
      })
      await page.locator('[data-openpencil-upload-input]').evaluate((element) => {
        const input = element as HTMLInputElement
        const dispatchFile = (name: string) => {
          const transfer = new DataTransfer()
          transfer.items.add(new File([name], name, { type: 'text/plain' }))
          Object.defineProperty(input, 'files', {
            configurable: true,
            value: transfer.files
          })
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }
        dispatchFile('first.txt')
        dispatchFile('second.txt')
        dispatchFile('third.txt')
      })
      await playwrightExpect(page.getByRole('status')).toHaveText(
        '2 files selected locally — not uploaded.'
      )
      await playwrightExpect(page.getByRole('alert')).toHaveText('You can select up to 2 files.')
      await playwrightExpect(page.locator('[data-openpencil-upload-file]')).toHaveCount(0)
      await page.getByRole('button', { name: 'Clear local selection' }).click()
      await playwrightExpect(page.getByRole('status')).toHaveCount(0)
      await playwrightExpect(page.getByRole('alert')).toHaveCount(0)
      await playwrightExpect(page.locator('[data-openpencil-upload-trigger]')).toBeFocused()

      await page.locator('[data-openpencil-upload-input]').evaluate((element) => {
        const input = element as HTMLInputElement
        const transfer = new DataTransfer()
        for (let index = 0; index < 150; index += 1) {
          const name =
            index === 0
              ? 'x'.repeat(10_000) + '\u061c\u200e\u202eunsafe.png'
              : `rejected-${index}.png`
          transfer.items.add(new File(['x'], name, { type: 'image/png' }))
        }
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: transfer.files
        })
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })
      const boundedAlert = page.getByRole('alert')
      await playwrightExpect(boundedAlert).toContainText('96 more files were rejected.')
      await playwrightExpect(boundedAlert).toContainText('50 additional files were not checked.')
      const boundedText = (await boundedAlert.textContent()) ?? ''
      expect(boundedText.length).toBeLessThan(1_000)
      expect(boundedText).not.toContain('\u061c')
      expect(boundedText).not.toContain('\u200e')
      expect(boundedText).not.toContain('\u202e')
      await playwrightExpect(page.getByRole('status')).toHaveCount(0)
    },
    timeoutMs
  )

  test(
    'supports bounded file drop, reduced motion, 375px layout, and isolated instances',
    async () => {
      if (!server || !page) throw new Error('Missing Upload Button preview runtime')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize({ width: 375, height: 667 })
      await loadFixture(
        server,
        page,
        {
          accept: ['image/*'],
          multiple: true,
          maxFiles: 2,
          maxFileBytes: 100,
          allowDrop: true
        },
        2
      )
      const roots = page.locator('[data-openpencil-upload-root]')
      const firstDetails = await uploadDetails(page, roots.nth(0))
      const secondDetails = await uploadDetails(page, roots.nth(1))
      const trigger = roots.nth(0).locator('[data-openpencil-upload-trigger]')
      expect(
        await trigger.evaluate((element) => getComputedStyle(element).transitionDuration)
      ).toBe('0s')
      await roots.nth(0).evaluate((element) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File(['a'], 'one.png', { type: 'image/png' }))
        transfer.items.add(new File(['b'], 'two.jpg', { type: 'image/jpeg' }))
        element.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
        )
      })
      await playwrightExpect(firstDetails.getByRole('status')).toContainText(
        '2 files selected locally'
      )
      await chooseFiles(page, 0, [
        { name: 'three.webp', mimeType: 'image/webp', buffer: Buffer.from('c') }
      ])
      await playwrightExpect(firstDetails.getByRole('alert')).toContainText(
        'You can select up to 2 files.'
      )
      await playwrightExpect(secondDetails).toHaveCount(0)

      const detailsBox = await firstDetails.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, width: rect.width }
      })
      expect(detailsBox.width).toBeGreaterThanOrEqual(220)
      expect(detailsBox.left).toBeGreaterThanOrEqual(8)
      expect(detailsBox.right).toBeLessThanOrEqual(367)

      await roots.nth(1).evaluate((element) => {
        const transfer = new DataTransfer()
        transfer.setData('text/plain', 'not a file')
        element.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
        )
      })
      await playwrightExpect(secondDetails).toHaveCount(0)

      await roots.nth(1).evaluate((element) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([], 'folder', { type: 'application/octet-stream' }))
        const original = Object.getOwnPropertyDescriptor(
          DataTransferItem.prototype,
          'webkitGetAsEntry'
        )
        Object.defineProperty(DataTransferItem.prototype, 'webkitGetAsEntry', {
          configurable: true,
          value: () => ({ isDirectory: true, isFile: false })
        })
        element.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
        )
        if (original) {
          Object.defineProperty(DataTransferItem.prototype, 'webkitGetAsEntry', original)
        } else {
          delete (
            DataTransferItem.prototype as DataTransferItem & {
              webkitGetAsEntry?: unknown
            }
          ).webkitGetAsEntry
        }
      })
      await playwrightExpect(secondDetails.getByRole('status')).toHaveCount(0)
      await playwrightExpect(secondDetails.getByRole('alert')).toHaveText(
        'Folders are not supported.'
      )
      const edgeDetails = secondDetails
      await playwrightExpect
        .poll(async () =>
          edgeDetails.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return { left: rect.left, right: rect.right, width: rect.width }
          })
        )
        .toEqual({ left: 147, right: 367, width: 220 })

      await page.setViewportSize({ width: 320, height: 667 })
      await playwrightExpect
        .poll(async () =>
          edgeDetails.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return { left: rect.left, right: rect.right, width: rect.width }
          })
        )
        .toEqual({ left: 92, right: 312, width: 220 })

      await roots.nth(1).evaluate((element) => {
        ;(element as HTMLElement).style.top = '600px'
        window.dispatchEvent(new Event('resize'))
      })
      await playwrightExpect
        .poll(async () => {
          const [details, triggerBox] = await Promise.all([
            edgeDetails.evaluate((element) => element.getBoundingClientRect().top),
            roots
              .nth(1)
              .locator('[data-openpencil-upload-trigger]')
              .evaluate((element) => element.getBoundingClientRect().top)
          ])
          return details < triggerBox
        })
        .toBe(true)
    },
    timeoutMs
  )

  test(
    'prevents browser file-navigation defaults when drop processing is disabled',
    async () => {
      if (!server || !page) throw new Error('Missing Upload Button preview runtime')
      for (const [allowDrop, disabled] of [
        [false, false],
        [true, true]
      ] as const) {
        await loadFixture(server, page, { allowDrop }, 1, false, false, disabled)
        const prevented = await page
          .locator('[data-openpencil-upload-root]')
          .evaluate((element) => {
            const transfer = new DataTransfer()
            transfer.items.add(new File(['local'], 'local.txt', { type: 'text/plain' }))
            const over = new DragEvent('dragover', {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer
            })
            const drop = new DragEvent('drop', {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer
            })
            element.dispatchEvent(over)
            element.dispatchEvent(drop)
            return {
              drop: drop.defaultPrevented,
              dropEffect: transfer.dropEffect,
              over: over.defaultPrevented
            }
          })
        expect(prevented).toEqual({ drop: true, dropEffect: 'none', over: true })
        await playwrightExpect(page.getByRole('status')).toHaveCount(0)
        await playwrightExpect(page.getByRole('alert')).toHaveCount(0)
        if (disabled) {
          await playwrightExpect(page.locator('[data-openpencil-upload-trigger]')).toBeDisabled()
          await playwrightExpect(page.locator('[data-openpencil-upload-input]')).toBeDisabled()
        }
      }
    },
    timeoutMs
  )
})
