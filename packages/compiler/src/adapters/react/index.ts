import {
  buildGitignore,
  buildIndexCss,
  buildIndexHtml,
  buildMainTsx,
  buildPackageJson,
  buildTsConfig,
  buildViteConfig
} from '#compiler/project'
import type { IRNode, IRTree } from '#compiler/ir/types'
import type { CompilerOptions } from '#compiler/types'
import type { AdapterEmission, FrameworkAdapter } from '../types'

import { buildPreviewBridge } from './preview-bridge'
import { buildAppTsx, PAGE_WRAPPER_CLASSES } from './scaffold'

export const reactAdapter: FrameworkAdapter = {
  emit(ir: IRTree, options: CompilerOptions): AdapterEmission {
    const files = new Map<string, string | Uint8Array>()
    files.set('package.json', buildPackageJson(options))
    files.set('vite.config.ts', buildViteConfig())
    files.set('tsconfig.json', buildTsConfig())
    files.set('index.html', buildIndexHtml(options.packageName))
    files.set('src/main.tsx', buildMainTsx())
    files.set('src/App.tsx', buildAppTsx(ir, { devMode: options.devMode }))
    files.set('src/index.css', buildIndexCss(collectClassNames(ir)))
    files.set('.gitignore', buildGitignore())
    if (options.devMode) {
      files.set('src/__preview-bridge.ts', buildPreviewBridge())
    }
    return { files, warnings: [] }
  }
}

function collectClassNames(ir: IRTree): string[] {
  // Seed with the wrapper classes scaffold.ts emits on the page <div>.
  // They never appear in the IR (the wrapper isn't an IRNode), so without
  // this seed Tailwind v4 wouldn't generate them and absolute children lose
  // their reference frame in the VFS-served iframe.
  const acc = new Set<string>(PAGE_WRAPPER_CLASSES)
  for (const child of ir.children) walk(child, acc)
  return [...acc].sort()
}

function walk(node: IRNode, acc: Set<string>): void {
  if (node.kind !== 'element') return
  if (node.className) {
    for (const cls of node.className.split(/\s+/)) {
      if (cls) acc.add(cls)
    }
  }
  for (const child of node.children) walk(child, acc)
}
