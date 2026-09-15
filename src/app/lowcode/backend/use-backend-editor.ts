import { computed, nextTick, onScopeDispose, ref, toRaw, watch } from 'vue'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import { canonicalManifestJSON, type PluginDataEntry } from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { appPluginStore, appPluginStoreSnapshot } from '@/app/plugins/app'
import {
  APP_BACKEND_PROVIDER_DOCUMENT_KEY,
  APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
  AppBackendProviderBuildError,
  listAppBackendProviderDescriptors,
  type AppBackendProviderBuildRequest
} from '@/app/plugins/host/backend-provider'

import { createCommerceApplication } from './commerce/application'
import { commerceCopy } from './commerce/copy'
import { canInstallCommerceExample, createCommercePages } from './commerce/template'
import {
  BackendDocumentValidationError,
  clearBackendProviderDocumentRequest,
  commitBackendProviderDocumentRequest,
  createBackendProviderDocumentRequest,
  createEmptyBackendApplication,
  readBackendProviderDocumentRequest,
  validateBackendApplicationDraft
} from './document'
import { createBackendDraftId } from './draft'
import { registerBackendDraftGuard } from './draft/pending'
import { createBackendGettingStartedGuide } from './getting-started'
import { backendGettingStartedViewCopy } from './getting-started/view-copy'
import { backendLibraryCopy } from './library/copy'
import {
  createBackendLibraryInstaller,
  hasBackendAuthenticationFlow,
  isEmptyBackendLibraryDraft,
  type BackendLibraryInstallContext
} from './library/install'
import { createBackendModuleInstaller } from './library/modules'
import { backendProviderDescriptorKey } from './library/provider-identity'
import { backendLibraryViewCopy } from './library/view-copy'
import { createNestJSNotesApplication, isNestJSProvider } from './nestjs-draft'
import { createPersonalNotesPages } from './notes-template'

export {
  backendProviderDescriptorKey,
  backendProviderDescriptorLabel
} from './library/provider-identity'

export function useBackendEditor() {
  const editor = useEditorStore()
  const { panels, locale } = useI18n()
  const createDefaultApplication = (): BackendApplicationSpecV1 => {
    const rootId = editor.graph.rootId || createBackendDraftId('document')
    return createEmptyBackendApplication(`app:${rootId}`.slice(0, 64))
  }

  const draft = ref<BackendApplicationSpecV1>(createDefaultApplication())
  const committedRequest = ref<AppBackendProviderBuildRequest | null>(null)
  const selectedProviderKey = ref('')
  const readError = ref('')
  const operationError = ref('')
  const outcome = ref('')
  const busy = ref(false)
  const clearArmed = ref(false)
  const draftRevision = ref(0)

  const providerDescriptors = computed(() => {
    const snapshot = appPluginStoreSnapshot.value
    if (!snapshot.ready || snapshot.error) return []
    return [...listAppBackendProviderDescriptors(appPluginStore)]
  })
  const providersLoading = computed(() => !appPluginStoreSnapshot.value.ready)
  const selectedDescriptor = computed(
    () =>
      providerDescriptors.value.find(
        (descriptor) => backendProviderDescriptorKey(descriptor) === selectedProviderKey.value
      ) ?? null
  )
  const committedProviderUnavailable = computed(() => {
    const committed = committedRequest.value
    return Boolean(
      committed &&
      backendProviderDescriptorKey(committed.selection) === selectedProviderKey.value &&
      !selectedDescriptor.value
    )
  })

  const rootPluginData = useSceneComputed<PluginDataEntry[]>(() => {
    return editor.graph.getNode(editor.graph.rootId)?.pluginData ?? []
  })
  const fingerprintBackendEntries = (entries: readonly PluginDataEntry[]): string =>
    JSON.stringify(
      entries
        .filter(
          (entry) =>
            entry.pluginId === APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID &&
            entry.key === APP_BACKEND_PROVIDER_DOCUMENT_KEY
        )
        .map((entry) => entry.value)
    )
  const currentBackendEntryFingerprint = (): string =>
    fingerprintBackendEntries(editor.graph.getNode(editor.graph.rootId)?.pluginData ?? [])
  const backendEntryFingerprint = computed(() => fingerprintBackendEntries(rootPluginData.value))
  const hasBackendDeclaration = computed(() => backendEntryFingerprint.value !== '[]')
  const gettingStartedGuide = computed(() => {
    const saved = committedRequest.value
    return saved?.selection.providerId === 'nestjs'
      ? createBackendGettingStartedGuide(toRaw(saved.application), locale.value)
      : null
  })
  const gettingStartedPages = useSceneComputed(() =>
    editor.graph
      .getPages()
      .filter((page) => !page.internalOnly && page.lowcodeRoutePattern)
      .map(({ id, name, lowcodeRoutePattern }) => ({ id, name, lowcodeRoutePattern }))
  )
  const hasUnsavedBackendDraft = computed(() => {
    void draftRevision.value
    const saved = committedRequest.value
    return Boolean(
      saved &&
      (canonicalManifestJSON(toRaw(draft.value)) !== canonicalManifestJSON(saved.application) ||
        selectedProviderKey.value !== backendProviderDescriptorKey(saved.selection))
    )
  })

  const openGettingStartedPage = async (id: string): Promise<void> => {
    if (busy.value || !gettingStartedGuide.value) return
    const graph = editor.graph
    const page = graph.getNode(id)
    if (page?.type !== 'CANVAS' || page.internalOnly || !page.lowcodeRoutePattern) {
      operationError.value = backendGettingStartedViewCopy(locale.value).pageUnavailable
      return
    }
    try {
      await editor.switchPage(id)
      if (editor.graph === graph) editor.zoomToFit()
    } catch {
      operationError.value = backendGettingStartedViewCopy(locale.value).pageUnavailable
    }
  }

  const safeOperationMessage = (cause: unknown): string => {
    if (
      cause instanceof BackendDocumentValidationError ||
      cause instanceof AppBackendProviderBuildError
    ) {
      return cause.message
    }
    return panels.value.lowcodeBackendOperationError
  }

  const loadDocumentRequest = (): void => {
    readError.value = ''
    operationError.value = ''
    clearArmed.value = false
    try {
      const request = readBackendProviderDocumentRequest(editor.graph)
      committedRequest.value = request
      draft.value = request ? structuredClone(request.application) : createDefaultApplication()
      selectedProviderKey.value = request ? backendProviderDescriptorKey(request.selection) : ''
    } catch (cause) {
      committedRequest.value = null
      draft.value = createDefaultApplication()
      selectedProviderKey.value = ''
      readError.value = safeOperationMessage(cause)
    }
  }

  watch(backendEntryFingerprint, loadDocumentRequest, { immediate: true })
  onScopeDispose(
    registerBackendDraftGuard({
      graph: () => editor.graph,
      reason: () => {
        if (readError.value) return 'Resolve the saved Backend declaration before adding a module.'
        const request = committedRequest.value
        if (
          !request ||
          canonicalManifestJSON(toRaw(draft.value)) !==
            canonicalManifestJSON(request.application) ||
          selectedProviderKey.value !== backendProviderDescriptorKey(request.selection)
        )
          return 'Save or discard the current Backend draft and Provider selection before adding a module.'
        return ''
      }
    })
  )
  watch(
    providerDescriptors,
    (descriptors) => {
      if (!selectedProviderKey.value && descriptors[0]) {
        selectedProviderKey.value = backendProviderDescriptorKey(descriptors[0])
      }
    },
    { immediate: true }
  )

  const draftValidation = computed(() => {
    // Validation consumes detached plain data; explicitly track nested draft edits.
    void draftRevision.value
    return validateBackendApplicationDraft(toRaw(draft.value), selectedDescriptor.value)
  })
  const requestFingerprint = computed(() => {
    if (!selectedDescriptor.value || !draftValidation.value.ok) return ''
    try {
      return JSON.stringify(
        createBackendProviderDocumentRequest(selectedDescriptor.value, toRaw(draft.value))
      )
    } catch {
      return ''
    }
  })
  const committedFingerprint = computed(() =>
    committedRequest.value ? JSON.stringify(committedRequest.value) : ''
  )
  watch(
    draft,
    () => {
      draftRevision.value += 1
      clearArmed.value = false
    },
    { deep: true, flush: 'sync' }
  )
  watch(selectedProviderKey, () => {
    clearArmed.value = false
  })
  const dirty = computed(
    () =>
      Boolean(requestFingerprint.value) && requestFingerprint.value !== committedFingerprint.value
  )
  const canSave = computed(
    () =>
      !busy.value &&
      !readError.value &&
      Boolean(selectedDescriptor.value) &&
      draftValidation.value.ok &&
      dirty.value
  )

  const saveDraft = async (): Promise<void> => {
    if (!canSave.value || busy.value) return
    const descriptor = selectedDescriptor.value
    if (!descriptor) return
    const descriptorKey = backendProviderDescriptorKey(descriptor)
    const expectedDocumentFingerprint = currentBackendEntryFingerprint()
    const expectedRequestFingerprint = requestFingerprint.value
    const applicationSnapshot = structuredClone(toRaw(draft.value))
    busy.value = true
    operationError.value = ''
    outcome.value = ''
    clearArmed.value = false
    try {
      await Promise.resolve()
      if (
        selectedProviderKey.value !== descriptorKey ||
        currentBackendEntryFingerprint() !== expectedDocumentFingerprint ||
        requestFingerprint.value !== expectedRequestFingerprint
      ) {
        throw new AppBackendProviderBuildError(
          'request-invalid',
          'The Backend draft or document changed before save. Review it and try again.'
        )
      }
      const request = commitBackendProviderDocumentRequest(editor, descriptor, applicationSnapshot)
      committedRequest.value = request
      draft.value = structuredClone(request.application)
      selectedProviderKey.value = backendProviderDescriptorKey(request.selection)
      outcome.value = panels.value.lowcodeBackendSaved
      await nextTick()
    } catch (cause) {
      operationError.value = safeOperationMessage(cause)
    } finally {
      busy.value = false
    }
  }

  const clearDeclaration = async (): Promise<void> => {
    if (busy.value || !hasBackendDeclaration.value) return
    if (!clearArmed.value) {
      clearArmed.value = true
      outcome.value = ''
      return
    }
    const expectedDocumentFingerprint = currentBackendEntryFingerprint()
    busy.value = true
    operationError.value = ''
    try {
      await Promise.resolve()
      if (currentBackendEntryFingerprint() !== expectedDocumentFingerprint) {
        throw new AppBackendProviderBuildError(
          'request-invalid',
          'The Backend document changed before clear. Review it and try again.'
        )
      }
      clearBackendProviderDocumentRequest(editor)
      committedRequest.value = null
      draft.value = createDefaultApplication()
      selectedProviderKey.value = providerDescriptors.value[0]
        ? backendProviderDescriptorKey(providerDescriptors.value[0])
        : ''
      clearArmed.value = false
      outcome.value = panels.value.lowcodeBackendCleared
      await nextTick()
    } catch (cause) {
      operationError.value = safeOperationMessage(cause)
    } finally {
      busy.value = false
    }
  }

  const canInitializeNestJS = computed(() => {
    void draftRevision.value
    return (
      isNestJSProvider(selectedDescriptor.value?.providerId) &&
      !hasBackendDeclaration.value &&
      !readError.value &&
      isEmptyBackendLibraryDraft(toRaw(draft.value))
    )
  })
  function initializeNestJS(): void {
    if (!canInitializeNestJS.value || busy.value) return
    draft.value = createNestJSNotesApplication(draft.value.applicationId)
    outcome.value = ''
  }
  const hasAuthenticationFlow = useSceneComputed(() => hasBackendAuthenticationFlow(editor.graph))
  const canCreateNotesPages = computed(
    () =>
      !busy.value &&
      !readError.value &&
      isNestJSProvider(selectedDescriptor.value?.providerId) &&
      draftValidation.value.ok &&
      Boolean(draft.value.httpApi?.browserClient) &&
      !hasAuthenticationFlow.value
  )
  function createNotesPages(): void {
    const descriptor = selectedDescriptor.value
    if (!descriptor || !canCreateNotesPages.value) return
    busy.value = true
    operationError.value = ''
    try {
      const result = createPersonalNotesPages(
        editor,
        descriptor,
        structuredClone(toRaw(draft.value))
      )
      outcome.value = `${panels.value.lowcodeBackendNotesCreated} ${result.loginPath} → ${result.notesPath}`
    } catch (cause) {
      operationError.value =
        cause instanceof Error ? cause.message : panels.value.lowcodeBackendOperationError
    } finally {
      busy.value = false
    }
  }

  const libraryContext: BackendLibraryInstallContext = {
    editor,
    store: appPluginStore,
    draft,
    busy,
    readError,
    locale: () => locale.value,
    started: () => {
      operationError.value = ''
      outcome.value = ''
      clearArmed.value = false
    },
    created: (result) => {
      loadDocumentRequest()
      outcome.value = `${backendLibraryViewCopy(locale.value).created} ${backendLibraryCopy(locale.value).templates[result.templateId].name} ${result.path}`
    },
    failed: (cause) => {
      operationError.value = safeOperationMessage(cause)
    }
  }
  const libraryInstaller = createBackendLibraryInstaller(libraryContext)
  const moduleInstaller = createBackendModuleInstaller(
    libraryContext,
    () => selectedProviderKey.value
  )
  const libraryBlockReason = useSceneComputed(() => {
    void draftRevision.value
    return libraryInstaller.blockReason()
  })
  const moduleReviews = useSceneComputed(() => {
    void draftRevision.value
    void providerDescriptors.value
    return moduleInstaller.reviews()
  })

  const canCreateCommerce = computed(
    () =>
      !busy.value &&
      !readError.value &&
      isNestJSProvider(selectedDescriptor.value?.providerId) &&
      canInitializeNestJS.value &&
      canInstallCommerceExample(editor)
  )
  async function createCommerce(): Promise<void> {
    const descriptor = selectedDescriptor.value
    if (!descriptor || !canCreateCommerce.value) return
    busy.value = true
    operationError.value = ''
    try {
      const application = createCommerceApplication(draft.value.applicationId, {
        kind: 'oidc-pkce',
        issuer: 'http://127.0.0.1:18080/realms/openpencil',
        clientId: 'notes-public-client',
        scopes: ['openid', 'profile'],
        callbackPath: '/_openpencil/auth/callback'
      })
      const result = createCommercePages(editor, descriptor, application, locale.value)
      const productPage = editor.graph
        .getPages()
        .find((page) => page.lowcodeRoutePattern === result.paths.shop)
      if (productPage) {
        await editor.switchPage(productPage.id)
        editor.zoomToFit()
      }
      outcome.value = `${commerceCopy(locale.value).created} ${result.paths.shop}`
    } catch (cause) {
      operationError.value = safeOperationMessage(cause)
    } finally {
      busy.value = false
    }
  }

  return {
    gettingStartedGuide,
    gettingStartedPages,
    hasUnsavedBackendDraft,
    openGettingStartedPage,
    moduleReviews,
    addLibraryModule: moduleInstaller.add,
    libraryBlockReason,
    createLibraryTemplate: libraryInstaller.create,
    canCreateCommerce,
    createCommerce,
    canInitializeNestJS,
    initializeNestJS,
    canCreateNotesPages,
    createNotesPages,
    busy,
    canSave,
    clearArmed,
    clearDeclaration,
    committedProviderUnavailable,
    committedRequest,
    diagnostics: computed(() => draftValidation.value.diagnostics),
    draft,
    draftValidation,
    hasBackendDeclaration,
    operationError,
    outcome,
    providerDescriptors,
    providersLoading,
    readError,
    saveDraft,
    selectedDescriptor,
    selectedProviderKey
  }
}
