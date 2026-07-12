import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import type { SceneGraph } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function addRuntimeThemeVariables(graph: SceneGraph): void {
  graph.addCollection({
    id: 'col-runtime-theme',
    name: 'Runtime Theme',
    modes: [
      { modeId: 'light', name: 'Light' },
      { modeId: 'dark', name: 'Dark' }
    ],
    defaultModeId: 'light',
    variableIds: ['var-primary', 'var-radius']
  })
  graph.addVariable({
    id: 'var-primary',
    name: 'color/primary',
    type: 'COLOR',
    collectionId: 'col-runtime-theme',
    valuesByMode: {
      light: { r: 0.2, g: 0.4, b: 0.8, a: 1 } satisfies Color,
      dark: { r: 0.8, g: 0.9, b: 1, a: 1 } satisfies Color
    },
    description: '',
    hiddenFromPublishing: false
  })
  graph.addVariable({
    id: 'var-radius',
    name: 'radius/base',
    type: 'FLOAT',
    collectionId: 'col-runtime-theme',
    valuesByMode: { light: 8, dark: 10 },
    description: '',
    hiddenFromPublishing: false
  })
}

function buildRuntimeUiSmokeFiles(): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  addRuntimeThemeVariables(graph)
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'doc-email', name: 'email', type: 'string', defaultValue: '' },
      { id: 'doc-open', name: 'isOpen', type: 'boolean', defaultValue: false }
    ]
  })

  graph.createNode('BUTTON', pageId, {
    name: 'ToastButton',
    x: 24,
    y: 24,
    width: 140,
    height: 40,
    interactiveProps: { text: 'Toast' },
    events: {
      onClick: [
        {
          id: 'toast',
          kind: 'toast',
          messageExpr: '"Saved via smoke"',
          variant: 'success',
          durationMs: 0
        }
      ]
    }
  })
  graph.createNode('BUTTON', pageId, {
    name: 'ConfirmButton',
    x: 180,
    y: 24,
    width: 140,
    height: 40,
    interactiveProps: { text: 'Confirm' },
    events: {
      onClick: [{ id: 'confirm', kind: 'confirm', messageExpr: '"Proceed?"', consequent: [] }]
    }
  })
  graph.createNode('BUTTON', pageId, {
    name: 'OverlayButton',
    x: 336,
    y: 24,
    width: 140,
    height: 40,
    interactiveProps: { text: 'Overlay' },
    events: {
      onClick: [{ id: 'open', kind: 'setVariable', targetName: 'isOpen', valueExpr: '1 === 1' }]
    }
  })
  graph.createNode('SWITCH', pageId, {
    name: 'SwitchSmoke',
    x: 24,
    y: 96,
    width: 44,
    height: 24,
    interactiveProps: { checked: true }
  })
  graph.createNode('RADIO', pageId, {
    name: 'RadioSmoke',
    x: 24,
    y: 144,
    width: 160,
    height: 72,
    interactiveProps: { options: ['Yes', 'No'], value: 'Yes', groupName: 'answer' }
  })
  const form = graph.createNode('FORM', pageId, {
    name: 'ValidationForm',
    x: 220,
    y: 96,
    width: 240,
    height: 96
  })
  graph.createNode('INPUT', form.id, {
    name: 'EmailInput',
    width: 220,
    height: 40,
    bindings: { value: { kind: 'docState', docStateName: 'email' } },
    interactiveProps: {
      placeholder: 'Email',
      validation: { required: true, messages: { required: 'Email required' } }
    }
  })
  const overlay = graph.createNode('FRAME', pageId, {
    name: 'OverlaySmoke',
    width: 280,
    height: 120,
    interactiveProps: { overlay: { kind: 'modal', openRef: 'isOpen' } }
  })
  graph.createNode('TEXT', overlay.id, { text: 'Overlay body' })

  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'runtime-ui-smoke' })
  }).files
}

describe('preview browser runtime UI smoke (Phase 5 §5)', () => {
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 720, height: 520 }, deviceScaleFactor: 1 })
  })

  afterEach(async () => {
    if (page) await page.close()
    if (browser) await browser.close()
    if (server) await server.close()
    page = null
    browser = null
    server = null
  })

  test('renders theme switch, toast, and confirm token surfaces', async () => {
    const currentPage = await loadRuntimeUi(server, page)

    await currentPage.getByRole('button', { name: 'Dark' }).click()
    expect(await currentPage.locator('html').getAttribute('data-theme')).toBe('dark')

    await currentPage.getByRole('button', { name: 'Toast' }).click()
    const toast = currentPage.getByText('Saved via smoke').locator('..')
    await expectVisible(currentPage, 'Saved via smoke')
    expect(await computed(toast, 'background-color')).not.toBe('rgba(0, 0, 0, 0)')
    expect(await computed(toast, 'color')).not.toBe('rgb(255, 255, 255)')

    await currentPage.getByRole('button', { name: 'Confirm' }).click()
    await expectVisible(currentPage, 'Proceed?')
    const confirmOk = currentPage.getByRole('button', { name: 'OK' })
    expect(await computed(confirmOk, 'background-color')).not.toBe('rgba(0, 0, 0, 0)')
    await confirmOk.click()
  }, 30_000)

  test('renders validation invalid state and overlay backdrop tokens', async () => {
    const currentPage = await loadRuntimeUi(server, page)

    const email = currentPage.getByPlaceholder('Email')
    await email.focus()
    await email.evaluate((el) => {
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }))
    })
    await expectVisible(currentPage, 'Email required')
    expect(await computed(email, 'border-color')).not.toBe('rgb(229, 231, 235)')

    await currentPage.getByRole('button', { name: 'Overlay' }).click()
    await expectVisible(currentPage, 'Overlay body')
    const backdrop = currentPage.getByLabel('Close overlay')
    expect(await computed(backdrop, 'background-color')).not.toBe('rgba(0, 0, 0, 0)')
    await backdrop.click({ position: { x: 4, y: 4 } })
    await currentPage.getByText('Overlay body').waitFor({ state: 'hidden' })
  }, 30_000)

  test('renders switch and radio semantic control tokens', async () => {
    const currentPage = await loadRuntimeUi(server, page)

    await currentPage.getByRole('button', { name: 'Dark' }).click()
    const switchInput = currentPage.getByRole('switch')
    expect(await computed(switchInput, 'background-color')).not.toBe('rgb(209, 213, 219)')
    const radioInput = currentPage.locator('input[type="radio"]').first()
    expect(await computed(radioInput, 'accent-color')).toBe('rgb(204, 230, 255)')
  }, 30_000)
})

async function loadRuntimeUi(server: PreviewServer | null, page: Page | null): Promise<Page> {
  if (!server || !page) throw new Error('missing preview test runtime')
  server.updateFiles(buildRuntimeUiSmokeFiles())
  await page.goto(server.url, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Toast' }).waitFor()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Toast' }).waitFor()
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      })
  )
  return page
}

async function expectVisible(page: Page, text: string): Promise<void> {
  await page.getByText(text).waitFor({ state: 'visible' })
}

async function computed(locator: ReturnType<Page['locator']>, property: string): Promise<string> {
  return await locator.evaluate((el, prop) => {
    const style = getComputedStyle(el as HTMLElement)
    return (
      style.getPropertyValue(prop) || style[prop as keyof CSSStyleDeclaration]?.toString() || ''
    )
  }, property)
}
