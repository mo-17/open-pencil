import { computed, ref, shallowRef } from 'vue'

import { withDefaults } from '@open-pencil/compiler'
import {
  nestJSPreviewApplicationDigest,
  validateNestJSConnectedPreview
} from '@open-pencil/compiler/backend'
import {
  parsePreviewLocalBackendConnection,
  type PreviewLocalBackendConnection
} from '@open-pencil/compiler/preview-local-backend'
import { isBackendAuthReturnPath } from '@open-pencil/lowcode/backend'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { readAppBackendProviderDocumentRequest } from '@/app/plugins/host/backend-provider'
import { isTauri } from '@/app/tauri/env'

import {
  preparePreviewBackendProvider,
  resolveLivePreviewBackendProviderStore
} from './host/backend-provider'
import type { PreviewTarget } from './host/types'

export const LOCAL_BACKEND_PREVIEW_PORT = 5181
export const LOCAL_BACKEND_PREVIEW_ORIGIN = `http://127.0.0.1:${LOCAL_BACKEND_PREVIEW_PORT}`
export const LOCAL_BACKEND_PREVIEW_CALLBACK = '/_openpencil/auth/callback'
export const LOCAL_BACKEND_CHANGED_MESSAGE =
  'Backend model, authentication or Provider changed. Synchronize your local backend, then reconnect.'

export interface PreparedLocalBackendPreview {
  connection: PreviewLocalBackendConnection
  loginPath: string
}

export interface LocalBackendPreviewState {
  kind: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  message: string
}

export async function prepareLocalBackendPreview(
  graph: SceneGraph,
  target: PreviewTarget,
  apiPort: number
): Promise<PreparedLocalBackendPreview> {
  if (!isTauri()) throw new Error('Local NestJS preview requires the desktop editor.')
  const request = readAppBackendProviderDocumentRequest(graph)
  if (!request) throw new Error('Configure the document NestJS Backend before connecting.')
  const applicationDigest = nestJSPreviewApplicationDigest(request.application)
  const backendStore = await resolveLivePreviewBackendProviderStore()
  // Resolve live plugin authority after readiness, and reject a document changed while waiting.
  const prepared = preparePreviewBackendProvider(
    graph,
    withDefaults({ target, backendPreview: { kind: 'nestjs-local', applicationDigest } }),
    backendStore
  )
  const backend = prepared.options.backendProvider
  if (!backend) throw new Error('The document Backend is no longer available.')
  const validated = validateNestJSConnectedPreview({ ...backend, target, applicationDigest })
  if (!validated.ok) throw new Error(validated.diagnostics.map((item) => item.message).join(' '))
  const browser = validated.application.httpApi?.browserClient
  if (!browser || browser.authentication.callbackPath !== LOCAL_BACKEND_PREVIEW_CALLBACK) {
    throw new Error(`Local preview requires the callback path ${LOCAL_BACKEND_PREVIEW_CALLBACK}.`)
  }
  const loginPath = graph.getNode(graph.rootId)?.lowcodeAuthRedirect
  if (
    !isBackendAuthReturnPath(loginPath) ||
    new URL(loginPath, LOCAL_BACKEND_PREVIEW_ORIGIN).pathname !== loginPath
  ) {
    throw new Error('Configure a local login route before connecting the Backend preview.')
  }
  prepared.assertCurrent()
  return {
    connection: parsePreviewLocalBackendConnection({
      previewPort: LOCAL_BACKEND_PREVIEW_PORT,
      apiPort,
      apiBasePath: browser.apiBasePath,
      applicationId: validated.application.applicationId,
      applicationDigest
    }),
    loginPath
  }
}

/** Session-only authority. Neither connection details nor login state enter the document. */
export function createLocalBackendPreviewConnection(input: {
  prepare(apiPort: number): Promise<PreparedLocalBackendPreview>
  start(): Promise<void>
  stop(): Promise<void>
}) {
  const connection = shallowRef<PreviewLocalBackendConnection | null>(null)
  const state = ref<LocalBackendPreviewState>({ kind: 'idle', message: '' })
  const loginPath = ref('')
  const active = computed(() => state.value.kind !== 'idle')
  const browserURL = computed(() =>
    state.value.kind === 'connected' && connection.value
      ? `http://127.0.0.1:${connection.value.previewPort}${loginPath.value}`
      : null
  )
  let serial = 0

  async function disconnect(message = 'Disconnected. Your local backend and data remain running.') {
    serial += 1
    connection.value = null
    state.value = { kind: 'disconnected', message }
    await input.stop()
  }

  async function fail(message: string) {
    serial += 1
    connection.value = null
    state.value = { kind: 'error', message }
    await input.stop()
  }

  async function connectPrepared(prepare: () => Promise<PreparedLocalBackendPreview>) {
    const request = ++serial
    connection.value = null
    state.value = { kind: 'connecting', message: 'Checking the local Backend and compiling…' }
    try {
      await input.stop()
      if (request !== serial) return
      const prepared = await prepare()
      if (request !== serial) return
      connection.value = prepared.connection
      loginPath.value = prepared.loginPath
      await input.start()
    } catch (cause) {
      if (request !== serial) return
      await fail(cause instanceof Error ? cause.message : 'Local Backend connection failed.')
    }
  }

  function markReady() {
    if (!connection.value) return
    state.value = { kind: 'connected', message: 'Connected. Frontend edits update automatically.' }
  }

  return {
    connection,
    state,
    active,
    browserURL,
    connect: (apiPort: number) => connectPrepared(() => input.prepare(apiPort)),
    adoptPrepared: (prepared: PreparedLocalBackendPreview) => connectPrepared(async () => prepared),
    disconnect,
    fail,
    markReady
  }
}
