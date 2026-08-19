import { expoAdapter } from './adapters/expo'
import { flutterAdapter } from './adapters/flutter'
import { mpxAdapter } from './adapters/mpx'
import { reactAdapter } from './adapters/react'
import { taroAdapter } from './adapters/taro'
import type { FrameworkAdapter } from './adapters/types'
import { uniAppAdapter } from './adapters/uni-app'
import { vueAdapter } from './adapters/vue'
import { wechatMiniProgramAdapter } from './adapters/wechat-miniprogram'
import type { CompileWarning, CompilerOptions } from './types'

export interface AdapterSelection {
  /** Resolved adapter, or null when the target is not implemented. */
  adapter: FrameworkAdapter | null
  /** Warnings to surface to the caller (e.g. unsupported target). */
  warnings: CompileWarning[]
}

/**
 * Pick an adapter for the requested target. Runtime values outside the closed
 * target union fail closed with an explicit diagnostic.
 */
export function selectAdapter(options: CompilerOptions): AdapterSelection {
  const target: unknown = options.target
  switch (target) {
    case 'react':
      return { adapter: reactAdapter, warnings: [] }
    case 'vue':
      return { adapter: vueAdapter, warnings: [] }
    case 'expo':
      return { adapter: expoAdapter, warnings: [] }
    case 'flutter':
      return { adapter: flutterAdapter, warnings: [] }
    case 'wechat-miniprogram':
      return { adapter: wechatMiniProgramAdapter, warnings: [] }
    case 'taro':
      return { adapter: taroAdapter, warnings: [] }
    case 'uni-app':
      return { adapter: uniAppAdapter, warnings: [] }
    case 'mpx':
      return { adapter: mpxAdapter, warnings: [] }
  }
  // Reserved targets reject at runtime so callers get an explicit diagnostic
  // instead of a silently empty or partially generated project.
  return {
    adapter: null,
    warnings: [
      {
        code: 'target-not-implemented',
        message: `target '${String(target)}' is not implemented; supported targets are 'react', 'vue', 'expo', 'flutter', 'wechat-miniprogram', 'taro', 'uni-app', and 'mpx'`
      }
    ]
  }
}
