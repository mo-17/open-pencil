import type { CompileWarning } from '@open-pencil/compiler'
import {
  parseCodePenSidecarResponse,
  serializeCodePenSidecarRequest,
  type CodePenSidecarDiagnostic,
  type CodePenSidecarOptions,
  type CodePenSidecarRequestInput,
  type CodePenSidecarSuccessResult,
  type CodePenSidecarTarget
} from '@open-pencil/compiler/codepen/sidecar-wire'

import { safeSourceProjectPackageName } from '@/app/plugins/host/source-project'

import { CodePenShowcaseSidecarError } from './errors'

export type CodePenShowcaseTarget = CodePenSidecarTarget
type PreviewFiles = CodePenSidecarRequestInput['files']

export interface CodePenShowcaseCommandOptions extends Omit<CodePenSidecarOptions, 'title'> {
  target: CodePenShowcaseTarget
  packageName: string
  title: string
  uiKit?: 'none' | 'shadcn'
  i18n?: boolean
  locales?: string[]
}

export interface CodePenCompiledShowcase {
  files: PreviewFiles
  warnings: CompileWarning[]
}

export interface CodePenShowcaseResult extends CodePenSidecarSuccessResult {
  warnings: CompileWarning[]
}

export type CodePenReviewNotice = Pick<CodePenSidecarDiagnostic, 'code' | 'message'>

export const CODEPEN_REVIEW_NOTICE_LIMIT = 100

export function codePenReviewNotices(
  notices: readonly CodePenReviewNotice[]
): CodePenReviewNotice[] {
  return notices
    .slice(0, CODEPEN_REVIEW_NOTICE_LIMIT)
    .map(({ code, message }) => ({ code, message }))
}

function prefillOptions(options: CodePenShowcaseCommandOptions): CodePenSidecarOptions {
  return {
    title: options.title.trim(),
    description: options.description?.trim(),
    tags: options.tags?.map((tag) => tag.trim()),
    private: options.private,
    layout: options.layout
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function truncateUTF8(value: string, maximum: number): string {
  let output = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = utf8ByteLength(character)
    if (bytes + characterBytes > maximum) break
    output += character
    bytes += characterBytes
  }
  return output
}

export function validateCodePenShowcaseCommandOptions(
  options: CodePenShowcaseCommandOptions
): void {
  const title = options.title.trim()
  if (!options.packageName || !title) {
    throw new Error('CodePen showcase package name and title are required.')
  }
  if (utf8ByteLength(title) > 256) {
    throw new Error('CodePen showcase title must be at most 256 UTF-8 bytes.')
  }
  if (options.description && utf8ByteLength(options.description.trim()) > 4096) {
    throw new Error('CodePen showcase description must be at most 4096 UTF-8 bytes.')
  }
  if ((options.tags?.length ?? 0) > 5) {
    throw new Error('CodePen showcase accepts at most five tags.')
  }
  if (options.tags?.some((tag) => !tag.trim() || utf8ByteLength(tag.trim()) > 64)) {
    throw new Error('Each CodePen showcase tag must be 1 to 64 UTF-8 bytes.')
  }
}

export function buildCodePenSidecarRequest(
  options: CodePenShowcaseCommandOptions,
  files: PreviewFiles,
  requestId: string
): string {
  if (!requestId) throw new Error('CodePen showcase request id is required.')
  validateCodePenShowcaseCommandOptions(options)
  return serializeCodePenSidecarRequest({
    requestId,
    target: options.target,
    packageName: options.packageName,
    files,
    options: prefillOptions(options)
  })
}

export function parseCodePenSidecarResult(
  raw: string,
  requestId: string,
  expected: Pick<CodePenShowcaseCommandOptions, 'target' | 'packageName'>
): CodePenSidecarSuccessResult {
  const response = parseCodePenSidecarResponse(raw, requestId)
  if (!response.ok) {
    throw new CodePenShowcaseSidecarError(
      response.error.code,
      response.error.message,
      response.error.diagnostics
    )
  }
  if (
    response.result.target !== expected.target ||
    response.result.packageName !== expected.packageName
  ) {
    throw new Error('CodePen sidecar response identity does not match the request.')
  }
  return response.result
}

export function mergeCodePenCompilerWarnings(
  result: CodePenSidecarSuccessResult,
  warnings: readonly CompileWarning[]
): CodePenShowcaseResult {
  return { ...result, warnings: [...warnings] }
}

export function defaultCodePenTitle(documentName: string): string {
  return truncateUTF8(documentName.trim() || 'OpenPencil Showcase', 256)
}

export function codePenTags(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((entry) => truncateUTF8(entry, 64))
}

export function codePenPackageName(documentName: string): string {
  return safeSourceProjectPackageName(documentName || 'OpenPencil Showcase')
}
