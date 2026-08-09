import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { buildOpenPencilCarouselComponent } from '#compiler/adapters/react/modules/carousel'
import { buildOpenPencilDataGridComponent } from '#compiler/adapters/react/modules/data-grid'
import { buildOpenPencilLottieComponent } from '#compiler/adapters/react/modules/lottie'
import { chromium, type Browser, type Page } from '@playwright/test'

import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'

const DATA_GRID_CONFIG = {
  data: {
    columns: [
      {
        id: 'name',
        label: 'Name',
        type: 'text',
        align: 'start',
        width: 180,
        sortable: true,
        filterable: true
      },
      {
        id: 'score',
        label: 'Score',
        type: 'number',
        align: 'end',
        width: 100,
        sortable: true,
        filterable: false
      }
    ],
    rows: [
      { id: 'alpha', cells: ['Alpha', 42] },
      { id: 'beta', cells: ['Beta', 37] }
    ]
  },
  initialSort: null,
  filters: [],
  pageSize: 10,
  selectionMode: 'single',
  density: 'compact',
  showHeader: true,
  stickyHeader: true,
  striped: true,
  borderColor: '#D1D5DB',
  headerBackground: '#F3F4F6',
  textColor: '#111827',
  accentColor: '#2563EB',
  fontSize: 14
}

function buildRuntimeFiles(): Map<string, string | Uint8Array> {
  const carouselConfig = JSON.stringify({
    label: 'Featured work',
    slides: [
      {
        title: 'First slide',
        description: 'Remote media remains consent gated in development.',
        imageUrl: 'https://media.example.com/first.webp',
        alt: 'First preview',
        href: '/details'
      },
      {
        title: 'Second slide',
        description: 'Local slide content.',
        imageUrl: '',
        alt: '',
        href: '/second-details'
      }
    ],
    initialIndex: 0,
    transition: 'fade',
    autoplay: false,
    intervalMs: 4_000,
    loop: false,
    showArrows: false,
    showDots: false,
    pauseOnHover: true,
    backgroundColor: '#111827',
    textColor: '#FFFFFF',
    accentColor: '#60A5FA'
  })
  const dataGridConfig = JSON.stringify(DATA_GRID_CONFIG)
  return new Map<string, string | Uint8Array>([
    [
      'index.html',
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'
    ],
    ['src/__openpencil_carousel.tsx', buildOpenPencilCarouselComponent({ devMode: true })],
    ['src/__openpencil_data_grid.tsx', buildOpenPencilDataGridComponent()],
    ['src/__openpencil_lottie.tsx', buildOpenPencilLottieComponent()],
    [
      'src/main.tsx',
      `import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import lottie from 'lottie-web/build/player/lottie_light'
import Carousel from './__openpencil_carousel'
import DataGrid from './__openpencil_data_grid'
import Lottie from './__openpencil_lottie'
import './index.css'

declare global {
  interface Window {
    __openPencilLottieTest: {
      destroyCalls: number
      lastContainer: HTMLElement | null
    }
  }
}

const lottieTest = { destroyCalls: 0, lastContainer: null as HTMLElement | null }
window.__openPencilLottieTest = lottieTest
lottie.loadAnimation = ((options: { container: HTMLElement }) => {
  const marker = document.createElement('svg')
  marker.setAttribute('data-test-lottie-marker', '')
  options.container.append(marker)
  lottieTest.lastContainer = options.container
  return {
    destroy() {
      lottieTest.destroyCalls += 1
      throw new Error('Synthetic destroy failure')
    },
    goToAndStop() {},
    setDirection() {},
    setSpeed() {}
  }
}) as typeof lottie.loadAnimation

function freshCarouselConfig(revision: number) {
  const config = ${carouselConfig}
  if (revision > 0) config.slides[0].imageUrl = 'https://media.example.com/first-updated.webp'
  return config
}

function freshDataGridConfig() {
  return ${dataGridConfig}
}

function freshHiddenHeaderDataGridConfig() {
  return { ...freshDataGridConfig(), showHeader: false as const }
}

function freshMultipleDataGridConfig() {
  return { ...freshDataGridConfig(), selectionMode: 'multiple' as const }
}

function freshLottieConfig() {
  return {
    source: 'json' as const,
    url: '',
    data: {
      v: '5.13.0',
      fr: 60,
      ip: 0,
      op: 120,
      w: 120,
      h: 120,
      layers: []
    },
    autoplay: false,
    loop: false,
    speed: 1,
    direction: 'forward' as const,
    fit: 'contain' as const
  }
}

function App({ revision }: { revision: number }) {
  return (
    <main>
      <Carousel config={freshCarouselConfig(revision)} style={{ height: 280, width: 520 }} />
      <div style={{ display: 'flex', gap: 24 }}>
        <DataGrid config={freshDataGridConfig()} style={{ height: 240, width: 360 }} />
        <DataGrid config={freshHiddenHeaderDataGridConfig()} style={{ height: 240, width: 360 }} />
        <DataGrid config={freshMultipleDataGridConfig()} style={{ height: 240, width: 360 }} />
      </div>
    </main>
  )
}

function RuntimeHarness() {
  const [revision, setRevision] = useState(0)
  const [showLottie, setShowLottie] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        Rerender host
      </button>
      <button type="button" onClick={() => setShowLottie(false)}>
        Unmount Lottie
      </button>
      <output aria-label="Host revision">{revision}</output>
      <App revision={revision} />
      {showLottie ? (
        <Lottie config={freshLottieConfig()} style={{ height: 120, width: 120 }} />
      ) : null}
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <RuntimeHarness />
  </StrictMode>
)
`
    ],
    ['src/index.css', 'body { font-family: sans-serif; margin: 0; }']
  ])
}

describe('preview browser — carousel and data grid runtimes', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildRuntimeFiles() })
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
    'keeps runtime consent and accessibility state scoped to the active control',
    async () => {
      if (!server || !page) throw new Error('Missing module preview runtime')
      await page.route('https://media.example.com/**', (route) => route.abort())
      await page.goto(server.url, { waitUntil: 'networkidle' })

      const carousel = page.locator('[data-openpencil-carousel]')
      await carousel.waitFor({ state: 'visible' })
      expect(await carousel.getByRole('button', { name: 'Load remote slide media' }).count()).toBe(
        1
      )
      expect(await carousel.getByRole('link', { name: 'First slide' }).count()).toBe(1)
      expect(await carousel.locator('a button, button a').count()).toBe(0)

      const firstSlide = carousel.locator('[data-openpencil-carousel-slide]').nth(0)
      const secondSlide = carousel.locator('[data-openpencil-carousel-slide]').nth(1)
      const firstLink = carousel.getByRole('link', { name: 'First slide' })
      await firstLink.focus()
      await firstLink.press('End')
      expect(await firstSlide.getAttribute('aria-hidden')).toBe('false')
      expect(await secondSlide.getAttribute('aria-hidden')).toBe('true')

      await carousel.focus()
      await carousel.press('End')
      expect(await firstSlide.getAttribute('aria-hidden')).toBe('true')
      expect(await secondSlide.getAttribute('aria-hidden')).toBe('false')
      await carousel.press('Home')
      expect(await firstSlide.getAttribute('aria-hidden')).toBe('false')

      await carousel.getByRole('button', { name: 'Load remote slide media' }).click()
      expect(
        await carousel.locator('img[src="https://media.example.com/first.webp"]').count()
      ).toBe(1)

      const grids = page.locator('[data-openpencil-data-grid]')
      expect(await grids.count()).toBe(3)
      const firstGrid = grids.nth(0)
      const secondGrid = grids.nth(1)
      const multipleGrid = grids.nth(2)
      const firstRadio = firstGrid.locator('input[type="radio"]').first()
      const secondRadio = secondGrid.locator('input[type="radio"]').first()
      const firstName = await firstRadio.getAttribute('name')
      const secondName = await secondRadio.getAttribute('name')
      expect(firstName).toBeTruthy()
      expect(secondName).toBeTruthy()
      expect(firstName).not.toBe(secondName)

      expect(await secondGrid.locator('thead[data-visually-hidden]').count()).toBe(1)
      expect(
        await secondGrid.getByRole('columnheader', { name: 'Name', exact: true }).count()
      ).toBe(1)
      expect(await secondGrid.getByRole('button', { name: 'Name', exact: true }).count()).toBe(0)
      expect(await secondGrid.getByRole('searchbox', { name: 'Filter Name' }).count()).toBe(0)

      const selectAll = multipleGrid.getByRole('checkbox', {
        name: 'Select all rows on this page'
      })
      await multipleGrid.getByRole('checkbox', { name: 'Select row alpha' }).check()
      expect(await selectAll.isChecked()).toBe(false)
      expect(await selectAll.getAttribute('aria-checked')).toBe('mixed')
      expect(await selectAll.evaluate((input) => (input as HTMLInputElement).indeterminate)).toBe(
        true
      )

      await firstGrid.getByRole('button', { name: 'Name', exact: true }).click()
      const filter = firstGrid.getByRole('searchbox', { name: 'Filter Name' })
      await filter.fill('Alpha')
      await firstRadio.check()
      expect(await firstRadio.isChecked()).toBe(true)
      expect(await firstGrid.locator('th[aria-sort="ascending"]').count()).toBe(1)

      await page.getByRole('button', { name: 'Rerender host', exact: true }).click()
      await expect(page.getByLabel('Host revision').textContent()).resolves.toBe('1')
      await page.waitForTimeout(50)

      expect(
        await carousel.locator('img[src="https://media.example.com/first-updated.webp"]').count()
      ).toBe(0)
      expect(await carousel.getByRole('button', { name: 'Load remote slide media' }).count()).toBe(
        1
      )

      expect(await filter.inputValue()).toBe('Alpha')
      expect(await firstRadio.isChecked()).toBe(true)
      expect(await firstRadio.getAttribute('name')).toBe(firstName)
      expect(await secondRadio.getAttribute('name')).toBe(secondName)
      expect(await firstGrid.locator('th[aria-sort="ascending"]').count()).toBe(1)

      await page.locator('[data-test-lottie-marker]').waitFor({ state: 'attached' })
      const destroyCallsBeforeUnmount = await page.evaluate(
        () => window.__openPencilLottieTest.destroyCalls
      )
      await page.getByRole('button', { name: 'Unmount Lottie', exact: true }).click()
      expect(
        await page.evaluate(() => window.__openPencilLottieTest.lastContainer?.childElementCount)
      ).toBe(0)
      expect(await page.evaluate(() => window.__openPencilLottieTest.destroyCalls)).toBe(
        destroyCallsBeforeUnmount + 1
      )
    },
    timeoutMs
  )

  test(
    'imports bounded pasted CSV locally and prepares formula-safe CSV text without permissions',
    async () => {
      if (!server || !page) throw new Error('Missing module preview runtime')
      await page.goto(server.url, { waitUntil: 'networkidle' })

      const firstGrid = page.locator('[data-openpencil-data-grid]').first()
      const csvTools = firstGrid.getByRole('region', { name: 'Data grid CSV tools' })
      await csvTools.getByRole('button', { name: 'Paste CSV (local session)' }).click()
      const importSource = csvTools.getByRole('textbox', { name: 'CSV import text' })

      await importSource.fill('Name,Score\rBroken,1')
      await csvTools.getByRole('button', { name: 'Import pasted CSV' }).click()
      expect(await csvTools.getByRole('alert').textContent()).toContain('malformed CR')

      await importSource.fill('\uFEFFName,Score\n"=SUM(A1:A2)",10\nGamma,3')
      await csvTools.getByRole('button', { name: 'Import pasted CSV' }).click()
      expect(await csvTools.getByText('local running session only').textContent()).toContain(
        'Imported 2 rows'
      )
      expect(await firstGrid.getByText('=SUM(A1:A2)', { exact: true }).count()).toBe(1)
      expect(await firstGrid.getByText('Alpha', { exact: true }).count()).toBe(0)

      await csvTools.getByRole('button', { name: 'Prepare CSV text' }).click()
      const prepared = csvTools.getByRole('textbox', { name: 'Prepared CSV text' })
      // HTML textarea values normalize CRLF to LF; the generated helper itself emits CRLF.
      expect(await prepared.inputValue()).toBe("Name,Score\n'=SUM(A1:A2),10\nGamma,3\n")
      expect(await csvTools.getByText('1 formula-like text fields were neutralized.').count()).toBe(
        1
      )

      await page.getByRole('button', { name: 'Rerender host', exact: true }).click()
      expect(await firstGrid.getByText('=SUM(A1:A2)', { exact: true }).count()).toBe(1)

      await page.reload({ waitUntil: 'networkidle' })
      const reloadedGrid = page.locator('[data-openpencil-data-grid]').first()
      expect(await reloadedGrid.getByText('Alpha', { exact: true }).count()).toBe(1)
      expect(await reloadedGrid.getByText('=SUM(A1:A2)', { exact: true }).count()).toBe(0)
    },
    timeoutMs
  )
})
