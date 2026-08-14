import { describe, expect, test } from 'bun:test'

import {
  parseCompilerMicrofrontendPackaging,
  unsupportedMicrofrontendFeatures
} from '#compiler/microfrontend/policy'

import { compile, withDefaults, type CompilerOptions } from '@open-pencil/compiler'
import type {
  ComponentDef,
  IRElement,
  IREventHandler,
  IRTree
} from '@open-pencil/compiler/ir/types'

import { addTestColorVariable, firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function options(target: 'react' | 'vue' = 'react'): CompilerOptions {
  return withDefaults({
    packageName: `${target}-microfrontend-policy`,
    target,
    router: target === 'react' ? 'react-router-v6' : 'vue-router-v4',
    devMode: false,
    packaging: { kind: 'microfrontend', appId: `com.example.policy-${target}` }
  })
}

function tree(overrides: Partial<IRTree> = {}): IRTree {
  return {
    pageId: 'page',
    pageName: 'Page',
    usesRouteParams: false,
    children: [],
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    warnings: [],
    ...overrides
  }
}

function element(overrides: Partial<IRElement> = {}): IRElement {
  return {
    kind: 'element',
    sourceId: 'node',
    tag: 'div',
    className: '',
    attrs: {},
    children: [],
    ...overrides
  }
}

function compileGraph(target: 'react' | 'vue', graph = makeSceneGraph()) {
  return compile({ graph, pageIds: [firstPageId(graph)], options: options(target) })
}

describe('microfrontend v1 feature policy', () => {
  test('validates explicit packaging even when there are no pages', () => {
    const graph = makeSceneGraph()
    expect(() =>
      compile({
        graph,
        pageIds: [],
        options: withDefaults({
          packaging: { kind: 'microfrontend', appId: 'com.example.preview' }
        })
      })
    ).toThrow('development preview bridge')
  })

  test.each([
    [{ kind: 'standalone', appId: 'com.example.invalid' }, 'kind must be microfrontend'],
    [{ kind: 'microfrontend', appId: 'com.example.invalid', extra: true }, 'must contain exactly'],
    [{ kind: 'microfrontend', appId: 42 }, 'appId must be a string'],
    [
      { kind: 'microfrontend', appId: 'com.example.invalid', version: 1 },
      'version must be a string'
    ]
  ] as const)('rejects malformed runtime packaging %#', (packaging, message) => {
    expect(() => parseCompilerMicrofrontendPackaging(packaging)).toThrow(message)
  })

  test('collects option-owned document features in deterministic order', () => {
    const unsupported = unsupportedMicrofrontendFeatures(
      {
        ...options(),
        i18n: true,
        themeCss: ':root { --brand: red; }',
        metadata: { title: 'Standalone title' },
        sourceLocale: 'ar'
      },
      [],
      []
    )
    expect(unsupported).toEqual([
      'internationalization runtime',
      'runtime theme or design-token CSS',
      'standalone HTML metadata',
      'non-default document locale'
    ])
  })

  test('walks nested result branches and component variants before adapter emission', () => {
    const nestedHandlers: IREventHandler[] = [
      {
        kind: 'apiCall',
        method: 'GET',
        url: { kind: 'string', value: '/events' },
        docStateName: 'result',
        onSuccess: [
          {
            kind: 'condition',
            condAst: { kind: 'number', value: 1 },
            references: [],
            consequent: [
              {
                kind: 'trackEvent',
                eventAst: { kind: 'string', value: 'nested' },
                references: []
              }
            ],
            alternate: [
              {
                kind: 'playMotion',
                targetNodeId: 'target'
              }
            ]
          }
        ]
      }
    ]
    const component: ComponentDef = {
      componentId: 'component',
      name: 'NestedFeature',
      props: [],
      children: [],
      variantAxes: [
        { name: 'kind', rawName: 'Kind', options: ['Default'], defaultValue: 'Default' }
      ],
      variants: [
        {
          key: 'Default',
          children: [element({ events: { onClick: nestedHandlers } })]
        }
      ]
    }
    expect(unsupportedMicrofrontendFeatures(options('vue'), [tree()], [component])).toEqual([
      'Motion runtime',
      'analytics runtime'
    ])
  })

  test('rejects runtime-bearing IR while allowing non-persisted module-local document state', () => {
    const unsafeTree = tree({
      motion: {} as NonNullable<IRTree['motion']>,
      prototype: { connections: [] },
      analyticsConfig: { provider: 'ga4', id: 'G-TEST' },
      serverWorkflows: [{} as NonNullable<IRTree['serverWorkflows']>[number]],
      docStates: [
        { id: 'safe', name: 'safe', type: 'number', defaultValue: 0, persist: false },
        { id: 'stored', name: 'stored', type: 'number', defaultValue: 0, persist: true }
      ],
      children: [
        element({
          generatedEffect: {} as NonNullable<IRElement['generatedEffect']>,
          overlay: { kind: 'modal', openRef: 'safe', closeOnBackdrop: true },
          module: {
            pluginId: 'open-pencil.modal',
            moduleType: 'modal',
            configVersion: 1,
            payload: {}
          }
        })
      ]
    })
    expect(unsupportedMicrofrontendFeatures(options(), [unsafeTree], [])).toEqual([
      'Motion runtime',
      'prototype runtime',
      'generated-effect runtime',
      'analytics runtime',
      'server workflows',
      'persisted document state',
      'overlay actions',
      'overlay modules'
    ])
    expect(
      unsupportedMicrofrontendFeatures(
        options(),
        [
          tree({
            docStates: [
              { id: 'safe', name: 'safe', type: 'number', defaultValue: 0, persist: false }
            ]
          })
        ],
        []
      )
    ).toEqual([])
  })

  test.each([
    ['open-pencil.modal', 'modal'],
    ['open-pencil.dropdown-menu', 'dropdown-menu'],
    ['open-pencil.slide-menu', 'slide-menu'],
    ['open-pencil.upload-button', 'upload-button']
  ] as const)('rejects the %s/%s overlay module identity', (pluginId, moduleType) => {
    const moduleNode = element({
      module: { pluginId, moduleType, configVersion: 1, payload: {} }
    })
    expect(
      unsupportedMicrofrontendFeatures(options(), [tree({ children: [moduleNode] })], [])
    ).toEqual(['overlay modules'])
  })

  test('walks component-ref event branches and allows non-overlay trusted modules', () => {
    const ref = {
      kind: 'componentRef' as const,
      sourceId: 'component-ref',
      name: 'Card',
      className: '',
      props: [],
      events: {
        onClick: [
          {
            kind: 'confirm' as const,
            ast: { kind: 'string' as const, value: 'Continue?' },
            references: [],
            consequent: [],
            alternate: []
          }
        ]
      }
    }
    const contentModule = element({
      module: {
        pluginId: 'open-pencil.table',
        moduleType: 'table',
        configVersion: 1,
        payload: {}
      }
    })
    expect(
      unsupportedMicrofrontendFeatures(options(), [tree({ children: [ref, contentModule] })], [])
    ).toEqual(['overlay actions'])
  })

  test.each(['react', 'vue'] as const)(
    '%s rejects persisted state but accepts isolated non-persisted state',
    (target) => {
      const persisted = makeSceneGraph()
      persisted.updateNode(persisted.rootId, {
        lowcodeDocumentState: [
          { id: 'count', name: 'count', type: 'number', defaultValue: 0, persist: true }
        ]
      })
      expect(() => compileGraph(target, persisted)).toThrow('persisted document state')

      const isolated = makeSceneGraph()
      isolated.updateNode(isolated.rootId, {
        lowcodeDocumentState: [
          { id: 'count', name: 'count', type: 'number', defaultValue: 0, persist: false }
        ]
      })
      expect(compileGraph(target, isolated).microfrontend?.app.framework).toBe(target)
    }
  )

  test.each(['react', 'vue'] as const)(
    '%s rejects persisted design tokens before writing a microfrontend project',
    (target) => {
      const graph = makeSceneGraph()
      addTestColorVariable(graph, 'brand', 'Brand')
      expect(() => compileGraph(target, graph)).toThrow('runtime theme or design-token CSS')

      const standalone = compile({
        graph,
        pageIds: [firstPageId(graph)],
        options: withDefaults({
          target,
          router: target === 'react' ? 'react-router-v6' : 'vue-router-v4',
          devMode: false
        })
      })
      expect(standalone.files.has('src/index.css')).toBe(true)
    }
  )
})
