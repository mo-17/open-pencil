import { describe, expect, test } from 'bun:test'

import { buildComponentModule } from '@open-pencil/compiler/adapters/react/emit/component'
import { buildAppTsx } from '@open-pencil/compiler/adapters/react/scaffold'
import type { ComponentDef, IREventHandler, IRTree } from '@open-pencil/compiler/ir/types'

function treeWithClick(
  handler: IREventHandler,
  attrs: Record<string, boolean | string> = {}
): IRTree {
  return {
    pageId: 'page',
    pageName: 'Request gate',
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    warnings: [],
    children: [
      {
        kind: 'element',
        sourceId: 'request-button',
        tag: 'button',
        className: '',
        attrs: { type: 'button', ...attrs },
        children: [{ kind: 'text', value: 'Run' }],
        events: { onClick: [handler] }
      }
    ]
  }
}

const mutation: IREventHandler = {
  kind: 'supabaseMutation',
  operation: 'insert',
  table: 'tasks',
  payload: '{"title":"One"}',
  filters: []
}

describe('React request single-flight gate', () => {
  test('network click emits an immediate ref lock plus reactive pending UI', () => {
    const out = buildAppTsx(treeWithClick(mutation))

    expect(out).toContain("import { useState, useRef } from 'react'")
    expect(out).toContain('const __opRequestsInFlight = useRef(new Set<string>())')
    expect(out).toContain('const __opRequestThrottleUntil = useRef(new Map<string, number>())')
    expect(out).toContain(
      'if (__opRequestsInFlight.current.has(key) || now < (__opRequestThrottleUntil.current.get(key) ?? 0)) return'
    )
    expect(out).toContain('__opRequestThrottleUntil.current.set(key, now + 300)')
    expect(out).toContain('finally {')
    expect(out).toContain('__opRequestsInFlight.current.delete(key)')
    expect(out).toContain(
      'onClick={async (e) => { await __opRunRequest("request-button:onClick", async () => {'
    )
    expect(out).toContain(
      'data-op-request-pending={(__opPendingRequests.has("request-button:onClick")) ? "true" : undefined}'
    )
    expect(out).toContain('aria-busy={__opPendingRequests.has("request-button:onClick")}')
    expect(out).toContain('disabled={__opPendingRequests.has("request-button:onClick")}')
    expect(out).toContain('aria-busy={__opPendingRequests.size > 0}')
  })

  test('pending is ORed with an authored disabled value', () => {
    const out = buildAppTsx(treeWithClick(mutation, { disabled: true }))
    expect(out).toContain('disabled={__opPendingRequests.has("request-button:onClick") || true}')
    expect(out.match(/ disabled=/g)).toHaveLength(1)
  })

  test('an unvalidated form prevents native submission before the throttle gate', () => {
    const tree = treeWithClick(mutation)
    tree.children = [
      {
        kind: 'element',
        sourceId: 'request-form',
        tag: 'form',
        className: '',
        attrs: {},
        events: { onSubmit: [mutation] },
        children: [
          {
            kind: 'element',
            sourceId: 'submit-button',
            tag: 'button',
            className: '',
            attrs: { type: 'submit' },
            children: [{ kind: 'text', value: 'Submit' }]
          }
        ]
      }
    ]

    const out = buildAppTsx(tree)
    expect(out).toContain(
      'onSubmit={async (e) => { e.preventDefault(); await __opRunRequest("request-form:onSubmit", async () => {'
    )
  })

  test('pure async delay does not opt into request locking', () => {
    const out = buildAppTsx(treeWithClick({ kind: 'delay', ms: 20 }))
    expect(out).not.toContain('__opRequestsInFlight')
    expect(out).not.toContain('data-op-request-pending')
    expect(out).toContain('onClick={async () =>')
  })

  test('a nested network action still opts the activation into one gate', () => {
    const conditional: IREventHandler = {
      kind: 'condition',
      condAst: { kind: 'boolean', value: true },
      references: [],
      consequent: [mutation],
      alternate: []
    }
    const out = buildAppTsx(treeWithClick(conditional))
    expect(out).toContain("import { getSupabaseClient } from './_lowcode_supabase'")
    expect(out).toContain('__opRunRequest("request-button:onClick"')
    expect(out).toContain('disabled={__opPendingRequests.has("request-button:onClick")}')
  })

  test('reusable component bodies receive the same hook and guard', () => {
    const apiCall: IREventHandler = {
      kind: 'apiCall',
      method: 'GET',
      url: { kind: 'template', quasis: ['https://example.test/tasks'], expressions: [] },
      body: undefined,
      docStateName: 'tasks'
    }
    const def: ComponentDef = {
      componentId: 'component',
      name: 'RequestButton',
      props: [],
      docStateWrites: ['tasks'],
      children: treeWithClick(apiCall).children
    }
    const out = buildComponentModule(def, false)
    expect(out).toContain("import { useState, useRef } from 'react'")
    expect(out).toContain('const __opRequestsInFlight = useRef(new Set<string>())')
    expect(out).toContain('__opRunRequest("request-button:onClick"')
  })

  test('remote onChange keeps the controlled writer immediate and debounces the authored chain', () => {
    const apiCall: IREventHandler = {
      kind: 'apiCall',
      method: 'GET',
      url: { kind: 'template', quasis: ['https://example.test/search'], expressions: [] },
      body: undefined,
      docStateName: 'results'
    }
    const tree: IRTree = {
      pageId: 'page',
      pageName: 'Debounced search',
      states: [],
      docStates: [],
      docStateReads: ['query'],
      docStateWrites: ['query', 'results'],
      warnings: [],
      children: [
        {
          kind: 'element',
          sourceId: 'search-input',
          tag: 'input',
          className: '',
          attrs: { type: 'search' },
          children: [],
          controlled: {
            read: 'query',
            write: { kind: 'docState', name: 'query', targetType: 'string' }
          },
          events: { onChange: [apiCall] }
        }
      ]
    }
    const out = buildAppTsx(tree)

    expect(out).toContain("import { useState, useRef, useEffect } from 'react'")
    expect(out).toContain('new Map<EventTarget, ReturnType<typeof setTimeout>>()')
    expect(out).toContain('const __opDebounceChange = (target: EventTarget')
    expect(out).toContain(
      'const $value = (e.target as HTMLInputElement).value; setDocState("query", e.target.value); __opDebounceChange(e.currentTarget, async () => {'
    )
    expect(out).not.toContain('__opRunRequest("search-input:onChange"')
    expect(out).not.toContain('disabled={__opPendingRequests.has("search-input:onChange")}')
  })

  test('$event-bearing remote onChange remains immediate because SyntheticEvent is not delay-safe', () => {
    const eventBearingGet: IREventHandler = {
      kind: 'apiCall',
      method: 'GET',
      url: {
        kind: 'template',
        quasis: ['https://example.test/search?q=', ''],
        expressions: [{ kind: 'ident', name: '$event' }]
      },
      body: undefined,
      docStateName: 'results'
    }
    const tree = treeWithClick(eventBearingGet)
    const input = tree.children[0]
    if (input.kind !== 'element') throw new Error('expected element fixture')
    input.tag = 'input'
    input.attrs = { type: 'text' }
    input.children = []
    input.events = { onChange: [eventBearingGet] }
    const out = buildAppTsx(tree)
    expect(out).not.toContain('__opDebounceChange')
    expect(out).toContain('onChange={async (e) => { const $event = e;')
  })

  test('mutation onChange is never trailing-debounced or replayed', () => {
    const tree = treeWithClick(mutation)
    const input = tree.children[0]
    if (input.kind !== 'element') throw new Error('expected element fixture')
    input.tag = 'input'
    input.attrs = { type: 'checkbox' }
    input.children = []
    input.events = { onChange: [mutation] }
    const out = buildAppTsx(tree)
    expect(out).not.toContain('__opDebounceChange')
    expect(out).toContain('onChange={async (e) => { const $event = e;')
  })
})
