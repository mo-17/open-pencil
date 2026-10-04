import { expect, test } from 'bun:test'

import { computeActionErrors, type ActionValidationCtx } from '@/app/lowcode/action/errors'
import { makeAction } from '@/app/lowcode/action/factory'
import { navigationOperation, navigationTarget } from '@/app/lowcode/action/navigation'

const context: ActionValidationCtx = {
  validStateIds: new Set(),
  validDocStateNames: new Set(),
  workflows: [],
  validNodeIds: new Set(),
  motionTargets: []
}

test('navigation factory keeps existing push defaults and creates explicit Back fallback', () => {
  const ctx = { pageStates: [], docStates: [], motionTargets: [] }
  expect(makeAction('navigate', 'go', ctx)).toEqual({ id: 'go', kind: 'navigate', to: '/' })
  expect(makeAction('back', 'back', ctx)).toEqual({ id: 'back', kind: 'back', fallback: '/' })
})

test('navigation editor validation rejects external paths and unresolved Back parameter patterns', () => {
  expect(
    computeActionErrors({ id: 'go', kind: 'navigate', to: '//example.test' }, context).to
  ).toBeDefined()
  expect(
    computeActionErrors({ id: 'back', kind: 'back', fallback: '/:id' }, context).to
  ).toBeDefined()
  expect(
    computeActionErrors({ id: 'back', kind: 'back', fallback: '/list?status=active#top' }, context)
  ).toEqual({})
  expect(
    computeActionErrors(
      {
        id: 'go',
        kind: 'navigate',
        to: '/detail/:id?mode=edit#form',
        history: 'replace',
        params: { id: '42' }
      },
      context
    )
  ).toEqual({})
})

test('changing Jump/Replace retains route params, creates detached values, and keeps legacy omitted push field', () => {
  const source = {
    id: 'go',
    kind: 'navigate' as const,
    to: '/details/:id?mode=edit#form',
    params: { id: 'itemId' }
  }
  const replacement = navigationOperation(source, 'replace')
  expect(replacement).toEqual({ ...source, history: 'replace' })
  if (replacement?.kind !== 'navigate') throw new Error('Expected navigate')
  expect(replacement.params).not.toBe(source.params)
  expect(navigationOperation(replacement, 'push')).toEqual(source)
  expect(source).not.toHaveProperty('history')
  expect(navigationTarget(replacement, '/list')).toEqual({ ...replacement, to: '/list' })
  expect(replacement.to).toBe(source.to)
})

test('Back requires an explicit concrete fallback and operation changes retain action identity', () => {
  const source = {
    id: 'go',
    kind: 'navigate' as const,
    to: '/detail/:id',
    params: { id: 'itemId' }
  }
  const back = navigationOperation(source, 'back')
  expect(back).toEqual({ id: 'go', kind: 'back', fallback: '/' })
  if (!back) throw new Error('Expected Back')
  const changed = navigationTarget(back, '/list?category=active#top')
  expect(navigationOperation(changed, 'push')).toEqual({
    id: 'go',
    kind: 'navigate',
    to: '/list?category=active#top'
  })
  expect(navigationOperation(source, 'unrecognized')).toBeUndefined()
})
