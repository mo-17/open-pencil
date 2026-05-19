import { describe, expect, test } from 'bun:test'

import { buildAppTsx } from '@open-pencil/compiler/adapters/react/scaffold'
import type { IRTree } from '@open-pencil/compiler/ir/types'

const empty: IRTree = {
  pageId: 'p1',
  pageName: 'Test',
  children: [],
  states: [],
  warnings: []
}

describe('buildAppTsx (React adapter scaffold)', () => {
  test('empty IR → returns stateless <div />', () => {
    const out = buildAppTsx(empty)
    expect(out).toContain('export default function App()')
    expect(out).toContain('return <div />')
  })

  test('renders children inside a wrapping <div>', () => {
    const tree: IRTree = {
      pageId: 'p1',
      pageName: 'Test',
      states: [],
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
    expect(out).toMatch(/return \(\s*<div>/)
  })
})
