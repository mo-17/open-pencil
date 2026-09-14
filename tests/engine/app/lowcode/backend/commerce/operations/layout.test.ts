import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'
import { commerceOperationsCopy } from '@/app/lowcode/backend/commerce/operations/copy'
import { createCommerceOperationsPages } from '@/app/lowcode/backend/commerce/operations/template'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import { listAppBackendProviderDescriptors } from '@/app/plugins/host/backend-provider'

function pageBox(graph: SceneGraph, node: SceneNode) {
  let x = node.x,
    y = node.y,
    parent = graph.getNode(node.parentId ?? '')
  while (parent && parent.type !== 'CANVAS') {
    x += parent.x
    y += parent.y
    parent = graph.getNode(parent.parentId ?? '')
  }
  return { x, y, right: x + node.width, bottom: y + node.height, page: parent?.id }
}

async function fixture(mode: 'single-merchant' | 'multi-merchant', locale: string) {
  const store = createAppPluginStore({
    catalog: createBundledPluginCatalog().filter(
      (entry) => entry.manifest.plugin.id === 'open-pencil.nestjs-backend'
    ),
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing NestJS provider')
  const editor = createEditor()
  const application = createCommerceOperationsApplication(
    'layout-regression',
    {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.com',
      clientId: 'commerce-public',
      scopes: ['openid', 'profile'],
      callbackPath: '/_openpencil/auth/callback'
    },
    mode
  )
  const result = createCommerceOperationsPages(editor, descriptor, application, mode, locale)
  return { editor, result }
}

describe('commerce operations error-region geometry', () => {
  test.each([
    ['single-merchant', 'en'],
    ['single-merchant', 'zh-CN'],
    ['multi-merchant', 'en'],
    ['multi-merchant', 'zh-CN']
  ] as const)(
    '%s %s keeps visible errors clear of controls and recovery buttons',
    async (mode, locale) => {
      const { editor, result } = await fixture(mode, locale)
      const nodes = [...editor.graph.getAllNodes()]
      const controls = nodes.filter((node) =>
        ['BUTTON', 'INPUT', 'TEXTAREA', 'FORM'].includes(node.type)
      )
      const errors = nodes.filter(
        (node) =>
          node.bindings?.text?.kind === 'docState' &&
          node.bindings.text.docStateName?.includes('Error')
      )
      expect(errors).toHaveLength(12)
      const collisions: string[] = []
      for (const error of errors) {
        const box = pageBox(editor.graph, error)
        for (const control of controls) {
          const target = pageBox(editor.graph, control)
          if (box.page !== target.page) continue
          if (
            box.x < target.right + 8 &&
            box.right > target.x - 8 &&
            box.y < target.bottom + 8 &&
            box.bottom > target.y - 8
          )
            collisions.push(
              `${editor.graph.getNode(box.page ?? '')?.name}: error overlaps ${control.name}`
            )
        }
        const page = editor.graph.getNode(box.page ?? '')
        expect(page).toBeDefined()
        expect(box.bottom).toBeLessThanOrEqual(page?.height ?? 0)
        if (page?.lowcodeRoutePattern !== result.paths.admin)
          expect(error.renderCondition).toBeTruthy()
      }
      expect(collisions).toEqual([])
      const copy = commerceOperationsCopy(locale)
      for (const path of [result.paths.shop, result.paths.cart]) {
        const page = editor.graph.getPages().find((entry) => entry.lowcodeRoutePattern === path)
        expect(
          nodes.some(
            (node) =>
              pageBox(editor.graph, node).page === page?.id && node.text.includes(copy.currency)
          )
        ).toBe(true)
      }
    }
  )
})
