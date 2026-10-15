import { expect, test } from 'bun:test'

import { shadcnAdapter } from '#compiler/adapters/react/ui-kit/shadcn'
import * as v from 'valibot'

import { previewOptimizeDeps } from '@open-pencil/compiler/dev-server'

import { shadcnControlsFixture } from '#tests/helpers/compiler/components/shadcn-controls'

test('initial preview prebundles the dependencies declared by generated shadcn controls', () => {
  const output = shadcnControlsFixture()
  const manifestSource = output.files.get('package.json')
  if (typeof manifestSource !== 'string') throw new Error('Missing generated package manifest')
  const manifest = v.parse(
    v.pipe(
      v.string(),
      v.parseJson(),
      v.looseObject({ dependencies: v.record(v.string(), v.string()) })
    ),
    manifestSource
  )
  const included = previewOptimizeDeps(output.files)
  expect(included).toContain('@radix-ui/react-switch')
  for (const dependency of Object.keys(manifest.dependencies)) {
    expect(included).toContain(dependency)
  }
  expect(new Set(included).size).toBe(included.length)
})

test('prebundles only registered components and shared helpers without reading arbitrary imports', () => {
  const files = shadcnAdapter.componentFiles(new Set(['Switch']))
  const baseline = previewOptimizeDeps(new Map())
  const included = previewOptimizeDeps(files)
  expect(included.filter((dependency) => !baseline.includes(dependency))).toEqual([
    '@radix-ui/react-switch',
    'clsx',
    'tailwind-merge'
  ])
  expect(included).not.toContain('@radix-ui/react-select')
  files.set('src/components/ui/unreviewed.tsx', "import 'unreviewed-package'")
  files.set('package.json', JSON.stringify({ dependencies: { 'unreviewed-package': '*' } }))
  expect(previewOptimizeDeps(files)).toEqual(included)
  expect(previewOptimizeDeps(files, 'vue')).toEqual(['vue'])
  expect(
    previewOptimizeDeps(shadcnAdapter.sharedFiles()).filter(
      (dependency) => !baseline.includes(dependency)
    )
  ).toEqual(['clsx', 'tailwind-merge'])
})
