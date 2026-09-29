import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectKitImports } from '@open-pencil/compiler/adapters/react/ui-kit/registry'
import { shadcnAdapter } from '@open-pencil/compiler/adapters/react/ui-kit/shadcn'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'

import { autocompleteGraph } from '#tests/helpers/compiler/components/autocomplete/model'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test('shadcn emits Input only for ordinary inputs alongside enhanced autocomplete', () => {
  const { graph, pageId, form } = autocompleteGraph()
  function output() {
    return compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target: 'react', router: 'none', uiKit: 'shadcn', devMode: false })
    })
  }
  const enhanced = output()
  expect(enhanced.warnings).toEqual([])
  expect(
    collectKitImports(collectTree(graph, pageId).children, shadcnAdapter).some(
      (mapping) => mapping.component === 'Input'
    )
  ).toBe(false)
  expect(enhanced.files.has('src/components/ui/input.tsx')).toBe(false)
  expect(enhanced.files.has('src/components/_open-pencil-autocomplete.tsx')).toBe(true)
  graph.createNode('INPUT', form.id, {
    width: 240,
    height: 44,
    interactiveProps: { ariaLabel: 'Ordinary input' }
  })
  const mixed = output()
  expect(
    collectKitImports(collectTree(graph, pageId).children, shadcnAdapter).some(
      (mapping) => mapping.component === 'Input'
    )
  ).toBe(true)
  expect(mixed.files.has('src/components/ui/input.tsx')).toBe(true)
  typeCheckCompilerFiles(
    new Map(
      [...mixed.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    'react'
  )
}, 35000)
