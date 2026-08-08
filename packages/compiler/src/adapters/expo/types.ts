import type { CompileWarning } from '#compiler/types'

export type ExpoWarningSink = (warning: CompileWarning) => void

export type ExpoStyleValue = string | number | readonly Record<string, string | number>[]

export interface ExpoStyleResult {
  style: Record<string, ExpoStyleValue>
  backgroundAsset?: string
  placeholderTextColor?: string
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center' | 'repeat'
}
