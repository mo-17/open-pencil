import type { SubCommandsDef } from 'citty'

/**
 * The top-level `openpencil` commands by name, as `--help` lists them. The docs site counts them
 * from here, so its numbers follow the CLI.
 */
export const COMMANDS = {
  backend: () => import('./backend').then((module) => module.default),
  build: () => import('./build').then((module) => module.default),
  compile: () => import('./compile').then((module) => module.default),
  deploy: () => import('./deploy').then((module) => module.default),
  library: () => import('./library').then((module) => module.default),
  motion: () => import('./motion').then((module) => module.default),
  microfrontend: () => import('./microfrontend').then((module) => module.default),
  plugin: () => import('./plugin').then((module) => module.default),
  analyze: () => import('./analyze').then((module) => module.default),
  convert: () => import('./convert').then((module) => module.default),
  diff: () => import('./diff').then((module) => module.default),
  documents: () => import('./documents').then((module) => module.default),
  eval: () => import('./eval').then((module) => module.default),
  export: () => import('./export').then((module) => module.default),
  import: () => import('./import').then((module) => module.default),
  find: () => import('./find').then((module) => module.default),
  formats: () => import('./formats').then((module) => module.default),
  fonts: () => import('./fonts').then((module) => module.default),
  info: () => import('./info').then((module) => module.default),
  lint: () => import('./lint').then((module) => module.default),
  libraries: () => import('./libraries').then((module) => module.default),
  query: () => import('./query').then((module) => module.default),
  node: () => import('./node').then((module) => module.default),
  pages: () => import('./pages').then((module) => module.default),
  redo: () => import('./history').then((module) => module.redo),
  selection: () => import('./selection').then((module) => module.default),
  settings: () => import('./settings').then((module) => module.default),
  tool: () => import('./tool').then((module) => module.default),
  tokens: () => import('./tokens').then((module) => module.default),
  tree: () => import('./tree').then((module) => module.default),
  undo: () => import('./history').then((module) => module.undo),
  variables: () => import('./variables').then((module) => module.default)
} satisfies SubCommandsDef
