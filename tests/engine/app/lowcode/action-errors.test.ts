import { describe, expect, test } from 'bun:test'

import type { ActionDef } from '@open-pencil/core/scene-graph'

import { computeActionErrors } from '@/app/lowcode/action-errors'
import {
  ANALYTICS_TRACK_EVENT_CONFIG_HINT,
  analyticsProviderHelp
} from '@/app/lowcode/analytics-help'

const ctx = {
  validStateIds: new Set<string>(),
  validDocStateNames: new Set<string>(),
  workflows: []
}
const CHECKOUT_ENDPOINT = `/api/\${priceId}/checkout`
const PORTAL_ENDPOINT = `/api/customer-portal/\${customerId}`

describe('lowcode ActionRow validation', () => {
  test('analytics provider help maps provider-specific setup hints', () => {
    expect(analyticsProviderHelp('ga4')).toMatchObject({
      idLabel: 'Measurement ID',
      docsHref: 'https://support.google.com/analytics/answer/9539598'
    })
    expect(analyticsProviderHelp('plausible')).toMatchObject({
      idLabel: 'Domain',
      docsHref: 'https://plausible.io/docs/plausible-script'
    })
    expect(analyticsProviderHelp('posthog')).toMatchObject({
      idLabel: 'Project API key',
      docsHref: 'https://posthog.com/docs/libraries/js'
    })
  })

  test('trackEvent missing-provider hint stays non-blocking', () => {
    const action: ActionDef = {
      id: 'track-1',
      kind: 'trackEvent',
      eventNameExpr: '"signup_click"'
    }

    expect(ANALYTICS_TRACK_EVENT_CONFIG_HINT).toContain('no-op until a provider id is set')
    expect(computeActionErrors(action, ctx)).toEqual({})
  })

  test('trackEvent properties accept identifier keys and expression values', () => {
    const action: ActionDef = {
      id: 'track-1',
      kind: 'trackEvent',
      eventNameExpr: '"signup_click"',
      properties: {
        plan: '"pro"',
        count: '1 + 2'
      }
    }

    expect(computeActionErrors(action, ctx)).toEqual({})
  })

  test('trackEvent properties report invalid keys and expressions', () => {
    const action: ActionDef = {
      id: 'track-1',
      kind: 'trackEvent',
      eventNameExpr: '',
      properties: {
        'bad-key': ''
      }
    }

    const errors = computeActionErrors(action, ctx)
    expect(errors.expr).toBeTruthy()
    expect(errors.properties?.get(0)?.keyError).toBe('invalid identifier')
    expect(errors.properties?.get(0)?.valueError).toBeTruthy()
  })

  test('stripeCheckout accepts endpoint templates and expression payload entries', () => {
    const action: ActionDef = {
      id: 'checkout-1',
      kind: 'stripeCheckout',
      endpoint: CHECKOUT_ENDPOINT,
      payloadEntries: [
        { key: 'priceId', valueExpr: 'priceId' },
        { key: 'quantity', valueExpr: 'qty' }
      ],
      errorTarget: 'checkoutError'
    }
    const stripeCtx = {
      ...ctx,
      validDocStateNames: new Set(['checkoutError'])
    }

    expect(computeActionErrors(action, stripeCtx)).toEqual({})
  })

  test('stripeCheckout reports invalid endpoint, payload, and error target', () => {
    const action: ActionDef = {
      id: 'checkout-1',
      kind: 'stripeCheckout',
      endpoint: '${',
      payloadEntries: [
        { key: 'bad-key', valueExpr: '' },
        { key: 'bad-key', valueExpr: 'qty' }
      ],
      errorTarget: 'missingError'
    }

    const errors = computeActionErrors(action, ctx)
    expect(errors.endpoint).toBeTruthy()
    expect(errors.target).toBe('error target no longer exists')
    expect(errors.entries?.get(0)?.keyError).toBe('invalid identifier')
    expect(errors.entries?.get(0)?.valueError).toBeTruthy()
    expect(errors.entries?.get(1)?.keyError).toBe('invalid identifier')
  })

  test('stripeCustomerPortal mirrors stripe redirect validation', () => {
    const valid: ActionDef = {
      id: 'portal-1',
      kind: 'stripeCustomerPortal',
      endpoint: PORTAL_ENDPOINT,
      payloadEntries: [{ key: 'customerId', valueExpr: 'customerId' }],
      errorTarget: 'checkoutError'
    }
    const stripeCtx = {
      ...ctx,
      validDocStateNames: new Set(['checkoutError'])
    }

    expect(computeActionErrors(valid, stripeCtx)).toEqual({})

    const invalid: ActionDef = {
      id: 'portal-2',
      kind: 'stripeCustomerPortal',
      endpoint: '${',
      payloadEntries: [{ key: 'bad-key', valueExpr: '' }],
      errorTarget: 'missingError'
    }
    const errors = computeActionErrors(invalid, ctx)
    expect(errors.endpoint).toBeTruthy()
    expect(errors.target).toBe('error target no longer exists')
    expect(errors.entries?.get(0)?.keyError).toBe('invalid identifier')
    expect(errors.entries?.get(0)?.valueError).toBeTruthy()
  })
})
