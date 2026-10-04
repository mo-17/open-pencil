import { expect, test } from 'bun:test'
import { posix } from 'node:path'

import * as vue from 'vue'
import * as vueRouter from 'vue-router'
import { compileScript, parse } from 'vue/compiler-sfc'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function routingProject() {
  const graph = new SceneGraph()
  const home = graph.getPages()[0]
  graph.createNode('TEXT', home.id, { text: 'Home' })
  const products = graph.addPage('Products')
  graph.updateNode(products.id, {
    lowcodeRoutePattern: '/products/:id',
    state: [
      {
        id: 'route-label',
        name: 'routeLabel',
        type: 'string',
        defaultValue: '',
        computedExpr: '$params.id + ":" + $query.tab'
      }
    ]
  })
  graph.createNode('TEXT', products.id, {
    bindings: { text: { kind: 'expr', expr: '"Page " + routeLabel' } }
  })
  graph.createNode('TEXT', products.id, {
    bindings: { text: { kind: 'expr', expr: '"Direct " + $params.id + ":" + $query.tab' } }
  })
  const master = graph.createNode('COMPONENT', home.id, {
    name: 'Route Card',
    width: 180,
    height: 80
  })
  graph.createNode('TEXT', master.id, {
    bindings: { text: { kind: 'expr', expr: '"Card " + $params.id + ":" + $query.tab' } }
  })
  function button(parentId: string, label: string, tab: string) {
    graph.createNode('BUTTON', parentId, {
      interactiveProps: { text: label },
      events: {
        onClick: [
          { kind: 'navigate', to: `/products/:id?tab=${tab}#${tab}`, params: { id: '$params.id' } }
        ]
      }
    })
  }
  button(products.id, 'Page navigation', 'page')
  button(master.id, 'Card navigation', 'card')
  if (!graph.createInstance(master.id, products.id)) throw new Error('Missing route-card instance')
  return compile({
    graph,
    pageIds: [home.id, products.id],
    options: withDefaults({
      target: 'vue',
      router: 'vue-router-v4',
      packageName: 'route-reactivity',
      devMode: false
    })
  })
}

interface HostNode {
  tag?: string
  text?: string
  parent?: HostNode
  children: HostNode[]
  props: Record<string, unknown>
}

function renderHost() {
  const node = (text?: string, tag?: string): HostNode => ({ text, tag, children: [], props: {} })
  const renderer = vue.createRenderer<HostNode, HostNode>({
    patchProp: (target, key, _previous, value) => {
      target.props[key] = value
    },
    insert(target, parent) {
      if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1)
      target.parent = parent
      parent.children.push(target)
    },
    remove(target) {
      if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1)
    },
    createElement: (tag) => node(undefined, tag),
    createText: (text) => node(text),
    createComment: () => node(),
    setText: (target, text) => {
      target.text = text
    },
    setElementText: (target, text) => {
      target.text = text
    },
    parentNode: (target) => target.parent ?? null,
    nextSibling: () => null
  })
  return { renderer, root: node() }
}

function text(node: HostNode): string {
  return (node.text ?? '') + node.children.map(text).join(' ')
}

function findButton(node: HostNode, label: string): HostNode | undefined {
  if (node.tag === 'button' && text(node).includes(label)) return node
  return node.children.map((child) => findButton(child, label)).find(Boolean)
}

function loadSfc(files: ReadonlyMap<string, string | Uint8Array>, filename: string): vue.Component {
  const source = files.get(filename)
  if (typeof source !== 'string') throw new Error('Missing ' + filename)
  const parsed = parse(source, { filename })
  expect(parsed.errors).toEqual([])
  const compiled = compileScript(parsed.descriptor, { id: filename, inlineTemplate: true })
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  const modules: Record<string, unknown> = { vue, 'vue-router': vueRouter }
  const executable = transpiler
    .transformSync(compiled.content)
    .replace(
      /import \{([\s\S]*?)\} from ["']([^"']+)["'];?/g,
      (_statement, names: string, module: string) =>
        `const {${names.replace(/\bas\b/g, ':')}} = __modules[${JSON.stringify(module)}];`
    )
    .replace(
      /import ([\w$]+) from ["']([^"']+)["'];?/g,
      (_statement, alias: string, module: string) => {
        modules[module] = loadSfc(
          files,
          posix.normalize(posix.join(posix.dirname(filename), module))
        )
        return `const ${alias} = __modules[${JSON.stringify(module)}];`
      }
    )
    .replace('export default', 'return')
  return new Function('__modules', executable)(modules) as vue.Component
}

test('generated page, computed state and reusable-component route reads follow same-page replacements and events', async () => {
  const output = routingProject()
  expect(output.warnings).toEqual([])
  const products = loadSfc(output.files, 'src/pages/products.vue')
  const router = vueRouter.createRouter({
    history: vueRouter.createMemoryHistory(),
    routes: [{ path: '/products/:id', component: products }]
  })
  const { renderer, root } = renderHost()
  await router.push('/products/42?tab=details#reviews')
  const app = renderer.createApp({ render: () => vue.h(vueRouter.RouterView) })
  app.use(router)
  await router.isReady()
  app.mount(root)
  try {
    await vue.nextTick()
    for (const label of ['Page', 'Direct', 'Card'])
      expect(text(root)).toContain(`${label} 42:details`)
    await router.replace('/products/73?tab=summary#updated')
    await vue.nextTick()
    for (const label of ['Page', 'Direct', 'Card'])
      expect(text(root)).toContain(`${label} 73:summary`)
    for (const [label, tab] of [
      ['Page navigation', 'page'],
      ['Card navigation', 'card']
    ]) {
      const handler = findButton(root, label)?.props.onClick
      if (typeof handler !== 'function') throw new Error('Missing ' + label)
      await handler({ target: { value: '' } })
      await vue.nextTick()
      expect(router.currentRoute.value.fullPath).toBe(`/products/73?tab=${tab}#${tab}`)
      for (const prefix of ['Page', 'Direct', 'Card'])
        expect(text(root)).toContain(`${prefix} 73:${tab}`)
    }
  } finally {
    app.unmount()
  }
})

test('generated reactive route locals typecheck in pages and reusable components', () => {
  const output = routingProject()
  const files = new Map<string, string>()
  for (const [path, value] of output.files) if (typeof value === 'string') files.set(path, value)
  typeCheckCompilerFiles(files, 'vue')
}, 35000)

test('generated custom validation reads the latest route and query values', () => {
  const graph = new SceneGraph()
  const home = graph.getPages()[0]
  const products = graph.addPage('Products')
  graph.updateNode(products.id, {
    lowcodeRoutePattern: '/products/:id',
    state: [{ id: 'email', name: 'email', type: 'string', defaultValue: 'test@example.com' }]
  })
  graph.createNode('INPUT', products.id, {
    bindings: { value: { kind: 'ref', stateId: 'email' } },
    interactiveProps: {
      validation: {
        customExpr: '$params.id === "73" && $query.tab === "allowed"',
        messages: { custom: 'Route validation failed' }
      }
    }
  })
  const output = compile({
    graph,
    pageIds: [home.id, products.id],
    options: withDefaults({
      target: 'vue',
      router: 'vue-router-v4',
      packageName: 'route-validation',
      devMode: false
    })
  })
  expect(output.warnings).toEqual([])
  const source = output.files.get('src/pages/products.vue') as string
  const runtime = output.files.get('src/lowcode-validation.ts') as string
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  const validateValue = new Function(
    transpiler.transformSync(runtime).replace('export function', 'function') +
      ';return __opValidateValue'
  )()
  const declarations = source
    .split('\n')
    .filter((line) => /^const (\$(params|query)|__opState_email_)/.test(line))
    .join('\n')
  const validators = source.slice(
    source.indexOf('const __validators:'),
    source.indexOf('function __resetFieldValidation')
  )
  const route = vue.shallowReactive({ params: { id: '42' }, query: { tab: 'blocked' } })
  const functions = new Function(
    '__vueComputed',
    '__vueRef',
    '__opRoute',
    '__opValidateValue',
    transpiler.transformSync(declarations + '\n' + validators) + ';return __validators'
  )(vue.computed, vue.ref, route, validateValue) as Record<string, () => string | null>
  const validate = Object.values(functions)[0]
  expect(validate()).toBe('Route validation failed')
  route.params = { id: '73' }
  route.query = { tab: 'allowed' }
  expect(validate()).toBeNull()
})
