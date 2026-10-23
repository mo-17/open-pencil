import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createNativeCheckpointSource,
  editNativeCheckpointSource,
  nativeCheckpointDocument,
  nativeCheckpointPanel,
  nativeTemplateReadiness
} from '#tests/helpers/product-workflows/checkpoints'
import { openNativeEditorDocument } from '#tests/helpers/tauri/editor-ready'

const dialog = '//*[@role="dialog"]'
const backend = '//*[@data-test-id="lowcode-backend-editor"]'

async function shown(selector: string): Promise<WebdriverIO.Element> {
  let found: WebdriverIO.Element | undefined
  await browser.waitUntil(
    async () => {
      for (const element of await $$(selector)) {
        if (await element.isDisplayed()) {
          found = element
          return true
        }
      }
      return false
    },
    { timeoutMsg: `Native UI control is unavailable: ${selector}` }
  )
  if (!found) throw new Error(`Native UI control disappeared: ${selector}`)
  return found
}

async function button(english: string, chinese: string, scope = '') {
  const element = await shown(
    `${scope}//button[normalize-space(.)='${english}' or normalize-space(.)='${chinese}']`
  )
  await element.waitForEnabled()
  return element
}

async function openCheckpoints() {
  await (
    await shown('button[aria-label="Local checkpoints"], button[aria-label="本地版本检查点"]')
  ).click()
  await shown('[role="dialog"] form input')
}

async function closeCompilerPreview() {
  for (const close of await $$('[data-test-id="lowcode-preview-close"]')) {
    if (await close.isDisplayed()) {
      await close.click()
      break
    }
  }
}

describe('native local product workflows', () => {
  const directories: string[] = []
  after(async () => {
    for (const directory of directories) await rm(directory, { recursive: true, force: true })
  })

  it('stores a checkpoint and safety copy, restores a new unbound tab and retains the original edits', async () => {
    await openNativeEditorDocument()
    await closeCompilerPreview()
    const directory = await mkdtemp(join(tmpdir(), 'open-pencil-native-checkpoints-'))
    directories.push(directory)
    const path = join(directory, 'checkpoint-source.fig')
    const fixture = await browser.execute(createNativeCheckpointSource)
    // Establish a real test-owned source binding before the feature's UI actions.
    assert.equal(
      await browser.execute(async (path) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('Native checkpoint editor missing')
        return store.saveFigFileToPath(path)
      }, path),
      true
    )
    const original = await browser.execute(nativeCheckpointDocument)
    assert.equal(original.binding.filePath, path)
    const originalTab = await shown('[data-test-id="tabbar-tab"][aria-selected="true"]')
    await openCheckpoints()
    await (await shown('[role="dialog"] form input')).setValue('Native source checkpoint')
    await (await button('Create checkpoint', '创建检查点', dialog)).click()
    await browser.waitUntil(
      async () => {
        const state = await browser.execute(nativeCheckpointPanel)
        if (state.error) throw new Error(`Native checkpoint storage failed: ${state.error}`)
        return state.names.includes('Native source checkpoint')
      },
      { timeoutMsg: 'Native checkpoint was not persisted in the real WebView' }
    )
    await (await button('Close', '关闭', dialog)).click()
    await browser.execute(editNativeCheckpointSource, fixture.child)
    const edited = await browser.execute(nativeCheckpointDocument)
    assert.equal(edited.dirty, true)
    assert.equal(edited.roots.length, original.roots.length + 1)
    await openCheckpoints()
    await (await button('Compare with current document', '与当前文档比较', dialog)).click()
    await browser.waitUntil(async () => {
      const state = await browser.execute(nativeCheckpointPanel)
      if (state.error) throw new Error(`Native checkpoint comparison failed: ${state.error}`)
      return state.added === 1
    })
    await (await button('Open checkpoint as new document', '作为新文档打开检查点', dialog)).click()
    await browser.waitUntil(
      async () => {
        const restored = await browser.execute(nativeCheckpointDocument)
        return (
          restored.tabCount === original.tabCount + 1 &&
          !restored.preparing &&
          restored.roots.some((node) => node.name === 'Native checkpoint source')
        )
      },
      { timeoutMsg: 'Native checkpoint copy did not finish preparing' }
    )
    const restored = await browser.execute(nativeCheckpointDocument)
    const withoutIds = (roots: typeof restored.roots) => roots.map(({ id: _id, ...node }) => node)
    assert.deepEqual(withoutIds(restored.roots), withoutIds(original.roots))
    assert.deepEqual(restored.binding, {
      filePath: null,
      sourcePath: null,
      handle: false,
      storage: false
    })
    assert.equal(restored.dirty, true)
    await originalTab.click()
    const retained = await browser.execute(nativeCheckpointDocument)
    assert.deepEqual(retained.roots, edited.roots)
    assert.deepEqual(retained.binding, edited.binding)
    assert.equal(retained.dirty, true)
    await openCheckpoints()
    await browser.waitUntil(
      async () => (await browser.execute(nativeCheckpointPanel)).names.length === 2
    )
    const versions = await browser.execute(nativeCheckpointPanel)
    assert.ok(versions.names.includes('Native source checkpoint'))
    assert.ok(
      versions.names.some((name) => name === 'Before checkpoint restore' || name === '恢复检查点前')
    )
    const backupRow = `${dialog}//li[.//p[normalize-space(.)='Before checkpoint restore' or normalize-space(.)='恢复检查点前']]`
    await (await button('Compare with current document', '与当前文档比较', backupRow)).click()
    await browser.waitUntil(async () => {
      const state = await browser.execute(nativeCheckpointPanel)
      if (state.error) throw new Error(`Native safety-copy comparison failed: ${state.error}`)
      return state.compared
    })
    assert.equal((await browser.execute(nativeCheckpointPanel)).changedLayers, 0)
    await (await button('Close', '关闭', dialog)).click()
  })

  it('creates locally configured templates without claiming runtime readiness and preserves a public-auth draft through repair links', async () => {
    await (await shown('[data-test-id="tabbar-new"]')).click()
    await (await shown('[data-test-id="home-new-document"]')).click()
    await openNativeEditorDocument()
    await closeCompilerPreview()
    const initial = await browser.execute(nativeTemplateReadiness)
    await (await button('Template setup', '模板配置向导', backend)).click()
    // The default personal-notes and local-Keycloak choices need no network or credentials.
    await (await button('Continue', '继续', dialog)).click()
    await (await button('Continue', '继续', dialog)).click()
    await (await button('Create application', '创建应用', dialog)).click()
    await browser.waitUntil(
      async () => {
        const state = await browser.execute(nativeTemplateReadiness)
        if (state.error) throw new Error(`Native template creation failed: ${state.error}`)
        return state.model === 'configured' && state.login === 'configured'
      },
      { timeoutMsg: 'Native template metadata was not configured locally' }
    )
    const created = await browser.execute(nativeTemplateReadiness)
    assert.equal(created.runtime, 'unverified')
    assert.equal(created.pages, initial.pages + 2)
    await (await button('Edit sign-in configuration', '编辑登录配置', dialog)).click()
    await closeCompilerPreview()
    const clientSelector = `${backend}//label[contains(normalize-space(.),'Public client ID') or contains(normalize-space(.),'公开客户端标识符')]/input`
    const client = await shown(clientSelector)
    assert.equal(await client.getValue(), 'notes-public-client')
    await client.setValue('native-public-draft-client')
    await (await button('Template setup', '模板配置向导', backend)).click()
    await browser.waitUntil(
      async () => (await browser.execute(nativeTemplateReadiness)).model === 'missing'
    )
    assert.equal((await browser.execute(nativeTemplateReadiness)).runtime, 'unverified')
    await (await button('Edit and save Backend model', '编辑并保存后端模型', dialog)).click()
    await (await button('HTTP API & Login', 'HTTP API 与登录', backend)).click()
    assert.equal(await (await shown(clientSelector)).getValue(), 'native-public-draft-client')
    assert.equal(await (await shown('[data-test-id="lowcode-backend-save"]')).isEnabled(), true)
    assert.equal((await browser.execute(nativeTemplateReadiness)).pages, created.pages)
    await closeCompilerPreview()
  })
})
