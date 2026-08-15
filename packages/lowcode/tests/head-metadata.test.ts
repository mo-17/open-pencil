import { describe, expect, test } from 'bun:test'

import { compactLowcodeHeadMetadata } from '@open-pencil/lowcode'

describe('compactLowcodeHeadMetadata', () => {
  test('normalizes safe entries and drops empty or unsafe metadata', () => {
    expect(
      compactLowcodeHeadMetadata({
        meta: [
          { kind: 'name', key: ' description ', content: ' Hello ' },
          { kind: 'httpEquiv', key: ' refresh ', content: '0; url=javascript:alert(1)' },
          { kind: 'property', key: ' ', content: 'ignored' }
        ],
        link: [
          {
            rel: ' preload ',
            href: ' /app.css ',
            as: ' style ',
            type: ' text/css ',
            media: ' screen ',
            crossorigin: 'anonymous'
          },
          { rel: 'stylesheet', href: ['javascript', 'alert(1)'].join(':') },
          { rel: ' ', href: '/ignored.css' }
        ],
        styles: [' body { color: red; } ', '.x { background: url(javascript:alert(1)); }', ' ']
      })
    ).toEqual({
      meta: [{ kind: 'name', key: 'description', content: 'Hello' }],
      link: [
        {
          rel: 'preload',
          href: '/app.css',
          as: 'style',
          type: 'text/css',
          media: 'screen',
          crossorigin: 'anonymous'
        }
      ],
      styles: ['body { color: red; }']
    })
  })

  test('returns undefined when no usable metadata remains', () => {
    expect(compactLowcodeHeadMetadata(undefined)).toBeUndefined()
    expect(compactLowcodeHeadMetadata({ meta: [], link: [], styles: [' '] })).toBeUndefined()
  })
})
