import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import type { AppBackendProviderDocumentGraph } from '@/app/plugins/host/backend-provider'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import {
  MAX_SUPABASE_SOURCE_LEDGER_IMPORT_BYTES,
  DesktopSupabaseSourceMigrationExportError,
  type DesktopSupabaseSourceMigrationExportErrorCode,
  type DesktopSupabaseSourceMigrationExportResult
} from '@/app/plugins/host/deployment/desktop/supabase/source-migration/export'
import { appDesktopSupabaseSourceMigrationExportService } from '@/app/plugins/host/deployment/desktop/supabase/source-migration/export-app'
import { isTauri } from '@/app/tauri/env'

export type SupabaseSourceMigrationExportLocalError =
  | DesktopSupabaseSourceMigrationExportErrorCode
  | 'invalid-ledger-file'
  | 'ledger-file-too-large'

export const SUPABASE_SOURCE_MIGRATION_NAME_MAX_LENGTH = 64

const MIGRATION_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const MAX_VISIBLE_FILE_NAME_LENGTH = 128

export interface SupabaseSourceMigrationExportControllerInput {
  readonly getConfig: () => SupabaseConfig | undefined
  readonly getGraph: () => AppBackendProviderDocumentGraph
  readonly getReviewed: () => DesktopSupabaseBackendReviewResult
  readonly getExternalBusy: () => boolean
  readonly onBusy: (value: boolean) => void
  readonly onExported: (result: DesktopSupabaseSourceMigrationExportResult) => void
}

function clearFileInput(input: HTMLInputElement | undefined): void {
  if (input) input.value = ''
}

function selectedFile(event: Event): File | null {
  const input = event.currentTarget as HTMLInputElement
  return input.files?.item(0) ?? null
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DesktopSupabaseSourceMigrationExportError('aborted')
}

async function readLedgerFile(file: File | null, signal: AbortSignal): Promise<string | undefined> {
  if (!file) return undefined
  if (file.size > MAX_SUPABASE_SOURCE_LEDGER_IMPORT_BYTES) {
    throw new DesktopSupabaseSourceMigrationExportError('invalid-ledger')
  }
  throwIfAborted(signal)
  const text = await file.text()
  throwIfAborted(signal)
  if (new TextEncoder().encode(text).byteLength > MAX_SUPABASE_SOURCE_LEDGER_IMPORT_BYTES) {
    throw new DesktopSupabaseSourceMigrationExportError('invalid-ledger')
  }
  return text
}

export function useSupabaseSourceMigrationExportController(
  input: SupabaseSourceMigrationExportControllerInput
) {
  const migrationName = ref('')
  const localBusy = ref(false)
  const localError = ref<SupabaseSourceMigrationExportLocalError | null>(null)
  const result = shallowRef<DesktopSupabaseSourceMigrationExportResult | null>(null)
  const outcomeUnknown = ref(false)
  const activeController = shallowRef<AbortController | null>(null)
  const inspectedLedgerInput = ref<HTMLInputElement>()
  const promotionLedgerInput = ref<HTMLInputElement>()
  const inspectedLedgerFile = shallowRef<File | null>(null)
  const promotionLedgerFile = shallowRef<File | null>(null)
  const inspectedLedgerName = ref('')
  const promotionLedgerName = ref('')

  const liveGraph: AppBackendProviderDocumentGraph = Object.freeze({
    get rootId() {
      return input.getGraph().rootId
    },
    getNode(id: string) {
      return input.getGraph().getNode(id)
    }
  })

  const busy = computed(() => localBusy.value || input.getExternalBusy())
  const canExport = computed(() => {
    const reviewed = input.getReviewed()
    return (
      isTauri() &&
      !busy.value &&
      !outcomeUnknown.value &&
      MIGRATION_NAME.test(migrationName.value) &&
      input.getConfig() !== undefined &&
      reviewed.reviewReady &&
      reviewed.blockerCount === 0
    )
  })

  function clearSelectedLedgerFiles(): void {
    inspectedLedgerFile.value = null
    promotionLedgerFile.value = null
    inspectedLedgerName.value = ''
    promotionLedgerName.value = ''
    clearFileInput(inspectedLedgerInput.value)
    clearFileInput(promotionLedgerInput.value)
  }

  function setInspectedLedgerInput(value: unknown): void {
    inspectedLedgerInput.value = value instanceof HTMLInputElement ? value : undefined
  }

  function setPromotionLedgerInput(value: unknown): void {
    promotionLedgerInput.value = value instanceof HTMLInputElement ? value : undefined
  }

  function updateMigrationName(event: Event): void {
    const element = event.currentTarget as HTMLInputElement
    const normalized = element.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/gu, '')
      .slice(0, SUPABASE_SOURCE_MIGRATION_NAME_MAX_LENGTH)
    element.value = normalized
    migrationName.value = normalized
    result.value = null
    if (!outcomeUnknown.value) localError.value = null
  }

  function acceptLedgerFile(file: File | null): file is File {
    if (!file || !file.name.toLowerCase().endsWith('.json')) {
      localError.value = 'invalid-ledger-file'
      return false
    }
    if (file.size > MAX_SUPABASE_SOURCE_LEDGER_IMPORT_BYTES) {
      localError.value = 'ledger-file-too-large'
      return false
    }
    return true
  }

  function selectLedger(
    event: Event,
    fileRef: typeof inspectedLedgerFile,
    nameRef: typeof inspectedLedgerName,
    inputRef: typeof inspectedLedgerInput
  ): void {
    const file = selectedFile(event)
    if (!acceptLedgerFile(file)) {
      fileRef.value = null
      nameRef.value = ''
      clearFileInput(inputRef.value)
      return
    }
    fileRef.value = file
    nameRef.value = file.name.slice(0, MAX_VISIBLE_FILE_NAME_LENGTH)
    localError.value = null
    result.value = null
  }

  function selectInspectedLedger(event: Event): void {
    selectLedger(event, inspectedLedgerFile, inspectedLedgerName, inspectedLedgerInput)
  }

  function selectPromotionLedger(event: Event): void {
    selectLedger(event, promotionLedgerFile, promotionLedgerName, promotionLedgerInput)
  }

  async function exportMigration(): Promise<void> {
    if (!canExport.value || localBusy.value) return
    localBusy.value = true
    localError.value = null
    result.value = null
    const controller = new AbortController()
    activeController.value = controller
    let inspectedFile: File | null = inspectedLedgerFile.value
    let promotionFile: File | null = promotionLedgerFile.value
    let inspectedSourceLedgerJSON = ''
    let promotionLedgerJSON = ''
    clearSelectedLedgerFiles()
    try {
      inspectedSourceLedgerJSON = (await readLedgerFile(inspectedFile, controller.signal)) ?? ''
      promotionLedgerJSON = (await readLedgerFile(promotionFile, controller.signal)) ?? ''
      const config = input.getConfig()
      const exported = await appDesktopSupabaseSourceMigrationExportService.exportMigration({
        config,
        readConfig: input.getConfig,
        graph: liveGraph,
        reviewed: input.getReviewed(),
        name: migrationName.value,
        ...(inspectedSourceLedgerJSON ? { inspectedSourceLedgerJSON } : {}),
        ...(promotionLedgerJSON ? { promotionLedgerJSON } : {}),
        signal: controller.signal
      })
      if (exported.outcome === 'cancelled') return
      result.value = exported
      input.onExported(exported)
    } catch (cause) {
      const code =
        cause instanceof DesktopSupabaseSourceMigrationExportError ? cause.code : 'export-failed'
      localError.value = code
      if (code === 'outcome-unknown') outcomeUnknown.value = true
    } finally {
      inspectedSourceLedgerJSON = ''
      promotionLedgerJSON = ''
      inspectedFile = null
      promotionFile = null
      clearSelectedLedgerFiles()
      if (activeController.value === controller) activeController.value = null
      localBusy.value = false
    }
  }

  watch(localBusy, input.onBusy, { immediate: true })
  watch(
    () => {
      const config = input.getConfig()
      const reviewed = input.getReviewed()
      return [
        config?.url,
        config?.schema,
        reviewed.artifact.manifestDigest,
        input.getGraph().rootId
      ]
    },
    () => {
      if (localBusy.value) return
      localError.value = null
      result.value = null
      outcomeUnknown.value = false
      clearSelectedLedgerFiles()
    }
  )

  onScopeDispose(() => {
    activeController.value?.abort()
    activeController.value = null
    clearSelectedLedgerFiles()
    input.onBusy(false)
  })

  return {
    busy,
    canExport,
    exportMigration,
    inspectedLedgerName,
    localBusy,
    localError,
    migrationName,
    promotionLedgerName,
    result,
    selectInspectedLedger,
    selectPromotionLedger,
    setInspectedLedgerInput,
    setPromotionLedgerInput,
    updateMigrationName
  }
}
