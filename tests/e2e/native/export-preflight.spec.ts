import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  countRedExportPixels,
  createMissingImageExportFixture,
  repairExportFixture
} from '#tests/helpers/document/export-preflight'
import { openNativeEditorDocument } from '#tests/helpers/tauri/editor-ready'
import { writeNativeFile } from '#tests/helpers/tauri/invoke'

describe('native export preflight', () => {
  it('blocks a missing resource, locates it and exports repaired pixels through native file I/O', async () => {
    await openNativeEditorDocument()
    const id = await browser.execute(createMissingImageExportFixture)
    await $('[data-test-id="export-button"]').click()
    const issue = await $('[role="dialog"] [data-export-issue="missing-image"]')
    await issue.waitForDisplayed()
    await issue.$('button').click()
    await $('[role="dialog"]').waitForExist({ reverse: true })
    const selected = await browser.execute(() => [
      ...(window.openPencil?.getStore?.()?.state.selectedIds ?? [])
    ])
    assert.deepEqual(selected, [id])
    await browser.execute(repairExportFixture, id)
    await $('[data-property="export-preflight"]').click()
    await $('[role="dialog"]').waitForDisplayed()
    assert.equal(await $('[data-export-issue="missing-image"]').isExisting(), false)
    await $('[role="dialog"] [data-slot="dialog-footer"] button:last-child').click()
    // Rendering and filesystem IPC are real. A trusted OS save-dialog interaction
    // remains separate from this embedded driver's DOM clicks.
    const bytes = await browser.execute(async (id) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('Native export editor is missing')
      const image = await store.renderExportImage([id], 1, 'PNG')
      if (!image) throw new Error('Native export produced no image')
      return [...image]
    }, id)
    assert.ok((await browser.execute(countRedExportPixels, bytes)) > 4_000)
    const directory = await mkdtemp(join(tmpdir(), 'open-pencil-preflight-'))
    try {
      const path = join(directory, 'repaired.png')
      assert.equal(await writeNativeFile(path, bytes), null)
      const png = await readFile(path)
      assert.equal(png.readUInt32BE(16), 80)
      assert.equal(png.readUInt32BE(20), 60)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
