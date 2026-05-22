import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef } from '@open-pencil/core/scene-graph'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  emitExpression,
  hasPrevReference,
  parseTemplate,
  substitutePrev
} from '@open-pencil/compiler/ir/expression'

/**
 * Phase 2 §4 step 4 — cross-walker regression (经验 A).
 *
 * `template` is a new `ExprAst` kind. The four ExprAst walkers
 * (`emitWithPrec`, `collectReferences`, `hasPrevReference`,
 * `substitutePrev`) all have a `default` branch, so a missing `template`
 * case would NOT be a tsgo error — it would silently drop the
 * interpolations. This file pins that every walker descends into a
 * template, and that an `${}` URL + docState-in-expr survive a full
 * compile end-to-end.
 */
describe('cross-walker — template AST through every ExprAst walker', () => {
  test('parseTemplate.references collects identifiers from every interpolation', () => {
    const r = parseTemplate('a${x}b${y.z}')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect([...r.references].sort()).toEqual(['x', 'y'])
  })

  test('emitExpression descends into a template (no dropped interpolations)', () => {
    const r = parseTemplate('https://x.test/${a}/${b}')
    if (!r.ok) throw new Error(r.error)
    expect(emitExpression(r.ast)).toBe('`https://x.test/${a}/${b}`')
  })

  test('hasPrevReference descends into template interpolations', () => {
    const withPrev = parseTemplate('x${$prev}')
    const without = parseTemplate('x${count}')
    if (!withPrev.ok || !without.ok) throw new Error('parse failed')
    expect(hasPrevReference(withPrev.ast)).toBe(true)
    expect(hasPrevReference(without.ast)).toBe(false)
  })

  test('substitutePrev rewrites $prev inside a template interpolation', () => {
    const r = parseTemplate('x${$prev + 1}')
    if (!r.ok) throw new Error(r.error)
    const rewritten = substitutePrev(r.ast, 'prev')
    expect(emitExpression(rewritten)).toBe('`x${prev + 1}`')
    // Input AST is not mutated.
    expect(emitExpression(r.ast)).toBe('`x${$prev + 1}`')
  })
})

describe('cross-walker — ${} URL + docState-in-expr survive a full compile', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('templated apiCall URL, expr binding and renderCondition all emit', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd-uid', name: 'userId', type: 'number', defaultValue: 1 },
        { id: 'd-user', name: 'user', type: 'object', defaultValue: {} }
      ]
    })
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { name: 'Home' })

    const onClick: ActionDef[] = [
      {
        id: 'a-api',
        kind: 'apiCall',
        method: 'GET',
        url: 'https://x.test/users/${userId}',
        targetName: 'user'
      }
    ]
    graph.createNode('BUTTON', page.id, {
      interactiveProps: { text: 'Load' },
      events: { onClick }
    })
    // docState referenced inside a kind:'expr' text binding.
    graph.createNode('TEXT', page.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr: 'user.name' } }
    })
    // docState referenced inside a renderCondition.
    graph.createNode('FRAME', page.id, { name: 'Gate', renderCondition: 'userId > 0' })

    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cross-walker-template' })
    })
    const app = out.files.get('src/App.tsx') as string

    // §4 — URL template emits as a backtick template.
    expect(app).toContain('await fetch(`https://x.test/users/${userId}`)')
    // docState-in-expr text binding + renderCondition emit.
    expect(app).toContain('{user.name}')
    expect(app).toContain('(userId > 0) &&')
    // Every read docState gets a useDocState local; the url template read
    // (`userId`), the expr binding read (`user`) and the condition read
    // (`userId`) all register.
    expect(app).toContain('useDocState("userId")')
    expect(app).toContain('useDocState("user")')
    expect(out.warnings).toEqual([])
  })
})
