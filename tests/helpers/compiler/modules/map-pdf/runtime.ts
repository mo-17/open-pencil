import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createRenderer, h, nextTick, ref, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

export class ModuleHostNode {
  children: ModuleHostNode[] = []
  parent: ModuleHostNode | null = null
  props: Record<string, unknown> = {}
  text = ''
  style: Record<string, string> = {}
  listeners = new Map<string, EventListener>()
  constructor(readonly type: string) {}
  addEventListener(name: string, callback: EventListener) {
    this.listeners.set(name, callback)
  }
  removeEventListener(name: string, callback: EventListener) {
    if (this.listeners.get(name) === callback) this.listeners.delete(name)
  }
  getContext() {
    return { getExtension: () => ({ loseContext: () => undefined }) }
  }
  set textContent(value: string) {
    this.text = value
  }
  get textContent() {
    return this.text
  }
}

interface MockMapInstance {
  removed: number
  resized: number
  disabled: string[]
  canvas: ModuleHostNode
  options: Record<string, unknown>
}
interface MockMarkerInstance {
  removed: number
  popup?: { label: ModuleHostNode }
  coordinates?: number[]
}
export interface MockMapState {
  maps: MockMapInstance[]
  markers: MockMarkerInstance[]
  throwMarker: boolean
}

const mockMapSource = `export const state = {maps:[],markers:[],throwMarker:false}
export class Map {
  constructor(options){this.options=options;this.removed=0;this.resized=0;this.disabled=[];this.canvas=document.createElement('canvas');state.maps.push(this)
    for(const key of ['boxZoom','doubleClickZoom','dragPan','dragRotate','keyboard','scrollZoom','touchZoomRotate'])this[key]={disable:()=>this.disabled.push(key)}}
  getCanvas(){return this.canvas} remove(){this.removed++} resize(){this.resized++}
}
export class Marker {
  constructor(){this.removed=0;state.markers.push(this)}
  setLngLat(value){this.coordinates=value;return this} setPopup(value){this.popup=value;return this}
  addTo(){if(state.throwMarker)throw new Error('marker failed');return this} remove(){this.removed++}
}
export class Popup {setDOMContent(label){this.label=label;return this}}
`

export async function withModuleRuntime(
  source: string,
  run: (component: Component, state: MockMapState) => Promise<void>
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-map-pdf-runtime-'))
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  try {
    const deps = join(directory, 'node_modules')
    mkdirSync(deps)
    symlinkSync(realpathSync(resolve('node_modules/vue')), join(deps, 'vue'), 'dir')
    const mock = join(deps, 'maplibre-gl')
    mkdirSync(join(mock, 'dist'), { recursive: true })
    writeFileSync(
      join(mock, 'package.json'),
      JSON.stringify({ name: 'maplibre-gl', type: 'module', main: './index.js' })
    )
    writeFileSync(join(mock, 'index.js'), mockMapSource)
    writeFileSync(join(mock, 'dist/maplibre-gl.css'), '')
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: (name: string) => new ModuleHostNode(name) }
    })
    const parsed = parse(source)
    if (parsed.errors.length) {
      const error = parsed.errors[0]
      throw new Error(typeof error === 'string' ? error : error.message)
    }
    const compiled = compileScript(parsed.descriptor, {
      id: 'map-pdf-runtime',
      inlineTemplate: true
    })
    const path = join(directory, 'runtime.ts')
    writeFileSync(path, compiled.content)
    const runtime = (await import(pathToFileURL(path).href)) as { default: Component }
    const module = (await import(pathToFileURL(join(mock, 'index.js')).href)) as {
      state: MockMapState
    }
    await run(runtime.default, module.state)
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    rmSync(directory, { recursive: true, force: true })
  }
}

export function mountModuleRuntime(component: Component, initialConfig: unknown) {
  const root = new ModuleHostNode('root')
  const config = ref(initialConfig)
  const mounted = ref(true)
  const revision = ref(0)
  const renderer = createRenderer<ModuleHostNode, ModuleHostNode>({
    patchProp: (node, key, _previous, value) => {
      node.props[key] = value
    },
    createElement: (type) => new ModuleHostNode(type),
    createText: (text) => {
      const node = new ModuleHostNode('text')
      node.text = text
      return node
    },
    createComment: () => new ModuleHostNode('comment'),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    insert: (node, parent, anchor) => {
      remove(node)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove
  })
  const app = renderer.createApp({
    render: () =>
      h('main', [
        h('p', String(revision.value)),
        mounted.value
          ? h(
              component,
              {
                config: config.value,
                class: 'flex',
                style: { width: '520px', height: '360px' },
                'data-node-id': 'authored'
              },
              { default: () => h('span', 'Authored overlay') }
            )
          : null
      ])
  })
  app.mount(root)
  return { root, config, mounted, revision, settle: nextTick, dispose: () => app.unmount() }
}

function remove(node: ModuleHostNode) {
  if (node.parent) {
    const index = node.parent.children.indexOf(node)
    if (index !== -1) node.parent.children.splice(index, 1)
  }
  node.parent = null
}

export function findModuleNodes(root: ModuleHostNode, type: string): ModuleHostNode[] {
  return [root, ...root.children.flatMap((child) => findModuleNodes(child, type))].filter(
    (node) => node.type === type
  )
}
