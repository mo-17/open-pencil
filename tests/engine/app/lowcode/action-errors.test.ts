import { describe, expect, test } from 'bun:test'

import type { ActionDef } from '@open-pencil/scene-graph'

import { computeActionErrors } from '@/app/lowcode/action/errors'
import {
  ANALYTICS_TRACK_EVENT_CONFIG_HINT,
  analyticsProviderHelp
} from '@/app/lowcode/analytics-help'

const ctx = {
  validStateIds: new Set<string>(),
  validDocStateNames: new Set<string>(),
  workflows: [],
  validNodeIds: new Set<string>(),
  motionTargets: []
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

  test('invokeServerWorkflow validates workflow, arguments, and success result binding', () => {
    const valid: ActionDef = {
      id: 'invoke-1',
      kind: 'invokeServerWorkflow',
      workflowId: 'create-checkout',
      args: { priceId: 'selectedPrice.id', quantity: 'count + 1' },
      resultName: 'checkoutResult',
      onSuccess: [{ id: 'success-1', kind: 'toast', messageExpr: '"Ready"' }],
      onError: [{ id: 'error-1', kind: 'toast', messageExpr: '"Failed"' }]
    }
    expect(computeActionErrors(valid, ctx)).toEqual({})

    const invalid: ActionDef = {
      id: 'invoke-2',
      kind: 'invokeServerWorkflow',
      workflowId: '',
      args: { 'bad-key': '', validName: '(' },
      resultName: 'bad-result'
    }
    const errors = computeActionErrors(invalid, ctx)
    expect(errors.workflow).toBe('server workflow required')
    expect(errors.resultName).toBe('must be a valid identifier')
    expect(errors.argErrors?.get('bad-key')).toBe('argument name must be a valid identifier')
    expect(errors.argErrors?.get('validName')).toBeTruthy()
  })

  test('motion actions distinguish missing, invalid, and deleted targets', () => {
    const motionCtx = {
      ...ctx,
      validNodeIds: new Set(['static-node', 'motion-node']),
      motionTargets: [
        {
          id: 'motion-node',
          label: 'Animated (motion-node)',
          tracks: [{ id: 'hover', label: 'hover' }]
        }
      ]
    }

    expect(
      computeActionErrors({ id: 'play-1', kind: 'playMotion', targetNodeId: '' }, motionCtx)
    ).toEqual({ target: 'motion target required' })
    expect(
      computeActionErrors(
        { id: 'play-2', kind: 'playMotion', targetNodeId: 'static-node' },
        motionCtx
      )
    ).toEqual({ target: 'target node has no valid motion' })
    expect(
      computeActionErrors(
        { id: 'stop-1', kind: 'stopMotion', targetNodeId: 'deleted-node' },
        motionCtx
      )
    ).toEqual({ target: 'target node no longer exists' })
  })

  test('motion actions accept all tracks and reject a stale track id', () => {
    const motionCtx = {
      ...ctx,
      validNodeIds: new Set(['motion-node']),
      motionTargets: [
        {
          id: 'motion-node',
          label: 'Animated (motion-node)',
          tracks: [{ id: 'hover', label: 'hover' }]
        }
      ]
    }

    expect(
      computeActionErrors(
        { id: 'play-1', kind: 'playMotion', targetNodeId: 'motion-node' },
        motionCtx
      )
    ).toEqual({})
    expect(
      computeActionErrors(
        {
          id: 'stop-1',
          kind: 'stopMotion',
          targetNodeId: 'motion-node',
          trackId: 'removed-track'
        },
        motionCtx
      )
    ).toEqual({ track: 'motion track no longer exists' })
    expect(
      computeActionErrors(
        {
          id: 'await-1',
          kind: 'awaitMotion',
          targetNodeId: 'motion-node',
          trackId: 'hover',
          timeoutMs: 120_001
        },
        motionCtx
      )
    ).toEqual({ ms: 'timeout must be between 0 and 120000 ms' })
    expect(
      computeActionErrors(
        { id: 'toggle-1', kind: 'toggleMotion', targetNodeId: 'motion-node' },
        motionCtx
      )
    ).toEqual({})
  })
})
