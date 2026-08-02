import { describe, expect, test } from 'bun:test'

import { deserializePreviewFiles, serializePreviewFiles } from '@open-pencil/compiler'
import { classifyUpdate, diffPreviewFiles } from '@open-pencil/compiler/dev-server'

function transport(files: Map<string, string | Uint8Array>) {
  return deserializePreviewFiles(serializePreviewFiles(files))
}

describe('preview dev-server file diff', () => {
  test('treats an unchanged retransmitted binary font as a no-op', () => {
    const files = new Map<string, string | Uint8Array>([
      ['src/main.tsx', 'export default 1'],
      ['src/assets/fonts/test.woff2', new Uint8Array([0, 255, 17, 42])]
    ])
    const previous = transport(files)
    const next = transport(files)

    expect(previous.get('src/assets/fonts/test.woff2')).not.toBe(
      next.get('src/assets/fonts/test.woff2')
    )
    const diff = diffPreviewFiles(previous, next)
    expect(diff).toEqual({ changed: [], topologyChanged: false })
    expect(classifyUpdate(diff.changed, 0, diff.topologyChanged)).toBe('noop')
  })

  test('detects a binary byte change without reporting a topology change', () => {
    const previous = transport(
      new Map([['src/assets/fonts/test.woff2', new Uint8Array([0, 1, 2, 3])]])
    )
    const next = transport(new Map([['src/assets/fonts/test.woff2', new Uint8Array([0, 1, 9, 3])]]))

    expect(diffPreviewFiles(previous, next)).toEqual({
      changed: ['src/assets/fonts/test.woff2'],
      topologyChanged: false
    })
  })

  test('keeps full-snapshot deletion detection intact', () => {
    const previous = transport(
      new Map<string, string | Uint8Array>([
        ['src/main.tsx', 'export default 1'],
        ['src/assets/fonts/test.woff2', new Uint8Array([0, 1, 2, 3])]
      ])
    )
    const next = transport(new Map([['src/main.tsx', 'export default 1']]))

    expect(diffPreviewFiles(previous, next)).toEqual({
      changed: ['src/assets/fonts/test.woff2'],
      topologyChanged: true
    })
  })
})
