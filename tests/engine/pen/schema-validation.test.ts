import { describe, expect, test } from 'bun:test'

import { parsePenFile } from '@open-pencil/pen'

describe('.pen schema validation', () => {
  test('treats descendant overrides with id but no type as property overrides', () => {
    const source = JSON.stringify({
      version: '2.14',
      children: [
        {
          id: 'component',
          type: 'frame',
          reusable: true,
          children: [{ id: 'label', type: 'text', content: 'Original' }]
        },
        {
          id: 'instance',
          type: 'ref',
          ref: 'component',
          descendants: {
            label: { id: 'label-alias', content: 'Override' }
          }
        }
      ]
    })

    expect(() => parsePenFile(source)).not.toThrow()
    expect(parsePenFile(source).getNode('instance')).toBeDefined()
  })
})
