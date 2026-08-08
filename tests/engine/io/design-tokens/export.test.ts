import { describe, expect, test } from 'bun:test'

import { exportDesignTokens } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('exportDesignTokens', () => {
  test('exports deterministic published token metadata, modes, colors, and aliases', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Theme')
    graph.addMode(collection.id, 'dark-mode', 'Dark')
    const primary = graph.createVariable('color/primary', 'COLOR', collection.id, {
      r: 1,
      g: 0,
      b: 0,
      a: 1
    })
    primary.description = 'Brand color'
    primary.valuesByMode['dark-mode'] = { r: 0, g: 0, b: 0, a: 1 }
    const alias = graph.createVariable('color/action', 'COLOR', collection.id, {
      aliasId: primary.id
    })
    alias.valuesByMode['dark-mode'] = { aliasId: primary.id }
    const hidden = graph.createVariable('internal/secret', 'STRING', collection.id, 'private')
    hidden.hiddenFromPublishing = true

    const first = exportDesignTokens(graph)
    const second = exportDesignTokens(graph)
    const payload = JSON.parse(first.text)

    expect(second.text).toBe(first.text)
    expect(first.stats).toEqual({ collectionCount: 1, modeCount: 2, tokenCount: 2 })
    expect(payload.collections[0].tokens).toHaveLength(2)
    expect(first.text).not.toContain('internal/secret')
    expect(first.text).toContain('Brand color')
    expect(first.text).toContain('#ff0000')
    expect(first.text).toContain(`"$alias": "${primary.id}"`)
  })

  test('fails closed for aliases to hidden or missing tokens', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Theme')
    const hidden = graph.createVariable('hidden', 'FLOAT', collection.id, 4)
    hidden.hiddenFromPublishing = true
    graph.createVariable('alias', 'FLOAT', collection.id, { aliasId: hidden.id })

    expect(() => exportDesignTokens(graph)).toThrow('hidden or missing token')
  })

  test('detects alias cycles before serializing', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Theme')
    const first = graph.createVariable('first', 'FLOAT', collection.id, 1)
    const second = graph.createVariable('second', 'FLOAT', collection.id, { aliasId: first.id })
    first.valuesByMode[collection.defaultModeId] = { aliasId: second.id }

    expect(() => exportDesignTokens(graph)).toThrow('alias cycle')
  })

  test('fails closed for malformed collection membership and modes', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Theme')
    const variable = graph.createVariable('published', 'STRING', collection.id, 'value')
    collection.variableIds = []
    expect(() => exportDesignTokens(graph)).toThrow('not in its collection')

    collection.variableIds = [variable.id]
    collection.defaultModeId = 'missing-mode'
    expect(() => exportDesignTokens(graph)).toThrow('invalid default mode')
  })

  test('validates deep alias chains without recursive stack growth', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Theme')
    const variables = Array.from({ length: 2_000 }, (_, index) =>
      graph.createVariable(`token-${index}`, 'FLOAT', collection.id, index)
    )
    for (let index = 0; index < variables.length - 1; index++) {
      variables[index].valuesByMode[collection.defaultModeId] = {
        aliasId: variables[index + 1].id
      }
    }

    expect(() => exportDesignTokens(graph)).not.toThrow()
  })

  test('rejects oversized string input before building the complete payload', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Theme')
    graph.createVariable('oversized', 'STRING', collection.id, 'x'.repeat(4 * 1024 * 1024))

    expect(() => exportDesignTokens(graph)).toThrow('may not exceed 4194304 bytes')
  })

  test('rejects unexpected mode values and aliases across token types', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Theme')
    const number = graph.createVariable('number', 'FLOAT', collection.id, 1)
    const text = graph.createVariable('text', 'STRING', collection.id, { aliasId: number.id })

    expect(() => exportDesignTokens(graph)).toThrow('alias type mismatch')

    text.valuesByMode[collection.defaultModeId] = 'safe'
    text.valuesByMode['unexpected-mode'] = 'unsafe'
    expect(() => exportDesignTokens(graph)).toThrow('unexpected mode value')
  })

  test('caps collection references before allocating a duplicate-id set', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Theme')
    const variable = graph.createVariable('token', 'FLOAT', collection.id, 1)
    collection.variableIds = Array.from({ length: 20_001 }, () => variable.id)

    expect(() => exportDesignTokens(graph)).toThrow('more than 20000 token references')
  })
})
