import { describe, expect, test } from 'bun:test'

import { substituteHandler } from '#compiler/ir/collect/substitute'

import { emitExpression, parseExpression, type ExprAst } from '@open-pencil/lowcode'

import { browserApplication, browserGraph, compileBrowser, setSubmit } from './helpers'

function queryApplication() {
  const application = browserApplication()
  if (!application.httpApi) throw new Error('Missing test API')
  application.httpApi.resources[0].query = {
    filterFields: ['title'],
    searchFields: ['title'],
    sortFields: ['id']
  }
  return application
}
function expression(value: string): ExprAst {
  const parsed = parseExpression(value)
  if (!parsed.ok) throw new Error('Invalid test expression')
  return parsed.ast
}

describe('Backend list query expression compilation', () => {
  test.each(['react', 'vue'] as const)(
    'omits empty AI-authored filters from %s LIST and action requests',
    (target) => {
      const fixture = browserGraph()
      fixture.graph.updateNode(fixture.list.id, {
        interactiveProps: {
          ...fixture.list.interactiveProps,
          dataSourceRef: {
            kind: 'backendResource',
            resourceId: 'notes-api',
            filterEntries: []
          }
        }
      })
      setSubmit(fixture, {
        id: 'empty-query',
        kind: 'backendRequest',
        operation: 'list',
        resourceId: 'notes-api',
        filterEntries: []
      })
      const output = compileBrowser(target, fixture, queryApplication())
      const source = [...output.files]
        .filter(([path]) => /src\/pages\//.test(path))
        .map(([, content]) => String(content))
        .join('\n')
      expect(source).toContain('watchBackendResource')
      expect(source).toContain('backendRequest')
      expect(source).not.toContain('filter:')
    }
  )

  test.each(['react', 'vue'] as const)(
    'emits %s list and action queries with reactive state dependencies',
    (target) => {
      const fixture = browserGraph()
      fixture.graph.updateNode(fixture.notes.id, {
        state: [{ id: 'search', name: 'search', type: 'string', defaultValue: '' }]
      })
      const query = {
        filterEntries: [{ key: 'title', valueExpr: 'title' }],
        searchExpr: 'search',
        sortField: 'id',
        sortDirection: 'desc' as const
      }
      fixture.graph.updateNode(fixture.list.id, {
        interactiveProps: {
          ...fixture.list.interactiveProps,
          dataSourceRef: { kind: 'backendResource', resourceId: 'notes-api', ...query }
        }
      })
      setSubmit(fixture, {
        id: 'query',
        kind: 'backendRequest',
        operation: 'list',
        resourceId: 'notes-api',
        ...query
      })
      const output = compileBrowser(target, fixture, queryApplication())
      const source = [...output.files]
        .filter(([path]) => /src\/pages\//.test(path))
        .map(([, content]) => String(content))
        .join('\n')
      expect(source).toContain('createBackendQueryState')
      expect(source).toContain('filter: { "title":')
      expect(source).toContain('q: String(')
      expect(source).toContain('sort: "id"')
      expect(source).toContain('direction: "desc"')
      if (target === 'react') expect(source).toContain('), [search, title])')
      else {
        expect(source).toMatch(/"title": __opDoc_title_\w+\.value/u)
        expect(source).toMatch(/q: String\(__opState_search_\w+\.value\)/u)
      }
      expect(
        output.warnings.filter((warning) => /backend|binding|scope/u.test(warning.code))
      ).toEqual([])
    }
  )

  test('rejects unknown filter and search identifiers instead of emitting broken JavaScript', () => {
    for (const query of [
      { filterEntries: [{ key: 'title', valueExpr: 'unknownFilter' }] },
      { searchExpr: 'unknownSearch' }
    ]) {
      const fixture = browserGraph()
      fixture.graph.updateNode(fixture.list.id, {
        interactiveProps: {
          ...fixture.list.interactiveProps,
          dataSourceRef: { kind: 'backendResource', resourceId: 'notes-api', ...query }
        }
      })
      expect(() => compileBrowser('react', fixture, queryApplication())).toThrow(
        'backend-client-binding-invalid'
      )
    }
  })

  test('substitutes workflow arguments inside filters and search and recomputes references', () => {
    const handler = substituteHandler(
      {
        kind: 'backendRequest',
        resourceId: 'notes-api',
        operation: 'list',
        filterEntries: [{ key: 'title', ast: expression('parameter'), references: ['parameter'] }],
        searchAst: expression('parameter')
      },
      new Map([['parameter', expression('title')]])
    )
    if (handler.kind !== 'backendRequest') throw new Error('Unexpected substituted handler')
    expect(handler.filterEntries?.[0].references).toEqual(['title'])
    expect(handler.filterEntries?.[0].ast).toEqual(expression('title'))
    expect(handler.searchAst && emitExpression(handler.searchAst)).toBe('title')
  })
})
