import type { Page } from '@playwright/test'

import type {
  ManagedPreviewCommand,
  ManagedPreviewConfig,
  ManagedPreviewState
} from '@open-pencil/compiler/managed-preview'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

export type PreviewFixtureWindow = Window & {
  __OP_NESTJS_PREVIEW__: {
    spawns: { pid: number; args: string[] }[]
    updates: string[]
    killed: number[]
    opened: string[]
    managedCommands: ManagedPreviewCommand[]
    caDialogs: number
  }
  __OP_NESTJS_RESOLVE_CA__: (value: string | null) => void
}

export async function mockDesktopPreview(page: Page) {
  await page.addInitScript(() => {
    const state = {
      spawns: [] as { pid: number; args: string[] }[],
      updates: [] as string[],
      killed: [] as number[],
      opened: [] as string[],
      managedCommands: [] as ManagedPreviewCommand[],
      caDialogs: 0
    }
    ;(window as PreviewFixtureWindow).__OP_NESTJS_PREVIEW__ = state
    let resolveCA: ((value: string | null) => void) | null = null
    ;(window as PreviewFixtureWindow).__OP_NESTJS_RESOLVE_CA__ = (value) => {
      if (!resolveCA) throw new Error('No pending CA selection')
      const resolve = resolveCA
      resolveCA = null
      resolve(value)
    }
    const callbacks = new Map<number, (value: unknown) => void>()
    const processes = new Map<
      number,
      {
        channel: number
        index: number
        managed?: {
          state: ManagedPreviewState
          desired?: BackendApplicationSpecV1
          config?: ManagedPreviewConfig
        }
      }
    >()
    let serial = 0
    const emit = (pid: number, event: string, payload: unknown) => {
      const process = processes.get(pid)
      if (process)
        callbacks.get(process.channel)?.({ index: process.index++, message: { event, payload } })
    }
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { windowLabel: 'main', label: 'main' }
        },
        convertFileSrc: (path: string) => `asset://localhost/${path}`,
        transformCallback(callback: (value: unknown) => void) {
          callbacks.set(++serial, callback)
          return serial
        },
        unregisterCallback(id: number) {
          callbacks.delete(id)
        },
        runCallback(id: number, value: unknown) {
          callbacks.get(id)?.(value)
        },
        // oxlint-disable-next-line complexity -- One dispatcher models both owned companion and frontend IPC channels.
        async invoke(command: string, args?: Record<string, unknown>) {
          if (command === 'plugin:dialog|open') {
            state.caDialogs++
            return new Promise<string | null>((resolve) => {
              resolveCA = resolve
            })
          }
          if (command === 'plugin:shell|spawn') {
            const pid = state.spawns.length + 1
            const shellArgs = args?.args as string[]
            const channel = (args?.onEvent as { id: number } | undefined)?.id
            if (!channel) throw new Error('Missing preview callback')
            const localIndex = shellArgs.indexOf('--local-backend')
            const port =
              localIndex === -1 ? 60140 : JSON.parse(shellArgs[localIndex + 1]).previewPort
            state.spawns.push({ pid, args: shellArgs })
            if (shellArgs.includes('packages/compiler/src/managed-preview/cli.ts')) {
              const sessionId = shellArgs[shellArgs.indexOf('--session') + 1]
              processes.set(pid, {
                channel,
                index: 0,
                managed: {
                  state: {
                    sessionId,
                    phase: 'empty',
                    initialized: false,
                    applicationId: null,
                    applicationDigest: null,
                    connection: null,
                    plan: null
                  }
                }
              })
              setTimeout(
                () =>
                  emit(
                    pid,
                    'Stdout',
                    JSON.stringify({ version: 1, type: 'ready', sessionId }) + '\n'
                  ),
                0
              )
              return pid
            }
            processes.set(pid, { channel, index: 0 })
            setTimeout(
              () =>
                emit(
                  pid,
                  'Stdout',
                  JSON.stringify({ type: 'ready', url: `http://127.0.0.1:${port}/`, port }) + '\n'
                ),
              0
            )
            return pid
          }
          if (command === 'plugin:shell|stdin_write') {
            const pid = args?.pid as number
            const managed = processes.get(pid)?.managed
            if (managed) {
              const request = JSON.parse(String(args?.buffer)) as ManagedPreviewCommand
              state.managedCommands.push(request)
              if (request.command === 'prepare') {
                const digestURL = new URL(
                  '/packages/compiler/src/backend/nestjs/preview-digest.ts',
                  window.location.origin
                ).href
                const { nestJSPreviewApplicationDigest } = await import(
                  /* @vite-ignore */ digestURL
                )
                const digest = nestJSPreviewApplicationDigest(request.application)
                managed.desired = request.application
                managed.config = request.config
                managed.state = {
                  ...managed.state,
                  phase: 'prepared',
                  applicationId: request.application.applicationId,
                  plan: {
                    planId: digest,
                    kind: managed.state.initialized ? 'migration' : 'initial',
                    fromApplicationDigest: managed.state.applicationDigest,
                    toApplicationDigest: digest,
                    sql: `CREATE TABLE preview_notes (id uuid PRIMARY KEY);\n-- Fields: ${request.application.dataModel.entities[0]?.fields.map((field) => field.name).join(', ')}`,
                    summary: ['Create the isolated preview notes table'],
                    diagnostics: [],
                    requiresApproval: true
                  }
                }
              } else if (request.command === 'setup' || request.command === 'apply') {
                managed.state = {
                  ...managed.state,
                  initialized: true,
                  phase: 'prepared',
                  applicationDigest: managed.state.plan?.toApplicationDigest ?? null,
                  plan: null
                }
              } else if (request.command === 'start') {
                if (!managed.config || !managed.state.applicationDigest || !managed.desired)
                  throw new Error('Managed fixture was not prepared')
                managed.state = {
                  ...managed.state,
                  phase: 'running',
                  connection: {
                    previewPort: managed.config.previewPort,
                    apiPort: managed.config.apiPort,
                    apiBasePath: '/api',
                    applicationId: managed.desired.applicationId,
                    applicationDigest: managed.state.applicationDigest
                  }
                }
              } else if (request.command === 'stop' || request.command === 'close') {
                managed.state = { ...managed.state, phase: 'stopped', connection: null }
              }
              emit(
                pid,
                'Stdout',
                JSON.stringify({
                  version: 1,
                  type: 'result',
                  id: request.id,
                  state: managed.state
                }) + '\n'
              )
              if (request.command === 'close') emit(pid, 'Terminated', { code: 0, signal: null })
              return null
            }
            state.updates.push(String(args?.buffer))
            setTimeout(() => emit(pid, 'Stdout', JSON.stringify({ type: 'updated' }) + '\n'), 0)
            return null
          }
          if (command === 'plugin:shell|kill') {
            const pid = args?.pid as number
            state.killed.push(pid)
            emit(pid, 'Terminated', { code: 0, signal: null })
            return null
          }
          if (command === 'plugin:opener|open_url') {
            state.opened.push(String(args?.url))
            return null
          }
          if (command === 'plugin:event|listen') return ++serial
          if (command === 'take_pending_open' || command === 'list_system_fonts') return []
          return null
        }
      }
    })
  })
  await page.route('http://127.0.0.1:60140/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><p>Ordinary preview fixture</p>'
    })
  )
}

export async function createNotes(page: Page) {
  return page.evaluate(async () => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Missing editor')
    const toolsURL = new URL('/src/app/ai/tools/index.ts', window.location.origin).href
    const { createAITools } = await import(/* @vite-ignore */ toolsURL)
    const created = await createAITools(editor).create_personal_notes_app.execute({
      authentication: 'local-keycloak'
    })
    if (created.status !== 'created') throw new Error('Notes creation failed')
    return created.loginPath
  })
}

export async function addNotesField(page: Page, fieldName: string) {
  await page.evaluate(async (name) => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Missing editor')
    const backendURL = new URL('/src/app/plugins/host/backend-provider.ts', window.location.origin)
      .href
    const { readAppBackendProviderDocumentRequest, appBackendProviderDocumentValue } = await import(
      /* @vite-ignore */ backendURL
    )
    const request = structuredClone(readAppBackendProviderDocumentRequest(editor.graph))
    const root = editor.graph.getNode(editor.graph.rootId)
    if (!request || !root) throw new Error('Missing backend')
    request.application.dataModel.entities[0].fields.push({
      id: name,
      name,
      type: 'string',
      nullable: true
    })
    editor.updateNodeWithUndo(root.id, {
      pluginData: root.pluginData.map((entry) =>
        entry.key === 'lowcode/backendProvider.v1'
          ? { ...entry, value: appBackendProviderDocumentValue(request) }
          : entry
      )
    })
  }, fieldName)
}

export function managedCommands(page: Page) {
  return page.evaluate(() =>
    (window as PreviewFixtureWindow).__OP_NESTJS_PREVIEW__.managedCommands.map(
      (command) => command.command
    )
  )
}

export async function changeNotesClient(page: Page, clientId: string) {
  await page.evaluate(async (nextClientId) => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Missing editor')
    const backendURL = new URL('/src/app/plugins/host/backend-provider.ts', window.location.origin)
      .href
    const { readAppBackendProviderDocumentRequest, appBackendProviderDocumentValue } = await import(
      /* @vite-ignore */ backendURL
    )
    const request = structuredClone(readAppBackendProviderDocumentRequest(editor.graph))
    const root = editor.graph.getNode(editor.graph.rootId)
    const authentication = request?.application.httpApi?.browserClient?.authentication
    if (!request || !root || !authentication) throw new Error('Missing backend authentication')
    authentication.clientId = nextClientId
    editor.updateNodeWithUndo(root.id, {
      pluginData: root.pluginData.map((entry) =>
        entry.key === 'lowcode/backendProvider.v1'
          ? { ...entry, value: appBackendProviderDocumentValue(request) }
          : entry
      )
    })
  }, clientId)
}
