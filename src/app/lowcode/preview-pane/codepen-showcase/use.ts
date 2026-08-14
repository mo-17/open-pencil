import { onScopeDispose } from 'vue'

import { compile, resolveCompilerWebFonts, withDefaults } from '@open-pencil/compiler'

import { getActiveEditorStore } from '@/app/editor/active-store'
import { isTauri } from '@/app/tauri/env'

import {
  buildCodePenSidecarRequest,
  parseCodePenSidecarResult,
  type CodePenCompiledShowcase,
  type CodePenShowcaseCommandOptions,
  type CodePenShowcaseResult
} from './command'
import { createCodePenShowcaseController } from './controller'
import { runCodePenSidecarRequest } from './runner'
import type {
  CodePenShowcaseAvailability,
  CodePenShowcaseDependencies,
  CodePenShowcaseInput,
  CodePenShowcaseStore,
  UseCodePenShowcaseResult
} from './types'

export type {
  CodePenShowcaseAvailability,
  CodePenShowcaseDependencies,
  CodePenShowcaseInput,
  CodePenShowcaseStatus,
  CodePenShowcaseStore,
  UseCodePenShowcaseResult
} from './types'
export { createCodePenShowcaseController } from './controller'

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('CodePen showcase cancelled.', 'AbortError')
}

function codePenRouter(
  target: CodePenShowcaseCommandOptions['target'],
  pageCount: number
): 'none' | 'react-router-v6' | 'vue-router-v4' {
  if (pageCount <= 1) return 'none'
  return target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
}

async function compileCodePenProject(
  options: CodePenShowcaseCommandOptions,
  store: CodePenShowcaseStore,
  signal: AbortSignal
): Promise<CodePenCompiledShowcase> {
  throwIfAborted(signal)
  const pageIds = store.graph.getPages().map((page) => page.id)
  if (pageIds.length === 0) throw new Error('The current document has no pages to compile.')
  if (options.target === 'vue' && options.i18n) {
    throw new Error('Vue v1 does not support CodePen i18n export; disable i18n or use React.')
  }
  const fontManifest =
    options.target === 'vue'
      ? { faces: [] }
      : await resolveCompilerWebFonts({ graph: store.graph, pageIds })
  throwIfAborted(signal)
  const compiled = compile({
    graph: store.graph,
    pageIds,
    fontManifest,
    options: withDefaults({
      packageName: options.packageName,
      devMode: false,
      target: options.target,
      router: codePenRouter(options.target, pageIds.length),
      i18n: options.target === 'react' && options.i18n === true,
      ...(options.i18n && options.locales?.length ? { locales: [...options.locales] } : {}),
      ...(options.target === 'react' && options.uiKit === 'shadcn'
        ? { uiKit: 'shadcn' as const }
        : {})
    })
  })
  throwIfAborted(signal)
  if (compiled.files.size === 0) {
    const codes = compiled.warnings.map((warning) => warning.code).join(', ')
    throw new Error(`CodePen compile produced no files${codes ? ` (${codes})` : ''}.`)
  }
  return {
    files: compiled.files,
    warnings:
      options.target === 'vue'
        ? [
            {
              code: 'vue-font-assets-omitted',
              message:
                'Vue v1 preserves authored font-family CSS but does not embed font binaries in the CodePen showcase.'
            },
            ...compiled.warnings
          ]
        : compiled.warnings
  }
}

function effectiveInput(input: CodePenShowcaseInput): Readonly<Record<string, unknown>> {
  const i18n = input.i18n === true
  return Object.freeze({
    target: input.target,
    uiKit: input.target === 'react' && input.uiKit === 'shadcn' ? 'shadcn' : 'none',
    i18n,
    locales: i18n ? [...(input.locales ?? [])] : [],
    title: input.title.trim(),
    description: input.description?.trim() ?? '',
    tags: [...(input.tags ?? [])],
    private: input.private === true,
    layout: input.layout ?? 'left'
  })
}

export async function digestCodePenShowcaseInput(input: CodePenShowcaseInput): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(effectiveInput(input)))
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const DEFAULT_DEPENDENCIES: CodePenShowcaseDependencies = Object.freeze({
  getActiveStore: getActiveEditorStore,
  compileProject: compileCodePenProject,
  runSidecar(
    options: CodePenShowcaseCommandOptions,
    files: CodePenCompiledShowcase['files'],
    signal: AbortSignal
  ) {
    const requestId = crypto.randomUUID()
    return runCodePenSidecarRequest(
      buildCodePenSidecarRequest(options, files, requestId),
      (raw) => parseCodePenSidecarResult(raw, requestId, options),
      signal
    )
  },
  async openPrefill(data: CodePenShowcaseResult['data']) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_codepen_prefill', { request: { data } })
  },
  digestInput: digestCodePenShowcaseInput
})

function defaultAvailability(): CodePenShowcaseAvailability {
  const tauri = isTauri()
  if (!tauri) {
    return {
      available: false,
      unavailableReason: 'CodePen showcase export is currently available in the desktop app only.'
    }
  }
  return { available: true, unavailableReason: null }
}

export function useCodePenShowcase(): UseCodePenShowcaseResult {
  const controller = createCodePenShowcaseController(DEFAULT_DEPENDENCIES, defaultAvailability())
  onScopeDispose(() => controller.dispose())
  return controller
}
