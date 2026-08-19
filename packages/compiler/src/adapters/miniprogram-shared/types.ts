import type { IRTree } from '#compiler/ir/types'
import type { CompileWarning, MiniProgramCompilerTarget } from '#compiler/types'

export type MiniProgramWarningSink = (warning: CompileWarning) => void

export interface MiniProgramProjectLimits {
  maxFiles: number
  maxTextFileBytes: number
  maxBinaryFileBytes: number
  maxAggregateBytes: number
  maxPathBytes: number
  maxAssets: number
  maxPages: number
}

export type MiniProgramProjectBudgetDiagnosticCode =
  | 'mini-program-aggregate-byte-limit'
  | 'mini-program-asset-count-limit'
  | 'mini-program-binary-file-byte-limit'
  | 'mini-program-file-count-limit'
  | 'mini-program-page-count-limit'
  | 'mini-program-path-byte-limit'
  | 'mini-program-portable-path-collision'
  | 'mini-program-text-file-byte-limit'
  | 'mini-program-unsafe-path'
  | 'wechat-miniprogram-main-package-byte-limit'

export interface MiniProgramProjectBudgetDiagnostic {
  actual?: number
  code: MiniProgramProjectBudgetDiagnosticCode
  limit?: number
  path?: string
  target?: MiniProgramCompilerTarget
}

export interface MiniProgramPagePlan {
  ir: IRTree
  pageId: string
  pageName: string
  slug: string
  /** Extension-free application route, for example `pages/home/index`. */
  route: string
  /** Directory containing the platform page files. */
  directory: string
}

export interface MiniProgramAssetFile {
  sourcePath: string
  outputPath: string
  bytes: Uint8Array
}

export interface MiniProgramAssetPlan {
  assets: readonly MiniProgramAssetFile[]
  /** Resolve either a complete authored path or its unique basename. */
  resolve(sourcePath: string): string | undefined
}

export interface MiniProgramStyleResult {
  declarations: Readonly<Record<string, string>>
  unsupportedUtilities: readonly string[]
  /** Authored basename from `bg-[url(./assets/...)]`; adapters resolve it through the asset plan. */
  backgroundAsset?: string
}
