import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import {
  parsePreviewSidecarReady,
  previewCompilerOverrides,
  previewSidecarCommandArgs
} from '@/app/lowcode/preview-pane/use-compile-on-change'

function settings(target: 'react' | 'vue') {
  return {
    target: ref(target),
    uiKit: ref<'none' | 'shadcn'>('shadcn'),
    i18nEnabled: ref(true),
    localesInput: ref('ar, fr')
  }
}

describe('compiler preview target controller', () => {
  test('passes React-only preview features to the React compiler', () => {
    expect(previewCompilerOverrides(settings('react'), 2)).toEqual({
      target: 'react',
      router: 'react-router-v6',
      uiKit: 'shadcn',
      i18n: true,
      locales: ['ar', 'fr']
    })
  })

  test('fails closed by omitting incompatible features from Vue compiler input', () => {
    expect(previewCompilerOverrides(settings('vue'), 2)).toEqual({
      target: 'vue',
      router: 'vue-router-v4',
      i18n: false
    })
  })

  test('keeps the single-page preview router-free for both targets', () => {
    expect(previewCompilerOverrides(settings('react')).router).toBe('none')
    expect(previewCompilerOverrides(settings('vue')).router).toBe('none')
  })

  test('pins the immutable sidecar process to the selected framework', () => {
    expect(previewSidecarCommandArgs('/repo', 'react')).toEqual([
      'packages/compiler/src/dev-server.ts',
      '--root',
      '/repo',
      '--target',
      'react'
    ])
    expect(previewSidecarCommandArgs('/repo', 'vue')).toEqual([
      'packages/compiler/src/dev-server.ts',
      '--root',
      '/repo',
      '--target',
      'vue'
    ])
  })

  test('accepts only a canonical loopback ready origin with the declared port', () => {
    expect(
      parsePreviewSidecarReady({
        type: 'ready',
        url: 'http://127.0.0.1:60140/',
        port: 60140
      })
    ).toEqual({ url: 'http://127.0.0.1:60140/', port: 60140 })

    for (const value of [
      { type: 'ready', url: 'https://127.0.0.1:60140/', port: 60140 },
      { type: 'ready', url: 'http://example.com:60140/', port: 60140 },
      { type: 'ready', url: 'http://127.0.0.1:60141/', port: 60140 },
      { type: 'ready', url: 'http://user@127.0.0.1:60140/', port: 60140 },
      { type: 'ready', url: 'http://127.0.0.1:60140/?token=x', port: 60140 },
      { type: 'ready', url: 'http://127.0.0.1:60140/#preview', port: 60140 },
      { type: 'ready', url: 'http://127.0.0.1:60140/app', port: 60140 },
      { type: 'ready', url: 'http://127.0.0.1:60140/', port: 60140, extra: true }
    ]) {
      expect(() => parsePreviewSidecarReady(value)).toThrow()
    }
  })
})
