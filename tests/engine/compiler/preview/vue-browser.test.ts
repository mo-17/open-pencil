import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { vueAdapter } from '#compiler/adapters/vue'
import type { ComponentDef, IRElement, IRTree } from '#compiler/ir/types'
import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { build as viteBuild, preview, type PreviewServer } from 'vite'

import { withDefaults } from '@open-pencil/compiler'
import {
  DROPDOWN_MENU_MODULE_DEFAULT_CONFIG,
  MODAL_MODULE_DEFAULT_CONFIG,
  SLIDE_MENU_MODULE_DEFAULT_CONFIG,
  UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'

const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
)

function element(overrides: Partial<IRElement> = {}): IRElement {
  return {
    kind: 'element',
    sourceId: 'element',
    tag: 'div',
    className: '',
    attrs: {},
    children: [],
    ...overrides
  }
}

function page(overrides: Partial<IRTree> = {}): IRTree {
  return {
    pageId: 'home',
    pageName: 'Home',
    usesRouteParams: false,
    children: [],
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    warnings: [],
    ...overrides
  }
}

function moduleElement(
  sourceId: string,
  pluginId: string,
  moduleType: string,
  configVersion: number,
  payload: Record<string, unknown>,
  children: IRElement['children'] = []
): IRElement {
  return element({
    sourceId,
    className: 'h-[48px] w-[180px]',
    children,
    module: { pluginId, moduleType, configVersion, payload }
  })
}

function buildVueBrowserFiles(): Map<string, string | Uint8Array> {
  const component: ComponentDef = {
    componentId: 'browser-card',
    name: 'BrowserCard',
    children: [],
    props: [],
    variantAxes: [
      { name: 'tone', rawName: 'Tone', options: ['Default', 'Danger'], defaultValue: 'Default' }
    ],
    variants: [
      { key: 'Default', children: [{ kind: 'text', value: 'Fallback variant' }] },
      { key: 'Danger', children: [{ kind: 'text', value: 'Danger variant' }] }
    ]
  }
  const home = page({
    states: [
      { id: 'count', name: 'count', type: 'number', defaultValue: 0 },
      { id: 'choice', name: 'choice', type: 'string', defaultValue: 'a' },
      { id: 'selected', name: 'selected', type: 'array', defaultValue: ['x'] }
    ],
    docStates: [
      {
        id: 'target',
        name: 'linkTarget',
        type: 'string',
        defaultValue: ['java', 'script:globalThis.__VUE_LINK_PWN=1'].join('')
      }
    ],
    docStateReads: ['linkTarget'],
    assets: [{ path: 'src/assets/browser.png', bytes: PNG_BYTES }],
    children: [
      {
        kind: 'text',
        value: '{{ ({}).constructor.constructor("globalThis.__VUE_TEXT_PWN=1")() }}'
      },
      element({
        sourceId: 'count-value',
        children: [
          { kind: 'expression', ast: { kind: 'ident', name: 'count' }, references: ['count'] }
        ]
      }),
      element({
        sourceId: 'increment',
        tag: 'button',
        children: [{ kind: 'text', value: 'Increment' }],
        events: {
          onClick: [
            {
              kind: 'setState',
              stateName: 'count',
              ast: {
                kind: 'binary',
                op: '+',
                left: { kind: 'ident', name: 'count' },
                right: { kind: 'number', value: 1 }
              },
              references: ['count'],
              mode: 'absolute'
            }
          ]
        }
      }),
      element({
        sourceId: 'choice-value',
        children: [
          { kind: 'expression', ast: { kind: 'ident', name: 'choice' }, references: ['choice'] }
        ]
      }),
      element({
        sourceId: 'radio-a',
        tag: 'input',
        attrs: { type: 'radio', value: 'a', name: 'choice' },
        controlled: {
          read: 'choice',
          write: { kind: 'state', name: 'choice', targetType: 'string' }
        }
      }),
      element({
        sourceId: 'radio-b',
        tag: 'input',
        attrs: { type: 'radio', value: 'b', name: 'choice' },
        controlled: {
          read: 'choice',
          write: { kind: 'state', name: 'choice', targetType: 'string' }
        }
      }),
      element({
        sourceId: 'selected-value',
        children: [
          {
            kind: 'expression',
            ast: { kind: 'ident', name: 'selected' },
            references: ['selected']
          }
        ]
      }),
      element({
        sourceId: 'checkbox-x',
        tag: 'input',
        attrs: { type: 'checkbox', value: 'x' },
        controlled: {
          read: 'selected',
          write: { kind: 'state', name: 'selected', targetType: 'array' }
        }
      }),
      element({
        sourceId: 'checkbox-y',
        tag: 'input',
        attrs: { type: 'checkbox', value: 'y' },
        controlled: {
          read: 'selected',
          write: { kind: 'state', name: 'selected', targetType: 'array' }
        }
      }),
      element({
        sourceId: 'unsupported-form',
        tag: 'form',
        attrs: { action: '/native-submit-must-not-run' },
        events: {
          onSubmit: [
            {
              kind: 'supabaseMutation',
              operation: 'insert',
              table: 'contacts',
              filters: []
            }
          ]
        },
        children: [
          element({
            sourceId: 'unsupported-submit',
            tag: 'button',
            attrs: { type: 'submit' },
            children: [{ kind: 'text', value: 'Unsupported submit' }]
          })
        ]
      }),
      element({
        sourceId: 'asset-image',
        tag: 'img',
        image: { srcLiteral: './assets/browser.png', alt: 'Bundled browser asset' }
      }),
      element({
        sourceId: 'fill-image',
        className: 'w-[20px] h-[20px] bg-[url(./assets/browser.png)] bg-contain'
      }),
      element({
        sourceId: 'dynamic-link',
        link: { hrefExpr: { kind: 'ident', name: 'linkTarget' }, target: '_self' },
        children: [{ kind: 'text', value: 'Unsafe dynamic link' }]
      }),
      moduleElement(
        'vue-modal',
        'open-pencil.modal',
        'modal',
        1,
        {
          ...MODAL_MODULE_DEFAULT_CONFIG,
          title: 'Vue modal title',
          content: 'Focus stays inside this dialog.'
        },
        [
          element({
            sourceId: 'vue-modal-authored-button',
            tag: 'button',
            children: [{ kind: 'text', value: 'Authored modal trigger' }]
          })
        ]
      ),
      moduleElement(
        'vue-dropdown',
        'open-pencil.dropdown-menu',
        'dropdown-menu',
        1,
        {
          ...DROPDOWN_MENU_MODULE_DEFAULT_CONFIG,
          triggerLabel: 'Vue dropdown',
          items: [
            {
              type: 'item',
              label: 'First action',
              href: '',
              disabled: false,
              danger: false,
              shortcut: ''
            },
            {
              type: 'item',
              label: 'Disabled action',
              href: '',
              disabled: true,
              danger: false,
              shortcut: ''
            },
            {
              type: 'item',
              label: 'Last action',
              href: '',
              disabled: false,
              danger: true,
              shortcut: ''
            }
          ]
        },
        [
          element({
            sourceId: 'vue-dropdown-authored-button',
            tag: 'button',
            children: [{ kind: 'text', value: 'Vue dropdown' }]
          })
        ]
      ),
      moduleElement(
        'vue-slide',
        'open-pencil.slide-menu',
        'slide-menu',
        2,
        {
          ...SLIDE_MENU_MODULE_DEFAULT_CONFIG,
          title: 'Vue slide menu',
          description: 'A focus-managed local panel.',
          items: [{ label: 'No navigation', href: '' }]
        },
        [
          element({
            sourceId: 'vue-slide-authored-icon',
            tag: 'img',
            className: 'h-[18px] w-[18px]',
            image: { srcLiteral: './assets/browser.png', alt: '' }
          })
        ]
      ),
      moduleElement(
        'vue-upload',
        'open-pencil.upload-button',
        'upload-button',
        1,
        {
          ...UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
          triggerLabel: 'Choose PNG files',
          accept: ['.png'],
          multiple: true,
          maxFiles: 2,
          maxFileBytes: 5,
          helperText: 'Validated locally only.'
        },
        [
          element({
            sourceId: 'vue-upload-authored-button',
            tag: 'button',
            children: [{ kind: 'text', value: 'Authored upload trigger' }]
          })
        ]
      ),
      {
        kind: 'componentRef',
        sourceId: 'variant',
        name: 'BrowserCard',
        className: '',
        props: [{ name: 'tone', kind: 'variant', value: 'Unknown' }]
      },
      element({
        sourceId: 'navigate',
        tag: 'button',
        children: [{ kind: 'text', value: 'Next page' }],
        events: { onClick: [{ kind: 'navigate', to: '/second', params: [] }] }
      })
    ]
  })
  const second = page({
    pageId: 'second',
    pageName: 'Second',
    routePattern: '/second',
    children: [{ kind: 'text', value: 'Second page' }]
  })
  return vueAdapter.emit(
    [home, second],
    withDefaults({
      packageName: 'vue-browser-smoke',
      target: 'vue',
      router: 'vue-router-v4',
      devMode: true
    }),
    [component]
  ).files
}

function writeProject(directory: string, files: ReadonlyMap<string, string | Uint8Array>): void {
  for (const [path, value] of files) {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, value)
  }
  symlinkSync(join(process.cwd(), 'node_modules'), join(directory, 'node_modules'))
  if (!existsSync(join(directory, 'src/main.ts')))
    throw new Error('Vue project is missing src/main.ts')
  if (!existsSync(join(directory, 'node_modules/vue/package.json'))) {
    throw new Error('Vue project cannot resolve its Vue dependency')
  }
}

describe('Vue compiler preview browser', () => {
  const hookTimeoutMs = 30_000
  let directory: string | null = null
  let server: PreviewServer | null = null
  let serverUrl: string | null = null
  let browser: Browser | null = null
  let pageHandle: Page | null = null

  beforeEach(async () => {
    directory = mkdtempSync('/private/tmp/openpencil-vue-browser-')
    writeProject(directory, buildVueBrowserFiles())
    await viteBuild({
      configFile: false,
      root: directory,
      plugins: [vue(), tailwindcss()],
      build: { assetsInlineLimit: 0 },
      logLevel: 'error'
    })
    server = await preview({
      configFile: false,
      root: directory,
      preview: { host: '127.0.0.1', port: 0 },
      logLevel: 'error'
    })
    serverUrl = server.resolvedUrls?.local[0] ?? null
    if (!serverUrl) throw new Error('Vue Vite server did not expose a local URL')
    browser = await chromium.launch()
    pageHandle = await browser.newPage({ viewport: { width: 640, height: 480 } })
  }, hookTimeoutMs)

  afterEach(async () => {
    try {
      if (pageHandle) await pageHandle.close()
    } finally {
      try {
        if (browser) await browser.close()
      } finally {
        if (server) await server.close()
        if (directory) rmSync(directory, { recursive: true, force: true })
        directory = null
        serverUrl = null
        pageHandle = null
        browser = null
        server = null
      }
    }
  }, hookTimeoutMs)

  test('runs state, assets, router, variant fallback, and injection guards', async () => {
    if (!serverUrl || !pageHandle) throw new Error('missing Vue preview test runtime')
    const failedResponses: string[] = []
    pageHandle.on('response', (response) => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`)
    })
    await pageHandle.goto(serverUrl, { waitUntil: 'networkidle' })

    expect(
      await pageHandle.evaluate(() => Reflect.get(globalThis, '__VUE_TEXT_PWN'))
    ).toBeUndefined()
    await playwrightExpect(pageHandle.getByText('Fallback variant')).toBeVisible()
    expect(
      await pageHandle.locator('[data-node-id="dynamic-link"]').getAttribute('href')
    ).toBeNull()
    await pageHandle.locator('[data-node-id="dynamic-link"]').click()
    expect(
      await pageHandle.evaluate(() => Reflect.get(globalThis, '__VUE_LINK_PWN'))
    ).toBeUndefined()

    const modalHost = pageHandle.locator('[data-node-id="vue-modal"]')
    const modalTrigger = modalHost.locator('button').last()
    const dropdownHost = pageHandle.locator('[data-node-id="vue-dropdown"]')
    const dropdownTrigger = dropdownHost.locator(':scope > button')
    const slideHost = pageHandle.locator('[data-node-id="vue-slide"]')
    const slideTrigger = slideHost.locator(':scope > button')
    const uploadHost = pageHandle.locator('[data-node-id="vue-upload"]')
    const uploadTrigger = uploadHost.locator(':scope > button')
    await playwrightExpect(modalTrigger).toHaveAccessibleName(/Authored modal trigger/)
    await playwrightExpect(dropdownTrigger).toHaveAccessibleName(/Vue dropdown/)
    await playwrightExpect(slideTrigger).toHaveAccessibleName(
      SLIDE_MENU_MODULE_DEFAULT_CONFIG.triggerLabel
    )
    await playwrightExpect(uploadTrigger).toHaveAccessibleName(/Authored upload trigger/)
    const triggerIds = await Promise.all(
      [modalTrigger, dropdownTrigger, slideTrigger, uploadTrigger].map(async (trigger) => {
        const labelledBy = await trigger.getAttribute('aria-labelledby')
        if (!labelledBy) throw new Error('authored module trigger is missing aria-labelledby')
        const ids = labelledBy.split(/\s+/)
        expect(ids).toHaveLength(2)
        for (const id of ids) {
          await playwrightExpect(pageHandle.locator(`[id="${id}"]`)).toHaveCount(1)
        }
        return ids
      })
    )
    expect(new Set(triggerIds.flat()).size).toBe(8)
    for (const host of [modalHost, dropdownHost, slideHost, uploadHost]) {
      const authored = host.locator(
        '[data-openpencil-modal-authored-trigger=""], [data-openpencil-dropdown-authored-trigger=""], [data-openpencil-slide-menu-authored-trigger=""], [data-openpencil-upload-authored-trigger=""]'
      )
      await playwrightExpect(authored).toHaveAttribute('aria-hidden', 'true')
      await playwrightExpect(authored).toHaveAttribute('inert', '')
      await playwrightExpect(authored.getByRole('button')).toHaveCount(0)
      await playwrightExpect(host.locator(':scope > button button')).toHaveCount(0)
    }
    await modalTrigger.click()
    const dialog = pageHandle.locator('[data-openpencil-modal-panel]')
    await playwrightExpect(dialog).toBeVisible()
    await playwrightExpect(dialog).toContainText('Vue modal title')
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
    await pageHandle.keyboard.press('Escape')
    await playwrightExpect(dialog).toBeHidden()
    await playwrightExpect(modalTrigger).toBeFocused()

    await dropdownTrigger.click()
    const menu = pageHandle.locator('[data-openpencil-dropdown-menu]')
    await playwrightExpect(menu).toBeVisible()
    await playwrightExpect(menu.getByRole('menuitem', { name: 'First action' })).toBeFocused()
    await pageHandle.keyboard.press('ArrowDown')
    await playwrightExpect(menu.getByRole('menuitem', { name: 'Last action' })).toBeFocused()
    await pageHandle.keyboard.press('Escape')
    await playwrightExpect(menu).toBeHidden()
    await playwrightExpect(dropdownTrigger).toBeFocused()
    await dropdownTrigger.click()
    await playwrightExpect(menu).toBeVisible()
    await pageHandle.locator('[data-node-id="count-value"]').click()
    await playwrightExpect(menu).toBeHidden()

    await slideTrigger.click()
    const slidePanel = pageHandle.locator('[data-openpencil-slide-menu-panel]')
    await playwrightExpect(slidePanel).toBeVisible()
    expect(await slidePanel.evaluate((node) => node.contains(document.activeElement))).toBe(true)
    await pageHandle.keyboard.press('Escape')
    await playwrightExpect(slidePanel).toBeHidden()
    await playwrightExpect(slideTrigger).toBeFocused()

    await uploadHost.locator('input[type="file"]').setInputFiles([
      { name: 'valid.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) },
      { name: 'large.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3, 4, 5, 6]) },
      { name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from([1]) }
    ])
    await playwrightExpect(uploadHost.getByRole('status')).toContainText('1 local file selected')
    await playwrightExpect(uploadHost.getByRole('status')).toContainText('not been uploaded')
    await playwrightExpect(uploadHost.getByRole('alert')).toContainText('larger than')
    await playwrightExpect(uploadHost.getByRole('alert')).toContainText('accepted file types')
    await uploadHost.getByRole('button', { name: 'Remove valid.png' }).click()
    await playwrightExpect(uploadHost.getByRole('status')).toBeHidden()

    await pageHandle.locator('[data-node-id="increment"]').click()
    await playwrightExpect(pageHandle.locator('[data-node-id="count-value"]')).toHaveText('1')

    await playwrightExpect(pageHandle.locator('[data-node-id="radio-a"]')).toBeChecked()
    await pageHandle.locator('[data-node-id="radio-b"]').check()
    await playwrightExpect(pageHandle.locator('[data-node-id="choice-value"]')).toHaveText('b')
    await playwrightExpect(pageHandle.locator('[data-node-id="radio-b"]')).toBeChecked()

    await playwrightExpect(pageHandle.locator('[data-node-id="checkbox-x"]')).toBeChecked()
    await pageHandle.locator('[data-node-id="checkbox-y"]').check()
    await playwrightExpect(pageHandle.locator('[data-node-id="selected-value"]')).toContainText('x')
    await playwrightExpect(pageHandle.locator('[data-node-id="selected-value"]')).toContainText('y')
    await pageHandle.locator('[data-node-id="checkbox-x"]').uncheck()
    await playwrightExpect(pageHandle.locator('[data-node-id="selected-value"]')).not.toContainText(
      'x'
    )

    const urlBeforeSubmit = pageHandle.url()
    await pageHandle.locator('[data-node-id="unsupported-submit"]').click()
    await pageHandle.waitForTimeout(50)
    expect(pageHandle.url()).toBe(urlBeforeSubmit)
    expect(
      await pageHandle.locator('[data-node-id="asset-image"]').evaluate((node) => {
        return (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0
      })
    ).toBe(true)
    expect(
      await pageHandle.locator('[data-node-id="fill-image"]').evaluate((node) => {
        return getComputedStyle(node).backgroundImage
      })
    ).toMatch(/browser-[a-zA-Z0-9_-]+\.png/)

    await pageHandle.locator('[data-node-id="navigate"]').click()
    await playwrightExpect(pageHandle.getByText('Second page')).toBeVisible()
    expect(new URL(pageHandle.url()).pathname).toBe('/second')
    expect(failedResponses).toEqual([])
  }, 30_000)
})
