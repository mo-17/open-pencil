import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ALL_TOOLS } from '@open-pencil/core/tools'

import { createAITools, getToolLogEntries } from '@/app/ai/tools'
import { PERSONAL_NOTES_AI_TOOL_NAME } from '@/app/ai/tools/personal-notes'
import { createEditorStore } from '@/app/editor/session'
import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import { NESTJS_BACKEND_PROVIDER_PLUGIN_ID } from '@/app/plugins/host/nestjs/backend-provider'

let previousWindow: typeof globalThis.window | undefined

beforeEach(() => {
  previousWindow = globalThis.window
  Object.assign(globalThis, { window: { innerWidth: 1200, innerHeight: 800 } })
})

afterEach(() => {
  if (previousWindow) Object.assign(globalThis, { window: previousWindow })
  else Reflect.deleteProperty(globalThis, 'window')
})

async function fixture(ready?: () => Promise<void>) {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === NESTJS_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (!entry) throw new Error('NestJS bundle missing')
  const pluginStore = createAppPluginStore({
    catalog: [entry],
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await pluginStore.load()
  const editor = createEditorStore()
  editor.aiFlashDone = () => undefined
  const tools = createAITools(editor, {
    personalNotes: { pluginStore, ready: ready ?? (() => Promise.resolve()) }
  })
  const tool = tools[PERSONAL_NOTES_AI_TOOL_NAME] as {
    inputSchema: unknown
    execute(
      args: Record<string, unknown>,
      execution?: { abortSignal?: AbortSignal }
    ): Promise<Record<string, unknown>>
  }
  return { editor, pluginStore, tool }
}

describe('personal notes built-in AI tool', () => {
  test('is discoverable in the real AI catalog and creates an undoable complete application', async () => {
    const { editor, tool } = await fixture()
    const pagesBefore = editor.graph.getPages().map((page) => page.id)
    expect(tool.inputSchema).toBeDefined()
    const result = await tool.execute({ authentication: 'local-keycloak' })
    expect(result.status).toBe('created')
    expect(result.exportPageIds).toEqual([result.loginPageId, result.notesPageId])
    const request = readBackendProviderDocumentRequest(editor.graph)
    expect(request?.selection.providerId).toBe('nestjs')
    expect(request?.application.httpApi?.browserClient?.authentication).toMatchObject({
      issuer: 'http://127.0.0.1:18080/realms/openpencil',
      clientId: 'notes-public-client'
    })
    expect(editor.graph.getNode(String(result.notesPageId))?.lowcodeRequiresAuth).toBe(true)
    const createdPages = editor.graph.getPages().map((page) => page.id)
    expect(createdPages).toHaveLength(pagesBefore.length + 2)
    expect(getToolLogEntries(editor).at(-1)?.tool).toBe(PERSONAL_NOTES_AI_TOOL_NAME)
    editor.undo.undo()
    expect(editor.graph.getPages().map((page) => page.id)).toEqual(pagesBefore)
    expect(readBackendProviderDocumentRequest(editor.graph)).toBeNull()
    expect(editor.undo.canUndo).toBe(false)
    editor.undo.redo()
    expect(editor.graph.getPages().map((page) => page.id)).toEqual(createdPages)
    expect(readBackendProviderDocumentRequest(editor.graph)).toEqual(request)
  })

  test('accepts public OIDC configuration and refuses existing Backend/auth without changing it', async () => {
    const { editor, tool } = await fixture()
    const first = await tool.execute({
      authentication: 'oidc',
      issuer: 'https://identity.example.com',
      client_id: 'public-notes'
    })
    expect(first.status).toBe('created')
    const before = editor.snapshotDocument()
    expect(await tool.execute({ authentication: 'local-keycloak' })).toMatchObject({
      error: expect.stringContaining('already has a Backend model')
    })
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    editor.undo.undo()
    editor.updateNodeWithUndo(editor.graph.rootId, { lowcodeAuthRedirect: '/existing-login' })
    const authBefore = editor.snapshotDocument()
    expect(await tool.execute({ authentication: 'local-keycloak' })).toMatchObject({
      error: expect.stringContaining('existing authentication')
    })
    expect(editor.documentSnapshotChanged(authBefore)).toBe(false)
  })

  test('rechecks provider lifecycle after catalog creation and while waiting for readiness', async () => {
    const { editor, pluginStore, tool } = await fixture()
    await pluginStore.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, false)
    const before = editor.snapshotDocument()
    expect(await tool.execute({ authentication: 'local-keycloak' })).toMatchObject({
      error: expect.stringContaining('host-reviewed NestJS')
    })
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    await pluginStore.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, true)
    const late = createAITools(editor, {
      personalNotes: {
        pluginStore,
        ready: async () => {
          await pluginStore.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, false)
        }
      }
    })[PERSONAL_NOTES_AI_TOOL_NAME] as typeof tool
    expect(await late.execute({ authentication: 'local-keycloak' })).toMatchObject({
      error: expect.stringContaining('host-reviewed NestJS')
    })
    expect(editor.documentSnapshotChanged(before)).toBe(false)
  })

  test('rejects a changed package digest and does not add document authoring to core MCP tools', async () => {
    const { editor, pluginStore, tool } = await fixture()
    const before = editor.snapshotDocument()
    const changed = createAITools(editor, {
      personalNotes: {
        ready: () => Promise.resolve(),
        pluginStore: {
          installedBackendProviders: () =>
            pluginStore.installedBackendProviders().map((entry) => ({
              ...entry,
              plugin: {
                ...entry.plugin,
                package: { ...entry.plugin.package, digest: 'app-bundle-sha256:unreviewed' }
              }
            }))
        }
      }
    })[PERSONAL_NOTES_AI_TOOL_NAME] as typeof tool
    expect(await changed.execute({ authentication: 'local-keycloak' })).toMatchObject({
      error: expect.stringContaining('host-reviewed NestJS')
    })
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    expect(ALL_TOOLS.some((definition) => definition.name === PERSONAL_NOTES_AI_TOOL_NAME)).toBe(
      false
    )
  })

  test('rejects invalid public configuration and preset overrides before document mutation', async () => {
    const { editor, tool } = await fixture()
    for (const input of [
      { authentication: 'oidc' },
      { authentication: 'oidc', issuer: 'https://user:password@example.com', client_id: 'public' },
      { authentication: 'oidc', issuer: 'http://identity.example.com', client_id: 'public' },
      { authentication: 'local-keycloak', issuer: 'https://identity.example.com' }
    ]) {
      const before = editor.snapshotDocument()
      expect(await tool.execute(input)).toHaveProperty('error')
      expect(editor.documentSnapshotChanged(before)).toBe(false)
    }
  })

  test('abort during readiness leaves the document and undo history untouched', async () => {
    const controller = new AbortController()
    const { editor, tool } = await fixture(async () => controller.abort())
    const before = editor.snapshotDocument()
    await expect(
      tool.execute({ authentication: 'local-keycloak' }, { abortSignal: controller.signal })
    ).rejects.toHaveProperty('name', 'AbortError')
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    expect(editor.undo.canUndo).toBe(false)
  })
})
