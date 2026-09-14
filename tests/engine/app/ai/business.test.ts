import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { ALL_TOOLS } from '@open-pencil/core/tools'

import { designSystemPromptFor } from '@/app/ai/chat/prompt-policy'
import { BUSINESS_AI_TOOL_NAME, createBusinessAITools } from '@/app/ai/tools/business'
import { BUSINESS_TEMPLATE_IDS } from '@/app/lowcode/backend/business/model/types'
import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'

import { businessBrowserFixture } from '../lowcode/backend/business/browser/helpers'
import { moduleInstallationFixture } from '../lowcode/backend/business/installation/helpers'

describe('business template AI entry', () => {
  test('instructs only the Direct facade to use the five reviewed workflow kinds', () => {
    expect(ALL_TOOLS.some((tool) => tool.name === BUSINESS_AI_TOOL_NAME)).toBe(false)
    expect(designSystemPromptFor('direct')).toContain(BUSINESS_AI_TOOL_NAME)
    expect(designSystemPromptFor('delegated')).not.toContain(BUSINESS_AI_TOOL_NAME)
    for (const kind of BUSINESS_TEMPLATE_IDS)
      expect(designSystemPromptFor('direct')).toContain(kind)
  })

  test.each(BUSINESS_TEMPLATE_IDS)(
    'creates %s in a single undo without deploying or granting roles',
    async (kind) => {
      const value = await businessBrowserFixture(kind, 'vue')
      value.editor.undo.undo()
      const before = value.editor.snapshotDocument()
      const [tool] = createBusinessAITools(value.editor, {
        pluginStore: value.store,
        ready: async () => undefined
      })
      const result = await tool.execute(new FigmaAPI(value.graph), {
        kind,
        authentication: 'local-keycloak',
        locale: 'zh-CN'
      })
      expect(result).toMatchObject({ status: 'created', kind, providerId: 'nestjs' })
      expect(result).toHaveProperty(
        'exportPageIds',
        value.graph
          .getPages()
          .slice(1)
          .map((page) => page.id)
      )
      expect(readBackendProviderDocumentRequest(value.graph)?.application.commerce).toBeUndefined()
      const after = value.editor.snapshotDocument()
      value.editor.undo.undo()
      expect(value.editor.documentSnapshotChanged(before)).toBe(false)
      expect(value.editor.undo.canUndo).toBe(false)
      value.editor.undo.redo()
      expect(value.editor.documentSnapshotChanged(after)).toBe(false)
      expect(JSON.stringify(result)).toContain('only through the identity service')
      expect(JSON.stringify(result)).toContain('does not start services')
    }
  )

  test('rejects unavailable authority, invalid kinds and invalid locale without document mutation', async () => {
    const value = await businessBrowserFixture('customer-crm', 'react')
    value.editor.undo.undo()
    const before = value.editor.snapshotDocument()
    const figma = new FigmaAPI(value.graph)
    const [unavailable] = createBusinessAITools(value.editor, {
      pluginStore: { installedBackendProviders: () => [] },
      ready: async () => undefined
    })
    await expect(
      unavailable.execute(figma, { kind: 'customer-crm', authentication: 'local-keycloak' })
    ).rejects.toThrow('Enable the installed')
    const [tool] = createBusinessAITools(value.editor, {
      pluginStore: value.store,
      ready: async () => undefined
    })
    await expect(
      tool.execute(figma, { kind: 'arbitrary-backend', authentication: 'local-keycloak' })
    ).rejects.toThrow('Unknown business')
    await expect(
      tool.execute(figma, {
        kind: 'customer-crm',
        authentication: 'local-keycloak',
        locale: 'unsupported'
      })
    ).rejects.toThrow('page language')
    expect(value.editor.documentSnapshotChanged(before)).toBe(false)
  })

  test('adds a module through the reviewed installation and exports all original and new routes', async () => {
    const value = await moduleInstallationFixture()
    const before = value.editor.snapshotDocument()
    const [tool] = createBusinessAITools(value.editor, {
      pluginStore: value.store,
      ready: async () => undefined
    })
    const result = await tool.execute(new FigmaAPI(value.editor.graph), {
      kind: 'service-desk',
      mode: 'add-module',
      locale: 'zh-CN'
    })
    expect(result).toMatchObject({ status: 'module-added', kind: 'service-desk' })
    expect(result).toHaveProperty(
      'exportPageIds',
      value.editor.graph
        .getPages()
        .filter((page) => !page.internalOnly && page.lowcodeRoutePattern)
        .map((page) => page.id)
    )
    const application = readBackendProviderDocumentRequest(value.editor.graph)?.application
    expect(application?.applicationId).toBe(value.application.applicationId)
    expect(application?.httpApi?.browserClient).toEqual(value.application.httpApi?.browserClient)
    expect(
      value.editor.graph
        .getPages()
        .filter((page) => page.lowcodeRoutePattern === value.pages.paths.login)
    ).toHaveLength(1)
    const after = value.editor.snapshotDocument()
    value.editor.undo.undo()
    expect(value.editor.documentSnapshotChanged(before)).toBe(false)
    value.editor.undo.redo()
    expect(value.editor.documentSnapshotChanged(after)).toBe(false)
  })

  test('rejects installed modules, implicit additions and identity overrides without mutation', async () => {
    const value = await moduleInstallationFixture()
    const before = value.editor.snapshotDocument()
    const [tool] = createBusinessAITools(value.editor, {
      pluginStore: value.store,
      ready: async () => undefined
    })
    const figma = new FigmaAPI(value.editor.graph)
    await expect(tool.execute(figma, { kind: 'customer-crm', mode: 'add-module' })).rejects.toThrow(
      'already installed'
    )
    await expect(
      tool.execute(figma, {
        kind: 'service-desk',
        mode: 'add-module',
        issuer: 'https://new.example.com'
      })
    ).rejects.toThrow('authentication overrides')
    await expect(
      tool.execute(figma, { kind: 'service-desk', authentication: 'local-keycloak' })
    ).rejects.toThrow('existing Backend')
    await expect(tool.execute(figma, { kind: 'service-desk', mode: 'unknown' })).rejects.toThrow(
      'mode'
    )
    expect(value.editor.documentSnapshotChanged(before)).toBe(false)
  })

  test('stops an aborted module request before any document change', async () => {
    const value = await moduleInstallationFixture()
    const before = value.editor.snapshotDocument()
    const controller = new AbortController()
    const [tool] = createBusinessAITools(value.editor, {
      pluginStore: value.store,
      ready: async () => {
        controller.abort(new Error('Owned module cancellation'))
      }
    })
    await expect(
      tool.execute(
        new FigmaAPI(value.editor.graph),
        {
          kind: 'service-desk',
          mode: 'add-module'
        },
        { signal: controller.signal }
      )
    ).rejects.toThrow('Owned module cancellation')
    expect(value.editor.documentSnapshotChanged(before)).toBe(false)
  })
})
