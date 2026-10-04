import { runInNewContext } from 'node:vm'

import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

export interface MediaHost {
  type: string
  text: string
  props: Record<string, unknown>
  style: Record<string, unknown>
  children: MediaHost[]
  parent: MediaHost | null
  volume: number
  playbackRate: number
  pauses: number
  loads: number
  pause(): void
  load(): void
  removeAttribute(name: string): void
  replaceChildren(): void
}

function host(type = 'root', text = ''): MediaHost {
  return Vue.markRaw({
    type,
    text,
    props: {},
    style: {},
    children: [],
    parent: null,
    volume: 1,
    playbackRate: 1,
    pauses: 0,
    loads: 0,
    pause() {
      this.pauses++
    },
    load() {
      this.loads++
    },
    removeAttribute(name: string) {
      Reflect.deleteProperty(this.props, name)
    },
    replaceChildren() {
      for (const child of this.children) child.parent = null
      this.children = []
    }
  })
}
function remove(node: MediaHost) {
  if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
  node.parent = null
}
function insert(node: MediaHost, parent: MediaHost, anchor?: MediaHost | null) {
  remove(node)
  node.parent = parent
  const index = anchor ? parent.children.indexOf(anchor) : -1
  if (index < 0) parent.children.push(node)
  else parent.children.splice(index, 0, node)
}

/** Execute the emitted SFC's actual setup and compiled template with Vue's renderer. */
export function mountMediaSfc<C extends object>(
  source: string,
  config: C,
  libraries: Record<string, unknown> = {}
) {
  const descriptor = parse(source, { filename: 'Media.vue' }).descriptor
  const compiled = compileScript(descriptor, { id: 'media-test', inlineTemplate: true })
  let code = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(compiled.content)
  code = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g,
    (_match, bindings: string) => 'const {' + bindings.replace(/\bas\b/g, ':') + '} = Vue'
  )
  code = code.replace(
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    (_match, name: string, dependency: string) =>
      'const ' + name + ' = Libraries[' + JSON.stringify(dependency) + ']'
  )
  code = code.replace('export default', 'const Component =')
  const component = runInNewContext(code + '\nComponent', {
    Vue,
    Libraries: libraries,
    AbortController,
    URL,
    TextEncoder,
    TextDecoder,
    structuredClone,
    window: {
      matchMedia: () => ({ matches: libraries.reducedMotion === true }),
      setTimeout,
      clearTimeout
    },
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args)
  }) as Vue.Component
  const renderer = Vue.createRenderer<MediaHost, MediaHost>({
    patchProp: (node, key, _previous, value) => {
      node.props[key] = value
    },
    insert,
    remove,
    createElement: (type) => host(type),
    createText: (text) => host('text', text),
    createComment: (text) => host('comment', text),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) =>
      node.parent?.children[(node.parent?.children.indexOf(node) ?? -1) + 1] ?? null,
    querySelector: () => null,
    setScopeId: () => undefined,
    insertStaticContent: (content, parent, anchor) => {
      const node = host('static', content)
      insert(node, parent, anchor)
      return [node, node]
    }
  })
  const state = Vue.shallowRef(config),
    root = host(),
    revision = Vue.ref(0)
  const app = renderer.createApp({
    render: () => {
      return Vue.h(
        component,
        { config: state.value, 'data-owned-host': 'yes', 'data-revision': revision.value },
        { default: () => Vue.h('em', null, 'Authored child') }
      )
    }
  })
  app.mount(root)
  const nodes = (type: string) => {
    const found: MediaHost[] = []
    const walk = (node: MediaHost) => {
      if (node.type === type) found.push(node)
      node.children.forEach(walk)
    }
    walk(root)
    return found
  }
  return {
    root,
    state,
    nodes,
    rerender: () => {
      revision.value++
    },
    unmount: () => app.unmount(),
    tick: async () => {
      await Vue.nextTick()
      await Promise.resolve()
      await Vue.nextTick()
    }
  }
}
