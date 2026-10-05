#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'

const { version } = await import('../package.json')

const main = defineCommand({
  meta: {
    name: 'openpencil',
    description: 'OpenPencil CLI — inspect, build, and verify OpenPencil artifacts',
    version
  },
  subCommands: {
    analyze: () => import('./commands/analyze').then((module) => module.default),
    backend: () => import('./commands/backend').then((module) => module.default),
    build: () => import('./commands/build').then((module) => module.default),
    compile: () => import('./commands/compile').then((module) => module.default),
    convert: () => import('./commands/convert').then((module) => module.default),
    deploy: () => import('./commands/deploy').then((module) => module.default),
    diff: () => import('./commands/diff').then((module) => module.default),
    documents: () => import('./commands/documents').then((module) => module.default),
    eval: () => import('./commands/eval').then((module) => module.default),
    export: () => import('./commands/export').then((module) => module.default),
    import: () => import('./commands/import').then((module) => module.default),
    find: () => import('./commands/find').then((module) => module.default),
    formats: () => import('./commands/formats').then((module) => module.default),
    fonts: () => import('./commands/fonts').then((module) => module.default),
    info: () => import('./commands/info').then((module) => module.default),
    library: () => import('./commands/library').then((module) => module.default),
    libraries: () => import('./commands/libraries').then((module) => module.default),
    lint: () => import('./commands/lint').then((module) => module.default),
    motion: () => import('./commands/motion').then((module) => module.default),
    microfrontend: () => import('./commands/microfrontend').then((module) => module.default),
    query: () => import('./commands/query').then((module) => module.default),
    node: () => import('./commands/node').then((module) => module.default),
    pages: () => import('./commands/pages').then((module) => module.default),
    plugin: () => import('./commands/plugin').then((module) => module.default),
    selection: () => import('./commands/selection').then((module) => module.default),
    tree: () => import('./commands/tree').then((module) => module.default),
    variables: () => import('./commands/variables').then((module) => module.default)
  }
})

await runMain(main)
