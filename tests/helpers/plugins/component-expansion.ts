import { expect, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

export type ExpansionModule =
  | 'cascader'
  | 'walktour'
  | 'org-chart'
  | 'pagination'
  | 'descriptions'
  | 'slider'
  | 'rating'
  | 'stepper'
  | 'breadcrumb'
  | 'alert'
  | 'progress'
  | 'chip'
  | 'avatar'
  | 'badge'
  | 'timeline'
  | 'tooltip'
  | 'popover'
  | 'tree'
  | 'date-range'
  | 'skeleton'
  | 'empty-state'
export type ExpansionRenderer = 'retained' | 'tiled'

const NAMES: Record<ExpansionModule, string> = {
  cascader: 'Cascader',
  'org-chart': 'Organization chart',
  walktour: 'Guided Tour',
  pagination: 'Pagination',
  descriptions: 'Descriptions',
  alert: 'Alert',
  progress: 'Progress',
  chip: 'Chip',
  avatar: 'Avatar',
  badge: 'Badge',
  timeline: 'Timeline',
  tooltip: 'Tooltip',
  popover: 'Popover',
  tree: 'Tree',
  'date-range': 'Date range',
  skeleton: 'Skeleton',
  'empty-state': 'Empty State',
  slider: 'Slider',
  rating: 'Rating',
  stepper: 'Stepper',
  breadcrumb: 'Breadcrumb'
}

export async function prepareExpansionModules(
  page: Page,
  renderer: ExpansionRenderer,
  modules: readonly ExpansionModule[]
) {
  await page.goto(`/?test&no-rulers&renderer=${renderer}`)
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  for (const module of modules) {
    await page.getByTestId('settings-plugins-view').getByText('Browse', { exact: true }).click()
    const plugin = 'open-pencil.' + module
    await page.getByTestId('plugin-discover-search').fill(NAMES[module])
    await page.getByTestId(`plugin-install-${plugin}`).click()
    await expect(page.getByTestId(`plugin-installed-${plugin}`)).toBeVisible()
    await page.getByTestId(`plugin-enabled-${plugin}`).click()
    await expect(page.getByTestId(`plugin-enabled-${plugin}`)).toBeChecked()
  }
  await page.getByTestId('app-settings-done').click()
  return canvas
}

export async function insertExpansionModule(page: Page, module: ExpansionModule) {
  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId(`toolbar-plugin-module-open-pencil.${module}-${module}`).click()
  await expect(page.getByTestId('module-props-panel')).toContainText(NAMES[module])
}

export function expansionField(page: Page, field: string) {
  return page
    .getByTestId('module-property-field')
    .and(page.locator(`[data-module-path="${field}"]`))
}

export async function setExpansionNumber(page: Page, field: string, value: string) {
  const input = expansionField(page, field).getByRole('spinbutton')
  await input.click()
  await input.fill(value)
  await input.press('Enter')
}

/** Observe document persistence while all edits themselves go through the visible controls. */
export async function selectedExpansionConfig(page: Page) {
  return page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const module = editor.graph.getNode([...editor.state.selectedIds][0])?.interactiveProps?.module
    if (!module) throw new Error('Selected module unavailable')
    return module.config
  })
}

/** Do not capture a stale backing or mistake a blue selection outline for painted content. */
export async function waitForExpansionPaint(
  canvas: CanvasHelper,
  textColor?: readonly number[]
): Promise<void> {
  await canvas.page.waitForFunction(
    () => {
      const editor = window.openPencil.getStore()
      const renderers = editor.canvasRenderers.filter(
        (renderer) =>
          renderer.tracksSceneSettlement && renderer.pageId === editor.state.currentPageId
      )
      // Content isolation intentionally bypasses retained pictures/backings as a volatile scene.
      // Still require its live renderer to finish work; the pixel poll below proves glyphs painted.
      if (editor.state.contentEdit)
        return (
          renderers.length > 0 &&
          renderers.every(
            (renderer) =>
              !renderer.sceneBackingBuild &&
              !renderer.sceneBackingNeedsCrispRender &&
              !renderer.tiledScenePending
          )
        )
      return (
        renderers.length > 0 &&
        renderers.every(
          (renderer) =>
            renderer.sceneBacking?.sceneVersion === editor.state.sceneVersion &&
            renderer.sceneBacking.fontGeneration === renderer.fontGeneration &&
            renderer.sceneBacking.positionPreviewVersion === editor.graph.positionPreviewVersion &&
            !renderer.sceneBackingBuild &&
            !renderer.sceneBackingNeedsCrispRender &&
            (!renderer.tiledSceneEnabled ||
              (renderer.tiledSceneCovered && !renderer.tiledScenePending))
        )
      )
    },
    undefined,
    { timeout: 15000 }
  )
  await expect
    .poll(
      async () => {
        const screenshot = await canvas.screenshotCanvas()
        return canvas.page.evaluate(
          async ({ bytes, textColor }) => {
            const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
            const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
            const context = surface.getContext('2d')
            if (!context) throw new Error('Pixel reader unavailable')
            context.drawImage(bitmap, 0, 0)
            bitmap.close()
            const { data } = context.getImageData(0, 0, surface.width, surface.height)
            let pixels = 0
            for (let i = 0; i < data.length; i += 4) {
              const controlText =
                Math.abs(data[i] - 17) <= 2 &&
                Math.abs(data[i + 1] - 24) <= 2 &&
                Math.abs(data[i + 2] - 39) <= 2
              const navigationText =
                Math.abs(data[i] - 23) <= 2 &&
                Math.abs(data[i + 1] - 43) <= 2 &&
                Math.abs(data[i + 2] - 77) <= 2
              const feedbackText = textColor?.every(
                (channel, offset) => Math.abs(data[i + offset] - channel) <= 2
              )
              if (controlText || navigationText || feedbackText) pixels++
            }
            return pixels
          },
          { bytes: Array.from(screenshot), textColor }
        )
      },
      {
        timeout: 15000,
        message: 'The inserted module must paint actual label glyphs in its text color'
      }
    )
    .toBeGreaterThan(40)
}

export async function selectOtherExpansionNode(page: Page, moduleType: ExpansionModule) {
  return page.evaluate((module) => {
    const editor = window.openPencil.getStore()
    const current = [...editor.state.selectedIds][0]
    const other = editor.graph
      .getChildren(editor.state.currentPageId)
      .find((node) => node.id !== current && node.interactiveProps?.module?.moduleType === module)
    if (!other) throw new Error('Second module unavailable')
    const saved = JSON.stringify(other.interactiveProps?.module?.config)
    editor.select([other.id])
    return saved
  }, moduleType)
}

// Limit visual assertions to the authored node, excluding unrelated floating editor UI.
// A small missing trigger or changed icon must not fit the suite-wide canvas tolerance.
export async function selectedModuleClip(page: Page) {
  const surface = await page.getByTestId('canvas-element').boundingBox()
  if (!surface) throw new Error('Canvas surface unavailable')
  const bounds = await page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const nodeId = editor.state.contentEdit?.rootId ?? [...editor.state.selectedIds][0]
    const node = editor.graph.getNode(nodeId)
    if (!node) throw new Error('Selected module or content root unavailable')
    const origin = editor.graph.getAbsolutePosition(node.id)
    const { zoom, panX, panY } = editor.state
    return {
      x: origin.x * zoom + panX,
      y: origin.y * zoom + panY,
      width: node.width * zoom,
      height: node.height * zoom
    }
  })
  const x = Math.max(surface.x, surface.x + bounds.x - 32)
  const y = Math.max(surface.y, surface.y + bounds.y - 32)
  return {
    x,
    y,
    width: Math.min(surface.x + surface.width, surface.x + bounds.x + bounds.width + 32) - x,
    height: Math.min(surface.y + surface.height, surface.y + bounds.y + bounds.height + 32) - y
  }
}
