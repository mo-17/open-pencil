import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { createCommerceApplication } from '@/app/lowcode/backend/commerce/application'
import { createMerchantCommerceApplication } from '@/app/lowcode/backend/commerce/merchant/application'
import { createMerchantCommercePages } from '@/app/lowcode/backend/commerce/merchant/template'
import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'
import { createCommerceOperationsPages } from '@/app/lowcode/backend/commerce/operations/template'
import { createCommercePages } from '@/app/lowcode/backend/commerce/template'
import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'
import { createPersonalNotesPages } from '@/app/lowcode/backend/notes-template'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import { listAppBackendProviderDescriptors } from '@/app/plugins/host/backend-provider'

const kinds = [
  ['notes', 2],
  ['shop', 4],
  ['single-merchant-shop', 5],
  ['multi-merchant-marketplace', 7],
  ['single-merchant-commerce', 12],
  ['multi-merchant-commerce', 12]
] as const

async function fixture(kind: string) {
  const store = createAppPluginStore({
    catalog: createBundledPluginCatalog().filter(
      (entry) => entry.manifest.plugin.id === 'open-pencil.nestjs-backend'
    ),
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.15.0'
  })
  await store.load()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing provider')
  const auth = {
    kind: 'oidc-pkce' as const,
    issuer: 'https://identity.example.com',
    clientId: 'compact-fixture',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  }
  const editor = createEditor()
  if (kind === 'notes') {
    const application = createNestJSNotesApplication('compact-notes')
    if (!application.httpApi?.browserClient) throw new Error('Missing client')
    application.httpApi.browserClient.authentication = auth
    const pages = createPersonalNotesPages(editor, descriptor, application)
    return { editor, pageIds: [pages.notesPageId, pages.loginPageId] }
  }
  const mode = kind.startsWith('multi-') ? 'multi-merchant' : 'single-merchant'
  if (kind.endsWith('-commerce')) {
    const app = createCommerceOperationsApplication('compact-commerce', auth, mode)
    return { editor, ...createCommerceOperationsPages(editor, descriptor, app, mode, 'zh-CN') }
  }
  if (kind !== 'shop') {
    const app = createMerchantCommerceApplication('compact-merchant', auth, mode)
    return { editor, ...createMerchantCommercePages(editor, descriptor, app, mode, 'zh-CN') }
  }
  const app = createCommerceApplication('compact-shop', auth)
  return { editor, ...createCommercePages(editor, descriptor, app, 'zh-CN') }
}

function visibleFlow(graph: SceneGraph, id: string): string[] {
  const node = graph.getNode(id)
  if (!node || node.responsiveOverrides?.compact?.visible === false) return []
  return [id, ...graph.getChildren(id).flatMap((child) => visibleFlow(graph, child.id))]
}

function expectNavigationState(graph: SceneGraph, pageId: string, node: SceneNode): void {
  const binding = node.bindings?.value
  expect(binding?.kind).toBe('ref')
  if (binding?.kind !== 'ref') throw new Error('Missing navigation state')
  expect(graph.getNode(pageId)?.state?.some((entry) => entry.id === binding.stateId)).toBe(true)
  expect(
    node.events?.onChange?.every(
      (action) => action.kind === 'condition' && action.condExpr.startsWith('$value === ')
    )
  ).toBe(true)
}

function expectNodeSemantics(graph: SceneGraph, pageId: string, node: SceneNode): void {
  const compact = node.responsiveOverrides?.compact
  expect(compact).toBeDefined()
  if (node.type === 'LIST') {
    expect(node.interactiveProps?.dataSourceRef?.kind).toBe('backendResource')
    expect(compact?.height).toBe(520)
    expect(compact?.layoutMode).toBe('VERTICAL')
    expect(node.childIds).toHaveLength(1)
  }
  if (node.type === 'FORM') {
    expect(node.events?.onSubmit?.length).toBeGreaterThan(0)
    expect(compact?.layoutMode).toBe('VERTICAL')
  }
  if (node.type === 'SELECT' && node.name === '页面导航') expectNavigationState(graph, pageId, node)
}

describe('notes and commerce compact page contracts', () => {
  test.each(kinds)(
    '%s adapts all %i pages while preserving forms and bounded collections',
    async (kind, count) => {
      const { editor, pageIds } = await fixture(kind)
      expect(pageIds).toHaveLength(count)
      for (const pageId of pageIds) {
        expect(editor.graph.getNode(pageId)?.lowcodePageViewport).toEqual({
          version: 1,
          mode: 'responsive'
        })
        const frame = editor.graph.getChildren(pageId)[0]
        expect(frame.responsiveOverrides?.compact?.layoutMode).toBe('VERTICAL')
        expect(frame.responsiveOverrides?.compact?.primaryAxisSizing).toBe('HUG')
        for (const id of visibleFlow(editor.graph, frame.id)) {
          const node = editor.graph.getNode(id)
          if (!node) throw new Error('Missing visible node')
          expectNodeSemantics(editor.graph, pageId, node)
        }
      }
      // The entire generated graph, including all grouping/navigation mutations, is one undo step.
      editor.undo.undo()
      expect(editor.graph.getPages()).toHaveLength(1)
      editor.undo.redo()
      expect(editor.graph.getPages()).toHaveLength(count + 1)
      expect(pageIds.every((id) => editor.graph.getNode(id))).toBe(true)
    }
  )
})
