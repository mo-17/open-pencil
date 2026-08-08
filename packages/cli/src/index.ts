#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'

import analyze from './commands/analyze'
import build from './commands/build'
import compile from './commands/compile'
import convert from './commands/convert'
import deploy from './commands/deploy'
import documents from './commands/documents'
import evalCmd from './commands/eval'
import exportCmd from './commands/export'
import find from './commands/find'
import formats from './commands/formats'
import importCmd from './commands/import'
import info from './commands/info'
import library from './commands/library'
import lint from './commands/lint'
import motion from './commands/motion'
import node from './commands/node'
import pages from './commands/pages'
import plugin from './commands/plugin'
import query from './commands/query'
import selection from './commands/selection'
import tree from './commands/tree'
import variables from './commands/variables'

const { version } = await import('../package.json')

const main = defineCommand({
  meta: {
    name: 'openpencil',
    description: 'OpenPencil CLI — inspect, build, and verify OpenPencil artifacts',
    version
  },
  subCommands: {
    analyze,
    build,
    compile,
    convert,
    deploy,
    documents,
    eval: evalCmd,
    export: exportCmd,
    import: importCmd,
    find,
    formats,
    info,
    library,
    lint,
    motion,
    query,
    node,
    pages,
    plugin,
    selection,
    tree,
    variables
  }
})

void runMain(main)
