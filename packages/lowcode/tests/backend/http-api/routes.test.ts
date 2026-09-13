import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { httpApplication, httpResource } from './fixtures'

describe('Backend HTTP API method and path authority', () => {
  test('rejects overlapping methods for identical resource paths', () => {
    const application = httpApplication()
    application.httpApi.resources = [
      httpResource('first', '/api/notes', ['list']),
      httpResource('second', '/api/notes', ['list'])
    ]
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })

  test('rejects static collection paths overlapping another resource item GET, including case', () => {
    for (const childPath of ['/api/notes/new', '/API/NOTES/new']) {
      const application = httpApplication()
      application.httpApi.resources = [
        httpResource('item-read', '/api/notes', ['read']),
        httpResource('static-list', childPath, ['list'])
      ]
      expect(parseBackendApplicationSpecV1(application).ok, childPath).toBe(false)
      application.httpApi.resources.reverse()
      expect(parseBackendApplicationSpecV1(application).ok, childPath).toBe(false)
    }
  })

  test('retains distinct methods and nonoverlapping static segments', () => {
    for (const resources of [
      [
        httpResource('list', '/api/notes', ['list']),
        httpResource('create', '/api/notes', ['create'])
      ],
      [
        httpResource('read', '/api/notes', ['read']),
        httpResource('create', '/api/notes/new', ['create'])
      ],
      [httpResource('note', '/api/note', ['read']), httpResource('notes', '/api/notes', ['read'])]
    ]) {
      const application = httpApplication()
      application.httpApi.resources = resources
      expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    }
  })

  test('rejects dynamic, encoded, ambiguous and absolute paths', () => {
    for (const path of [
      '/',
      'notes',
      '/api/notes/',
      '/api//notes',
      '/api/./notes',
      '/api/../notes',
      '/api/:id',
      '/api/*',
      '/api/%6eotes',
      '/api/notes?all=1',
      '/api/notes#fragment',
      '/api/notes\\extra',
      '/api/notes\n',
      'https://example.invalid/notes'
    ]) {
      const application = httpApplication()
      application.httpApi.resources[0].path = path
      expect(parseBackendApplicationSpecV1(application).ok, JSON.stringify(path)).toBe(false)
    }
  })

  test('rejects duplicate resource identities even when routes are distinct', () => {
    const application = httpApplication()
    application.httpApi.resources = [
      httpResource('duplicate', '/api/notes'),
      httpResource('duplicate', '/api/other-notes')
    ]
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
})
