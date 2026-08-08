import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { LoaderModule } from 'vitepress'
import { createChecker } from 'vue-component-meta'

import { getOrCreateProcessSingleton } from './process-singleton'
import { createRefreshingChecker } from './refreshing-checker'

export interface SdkComponentPropMeta {
  name: string
  type: string
  description: string
  required: boolean
  default?: string
}

export interface SdkComponentEventMeta {
  name: string
  payload: string
  description: string
}

export interface SdkComponentSlotMeta {
  name: string
  props: string
  description: string
}

export interface SdkComponentExposeMeta {
  name: string
  type: string
  description: string
}

export interface SdkComponentMeta {
  name: string
  source: string
  props: SdkComponentPropMeta[]
  events: SdkComponentEventMeta[]
  slots: SdkComponentSlotMeta[]
  exposed: SdkComponentExposeMeta[]
}

function findWorkspaceRoot(start: string): string {
  let directory = start
  while (true) {
    const packagePath = join(directory, 'package.json')
    if (existsSync(packagePath)) {
      const packageJSON = JSON.parse(readFileSync(packagePath, 'utf8')) as { workspaces?: unknown }
      if (Array.isArray(packageJSON.workspaces)) return directory
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error('Unable to locate workspace root')
    directory = parent
  }
}

const repoRoot = findWorkspaceRoot(fileURLToPath(new URL('.', import.meta.url)))
const vueTsconfig = realpathSync(resolve(repoRoot, 'packages/vue/tsconfig.json'))
const checkerService = getOrCreateProcessSingleton(
  `vue-component-meta:${vueTsconfig}:schema=false`,
  () => createRefreshingChecker(createChecker(vueTsconfig, { schema: false }), vueTsconfig)
)

export interface SdkComponentData {
  components: SdkComponentMeta[]
}

export function defineComponentMetaLoader(sources: string[]): LoaderModule<SdkComponentData> {
  return {
    watch: [vueTsconfig, ...sources.map((source) => resolve(repoRoot, source))],
    load: () => {
      checkerService.refreshConfig()
      return { components: sources.map(readComponentMeta) }
    }
  }
}

export function readComponentMeta(source: string): SdkComponentMeta {
  const absoluteSource = resolve(repoRoot, source)
  checkerService.refreshFile(absoluteSource)
  const meta = checkerService.checker.getComponentMeta(absoluteSource)

  return {
    name:
      meta.name ??
      source
        .split('/')
        .at(-1)
        ?.replace(/\.vue$/, '') ??
      source,
    source,
    props: meta.props
      .filter((prop) => !prop.global)
      .map((prop) => ({
        name: prop.name,
        type: prop.type,
        description: prop.description,
        required: prop.required,
        default: prop.default
      })),
    events: meta.events.map((event) => ({
      name: event.name,
      payload: event.type,
      description: event.description
    })),
    slots: meta.slots.map((slot) => ({
      name: slot.name,
      props: slot.type,
      description: slot.description
    })),
    exposed: meta.exposed.map((entry) => ({
      name: entry.name,
      type: entry.type,
      description: entry.description
    }))
  }
}
