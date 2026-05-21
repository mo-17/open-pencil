import { describe, expect, test } from 'bun:test'

import { buildAppTsx } from '@open-pencil/compiler/adapters/react/scaffold'
import type { IRTree } from '@open-pencil/compiler/ir/types'

const empty: IRTree = {
  pageId: 'p1',
  pageName: 'Test',
  children: [],
  states: [],
  docStates: [],
  docStateRefs: [],
  warnings: []
}

describe('buildAppTsx (React adapter scaffold)', () => {
  test('empty IR → returns stateless wrapper with relative min-h-screen', () => {
    const out = buildAppTsx(empty)
    expect(out).toContain('export default function App()')
    expect(out).toContain('return <div className="relative min-h-screen"></div>')
  })

  test('renders children inside a wrapping <div> with relative min-h-screen', () => {
    const tree: IRTree = {
      pageId: 'p1',
      pageName: 'Test',
      states: [],
      docStates: [],
      docStateRefs: [],
      warnings: [],
      children: [
        {
          kind: 'element',
          sourceId: 'btn1',
          tag: 'button',
          className: 'bg-blue-500',
          attrs: { type: 'button' },
          children: [{ kind: 'text', value: 'OK' }]
        }
      ]
    }
    const out = buildAppTsx(tree)
    expect(out).toContain('<button className="bg-blue-500" type="button">OK</button>')
    expect(out).toMatch(/return \(\s*<div className="relative min-h-screen">/)
  })
})
