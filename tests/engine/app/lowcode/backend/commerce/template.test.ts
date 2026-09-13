import { describe, expect, test } from 'bun:test'

import { withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'
import { validateBackendClientAction } from '@open-pencil/lowcode/backend'
import type { ActionDef } from '@open-pencil/scene-graph'

import { createCommerceApplication } from '@/app/lowcode/backend/commerce/application'
import {
  canInstallCommerceExample,
  createCommercePages
} from '@/app/lowcode/backend/commerce/template'
import {
  readBackendProviderDocumentRequest,
  validateBackendApplicationDraft
} from '@/app/lowcode/backend/document'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  compileAppBackendProviderDocument,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'

async function fixture() {
  const entry = createBundledPluginCatalog().find(
    (value) => value.manifest.plugin.id === 'open-pencil.nestjs-backend'
  )
  if (!entry) throw new Error('Missing bundled NestJS provider')
  const store = createAppPluginStore({
    catalog: [entry],
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing active NestJS provider')
  const application = createCommerceApplication('checkout-example', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'catalog-client',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  })
  return { store, descriptor, application, editor: createEditor() }
}

describe('single-item checkout example', () => {
  test('validates the command model with public products, owner orders and role-gated inventory edits', async () => {
    const { application, descriptor } = await fixture()
    expect(validateBackendApplicationDraft(application, descriptor).diagnostics).toEqual([])
    const products = application.httpApi?.resources.find((value) => value.id === 'products')
    const orders = application.httpApi?.resources.find((value) => value.id === 'orders')
    if (!products || !orders) throw new Error('Missing commerce resources')
    expect(orders.operations).toEqual(['list', 'read'])
    const writers = application.auth.rowAccess.filter(
      (rule) =>
        rule.entityId === products.entityId &&
        rule.operations.some((operation) => operation !== 'select')
    )
    expect(writers).toHaveLength(1)
    expect(writers[0].principal).toEqual({ kind: 'role', roleId: 'catalog-manager' })
  })

  test('installs four usable pages atomically and preserves unrelated document state through undo/redo', async () => {
    const { application, descriptor, editor } = await fixture()
    const beforePages = editor.graph.getPages().map((page) => page.id)
    const beforeRoot = structuredClone(editor.graph.getNode(editor.graph.rootId))
    if (!beforeRoot) throw new Error('Missing document root')
    const result = createCommercePages(editor, descriptor, application)
    expect(result.pageIds).toHaveLength(4)
    const root = editor.graph.getNode(editor.graph.rootId)
    if (!root) throw new Error('Missing document root')
    expect(root.lowcodeAuthRedirect).toBe(result.paths.login)
    const commands = [...editor.graph.getAllNodes()]
      .flatMap((node) => Object.values(node.events ?? {}).flat())
      .flatMap((action) => (action.kind === 'condition' ? action.consequent : [action]))
      .flatMap((action) => (action.kind === 'confirm' ? action.consequent : [action]))
      .filter((action) => action.kind === 'backendCommand')
    expect(commands).toHaveLength(3)
    for (const name of [
      'checkoutAttempt',
      'cancelAttempt',
      'restockAttempt',
      'selectedSku',
      'selectedProduct',
      'selectedPrice',
      'selectedStock',
      'orderQuantity',
      'selectedOrder',
      'selectedOrderSummary'
    ]) {
      const value = root.lowcodeDocumentState?.find((entry) => entry.name === name)
      expect(value).toBeDefined()
      expect(value?.persist).toBeUndefined()
      expect(
        editor.graph.getPages().some((page) => page.state?.some((entry) => entry.name === name))
      ).toBe(false)
    }
    for (const action of commands) {
      expect(action.recovery).toBe('browser')
      expect(
        validateBackendClientAction(application, action, root.lowcodeDocumentState ?? [])
      ).toEqual([])
    }
    expect(canInstallCommerceExample(editor)).toBe(false)
    expect(() => createCommercePages(editor, descriptor, application)).toThrow('new document')
    expect(editor.graph.getPages()).toHaveLength(beforePages.length + 4)
    editor.undo.undo()
    expect(editor.graph.getPages().map((page) => page.id)).toEqual(beforePages)
    expect(editor.graph.getNode(editor.graph.rootId)?.lowcodeDocumentState).toEqual(
      beforeRoot.lowcodeDocumentState
    )
    expect(readBackendProviderDocumentRequest(editor.graph)).toBeNull()
    editor.undo.redo()
    expect(
      readBackendProviderDocumentRequest(editor.graph)?.application.commands?.commands
    ).toHaveLength(3)
    expect(editor.graph.getPages()).toHaveLength(beforePages.length + 4)
  })

  test('keeps saved attempts until explicit acknowledgement without clearing their keys in actions', async () => {
    const { application, descriptor, editor } = await fixture()
    createCommercePages(editor, descriptor, application)
    const recoveryHints = [...editor.graph.getAllNodes()].filter(
      (node) => node.type === 'TEXT' && node.text === 'Sign in and view the saved attempt.'
    )
    expect(recoveryHints).toHaveLength(3)
    expect(recoveryHints.every((node) => !node.renderCondition)).toBe(true)
    const allActions: ActionDef[] = []
    const visit = (actions: readonly ActionDef[]) => {
      for (const action of actions) {
        allActions.push(action)
        for (const key of ['consequent', 'alternate', 'onSuccess', 'onError'] as const)
          if (key in action) visit((action as { [K in typeof key]?: ActionDef[] })[key] ?? [])
      }
    }
    for (const node of editor.graph.getAllNodes())
      for (const actions of Object.values(node.events ?? {})) visit(actions ?? [])
    expect(
      allActions.some(
        (action) =>
          action.kind === 'setVariable' &&
          ['checkoutAttempt', 'cancelAttempt', 'restockAttempt'].includes(action.targetName)
      )
    ).toBe(false)
    for (const name of ['Start new order', 'Start new cancellation', 'Start new restock']) {
      const node = [...editor.graph.getAllNodes()].find((value) => value.name === name)
      const confirmation = node?.events?.onClick?.[0]
      expect(confirmation?.kind).toBe('confirm')
      if (confirmation?.kind !== 'confirm')
        throw new Error('Missing explicit acknowledgement confirmation')
      expect(
        confirmation.consequent.some(
          (action) => action.kind === 'backendCommandRecovery' && action.operation === 'acknowledge'
        )
      ).toBe(true)
    }
  })

  test.each(['react', 'vue'] as const)(
    '%s export includes command-backed checkout and cancellation',
    async (target) => {
      const { application, descriptor, editor, store } = await fixture()
      const result = createCommercePages(editor, descriptor, application)
      const output = compileAppBackendProviderDocument(store, {
        graph: editor.graph,
        pageIds: result.pageIds,
        options: withDefaults({
          target,
          router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
          devMode: false
        })
      })
      expect([...output.files.keys()].some((path) => path.startsWith('backend/nestjs/'))).toBe(true)
      const frontend = [...output.files]
        .filter(([path]) => path.startsWith('src/'))
        .map(([, source]) => source)
        .join('\n')
      expect(frontend).toContain('checkoutAttempt')
      expect(frontend).toContain('cancelAttempt')
      expect(frontend).toContain('catalog-manager')
      expect(output.warnings).toEqual([])
    }
  )
})
