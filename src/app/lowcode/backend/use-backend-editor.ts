import { computed, nextTick, ref, toRaw, watch } from 'vue'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type { PluginDataEntry } from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { appPluginStore, appPluginStoreSnapshot } from '@/app/plugins/app'
import {
  APP_BACKEND_PROVIDER_DOCUMENT_KEY,
  APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
  AppBackendProviderBuildError,
  listAppBackendProviderDescriptors,
  type AppBackendProviderBuildRequest,
  type AppBackendProviderDescriptor
} from '@/app/plugins/host/backend-provider'

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

export function backendProviderDescriptorKey(descriptor: AppBackendProviderDescriptor): string {
  return [
    descriptor.pluginId,
    descriptor.contributionId,
    descriptor.providerId,
    descriptor.adapterId,
    descriptor.packageAuthority.packageDigest
  ].join('\u0000')
}

export function backendProviderDescriptorLabel(descriptor: AppBackendProviderDescriptor): string {
  return `${descriptor.providerId} · ${descriptor.pluginId}`
}

export function useBackendEditor() {
  const editor = useEditorStore()
  const { panels } = useI18n()
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
  watch(
    providerDescriptors,
    (descriptors) => {
      if (!selectedProviderKey.value && descriptors[0]) {
        selectedProviderKey.value = backendProviderDescriptorKey(descriptors[0])
      }
    },
    { immediate: true }
  )

  const draftValidation = computed(() =>
    validateBackendApplicationDraft(toRaw(draft.value), selectedDescriptor.value)
  )
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
      clearArmed.value = false
    },
    { deep: true }
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

  return {
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
