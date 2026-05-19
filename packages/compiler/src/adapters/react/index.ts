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
import type { CompilerOptions, CompileWarning } from '#compiler/types'
import type { AdapterEmission, FrameworkAdapter } from '../types'

import { buildPreviewBridge } from './preview-bridge'
import { buildAppTsx, PAGE_WRAPPER_CLASSES } from './scaffold'

export const reactAdapter: FrameworkAdapter = {
  emit(irs: readonly IRTree[], options: CompilerOptions): AdapterEmission {
    // Phase 1 §11 step 1: pipeline accepts N IRs but only the single-page
    // shape is wired through. The multi-page branch (router shell +
    // src/pages/<slug>.tsx) lands in step 2; until then we warn and fall
    // back to emitting just the first page so production callers
    // (preview-pane, CLI single-page mode) keep working.
    const warnings: CompileWarning[] = []
    if (irs.length > 1) {
      warnings.push({
        code: 'multi-page-emit-pending',
        message:
          `${irs.length} pages were requested but the React adapter only emits ` +
          `the first page until Phase 1 §11 step 2 lands (react-router-dom wiring).`
      })
    }
    const ir = irs[0]
    const files = new Map<string, string | Uint8Array>()
    files.set('package.json', buildPackageJson(options))
    files.set('vite.config.ts', buildViteConfig())
    files.set('tsconfig.json', buildTsConfig())
    files.set('index.html', buildIndexHtml(options.packageName))
    files.set('src/main.tsx', buildMainTsx())
    files.set('src/App.tsx', buildAppTsx(ir, { devMode: options.devMode }))
    files.set('src/index.css', buildIndexCss(collectClassNames([ir])))
    files.set('.gitignore', buildGitignore())
    if (options.devMode) {
      files.set('src/__preview-bridge.ts', buildPreviewBridge())
    }
    return { files, warnings }
  }
}

function collectClassNames(irs: readonly IRTree[]): string[] {
  // Seed with the wrapper classes scaffold.ts emits on the page <div>.
  // They never appear in the IR (the wrapper isn't an IRNode), so without
  // this seed Tailwind v4 wouldn't generate them and absolute children lose
  // their reference frame in the VFS-served iframe.
  const acc = new Set<string>(PAGE_WRAPPER_CLASSES)
  for (const ir of irs) {
    for (const child of ir.children) walk(child, acc)
  }
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
