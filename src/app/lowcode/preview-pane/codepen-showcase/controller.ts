import { ref } from 'vue'

import {
  codePenPackageName,
  mergeCodePenCompilerWarnings,
  validateCodePenShowcaseCommandOptions,
  type CodePenShowcaseResult
} from './command'
import { codePenShowcaseErrorDetails, codePenShowcaseErrorMessage } from './errors'
import { createCodePenShowcaseAbortError, isCodePenShowcaseAbortError } from './runner'
import {
  clearCodePenListeners,
  codePenBindingIsCurrent,
  currentCodePenBinding,
  type CodePenCancellationReason,
  type CodePenShowcaseAvailability,
  type CodePenShowcaseDependencies,
  type CodePenShowcaseInput,
  type CodePenShowcaseOperation,
  type CodePenShowcaseStatus,
  type PreparedCodePenShowcase,
  type UseCodePenShowcaseResult
} from './types'

function copyInput(input: CodePenShowcaseInput): CodePenShowcaseInput {
  return {
    ...input,
    ...(input.tags ? { tags: [...input.tags] } : {}),
    ...(input.locales ? { locales: [...input.locales] } : {})
  }
}

function failedPreparationStatus(
  request: CodePenShowcaseOperation,
  result: CodePenShowcaseResult | null,
  primaryError: unknown,
  dependencies: CodePenShowcaseDependencies
): CodePenShowcaseStatus | null {
  if (request.cancellationReason === 'stale') {
    return {
      kind: 'error',
      message: 'The document or page changed during safety checks. Run safety checks again.'
    }
  }
  if (request.cancellationReason) return { kind: 'idle' }
  if (primaryError) {
    return isCodePenShowcaseAbortError(primaryError)
      ? { kind: 'idle' }
      : { kind: 'error', ...codePenShowcaseErrorDetails(primaryError) }
  }
  if (!result || !request.optionsDigest || !codePenBindingIsCurrent(request, dependencies)) {
    return {
      kind: 'error',
      message: 'The CodePen safety-check result became stale. Run safety checks again.'
    }
  }
  return null
}

export function createCodePenShowcaseController(
  dependencies: CodePenShowcaseDependencies,
  availability: CodePenShowcaseAvailability
): UseCodePenShowcaseResult & { dispose(): void } {
  const status = ref<CodePenShowcaseStatus>({ kind: 'idle' })
  let activeOperation: CodePenShowcaseOperation | null = null
  let prepared: PreparedCodePenShowcase | null = null
  let opening = false

  function clearPrepared(): void {
    if (!prepared) return
    clearCodePenListeners(prepared.unbinds)
    prepared = null
  }

  function setOperationCancelled(
    request: CodePenShowcaseOperation,
    reason: CodePenCancellationReason
  ): void {
    if (activeOperation !== request || request.cancellationReason) return
    request.cancellationReason = reason
    request.controller?.abort()
    status.value = { kind: 'cancelling' }
  }

  function requestIsCurrent(request: CodePenShowcaseOperation): boolean {
    return !request.cancellationReason && codePenBindingIsCurrent(request, dependencies)
  }

  function assertRequestIsCurrent(request: CodePenShowcaseOperation): void {
    if (activeOperation === request && requestIsCurrent(request)) return
    if (activeOperation === request && !request.cancellationReason) {
      setOperationCancelled(request, 'stale')
    }
    throw createCodePenShowcaseAbortError()
  }

  function subscribeOperation(request: CodePenShowcaseOperation): void {
    const invalidate = (): void => {
      if (!requestIsCurrent(request)) setOperationCancelled(request, 'stale')
    }
    request.unbinds.push(
      request.store.onEditorEvent('render:requested', invalidate),
      request.store.onEditorEvent('graph:replaced', () => setOperationCancelled(request, 'stale')),
      request.store.onEditorEvent('page:changed', () => setOperationCancelled(request, 'stale')),
      request.store.onSourceChanged(() => setOperationCancelled(request, 'stale'))
    )
  }

  function subscribePrepared(binding: PreparedCodePenShowcase): void {
    const invalidate = (): void => {
      if (opening || prepared !== binding) return
      clearPrepared()
      status.value = {
        kind: 'error',
        message: 'The document or page changed after safety checks. Run safety checks again.'
      }
    }
    const invalidateChangedScene = (): void => {
      if (!codePenBindingIsCurrent(binding, dependencies)) invalidate()
    }
    binding.unbinds.push(
      binding.store.onEditorEvent('render:requested', invalidateChangedScene),
      binding.store.onEditorEvent('graph:replaced', invalidate),
      binding.store.onEditorEvent('page:changed', invalidate),
      binding.store.onSourceChanged(invalidate)
    )
  }

  function reset(): void {
    if (activeOperation || opening) return
    clearPrepared()
    status.value = { kind: 'idle' }
  }

  function cancel(): void {
    if (activeOperation) setOperationCancelled(activeOperation, 'user')
  }

  async function prepare(input: CodePenShowcaseInput): Promise<void> {
    if (activeOperation || opening) return
    if (!availability.available) {
      status.value = {
        kind: 'error',
        message: availability.unavailableReason ?? 'CodePen is unavailable.'
      }
      return
    }

    clearPrepared()
    const binding = currentCodePenBinding(dependencies)
    const request: CodePenShowcaseOperation = {
      ...binding,
      input: copyInput(input),
      optionsDigest: null,
      controller: null,
      cancellationReason: null,
      unbinds: []
    }
    activeOperation = request
    subscribeOperation(request)

    let result: CodePenShowcaseResult | null = null
    let primaryError: unknown = null
    try {
      request.optionsDigest = await dependencies.digestInput(request.input)
      assertRequestIsCurrent(request)
      request.controller = new AbortController()
      status.value = { kind: 'compiling' }
      const commandOptions = {
        ...request.input,
        packageName: codePenPackageName(request.documentName)
      }
      validateCodePenShowcaseCommandOptions(commandOptions)
      const compiled = await dependencies.compileProject(
        commandOptions,
        request.store,
        request.controller.signal
      )
      assertRequestIsCurrent(request)
      const sidecarResult = await dependencies.runSidecar(
        commandOptions,
        compiled.files,
        request.controller.signal
      )
      assertRequestIsCurrent(request)
      result = mergeCodePenCompilerWarnings(sidecarResult, compiled.warnings)
    } catch (error) {
      primaryError = error
    }

    clearCodePenListeners(request.unbinds)
    if (activeOperation === request) activeOperation = null
    request.controller = null

    const failure = failedPreparationStatus(request, result, primaryError, dependencies)
    if (failure) {
      status.value = failure
      return
    }

    prepared = {
      ...binding,
      result: result as CodePenShowcaseResult,
      optionsDigest: request.optionsDigest as string,
      unbinds: []
    }
    subscribePrepared(prepared)
    status.value = { kind: 'ready', result: prepared.result }
  }

  async function openInCodePen(input: CodePenShowcaseInput): Promise<void> {
    if (activeOperation || opening || status.value.kind !== 'ready' || !prepared) return
    const review = prepared
    const result = review.result
    opening = true
    status.value = { kind: 'opening', result }
    try {
      const optionsDigest = await dependencies.digestInput(copyInput(input))
      if (prepared !== review || optionsDigest !== review.optionsDigest) {
        throw new Error('CodePen showcase settings changed after safety checks. Run them again.')
      }
      if (!codePenBindingIsCurrent(review, dependencies)) {
        throw new Error('The document or page changed after safety checks. Run them again.')
      }
      clearPrepared()
      await dependencies.openPrefill(result.data)
      status.value = { kind: 'done', result }
    } catch (error) {
      clearPrepared()
      status.value = { kind: 'error', message: codePenShowcaseErrorMessage(error) }
    } finally {
      opening = false
    }
  }

  function dispose(): void {
    clearPrepared()
    if (activeOperation) setOperationCancelled(activeOperation, 'disposed')
  }

  return {
    status,
    available: availability.available,
    unavailableReason: availability.unavailableReason,
    prepare,
    openInCodePen,
    cancel,
    reset,
    dispose
  }
}
