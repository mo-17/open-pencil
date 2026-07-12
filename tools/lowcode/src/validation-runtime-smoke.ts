#!/usr/bin/env bun
import { chromium } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer } from '@open-pencil/compiler/dev-server'
import { SceneGraph } from '@open-pencil/scene-graph'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const graph = new SceneGraph()
const pageId = graph.getPages()[0].id

graph.updateNode(pageId, {
  state: [
    { id: 's-email', name: 'email', type: 'string', defaultValue: '' },
    { id: 's-status', name: 'status', type: 'string', defaultValue: 'idle' }
  ]
})

const form = graph.createNode('FORM', pageId, {
  name: 'Validation form',
  x: 40,
  y: 40,
  width: 360,
  height: 220,
  layoutMode: 'VERTICAL',
  itemSpacing: 12,
  paddingTop: 16,
  paddingRight: 16,
  paddingBottom: 16,
  paddingLeft: 16,
  interactiveProps: {
    validationSummary: { enabled: true, title: 'Fix these fields' }
  },
  events: {
    onSubmit: [
      {
        id: 'submit-status',
        kind: 'setState',
        targetStateId: 's-status',
        valueExpr: '"submitted"'
      }
    ]
  }
})

graph.createNode('INPUT', form.id, {
  name: 'Email',
  width: 240,
  height: 36,
  bindings: { value: { kind: 'ref', stateId: 's-email' } },
  interactiveProps: {
    placeholder: 'Email',
    validation: {
      required: true,
      pattern: '^[^@]+@[^@]+\\.[^@]+$',
      customExpr: 'email !== "blocked@x.com"',
      async: {
        url: '/api/check-email',
        method: 'POST',
        message: 'Email failed remote validation'
      },
      messages: {
        required: 'Email is required',
        pattern: 'Use a valid email',
        custom: 'That email is blocked'
      }
    }
  }
})

graph.createNode('BUTTON', form.id, {
  name: 'Submit',
  width: 120,
  height: 36,
  interactiveProps: { text: 'Submit' }
})

graph.createNode('TEXT', form.id, {
  name: 'Status',
  width: 240,
  height: 24,
  text: ['Status: ', '{status}'].join('$')
})

const out = compile({
  graph,
  pageIds: [pageId],
  options: withDefaults({ packageName: 'validation-runtime-smoke' })
})
assert(
  out.warnings.length === 0,
  `Expected no compiler warnings, got ${JSON.stringify(out.warnings)}`
)

const server = await createPreviewServer({ initialFiles: out.files, fsRoot: process.cwd() })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

try {
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  await page.route('**/api/check-email', async (route) => {
    const payload = route.request().postDataJSON() as { value?: unknown } | null
    const value = String(payload?.value ?? '')
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        value === 'taken@example.com'
          ? { valid: false, message: 'Email is already taken' }
          : { valid: true }
      )
    })
  })
  await page.goto(server.url)
  await page.getByText('Status: idle').waitFor()

  const email = page.getByPlaceholder('Email')
  const fieldAlert = page.locator('p[role="alert"]')
  const summary = page.locator('form > div[role="alert"]')

  await email.pressSequentially('bad')
  await fieldAlert.waitFor()
  assert(
    (await fieldAlert.textContent()) === 'Use a valid email',
    'onChange should show pattern error'
  )
  assert(
    (await summary.textContent()) === 'Fix these fieldsUse a valid email',
    'summary should aggregate pattern error'
  )

  await email.fill('')
  await email.blur()
  await fieldAlert.waitFor()
  assert(
    (await fieldAlert.textContent()) === 'Email is required',
    'blur should show required error'
  )

  await email.pressSequentially('blocked@x.com')
  await email.blur()
  await fieldAlert.waitFor()
  assert(
    (await fieldAlert.textContent()) === 'That email is blocked',
    'blur should show custom error'
  )

  await email.fill('taken@example.com')
  await email.blur()
  await fieldAlert.waitFor()
  assert(
    (await fieldAlert.textContent()) === 'Email is already taken',
    'blur should show async remote error'
  )

  await email.focus()
  await email.press('Enter')
  await page.getByText('Status: idle').waitFor()

  await email.fill('user@example.com')
  await email.blur()
  await page.waitForFunction(() => document.querySelectorAll('[role="alert"]').length === 0)

  await email.focus()
  await email.press('Enter')
  await page.getByText('Status: submitted').waitFor()

  console.log('§19 validation runtime smoke passed')
} finally {
  await browser?.close()
  await server.close()
}
