import { describe, expect, spyOn, test } from 'bun:test'

import { canonicalManifestJSON } from '@open-pencil/scene-graph'

import { prepareBusinessModuleInstallation } from '@/app/lowcode/backend/business/installation'
import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'

import { BOUNDED_BUSINESS_GROUPS } from '../composition/helpers'
import { moduleInstallationFixture } from './helpers'

describe('business module document installation', () => {
  test.each(BOUNDED_BUSINESS_GROUPS)(
    'adds $name with one shared login and account page, preserving authored nodes',
    async ({ kinds }) => {
      const fixture = await moduleInstallationFixture()
      const oldRoot = canonicalManifestJSON(
        fixture.editor.graph.getNode(fixture.editor.graph.rootId)?.pluginData
      )
      const note = fixture.editor.graph.createNode('TEXT', fixture.pages.pageIds[0], {
        name: 'My custom note',
        text: 'Keep my edited design',
        x: 1800,
        y: 1600
      })
      const originalNote = structuredClone(note)
      for (const kind of kinds.slice(1)) {
        const beforeReview = canonicalManifestJSON([...fixture.editor.graph.nodes.values()])
        const prepared = prepareBusinessModuleInstallation({ ...fixture, kind })
        expect(prepared.review.status).toBe('ready')
        expect(canonicalManifestJSON([...fixture.editor.graph.nodes.values()])).toBe(beforeReview)
        const result = prepared.apply()
        expect(result.pageIds.length).toBe(prepared.review.addedPages)
        expect(fixture.editor.graph.getNode(result.entryPageId)?.lowcodeRoutePattern).toBe(
          result.path
        )
        expect(() => prepared.apply()).toThrow('already been applied')
      }
      const application = readBackendProviderDocumentRequest(fixture.editor.graph)?.application
      expect(application?.applicationId).toBe(fixture.application.applicationId)
      expect(application?.httpApi?.browserClient).toEqual(
        fixture.application.httpApi?.browserClient
      )
      expect(application?.modules?.modules.map((module) => module.id)).toEqual(
        expect.arrayContaining([...kinds])
      )
      expect(
        application?.dataModel.entities.filter((entity) => entity.name === 'users')
      ).toHaveLength(1)
      expect(fixture.editor.graph.getNode(note.id)).toEqual(originalNote)
      expect(
        fixture.editor.graph
          .getPages()
          .filter((page) => page.lowcodeRoutePattern === fixture.pages.paths.login)
      ).toHaveLength(1)
      expect(
        fixture.editor.graph
          .getPages()
          .filter((page) => page.lowcodeRoutePattern?.startsWith('/account-setup'))
      ).toHaveLength(1)
      expect(
        canonicalManifestJSON(fixture.editor.graph.getNode(fixture.editor.graph.rootId)?.pluginData)
      ).not.toBe(oldRoot)
    }
  )

  test('undo and redo include the model, new pages and appended navigation', async () => {
    const fixture = await moduleInstallationFixture()
    const before = canonicalManifestJSON([...fixture.editor.graph.nodes.values()])
    const prepared = prepareBusinessModuleInstallation({ ...fixture, kind: 'service-desk' })
    expect(prepared.review.status).toBe('ready')
    prepared.apply()
    const after = canonicalManifestJSON([...fixture.editor.graph.nodes.values()])
    fixture.editor.undo.undo()
    expect(canonicalManifestJSON([...fixture.editor.graph.nodes.values()])).toBe(before)
    fixture.editor.undo.redo()
    expect(canonicalManifestJSON([...fixture.editor.graph.nodes.values()])).toBe(after)
  })

  test('rejects stale reviews and disabled Providers before any mutation', async () => {
    const fixture = await moduleInstallationFixture()
    const prepared = prepareBusinessModuleInstallation({ ...fixture, kind: 'service-desk' })
    fixture.editor.updateNodeWithUndo(fixture.pages.pageIds[0], { name: 'Changed after review' })
    const edited = canonicalManifestJSON([...fixture.editor.graph.nodes.values()])
    expect(() => prepared.apply()).toThrow('changed')
    expect(canonicalManifestJSON([...fixture.editor.graph.nodes.values()])).toBe(edited)
    const current = prepareBusinessModuleInstallation({ ...fixture, kind: 'service-desk' })
    await fixture.store.setEnabled('open-pencil.nestjs-backend', false)
    expect(() => current.apply()).toThrow('Provider')
    expect(canonicalManifestJSON([...fixture.editor.graph.nodes.values()])).toBe(edited)
  })

  test('recognizes an existing standalone module and blocks a duplicate', async () => {
    const fixture = await moduleInstallationFixture()
    const prepared = prepareBusinessModuleInstallation({ ...fixture, kind: 'customer-crm' })
    expect(prepared.review.status).toBe('installed')
    expect(() => prepared.apply()).toThrow('already installed')
  })

  test('rolls back a graph write failure after the Backend declaration is updated', async () => {
    const fixture = await moduleInstallationFixture()
    const prepared = prepareBusinessModuleInstallation({ ...fixture, kind: 'service-desk' })
    expect(prepared.review.status).toBe('ready')
    const before = canonicalManifestJSON([...fixture.editor.graph.nodes.values()])
    const original = fixture.editor.createShape
    const failure = spyOn(fixture.editor, 'createShape').mockImplementation(() => {
      throw new Error('Owned synthetic graph failure')
    })
    try {
      expect(() => prepared.apply()).toThrow('Owned synthetic graph failure')
      expect(canonicalManifestJSON([...fixture.editor.graph.nodes.values()])).toBe(before)
    } finally {
      failure.mockRestore()
    }
    expect(fixture.editor.createShape).toBe(original)
  })
})
