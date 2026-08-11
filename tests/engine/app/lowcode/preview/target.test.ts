import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import {
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
})
