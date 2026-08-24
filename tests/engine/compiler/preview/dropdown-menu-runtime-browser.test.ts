import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import {
  createDropdownMenuModuleFrameOverrides,
  createDropdownMenuModuleInstance,
  DROPDOWN_MENU_MODULE_DEFAULT_CONFIG,
  type DropdownMenuModuleConfig,
  type DropdownMenuPlacementV1
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

type DropdownOverrides = Partial<DropdownMenuModuleConfig>

const TEST_ITEMS: DropdownMenuModuleConfig['items'] = [
  {
    type: 'item',
    label: 'Dashboard',
    href: '#dashboard',
    disabled: false,
    danger: false,
    shortcut: '⌘D'
  },
  {
    type: 'item',
    label: 'Disabled danger',
    href: '#disabled',
    disabled: true,
    danger: true,
    shortcut: '⌘X'
  },
  { type: 'separator' },
  {
    type: 'item',
    label: 'Sign out',
    href: '',
    disabled: false,
    danger: true,
    shortcut: ''
  }
]

function buildDropdownFiles(
  overrides: DropdownOverrides = {},
  instanceCount = 1,
  authoredTrigger = false,
  focusSentinels = false
) {
  const graph = makeSceneGraph('Compiled Dropdown Menu runtime')
  const pageId = firstPageId(graph)
  if (focusSentinels) {
    graph.createNode('BUTTON', pageId, {
      width: 160,
      height: 44,
      x: 100,
      y: 220,
      interactiveProps: { text: 'Before dropdown' }
    })
  }
  for (let index = 0; index < instanceCount; index += 1) {
    const config: DropdownMenuModuleConfig = {
      ...DROPDOWN_MENU_MODULE_DEFAULT_CONFIG,
      items: TEST_ITEMS.map((item) => ({ ...item })),
      ...overrides,
      triggerLabel: `${overrides.triggerLabel ?? DROPDOWN_MENU_MODULE_DEFAULT_CONFIG.triggerLabel} ${index + 1}`
    }
    const frame = graph.createNode('FRAME', pageId, {
      ...createDropdownMenuModuleFrameOverrides(config),
      x: 320,
      y: 220 + index * 72,
      interactiveProps: { module: createDropdownMenuModuleInstance(config) }
    })
    if (authoredTrigger) {
      graph.createNode('BUTTON', frame.id, {
        width: 150,
        height: 40,
        x: 15,
        y: 4,
        interactiveProps: { text: `Authored trigger ${index + 1}` }
      })
    }
  }
  if (focusSentinels) {
    graph.createNode('BUTTON', pageId, {
      width: 160,
      height: 44,
      x: 560,
      y: 220,
      interactiveProps: { text: 'After dropdown' }
    })
  }
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'dropdown-runtime-browser', devMode: false })
  }).files
}

async function loadFixture(
  server: PreviewServer,
  page: Page,
  overrides: DropdownOverrides = {},
  instanceCount = 1,
  authoredTrigger = false,
  focusSentinels = false
): Promise<void> {
  server.updateFiles(buildDropdownFiles(overrides, instanceCount, authoredTrigger, focusSentinels))
  await page.goto(server.url, { waitUntil: 'networkidle' })
}

async function openDropdown(page: Page, index = 0) {
  const trigger = page.locator('[data-openpencil-dropdown-trigger]').nth(index)
  await trigger.click()
  const menu = page.locator('[data-openpencil-dropdown-menu]').last()
  await playwrightExpect(menu).toHaveAttribute('data-state', 'open')
  return { menu, trigger }
}

async function waitForMenuCount(page: Page, count: number): Promise<void> {
  await playwrightExpect(page.locator('[data-openpencil-dropdown-menu]')).toHaveCount(count)
}

describe('preview browser — compiled Dropdown Menu module', () => {
  const timeoutMs = 40_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildDropdownFiles() })
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
    'keeps label and chevron independent and isolates an authored interactive trigger',
    async () => {
      if (!server || !page) throw new Error('Missing Dropdown Menu preview runtime')
      for (const [showTriggerLabel, showTriggerChevron] of [
        [true, true],
        [true, false],
        [false, true]
      ] as const) {
        await loadFixture(server, page, { showTriggerLabel, showTriggerChevron })
        const trigger = page.getByRole('button', { name: 'Open menu 1' })
        await playwrightExpect(trigger).toBeVisible()
        const metrics = await trigger.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return {
            chevron: Boolean(element.querySelector('[data-openpencil-dropdown-trigger-chevron]')),
            height: rect.height,
            label: element.querySelector('[data-openpencil-dropdown-trigger-label]')?.textContent,
            width: rect.width
          }
        })
        expect(metrics).toEqual({
          chevron: showTriggerChevron,
          height: 48,
          label: showTriggerLabel ? 'Open menu 1' : undefined,
          width: 180
        })
      }

      await loadFixture(server, page, {}, 1, true)
      const host = page.locator('[data-openpencil-dropdown-trigger-host]')
      await playwrightExpect(host).toBeVisible()
      expect(await host.locator('button').count()).toBe(2)
      expect(await host.locator('[data-openpencil-dropdown-trigger] button').count()).toBe(0)
      await playwrightExpect(
        host.locator('[data-openpencil-dropdown-trigger-authored]')
      ).toHaveAttribute('inert', '')
      await host.locator('[data-openpencil-dropdown-trigger]').click()
      await playwrightExpect(page.getByRole('menu')).toBeVisible()
    },
    timeoutMs
  )

  test(
    'implements menu roles, roving keyboard focus, disabled precedence, shortcuts, and close flags',
    async () => {
      if (!server || !page) throw new Error('Missing Dropdown Menu preview runtime')
      await loadFixture(server, page)
      const { menu, trigger } = await openDropdown(page)
      await playwrightExpect(menu).toHaveAttribute('role', 'menu')
      await playwrightExpect(menu.locator('[role="menuitem"]')).toHaveCount(3)
      await playwrightExpect(menu.locator('[role="separator"]')).toHaveCount(1)
      await playwrightExpect(page.getByRole('menuitem', { name: /Dashboard/ })).toBeFocused()
      expect(await menu.evaluate((element) => element.parentElement === document.body)).toBe(true)

      const triggerFocus = await trigger.evaluate(
        (element) => getComputedStyle(element).outlineStyle
      )
      expect(triggerFocus).toBe('none')
      const firstItem = page.getByRole('menuitem', { name: /Dashboard/ })
      await page.waitForTimeout(180)
      expect(await firstItem.evaluate((element) => element.getBoundingClientRect().height)).toBe(44)
      await firstItem.press('ArrowDown')
      const dangerItem = page.getByRole('menuitem', { name: 'Sign out' })
      await playwrightExpect(dangerItem).toBeFocused()
      expect(await dangerItem.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe(
        '2px'
      )
      await page.keyboard.press('ArrowUp')
      await playwrightExpect(firstItem).toBeFocused()
      await page.keyboard.press('End')
      await playwrightExpect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused()
      await page.keyboard.press('Home')
      await playwrightExpect(firstItem).toBeFocused()
      await playwrightExpect(
        menu.locator('[data-openpencil-dropdown-shortcut]').first()
      ).toHaveText('⌘D')

      const disabled = page.getByRole('menuitem', { name: /Disabled danger/ })
      const colors = await Promise.all([
        disabled.evaluate((element) => getComputedStyle(element).color),
        page
          .getByRole('menuitem', { name: 'Sign out' })
          .evaluate((element) => getComputedStyle(element).color)
      ])
      expect(colors[0]).not.toBe(colors[1])
      await disabled.click({ force: true })
      await playwrightExpect(menu).toHaveAttribute('data-state', 'open')

      await page.keyboard.press('End')
      await page.keyboard.press('Space')
      await waitForMenuCount(page, 0)
      await playwrightExpect(trigger).toBeFocused()

      await trigger.press('ArrowDown')
      await playwrightExpect(page.getByRole('menuitem', { name: /Dashboard/ })).toBeFocused()
      await page.keyboard.press('Escape')
      await waitForMenuCount(page, 0)

      await loadFixture(server, page, {
        closeOnEscape: false,
        closeOnOutsidePress: false,
        closeOnSelect: false
      })
      const guarded = await openDropdown(page)
      await page.keyboard.press('Escape')
      await playwrightExpect(guarded.menu).toHaveAttribute('data-state', 'open')
      await page.mouse.click(4, 4)
      await playwrightExpect(guarded.menu).toHaveAttribute('data-state', 'open')
      await page.getByRole('menuitem', { name: 'Sign out' }).click()
      await playwrightExpect(guarded.menu).toHaveAttribute('data-state', 'open')
      await page.keyboard.press('Tab')
      await waitForMenuCount(page, 0)
    },
    timeoutMs
  )

  test(
    'moves Tab focus around the trigger after the portal unmounts',
    async () => {
      if (!server || !page) throw new Error('Missing Dropdown Menu preview runtime')
      await loadFixture(server, page, {}, 1, false, true)
      const trigger = page.locator('[data-openpencil-dropdown-trigger]')
      const before = page.getByRole('button', { name: 'Before dropdown' })
      const after = page.getByRole('button', { name: 'After dropdown' })

      await trigger.evaluate((element) => {
        const blocker = (label: string) => {
          const button = document.createElement('button')
          button.textContent = label
          return button
        }
        const disabledBefore = blocker('Disabled before')
        disabledBefore.disabled = true
        const hiddenBefore = blocker('Hidden before')
        hiddenBefore.hidden = true
        const inertBefore = document.createElement('div')
        inertBefore.setAttribute('inert', '')
        inertBefore.append(blocker('Inert before'))
        const disabledAfter = blocker('Disabled after')
        disabledAfter.disabled = true
        const hiddenAfter = blocker('Hidden after')
        hiddenAfter.hidden = true
        const inertAfter = document.createElement('div')
        inertAfter.setAttribute('inert', '')
        inertAfter.append(blocker('Inert after'))
        element.before(disabledBefore, hiddenBefore, inertBefore)
        element.after(disabledAfter, hiddenAfter, inertAfter)
      })

      await trigger.focus()
      await trigger.press('ArrowDown')
      const firstItem = page.getByRole('menuitem', { name: /Dashboard/ })
      await playwrightExpect(firstItem).toBeFocused()
      await firstItem.press('Tab')
      await waitForMenuCount(page, 0)
      await playwrightExpect(after).toBeFocused()

      await trigger.focus()
      await trigger.press('ArrowDown')
      await playwrightExpect(firstItem).toBeFocused()
      await firstItem.press('Shift+Tab')
      await waitForMenuCount(page, 0)
      await playwrightExpect(before).toBeFocused()

      await trigger.focus()
      await trigger.press('ArrowDown')
      await page.keyboard.press('Escape')
      await waitForMenuCount(page, 0)
      await playwrightExpect(trigger).toBeFocused()
    },
    timeoutMs
  )

  test(
    'supports all placements, viewport clamping, reduced motion, and top-only stack closing',
    async () => {
      if (!server || !page) throw new Error('Missing Dropdown Menu preview runtime')
      const placements: DropdownMenuPlacementV1[] = [
        'bottomLeft',
        'bottom',
        'bottomRight',
        'topLeft',
        'top',
        'topRight',
        'leftTop',
        'left',
        'leftBottom',
        'rightTop',
        'right',
        'rightBottom'
      ]
      for (const placement of placements) {
        await loadFixture(server, page, { placement })
        const { menu, trigger } = await openDropdown(page)
        const geometry = await Promise.all([
          menu.boundingBox(),
          trigger.boundingBox(),
          menu.getAttribute('data-placement')
        ])
        const menuBox = geometry[0]
        const triggerBox = geometry[1]
        expect(geometry[2]).toBe(placement)
        if (!menuBox || !triggerBox) throw new Error('Missing placement geometry')
        if (placement.startsWith('bottom')) expect(menuBox.y).toBeGreaterThan(triggerBox.y)
        if (placement.startsWith('top')) expect(menuBox.y).toBeLessThan(triggerBox.y)
        if (placement.startsWith('left')) expect(menuBox.x).toBeLessThan(triggerBox.x)
        if (placement.startsWith('right')) expect(menuBox.x).toBeGreaterThan(triggerBox.x)
        await page.keyboard.press('Escape')
        await waitForMenuCount(page, 0)
      }

      await page.setViewportSize({ width: 375, height: 600 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await loadFixture(server, page, { menuWidth: 480, placement: 'rightBottom' })
      const narrow = await openDropdown(page)
      const responsive = await narrow.menu.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          transitionDuration: getComputedStyle(element).transitionDuration,
          width: rect.width
        }
      })
      expect(responsive.left).toBeGreaterThanOrEqual(8)
      expect(responsive.right).toBeLessThanOrEqual(367)
      expect(responsive.top).toBeGreaterThanOrEqual(8)
      expect(responsive.bottom).toBeLessThanOrEqual(592)
      expect(responsive.width).toBeLessThanOrEqual(359)
      expect(responsive.transitionDuration).toBe('0s')
      await page.keyboard.press('Escape')
      await waitForMenuCount(page, 0)

      await page.setViewportSize({ width: 900, height: 700 })
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await loadFixture(server, page, { closeOnOutsidePress: false }, 2)
      await openDropdown(page, 0)
      await page
        .locator('[data-openpencil-dropdown-trigger]')
        .nth(1)
        .evaluate((element) => (element as HTMLButtonElement).click())
      await waitForMenuCount(page, 2)
      const stackedMenus = page.locator('[data-openpencil-dropdown-menu]')
      await playwrightExpect(stackedMenus.last()).toHaveAttribute('data-state', 'open')
      await page.keyboard.press('Escape')
      await waitForMenuCount(page, 1)
      await page.keyboard.press('Escape')
      await waitForMenuCount(page, 0)
    },
    timeoutMs
  )

  test(
    'hover mode preserves focus and still supports click, touch-style, and keyboard activation',
    async () => {
      if (!server || !page) throw new Error('Missing Dropdown Menu preview runtime')
      await loadFixture(server, page, { triggerMode: 'hover' }, 1, false, true)
      const trigger = page.locator('[data-openpencil-dropdown-trigger]')
      const before = page.getByRole('button', { name: 'Before dropdown' })
      await before.focus()
      await trigger.hover()
      await playwrightExpect(page.getByRole('menu')).toHaveAttribute('data-state', 'open')
      await playwrightExpect(before).toBeFocused()
      await page.mouse.move(4, 4)
      await waitForMenuCount(page, 0)
      await playwrightExpect(before).toBeFocused()

      await trigger.evaluate((element) => (element as HTMLButtonElement).click())
      await playwrightExpect(page.getByRole('menu')).toHaveAttribute('data-state', 'open')
      await playwrightExpect(page.getByRole('menuitem', { name: /Dashboard/ })).toBeFocused()
      await trigger.evaluate((element) => (element as HTMLButtonElement).click())
      await waitForMenuCount(page, 0)

      await trigger.focus()
      await trigger.press('ArrowDown')
      const keyboardMenu = page.getByRole('menu')
      const keyboardItem = page.getByRole('menuitem', { name: /Dashboard/ })
      await playwrightExpect(keyboardItem).toBeFocused()
      await keyboardMenu.hover()
      await page.mouse.move(4, 4)
      await page.waitForTimeout(320)
      await playwrightExpect(keyboardMenu).toHaveAttribute('data-state', 'open')
      await playwrightExpect(keyboardItem).toBeFocused()
      await page.keyboard.press('Escape')
      await waitForMenuCount(page, 0)
      await playwrightExpect(trigger).toBeFocused()
    },
    timeoutMs
  )
})
