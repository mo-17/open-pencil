import { describe, expect, test } from 'bun:test'

import {
  buildCodePenSidecarRequest,
  CODEPEN_REVIEW_NOTICE_LIMIT,
  codePenReviewNotices,
  codePenTags,
  defaultCodePenTitle,
  parseCodePenSidecarResult
} from '@/app/lowcode/preview-pane/codepen-showcase/command'
import { CodePenShowcaseSidecarError } from '@/app/lowcode/preview-pane/codepen-showcase/errors'

function response(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    requestId: 'request:1',
    ok: true,
    result: {
      compatible: true,
      target: 'react',
      packageName: 'showcase',
      data: {
        title: 'Showcase',
        html: '<div id="root"></div>',
        html_pre_processor: 'none',
        css: 'body{margin:0}',
        css_pre_processor: 'none',
        js: 'document.body.dataset.ready="true"',
        js_pre_processor: 'none'
      },
      diagnostics: []
    },
    ...overrides
  })
}

describe('CodePen showcase sidecar command contract', () => {
  test('serializes VFS into one unframed request for the runner transport', () => {
    const serialized = buildCodePenSidecarRequest(
      {
        target: 'react',
        packageName: 'demo',
        title: ' Demo ',
        description: ' A showcase ',
        tags: ['openpencil', 'ui'],
        private: true,
        layout: 'right',
        uiKit: 'shadcn',
        i18n: true,
        locales: ['fr', 'ar']
      },
      new Map([
        ['src/main.tsx', 'export {}'],
        ['src/image.bin', new Uint8Array([1, 2, 3])]
      ]),
      'request:1'
    )

    expect(serialized.includes('\n')).toBe(false)
    const request = JSON.parse(serialized)
    expect(request).toMatchObject({
      version: 1,
      requestId: 'request:1',
      target: 'react',
      packageName: 'demo',
      options: {
        title: 'Demo',
        description: 'A showcase',
        tags: ['openpencil', 'ui'],
        private: true,
        layout: 'right'
      }
    })
    expect(request.options).not.toHaveProperty('uiKit')
    expect(request.files).toEqual([
      { path: 'src/image.bin', kind: 'base64', content: 'AQID' },
      { path: 'src/main.tsx', kind: 'text', content: 'export {}' }
    ])
  })

  test('normalizes title and tags without adding inferred content', () => {
    expect(defaultCodePenTitle('  My canvas  ')).toBe('My canvas')
    expect(defaultCodePenTitle('   ')).toBe('OpenPencil Showcase')
    expect(codePenTags(' ui, openpencil, , demo ')).toEqual(['ui', 'openpencil', 'demo'])
    expect(codePenTags('1,2,3,4,5,6')).toEqual(['1', '2', '3', '4', '5'])
  })

  test('parses the strict success response and binds it to the request id', () => {
    expect(
      parseCodePenSidecarResult(response(), 'request:1', {
        target: 'react',
        packageName: 'showcase'
      })
    ).toEqual({
      compatible: true,
      target: 'react',
      packageName: 'showcase',
      data: {
        title: 'Showcase',
        html: '<div id="root"></div>',
        html_pre_processor: 'none',
        css: 'body{margin:0}',
        css_pre_processor: 'none',
        js: 'document.body.dataset.ready="true"',
        js_pre_processor: 'none'
      },
      diagnostics: []
    })
    expect(() =>
      parseCodePenSidecarResult(response(), 'request:other', {
        target: 'react',
        packageName: 'showcase'
      })
    ).toThrow('requestId does not match')
    expect(() =>
      parseCodePenSidecarResult(response(), 'request:1', {
        target: 'vue',
        packageName: 'showcase'
      })
    ).toThrow('identity does not match')
  })

  test('surfaces the bounded sidecar error message and rejects unknown output fields', () => {
    let sidecarError: unknown
    try {
      parseCodePenSidecarResult(
        response({
          ok: false,
          result: undefined,
          error: {
            code: 'source-incompatible',
            message: 'This project cannot be shown safely.',
            diagnostics: [
              {
                code: 'unsafe-stylesheet-url',
                severity: 'error',
                message: 'A stylesheet URL is unsafe.'
              }
            ]
          }
        }),
        'request:1',
        { target: 'react', packageName: 'showcase' }
      )
    } catch (error) {
      sidecarError = error
    }
    expect(sidecarError).toBeInstanceOf(CodePenShowcaseSidecarError)
    expect(sidecarError).toMatchObject({
      code: 'source-incompatible',
      message: 'This project cannot be shown safely.',
      diagnostics: [
        {
          code: 'unsafe-stylesheet-url',
          severity: 'error',
          message: 'A stylesheet URL is unsafe.'
        }
      ]
    })

    const unknown = JSON.parse(response())
    unknown.result.data.endpoint = 'https://evil.test'
    expect(() =>
      parseCodePenSidecarResult(JSON.stringify(unknown), 'request:1', {
        target: 'react',
        packageName: 'showcase'
      })
    ).toThrow('unsupported field')
  })

  test('truncates generated CJK metadata on UTF-8 boundaries', () => {
    expect(defaultCodePenTitle('界'.repeat(100))).toBe('界'.repeat(85))
    expect(codePenTags('界'.repeat(30))).toEqual(['界'.repeat(21)])
  })

  test('bounds review notices and exposes only code and message', () => {
    const notices = Array.from({ length: CODEPEN_REVIEW_NOTICE_LIMIT + 2 }, (_, index) => ({
      code: `warning-${index}`,
      message: `Warning ${index}`,
      nodeId: `private-node-${index}`,
      path: `src/private-${index}.tsx`
    }))

    const visible = codePenReviewNotices(notices)

    expect(visible).toHaveLength(CODEPEN_REVIEW_NOTICE_LIMIT)
    expect(visible[0]).toEqual({ code: 'warning-0', message: 'Warning 0' })
    expect(visible[0]).not.toHaveProperty('nodeId')
    expect(visible[0]).not.toHaveProperty('path')
  })
})
