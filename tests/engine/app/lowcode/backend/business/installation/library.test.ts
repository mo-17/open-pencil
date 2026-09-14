import { describe, expect, test } from 'bun:test'

import { shallowRef } from 'vue'

import { canonicalManifestJSON } from '@open-pencil/scene-graph'

import { prepareBusinessModuleInstallation } from '@/app/lowcode/backend/business/installation'
import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'
import { registerBackendDraftGuard } from '@/app/lowcode/backend/draft/pending'
import { createBackendModuleInstaller } from '@/app/lowcode/backend/library/modules'
import { backendProviderDescriptorKey } from '@/app/lowcode/backend/library/provider-identity'

import { moduleInstallationFixture } from './helpers'

async function libraryFixture() {
  const fixture = await moduleInstallationFixture()
  const request = readBackendProviderDocumentRequest(fixture.editor.graph)
  if (!request) throw new Error('Missing saved Backend')
  const draft = shallowRef(structuredClone(request.application))
  const selected = shallowRef(backendProviderDescriptorKey(request.selection))
  const busy = shallowRef(false),
    readError = shallowRef('')
  const failures: unknown[] = []
  let afterStart: () => void = () => undefined
  const installer = createBackendModuleInstaller(
    {
      ...fixture,
      draft,
      busy,
      readError,
      locale: () => 'zh-CN',
      started: () => {
        afterStart()
      },
      created: () => {
        const saved = readBackendProviderDocumentRequest(fixture.editor.graph)
        if (!saved) throw new Error('Missing saved module')
        draft.value = structuredClone(saved.application)
      },
      failed: (cause) => {
        failures.push(cause)
      }
    },
    () => selected.value
  )
  return {
    ...fixture,
    draft,
    selected,
    busy,
    readError,
    failures,
    installer,
    onStart: (action: () => void) => {
      afterStart = action
    }
  }
}

describe('module library review and unsaved draft preservation', () => {
  test('keeps a review stable until change and installs through the library', async () => {
    const fixture = await libraryFixture()
    const first = fixture.installer.reviews().find((review) => review.kind === 'service-desk')
    expect(first?.status).toBe('ready')
    expect(fixture.installer.reviews()).toContainEqual(first)
    if (!first) throw new Error('Missing review')
    expect(await fixture.installer.add('service-desk', first.reviewKey)).toBe(true)
    expect(
      fixture.installer.reviews().find((review) => review.kind === 'service-desk')?.status
    ).toBe('installed')
    expect(fixture.failures).toEqual([])
    expect(fixture.busy.value).toBe(false)
  })

  test('blocks unsaved drafts and Provider selections before mutation', async () => {
    const fixture = await libraryFixture()
    const snapshot = canonicalManifestJSON([...fixture.editor.graph.nodes.values()])
    const savedDraft = structuredClone(fixture.draft.value)
    fixture.draft.value.applicationId = 'unsaved-author-change'
    expect(fixture.installer.reviews().every((review) => review.status === 'blocked')).toBe(true)
    fixture.draft.value = savedDraft
    fixture.selected.value = 'changed-provider'
    expect(fixture.installer.reviews().every((review) => review.status === 'blocked')).toBe(true)
    expect(await fixture.installer.add('service-desk', 'old-review')).toBe(false)
    expect(canonicalManifestJSON([...fixture.editor.graph.nodes.values()])).toBe(snapshot)
  })

  test('rejects stale reviews and draft changes during the async UI boundary', async () => {
    const fixture = await libraryFixture()
    const old = fixture.installer.reviews().find((review) => review.kind === 'service-desk')
    if (!old) throw new Error('Missing review')
    fixture.editor.graph.updateNode(fixture.pages.pageIds[0], { name: 'Authored page title' })
    const current = fixture.installer.reviews().find((review) => review.kind === 'service-desk')
    expect(current?.reviewKey).not.toBe(old.reviewKey)
    expect(await fixture.installer.add('service-desk', old.reviewKey)).toBe(false)
    const ready = fixture.installer.reviews().find((review) => review.kind === 'service-desk')
    if (!ready) throw new Error('Missing refreshed review')
    const snapshot = canonicalManifestJSON([...fixture.editor.graph.nodes.values()])
    fixture.onStart(() => {
      fixture.draft.value.applicationId = 'concurrent-draft-edit'
    })
    expect(await fixture.installer.add('service-desk', ready.reviewKey)).toBe(false)
    expect(fixture.draft.value.applicationId).toBe('concurrent-draft-edit')
    expect(canonicalManifestJSON([...fixture.editor.graph.nodes.values()])).toBe(snapshot)
  })

  test('an open panel draft also protects direct AI installation, with explicit disposal', async () => {
    const fixture = await moduleInstallationFixture()
    let dirty = false
    const unregister = registerBackendDraftGuard({
      graph: () => fixture.editor.graph,
      reason: () => (dirty ? 'Save or discard the current Backend draft.' : '')
    })
    try {
      const reviewed = prepareBusinessModuleInstallation({ ...fixture, kind: 'service-desk' })
      expect(reviewed.review.status).toBe('ready')
      dirty = true
      const snapshot = canonicalManifestJSON([...fixture.editor.graph.nodes.values()])
      expect(() => reviewed.apply()).toThrow('draft')
      expect(
        prepareBusinessModuleInstallation({ ...fixture, kind: 'service-desk' }).review.status
      ).toBe('blocked')
      expect(canonicalManifestJSON([...fixture.editor.graph.nodes.values()])).toBe(snapshot)
    } finally {
      unregister()
    }
    expect(
      prepareBusinessModuleInstallation({ ...fixture, kind: 'service-desk' }).review.status
    ).toBe('ready')
  })
})
