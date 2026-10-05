import { expect, test } from 'bun:test'

import { importNodeChanges } from '@open-pencil/core/kiwi/fig/import'
import { parseFigBuffer } from '@open-pencil/fig'

import { expectDefined } from '#tests/helpers/assert'
import { readFixtureArrayBuffer } from '#tests/helpers/fig/fixtures'
import { heavy } from '#tests/helpers/test-utils'

function importFixture(name: string) {
  const { nodeChanges, blobs, images } = parseFigBuffer(readFixtureArrayBuffer(name))
  // These assertions inspect authored metadata, not the expanded instance trees.
  return importNodeChanges(nodeChanges, blobs, new Map(images), { populate: 'none' })
}

const METADATA_TEST_TIMEOUT_MS = 60_000

heavy('fig component metadata import', () => {
  test(
    'preserves remote library component identity fields',
    () => {
      const graph = importFixture('gold-preview.fig')
      const component = expectDefined(
        Array.from(graph.getAllNodes()).find(
          (node) => node.componentKey === '26164e029c485511adfa634522024c7c23e7bb81'
        ),
        'remote component'
      )

      expect(component.sourceLibraryKey).toStartWith('lk-')
      expect(component.publishId).toBe('4132:5801')
      expect(component.overrideKey).toBe('4132:5801')
      expect(component.sharedSymbolVersion).toBe('4152:1913')
      expect(component.isSymbolPublishable).toBe(false)
    },
    METADATA_TEST_TIMEOUT_MS
  )

  test(
    'imports component set docs and variant property specs',
    () => {
      const graph = importFixture('material3.fig')
      const buttonSet = expectDefined(
        Array.from(graph.getAllNodes()).find(
          (node) => node.type === 'COMPONENT_SET' && node.name === 'Button'
        ),
        'Button component set'
      )

      expect(buttonSet.isPublishable).toBe(true)
      expect(buttonSet.symbolDescription).toContain('Buttons communicate actions')
      expect(buttonSet.symbolLinks.map((link) => link.uri)).toContain(
        'http://m3.material.io/components/buttons/overview'
      )
      expect(buttonSet.componentPropertyDefinitions.map((def) => def.name)).toContain('State')

      const variant = expectDefined(
        graph
          .getChildren(buttonSet.id)
          .find((node) => node.type === 'COMPONENT' && node.name.includes('State=Disabled')),
        'disabled Button variant'
      )
      expect(variant.variantPropSpecs.length).toBeGreaterThan(0)
      expect(variant.componentPropertyValues.State).toBe('Disabled')
      expect(variant.componentPropertyValues.Style).toBe('Tonal')
      expect(Object.keys(variant.componentPropertyValues).some((key) => key.includes(':'))).toBe(
        false
      )
    },
    METADATA_TEST_TIMEOUT_MS
  )
})

test(
  'visible Buttons metadata remains distinct from the authored internal copy',
  async () => {
    const { parseFigFile } = await import('@open-pencil/core')
    const { populateFigPage } = await import('@open-pencil/core/io/formats/fig')
    const graph = await parseFigFile(readFixtureArrayBuffer('material3.fig'), { populate: 'none' })
    const page = graph.getPages().find((page) => page.name === 'Buttons')
    if (!page) throw new Error('Missing visible Buttons page')
    populateFigPage(graph, page.id)
    const buttons = Array.from(graph.getAllNodes()).find((node) => node.source.id === '57994:2227')
    if (!buttons) throw new Error('Missing visible Buttons component set')
    expect(buttons.symbolLinks.map((link) => link.uri)).toContain(
      'https://m3.material.io/components/buttons/overview'
    )
    const variant = graph
      .getChildren(buttons.id)
      .find((node) => node.type === 'COMPONENT' && node.name.includes('State=Disabled'))
    if (!variant) throw new Error('Missing visible disabled Button variant')
    expect(variant.componentPropertyValues.State).toBe('Disabled')
    expect(Object.keys(variant.componentPropertyValues).sort()).toEqual(['Size', 'State', 'Type'])
  },
  METADATA_TEST_TIMEOUT_MS
)
