import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  importLibraryComponent,
  publishLibraryComponent,
  SceneGraph,
  type LibraryManifest
} from '@open-pencil/scene-graph'

import { libraryPanelRows, parseLibraryManifestText } from '@/app/lowcode/libraries'

const panelSource = [
  '../../../src/app/lowcode/use-libraries-panel.ts',
  '../../../src/components/properties/Lowcode/LibrariesCandidate.vue',
  '../../../src/components/properties/Lowcode/LibrariesImportedList.vue'
]
  .map((file) => readFileSync(resolve(import.meta.dir, file), 'utf8'))
  .join('\n')

test('parseLibraryManifestText validates the manifest shape', () => {
  const manifest = parseLibraryManifestText(
    JSON.stringify({
      libraryId: 'design-system',
      name: 'Design System',
      source: { kind: 'file', ref: 'library.fig' },
      components: [
        {
          key: 'component-card',
          name: 'Card',
          version: 'v1',
          nodeId: '0:1',
          type: 'COMPONENT'
        }
      ]
    })
  )

  expect(manifest.libraryId).toBe('design-system')
  expect(manifest.components[0]?.key).toBe('component-card')
  expect(() => parseLibraryManifestText('{"libraryId":"x"}')).toThrow(
    'manifest.name must be a non-empty string'
  )
})

test('libraryPanelRows reports imported component update status', () => {
  const source = createLibrarySource('Hello')
  const target = new SceneGraph()
  const published = publishLibraryComponent(source.graph, {
    componentId: source.componentId,
    libraryId: 'design-system',
    libraryName: 'Design System',
    componentKey: 'component-card',
    source: { kind: 'file', ref: 'library.fig' }
  })
  if ('error' in published) throw new Error(published.error)
  const imported = importLibraryComponent({
    sourceGraph: source.graph,
    targetGraph: target,
    manifest: published.manifest,
    componentKey: 'component-card'
  })
  if ('error' in imported) throw new Error(imported.error)

  const nextManifest: LibraryManifest = {
    ...published.manifest,
    components: [{ ...firstComponent(published.manifest), version: 'v2' }]
  }

  expect(libraryPanelRows(target)).toMatchObject([
    {
      libraryId: 'design-system',
      componentKey: 'component-card',
      currentVersion: published.component.version,
      status: 'unknown'
    }
  ])
  expect(libraryPanelRows(target, nextManifest)).toMatchObject([
    {
      libraryId: 'design-system',
      componentKey: 'component-card',
      currentVersion: published.component.version,
      latestVersion: 'v2',
      status: 'outdated'
    }
  ])
})

test('LibrariesPanel lists every unimported remote candidate component', () => {
  expect(panelSource).toMatch(
    /candidate\.manifest\.components\.filter\([\s\S]*!isComponentImported\(candidate\.manifest\.libraryId, component\.key\)/
  )
  expect(panelSource).toContain('v-for="component in candidateComponents"')
  expect(panelSource).toContain('data-test-id="lowcode-library-import"')
  expect(panelSource).toContain('@click="importCandidateComponent(component)"')
  expect(panelSource).toContain('parentId: cachePage.id')
})

test('LibrariesPanel scopes remote update checks and candidate status to the selected library', () => {
  expect(panelSource).toMatch(
    /function manifestSourceURL\(libraryId: string\)[\s\S]*\.find\([\s\S]*library\.libraryId === libraryId[\s\S]*\)\?\.manifestSource/
  )
  expect(panelSource).toContain('v-if="manifestSourceURL(row.libraryId)"')
  expect(panelSource).toContain('@click="checkLibrary(row.libraryId)"')
  expect(panelSource).toContain('candidate.manifest.libraryId !== expectedLibraryId')
  expect(panelSource).toContain('row.libraryId !== active.libraryId')
  expect(panelSource).toContain("status: 'unknown' as const")
})

test('LibrariesPanel clears staged candidates when the active document changes', () => {
  expect(panelSource).toContain('useActiveEditorStoreRef()')
  expect(panelSource).toMatch(
    /watch\([\s\S]*activeEditor[\s\S]*cancelActiveOperation\(\)[\s\S]*clearStagedSources\(\)/
  )
})

function createLibrarySource(text: string): { graph: SceneGraph; componentId: string } {
  const graph = new SceneGraph()
  const page = firstPage(graph)
  const component = graph.createNode('COMPONENT', page.id, { name: 'Card', width: 240, height: 80 })
  graph.createNode('TEXT', component.id, {
    name: 'Title',
    text,
    width: 120,
    height: 24
  })
  return { graph, componentId: component.id }
}

function firstPage(graph: SceneGraph) {
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected a default page')
  return page
}

function firstComponent(manifest: LibraryManifest) {
  const component = manifest.components[0]
  if (!component) throw new Error('Expected a manifest component')
  return component
}
