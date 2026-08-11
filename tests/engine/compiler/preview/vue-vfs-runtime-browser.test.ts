import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import { SceneGraph } from '@open-pencil/scene-graph'

function buildVuePreviewFiles(message = 'Vue target sidecar is ready') {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.createNode('TEXT', pageId, {
    name: 'Vue preview marker',
    text: message,
    x: 24,
    y: 24,
    width: 280,
    height: 32
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      packageName: 'vue-target-preview',
      target: 'vue',
      router: 'none',
      devMode: true
    })
  }).files
}

function buildVueLowcodePreviewFiles() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'email-state', name: 'email', type: 'string', defaultValue: '' }]
  })
  graph.createNode('BUTTON', pageId, {
    name: 'Toast action',
    x: 24,
    y: 24,
    width: 140,
    height: 40,
    interactiveProps: { text: 'Show toast' },
    events: {
      onClick: [
        {
          id: 'show-toast',
          kind: 'toast',
          messageExpr: '"Saved in Vue"',
          variant: 'success',
          durationMs: 0
        }
      ]
    }
  })
  graph.createNode('BUTTON', pageId, {
    name: 'Confirm action',
    x: 184,
    y: 24,
    width: 160,
    height: 40,
    interactiveProps: { text: 'Confirm choice' },
    events: {
      onClick: [
        {
          id: 'confirm-choice',
          kind: 'confirm',
          messageExpr: '"Save changes?"',
          confirmLabel: 'Save',
          cancelLabel: 'Keep editing',
          consequent: [
            {
              id: 'confirm-toast',
              kind: 'toast',
              messageExpr: '"Confirmed in Vue"',
              durationMs: 0
            }
          ],
          alternate: [
            {
              id: 'cancel-toast',
              kind: 'toast',
              messageExpr: '"Cancelled in Vue"',
              durationMs: 0
            }
          ]
        }
      ]
    }
  })
  const form = graph.createNode('FORM', pageId, {
    name: 'Validated form',
    x: 24,
    y: 112,
    width: 320,
    height: 160,
    interactiveProps: {
      validationSummary: { enabled: true, title: 'Fix the form' }
    },
    events: {
      onSubmit: [
        {
          id: 'submitted-toast',
          kind: 'toast',
          messageExpr: '"Form submitted"',
          durationMs: 0
        }
      ]
    }
  })
  graph.createNode('INPUT', form.id, {
    name: 'Email address',
    width: 240,
    height: 40,
    bindings: { value: { kind: 'docState', docStateName: 'email' } },
    interactiveProps: {
      placeholder: 'Email address',
      validation: {
        required: true,
        pattern: '^[^@]+@[^@]+$',
        messages: { required: 'Email required', pattern: 'Enter a valid email' }
      }
    }
  })
  graph.createNode('BUTTON', form.id, {
    name: 'Submit form',
    width: 140,
    height: 40,
    interactiveProps: { text: 'Submit form' }
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      packageName: 'vue-lowcode-preview',
      target: 'vue',
      router: 'none',
      devMode: true
    })
  }).files
}

describe('Vue target in-memory compiler preview', () => {
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeAll(async () => {
    server = await createPreviewServer({
      target: 'vue',
      initialFiles: buildVuePreviewFiles()
    })
    browser = await chromium.launch()
    page = await browser.newPage()
  }, 30_000)

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
  }, 30_000)

  test('plugin-vue transforms and renders the selected target through the sidecar', async () => {
    if (!server || !page) throw new Error('Vue preview runtime did not start')
    const failures: string[] = []
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
    })
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await playwrightExpect(page.getByText('Vue target sidecar is ready')).toBeVisible()
    server.updateFiles(buildVuePreviewFiles('Vue target HMR is ready'))
    await playwrightExpect(page.getByText('Vue target HMR is ready')).toBeVisible()
    expect(failures).toEqual([])
  }, 30_000)

  test('runs toast, confirm branches, focus management, and guarded local validation', async () => {
    if (!server || !page) throw new Error('Vue preview runtime did not start')
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    server.updateFiles(buildVueLowcodePreviewFiles())
    await page.goto(server.url, { waitUntil: 'networkidle' })

    await page.getByRole('button', { name: 'Show toast' }).click()
    await playwrightExpect(
      page.getByRole('status').filter({ hasText: 'Saved in Vue' })
    ).toBeVisible()

    const trigger = page.getByRole('button', { name: 'Confirm choice' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Confirmation' })
    await playwrightExpect(dialog).toBeVisible()
    await playwrightExpect(dialog.getByText('Save changes?')).toBeVisible()
    await playwrightExpect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused()
    await page.keyboard.press('Escape')
    await playwrightExpect(dialog).toBeHidden()
    await playwrightExpect(page.getByText('Cancelled in Vue')).toBeVisible()
    await playwrightExpect(trigger).toBeFocused()

    await trigger.click()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await playwrightExpect(dialog).toBeHidden()
    await playwrightExpect(page.getByText('Confirmed in Vue')).toBeVisible()

    const email = page.getByPlaceholder('Email address')
    await page.getByRole('button', { name: 'Submit form' }).click()
    await playwrightExpect(email).toHaveAttribute('aria-invalid', 'true')
    const fieldErrorId = await email.getAttribute('aria-describedby')
    expect(fieldErrorId).toMatch(/^openpencil-validation-error-/)
    const fieldError = page.locator(`#${fieldErrorId}`)
    await playwrightExpect(fieldError).toHaveText('Email required')
    await playwrightExpect(fieldError).toBeVisible()
    await playwrightExpect(page.getByText('Form submitted')).toHaveCount(0)

    await email.fill('person@example.com')
    await playwrightExpect(fieldError).toBeHidden()
    await playwrightExpect(email).toHaveAttribute('aria-invalid', 'false')
    await page.getByRole('button', { name: 'Submit form' }).click()
    await playwrightExpect(page.getByText('Form submitted')).toBeVisible()
    expect(pageErrors).toEqual([])
  }, 30_000)
})
