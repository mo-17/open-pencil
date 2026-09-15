import { expect, test } from '@playwright/test'

import {
  fillExpansionAction,
  submitExpansionAction
} from '#tests/helpers/compiler/business/expansion/actions'
import { expansionActionFixture } from '#tests/helpers/compiler/business/expansion/fixtures'
import {
  expansionDefinition,
  expansionKinds
} from '#tests/helpers/compiler/business/expansion/metadata'
import { withBusinessBrowser } from '#tests/helpers/compiler/business/helpers'

for (const kind of expansionKinds) {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} ${kind} operates every generated form with selected revisions and exact payloads`, async ({
      page
    }, info) => {
      test.setTimeout(240_000)
      const definition = expansionDefinition(kind)
      // Real generated React/Vue, DOM interaction and query/command transport; mocked OIDC/HTTP.
      // PostgreSQL scenarios separately exercise ownership, roles, conflicts and state transitions.
      await withBusinessBrowser(page, kind, target, async (session) => {
        for (const screen of definition.pages) {
          for (const action of screen.actions) {
            await test.step(action.commandId, async () => {
              const fixture = expansionActionFixture(session.fixture.application, screen, action)
              Object.assign(session.api.resources, fixture.resources)
              await session.open(screen.id)
              const requiresSelection =
                action.when ||
                action.inputs.some((input) => input.fromSelection) ||
                Object.values(action.parameters).some((source) => source.kind === 'selection')
              if (requiresSelection)
                await page
                  .getByRole('button', { name: 'Select record', exact: true })
                  .first()
                  .click()
              await page.getByRole('button', { name: action.label.en, exact: true }).first().click()
              await fillExpansionAction(page, action, fixture.values)
              try {
                await submitExpansionAction(session, action, fixture.payload, fixture.selected)
              } catch (error) {
                await info.attach(action.commandId + '-browser-text', {
                  body: await page.locator('body').innerText(),
                  contentType: 'text/plain'
                })
                await page.screenshot({ path: info.outputPath(action.commandId + '-failed.png') })
                throw error
              }
              if (screen.listing) expect(session.api.reads).toContain(screen.listing.resourceId)
              for (const input of action.inputs)
                if (input.relation) expect(session.api.reads).toContain(input.relation.resourceId)
            })
          }
        }
        expect(new Set(session.api.calls.map((call) => call.commandId)).size).toBe(
          session.fixture.application.commands?.commands.length
        )
        await page.screenshot({ path: info.outputPath('expansion-last-command.png') })
      })
    })
  }
}
