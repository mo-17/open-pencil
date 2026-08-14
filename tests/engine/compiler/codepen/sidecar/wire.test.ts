import { describe, expect, test } from 'bun:test'

import {
  CODEPEN_SIDECAR_LIMITS,
  CODEPEN_SIDECAR_PROTOCOL_VERSION,
  parseCodePenSidecarResponse,
  serializeCodePenSidecarRequest
} from '@open-pencil/compiler/codepen/sidecar-wire'

describe('CodePen sidecar browser wire', () => {
  test('serializes exact protocol JSON without transport framing', () => {
    const serialized = serializeCodePenSidecarRequest({
      requestId: 'wire-1',
      target: 'react',
      packageName: 'wire-demo',
      files: new Map([
        ['package.json', '{"name":"wire-demo"}'],
        ['src/asset.bin', new Uint8Array([0, 1, 255])]
      ]),
      options: { title: 'Wire demo' }
    })
    expect(serialized).not.toContain('\n')
    const parsed = JSON.parse(serialized)
    expect(parsed.files).toContainEqual({
      path: 'src/asset.bin',
      kind: 'base64',
      content: 'AAH/'
    })
  })

  test('parses the single-data success shape and binds request identity', () => {
    const response = parseCodePenSidecarResponse(
      JSON.stringify({
        version: CODEPEN_SIDECAR_PROTOCOL_VERSION,
        requestId: 'wire-2',
        ok: true,
        result: {
          target: 'vue',
          packageName: 'wire-vue',
          data: {
            html: '<div id="app"></div>',
            html_pre_processor: 'none',
            css: '',
            css_pre_processor: 'none',
            js: 'console.log(1)',
            js_pre_processor: 'none'
          },
          diagnostics: [],
          compatible: true
        }
      }),
      'wire-2'
    )
    expect(response.ok && response.result.data.html).toContain('id="app"')
    expect(() =>
      parseCodePenSidecarResponse(JSON.stringify(response), 'different-request')
    ).toThrow('requestId')
  })

  test('rejects unknown response fields and repeated pane payloads', () => {
    expect(() =>
      parseCodePenSidecarResponse(
        JSON.stringify({
          version: 1,
          requestId: 'wire-3',
          ok: true,
          result: {
            target: 'react',
            packageName: 'wire-react',
            data: {
              html: '',
              html_pre_processor: 'none',
              css: '',
              css_pre_processor: 'none',
              js: '',
              js_pre_processor: 'none'
            },
            payload: '{}',
            diagnostics: [],
            compatible: true
          }
        })
      )
    ).toThrow('unsupported field')
  })

  test('rejects an oversized stdout frame before parsing it', () => {
    expect(() =>
      parseCodePenSidecarResponse(' '.repeat(CODEPEN_SIDECAR_LIMITS.maxOutputBytes + 1))
    ).toThrow('byte limit')
  })

  test('enforces UTF-8 pane and metadata bounds and full project identity', () => {
    const response = {
      version: 1,
      requestId: 'wire-bounds',
      ok: true,
      result: {
        target: 'react',
        packageName: 'wire-bounds',
        data: {
          title: '界'.repeat(86),
          html: '',
          html_pre_processor: 'none',
          css: '',
          css_pre_processor: 'none',
          js: '',
          js_pre_processor: 'none'
        },
        diagnostics: [],
        compatible: true
      }
    }
    expect(() => parseCodePenSidecarResponse(JSON.stringify(response))).toThrow('byte limit')
    response.result.data.title = 'bounded'
    Object.assign(response.result.data, { tags: ['one', 'two', 'three', 'four', 'five', 'six'] })
    expect(() => parseCodePenSidecarResponse(JSON.stringify(response))).toThrow('tags')
    Reflect.deleteProperty(response.result.data, 'tags')
    expect(() =>
      parseCodePenSidecarResponse(JSON.stringify(response), {
        requestId: 'wire-bounds',
        target: 'vue',
        packageName: 'wire-bounds'
      })
    ).toThrow('identity')
    response.result.data.html = '界'.repeat(333_334)
    expect(() => parseCodePenSidecarResponse(JSON.stringify(response))).toThrow('byte limit')
  })
})
