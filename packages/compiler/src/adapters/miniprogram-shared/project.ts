import type { IRTree } from '#compiler/ir/types'
import type { MiniProgramCompilerTarget } from '#compiler/types'

import { portableMiniProgramPathKey, uniqueMiniProgramName } from './names'
import type {
  MiniProgramPagePlan,
  MiniProgramProjectBudgetDiagnostic,
  MiniProgramProjectBudgetDiagnosticCode,
  MiniProgramProjectLimits,
  MiniProgramWarningSink
} from './types'

const UTF8_ENCODER = new TextEncoder()

export const MINIPROGRAM_PROJECT_LIMITS: Readonly<MiniProgramProjectLimits> = Object.freeze({
  maxFiles: 512,
  maxTextFileBytes: 1 * 1024 * 1024,
  maxBinaryFileBytes: 2 * 1024 * 1024,
  maxAggregateBytes: 16 * 1024 * 1024,
  maxPathBytes: 240,
  maxAssets: 256,
  maxPages: 100
})

const WECHAT_MINIPROGRAM_MAIN_PACKAGE_MAX_BYTES = 2 * 1024 * 1024
const WECHAT_NON_PACKAGE_SOURCE_FILES = new Set(['README.md', 'project.config.json'])
const PAGE_FILE_PATTERN_BY_TARGET: Readonly<Record<MiniProgramCompilerTarget, RegExp>> =
  Object.freeze({
    'wechat-miniprogram': /^pages\/[^/]+\/index\.wxml$/u,
    taro: /^src\/pages\/[^/]+\/index\.tsx$/u,
    'uni-app': /^pages\/[^/]+\/index\.vue$/u,
    mpx: /^src\/pages\/[^/]+\/index\.mpx$/u
  })

function projectBudgetMessage(diagnostic: MiniProgramProjectBudgetDiagnostic): string {
  const target = diagnostic.target ? ` ${diagnostic.target}` : ''
  const path = diagnostic.path ? ` ${JSON.stringify(diagnostic.path)}` : ''
  const usage =
    diagnostic.actual === undefined || diagnostic.limit === undefined
      ? ''
      : ` (${diagnostic.actual} > ${diagnostic.limit})`
  const messages: Readonly<Record<MiniProgramProjectBudgetDiagnosticCode, string>> = {
    'mini-program-aggregate-byte-limit': `Mini-program${target} project exceeds the aggregate byte limit${usage}`,
    'mini-program-asset-count-limit': `Mini-program${target} project exceeds the binary asset count limit${usage}`,
    'mini-program-binary-file-byte-limit': `Mini-program${target} binary file${path} exceeds the byte limit${usage}`,
    'mini-program-file-count-limit': `Mini-program${target} project exceeds the file count limit${usage}`,
    'mini-program-page-count-limit': `Mini-program${target} project exceeds the page count limit${usage}`,
    'mini-program-path-byte-limit': `Mini-program${target} project path${path} exceeds the byte limit${usage}`,
    'mini-program-portable-path-collision': `Mini-program${target} project contains a portable path collision at${path}`,
    'mini-program-text-file-byte-limit': `Mini-program${target} text file${path} exceeds the byte limit${usage}`,
    'mini-program-unsafe-path': `Mini-program${target} project contains an unsafe path:${path}`,
    'wechat-miniprogram-main-package-byte-limit': `Native WeChat Mini Program output exceeds the main-package byte limit${usage}; split into subpackages or reduce assets before export`
  }
  return `[${diagnostic.code}] ${messages[diagnostic.code]}`
}

export class MiniProgramProjectBudgetError extends RangeError {
  readonly code = 'MINIPROGRAM_PROJECT_BUDGET' as const
  readonly diagnostic: Readonly<MiniProgramProjectBudgetDiagnostic>

  constructor(diagnostic: MiniProgramProjectBudgetDiagnostic) {
    super(projectBudgetMessage(diagnostic))
    this.name = 'MiniProgramProjectBudgetError'
    this.diagnostic = Object.freeze({ ...diagnostic })
  }
}

function failProjectBudget(diagnostic: MiniProgramProjectBudgetDiagnostic): never {
  throw new MiniProgramProjectBudgetError(diagnostic)
}

export function createMiniProgramPagePlan(
  irs: readonly IRTree[],
  warn: MiniProgramWarningSink,
  warningPrefix: string,
  limits: Readonly<MiniProgramProjectLimits> = MINIPROGRAM_PROJECT_LIMITS
): MiniProgramPagePlan[] {
  if (irs.length > limits.maxPages) {
    throw new RangeError(`Mini-program page count exceeds the limit of ${limits.maxPages}`)
  }
  const used = new Set<string>()
  return irs.map((ir, index) => {
    const requested = ir.pageName.trim() || (index === 0 ? 'index' : `page-${index + 1}`)
    const slug = uniqueMiniProgramName(requested, used, index === 0 ? 'index' : 'page')
    if (slug !== requested.toLowerCase()) {
      warn({
        code: `${warningPrefix}-page-path-sanitized`,
        message: `Mini-program export mapped page ${JSON.stringify(ir.pageName)} to portable path ${JSON.stringify(slug)}`,
        nodeId: ir.pageId
      })
    }
    const directory = `pages/${slug}`
    return {
      ir,
      pageId: ir.pageId,
      pageName: ir.pageName,
      slug,
      route: `${directory}/index`,
      directory
    }
  })
}

export function assertSafeMiniProgramProjectPath(
  path: string,
  limits: Readonly<MiniProgramProjectLimits> = MINIPROGRAM_PROJECT_LIMITS
): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    hasControlCharacter(path) ||
    path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`Unsafe mini-program project path: ${JSON.stringify(path)}`)
  }
  if (UTF8_ENCODER.encode(path).byteLength > limits.maxPathBytes) {
    throw new RangeError(`Mini-program project path exceeds ${limits.maxPathBytes} bytes`)
  }
}

export function setMiniProgramProjectFile(
  files: Map<string, string | Uint8Array>,
  path: string,
  content: string | Uint8Array,
  limits: Readonly<MiniProgramProjectLimits> = MINIPROGRAM_PROJECT_LIMITS
): void {
  assertSafeMiniProgramProjectPath(path, limits)
  const key = portableMiniProgramPathKey(path)
  if ([...files.keys()].some((existing) => portableMiniProgramPathKey(existing) === key)) {
    throw new TypeError(`Duplicate mini-program project path: ${JSON.stringify(path)}`)
  }
  const byteLength = projectFileByteLength(content)
  const maximum = typeof content === 'string' ? limits.maxTextFileBytes : limits.maxBinaryFileBytes
  if (byteLength > maximum) {
    throw new RangeError(
      `Mini-program ${typeof content === 'string' ? 'text' : 'binary'} file ${JSON.stringify(path)} exceeds ${maximum} bytes`
    )
  }
  if (files.size >= limits.maxFiles) {
    throw new RangeError(`Mini-program project exceeds the file limit of ${limits.maxFiles}`)
  }
  files.set(path, content)
}

export function assertMiniProgramProjectBudget(
  files: ReadonlyMap<string, string | Uint8Array>,
  limits: Readonly<MiniProgramProjectLimits> = MINIPROGRAM_PROJECT_LIMITS,
  target?: MiniProgramCompilerTarget
): void {
  if (files.size > limits.maxFiles) {
    failProjectBudget({
      actual: files.size,
      code: 'mini-program-file-count-limit',
      limit: limits.maxFiles,
      ...(target ? { target } : {})
    })
  }
  let total = 0
  let assets = 0
  const seen = new Set<string>()
  for (const [path, content] of files) {
    try {
      assertSafeMiniProgramProjectPath(path, limits)
    } catch (cause) {
      failProjectBudget({
        ...(cause instanceof RangeError
          ? {
              actual: UTF8_ENCODER.encode(path).byteLength,
              code: 'mini-program-path-byte-limit' as const,
              limit: limits.maxPathBytes
            }
          : { code: 'mini-program-unsafe-path' as const }),
        path,
        ...(target ? { target } : {})
      })
    }
    const key = portableMiniProgramPathKey(path)
    if (seen.has(key)) {
      failProjectBudget({
        code: 'mini-program-portable-path-collision',
        path,
        ...(target ? { target } : {})
      })
    }
    seen.add(key)
    const byteLength = projectFileByteLength(content)
    const maximum =
      typeof content === 'string' ? limits.maxTextFileBytes : limits.maxBinaryFileBytes
    if (byteLength > maximum) {
      failProjectBudget({
        actual: byteLength,
        code:
          typeof content === 'string'
            ? 'mini-program-text-file-byte-limit'
            : 'mini-program-binary-file-byte-limit',
        limit: maximum,
        path,
        ...(target ? { target } : {})
      })
    }
    if (typeof content !== 'string') assets++
    total += byteLength
    if (!Number.isSafeInteger(total) || total > limits.maxAggregateBytes) {
      failProjectBudget({
        actual: total,
        code: 'mini-program-aggregate-byte-limit',
        limit: limits.maxAggregateBytes,
        ...(target ? { target } : {})
      })
    }
  }
  if (assets > limits.maxAssets) {
    failProjectBudget({
      actual: assets,
      code: 'mini-program-asset-count-limit',
      limit: limits.maxAssets,
      ...(target ? { target } : {})
    })
  }
}

/** Validate the complete source project after host-owned warning files are added. */
export function assertMiniProgramExportProjectBudget(
  target: MiniProgramCompilerTarget,
  files: ReadonlyMap<string, string | Uint8Array>
): void {
  const limits = MINIPROGRAM_PROJECT_LIMITS
  assertMiniProgramProjectBudget(files, limits, target)
  const pagePattern = PAGE_FILE_PATTERN_BY_TARGET[target]
  const pages = [...files.keys()].filter((path) => pagePattern.test(path)).length
  if (pages > limits.maxPages) {
    failProjectBudget({
      actual: pages,
      code: 'mini-program-page-count-limit',
      limit: limits.maxPages,
      target
    })
  }
  if (target !== 'wechat-miniprogram') return

  let mainPackageBytes = 0
  for (const [path, content] of files) {
    if (WECHAT_NON_PACKAGE_SOURCE_FILES.has(path)) continue
    mainPackageBytes += projectFileByteLength(content)
    if (
      !Number.isSafeInteger(mainPackageBytes) ||
      mainPackageBytes > WECHAT_MINIPROGRAM_MAIN_PACKAGE_MAX_BYTES
    ) {
      failProjectBudget({
        actual: mainPackageBytes,
        code: 'wechat-miniprogram-main-package-byte-limit',
        limit: WECHAT_MINIPROGRAM_MAIN_PACKAGE_MAX_BYTES,
        target
      })
    }
  }
}

function projectFileByteLength(content: string | Uint8Array): number {
  return typeof content === 'string' ? UTF8_ENCODER.encode(content).byteLength : content.byteLength
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 31 || code === 127) return true
  }
  return false
}
