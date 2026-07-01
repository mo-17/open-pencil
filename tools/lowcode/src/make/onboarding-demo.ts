#!/usr/bin/env bun
import { resolve } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/core/scene-graph'
import type {
  ActionDef,
  Color,
  DocumentStateDef,
  Fill,
  SceneNode,
  WorkflowDef
} from '@open-pencil/core/scene-graph'
import { fontManager } from '@open-pencil/core/text'

export const LOWCODE_ONBOARDING_DEMO_PATH = 'packages/demos/lowcode/lowcode-onboarding-demo.fig'

const rgb = (r: number, g: number, b: number): Color => ({ r, g, b, a: 1 })
const solid = (color: Color): Fill => ({ type: 'SOLID', color, opacity: 1, visible: true })

const INK = rgb(0.09, 0.11, 0.16)
const MUTED = rgb(0.38, 0.43, 0.5)
const BLUE = rgb(0.22, 0.45, 0.93)
const GREEN = rgb(0.15, 0.63, 0.35)
const PANEL = rgb(0.97, 0.98, 1)
const WHITE = rgb(1, 1, 1)

export function buildLowcodeOnboardingDemo(): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    name: 'Onboarding Demo',
    lowcodeSeoMetadata: {
      title: 'OpenPencil Lowcode Demo',
      description: 'Supabase, validation, workflow, analytics, i18n, and deploy-ready metadata.'
    }
  })

  const docStates: DocumentStateDef[] = [
    { id: 'd-name', name: 'fullName', type: 'string', defaultValue: '' },
    { id: 'd-email', name: 'email', type: 'string', defaultValue: '' },
    { id: 'd-plan', name: 'plan', type: 'string', defaultValue: 'starter' },
    { id: 'd-status', name: 'status', type: 'string', defaultValue: 'Ready' },
    { id: 'd-category', name: 'category', type: 'string', defaultValue: 'featured' },
    { id: 'd-checkout-error', name: 'checkoutError', type: 'object', defaultValue: null },
    { id: 'd-portal-error', name: 'portalError', type: 'object', defaultValue: null }
  ]
  const workflows: WorkflowDef[] = [
    {
      id: 'wf-saved',
      name: 'Saved toast',
      params: ['message'],
      paramDefaults: { message: '"Saved to Supabase"' },
      optionalParams: ['message'],
      actions: [
        { id: 'toast-ok', kind: 'toast', messageExpr: 'message', variant: 'success' },
        { id: 'status-ok', kind: 'setVariable', targetName: 'status', valueExpr: 'message' }
      ]
    }
  ]
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: docStates,
    lowcodeSupabaseConfig: {
      url: 'https://example.supabase.co',
      anonKey: 'eyJ.onboarding-demo.anon'
    },
    lowcodeWorkflows: workflows,
    lowcodeTranslations: {
      'zh-CN': {
        'OpenPencil Lowcode Onboarding': 'OpenPencil 低代码入门示例',
        'Supabase + validation + workflow + analytics + i18n in one file.':
          '一个文件演示 Supabase、校验、工作流、分析和国际化。',
        'Create lead': '创建线索',
        'Full name': '姓名',
        Email: '邮箱',
        'Load products': '加载产品',
        'LIST reads products from Supabase with a doc-state filter.':
          'LIST 使用文档状态过滤条件读取 Supabase 产品数据。',
        'Product row': '产品行',
        'Track interest': '记录兴趣',
        'Plan checkout': '套餐结账',
        'Calls a demo server endpoint; Stripe secrets stay on the server.':
          '调用示例服务端端点；Stripe 密钥只保存在服务端。',
        'Start checkout': '开始结账',
        'Open billing portal': '打开账单门户',
        Ready: '就绪',
        starter: '入门版',
        pro: '专业版',
        enterprise: '企业版'
      }
    },
    lowcodeAnalyticsConfig: {
      provider: 'plausible',
      id: 'example.com',
      pageViews: false,
      respectDoNotTrack: true,
      consentRegionPreset: 'eea',
      consentRequired: true,
      consentAnalyticsDefault: false,
      consentCopy: {
        bannerText: 'OpenPencil demo uses privacy-friendly analytics for onboarding events.',
        analyticsDescription: 'Optional demo analytics for page views and button clicks.',
        privacyPolicyUrl: '/privacy',
        privacyPolicyLabel: 'Demo privacy notes'
      }
    },
    lowcodeHeadMetadata: {
      meta: [
        { kind: 'name', key: 'theme-color', content: '#2563eb' },
        { kind: 'property', key: 'og:title', content: 'OpenPencil Lowcode Demo' }
      ],
      link: [{ rel: 'preconnect', href: 'https://example.supabase.co' }],
      styles: [':root { color-scheme: light; }']
    },
    lowcodeCustomCss:
      '.onboarding-demo { min-height: 100vh; }\n.onboarding-note { letter-spacing: 0; }'
  })

  const shell = frame(graph, page.id, 'Onboarding shell', {
    x: 40,
    y: 40,
    width: 760,
    height: 900,
    itemSpacing: 18,
    paddingTop: 28,
    paddingRight: 28,
    paddingBottom: 28,
    paddingLeft: 28,
    fills: [solid(WHITE)]
  })
  text(graph, shell.id, 'OpenPencil Lowcode Onboarding', {
    name: 'Title',
    width: 700,
    height: 34,
    fontSize: 26,
    fontWeight: 700,
    fills: [solid(INK)]
  })
  text(graph, shell.id, 'Supabase + validation + workflow + analytics + i18n in one file.', {
    name: 'Subtitle',
    width: 700,
    height: 24,
    fontSize: 15,
    fills: [solid(MUTED)]
  })

  buildLeadForm(graph, shell.id)
  buildProductList(graph, shell.id)
  buildAnalyticsPanel(graph, shell.id)
  buildCheckoutPanel(graph, shell.id)

  return graph
}

export async function writeLowcodeOnboardingDemo(
  outPath = resolve(process.cwd(), LOWCODE_ONBOARDING_DEMO_PATH)
): Promise<{ path: string; byteLength: number }> {
  await fontManager.loadFont('Inter', 'Regular')
  await fontManager.loadFont('Inter', 'SemiBold')
  const graph = buildLowcodeOnboardingDemo()
  const io = new IORegistry(BUILTIN_IO_FORMATS)
  const result = await io.writeDocument('fig', graph)
  const data = result.data as Uint8Array
  await Bun.write(outPath, data)
  return { path: outPath, byteLength: data.byteLength }
}

function buildLeadForm(graph: SceneGraph, parentId: string): void {
  const section = card(graph, parentId, 'Lead form')
  text(graph, section.id, 'Create lead', { fontWeight: 700, fills: [solid(BLUE)] })
  const form = graph.createNode('FORM', section.id, {
    name: 'Lead form fields',
    width: 680,
    height: 220,
    layoutMode: 'VERTICAL',
    primaryAxisSizingMode: 'AUTO',
    counterAxisSizingMode: 'FIXED',
    itemSpacing: 10,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    fills: [],
    events: {
      onSubmit: [
        {
          id: 'create-lead',
          kind: 'supabaseMutation',
          operation: 'insert',
          table: 'leads',
          payloadEntries: [
            { key: 'full_name', valueExpr: 'fullName' },
            { key: 'email', valueExpr: 'email' },
            { key: 'plan', valueExpr: 'plan' }
          ],
          onSuccess: [{ id: 'saved-toast', kind: 'callWorkflow', workflowId: 'wf-saved' }],
          onError: [
            {
              id: 'save-error',
              kind: 'toast',
              messageExpr: '"Supabase insert failed"',
              variant: 'error'
            }
          ]
        },
        {
          id: 'track-submit',
          kind: 'trackEvent',
          eventNameExpr: '"lead_submit"',
          properties: { plan: 'plan' }
        }
      ]
    },
    interactiveProps: { validationSummary: { enabled: true, title: 'Fix these fields' } }
  })
  graph.createNode('INPUT', form.id, {
    name: 'Name input',
    width: 320,
    height: 40,
    bindings: { value: { kind: 'docState', docStateName: 'fullName' } },
    interactiveProps: { placeholder: 'Full name', validation: { required: true } }
  })
  graph.createNode('INPUT', form.id, {
    name: 'Email input',
    width: 320,
    height: 40,
    bindings: { value: { kind: 'docState', docStateName: 'email' } },
    interactiveProps: {
      placeholder: 'Email',
      validation: {
        required: true,
        pattern: '^[^@]+@[^@]+\\.[^@]+$',
        messages: { required: 'Email required', pattern: 'Use a valid email' }
      }
    }
  })
  graph.createNode('SELECT', form.id, {
    name: 'Plan select',
    width: 320,
    height: 40,
    bindings: { value: { kind: 'docState', docStateName: 'plan' } },
    interactiveProps: {
      options: ['starter', 'pro', 'enterprise'],
      value: 'starter'
    }
  })
  graph.createNode('BUTTON', form.id, {
    name: 'Submit lead',
    width: 180,
    height: 42,
    interactiveProps: { text: 'Create lead' },
    fills: [solid(BLUE)]
  })
}

function buildProductList(graph: SceneGraph, parentId: string): void {
  const section = card(graph, parentId, 'Product list')
  text(graph, section.id, 'Load products', { fontWeight: 700, fills: [solid(BLUE)] })
  text(graph, section.id, 'LIST reads products from Supabase with a doc-state filter.', {
    fills: [solid(MUTED)]
  })
  const list = graph.createNode('LIST', section.id, {
    name: 'Products list',
    width: 680,
    height: 120,
    interactiveProps: {
      itemName: 'product',
      dataSourceRef: {
        kind: 'supabaseQuery',
        query: {
          table: 'products',
          columns: 'id,name,price,category',
          filters: [{ column: 'category', op: 'eq', valueExpr: 'category' }],
          orderBy: [{ column: 'name', ascending: true }],
          limit: 6
        }
      }
    }
  })
  text(graph, list.id, 'Product row', { name: 'Product row', width: 640 })
}

function buildAnalyticsPanel(graph: SceneGraph, parentId: string): void {
  const section = card(graph, parentId, 'Analytics and i18n')
  text(graph, section.id, 'Track interest', { fontWeight: 700, fills: [solid(BLUE)] })
  text(graph, section.id, 'Ready', { name: 'Translated status', fills: [solid(MUTED)] })
  const button = graph.createNode('BUTTON', section.id, {
    name: 'Track interest button',
    width: 190,
    height: 42,
    interactiveProps: { text: 'Track interest' },
    fills: [solid(GREEN)]
  })
  const actions: ActionDef[] = [
    {
      id: 'track-interest',
      kind: 'trackEvent',
      eventNameExpr: '"product_interest"',
      properties: { plan: 'plan', category: 'category' }
    },
    {
      id: 'interest-toast',
      kind: 'toast',
      messageExpr: '"Interest tracked after consent"',
      variant: 'info'
    }
  ]
  graph.updateNode(button.id, { events: { onClick: actions } })

  const portalButton = graph.createNode('BUTTON', section.id, {
    name: 'Open billing portal button',
    width: 190,
    height: 42,
    interactiveProps: { text: 'Open billing portal' },
    fills: [solid(GREEN)]
  })
  const portalActions: ActionDef[] = [
    {
      id: 'open-portal',
      kind: 'stripeCustomerPortal',
      endpoint: '/api/demo-customer-portal',
      payloadEntries: [{ key: 'returnPath', valueExpr: '"/account"' }],
      errorTarget: 'portalError'
    },
    {
      id: 'track-portal',
      kind: 'trackEvent',
      eventNameExpr: '"billing_portal_open"',
      properties: { plan: 'plan' }
    }
  ]
  graph.updateNode(portalButton.id, { events: { onClick: portalActions } })
}

function buildCheckoutPanel(graph: SceneGraph, parentId: string): void {
  const section = card(graph, parentId, 'Checkout demo')
  text(graph, section.id, 'Plan checkout', { fontWeight: 700, fills: [solid(BLUE)] })
  text(graph, section.id, 'Calls a demo server endpoint; Stripe secrets stay on the server.', {
    fills: [solid(MUTED)]
  })
  const button = graph.createNode('BUTTON', section.id, {
    name: 'Start checkout button',
    width: 190,
    height: 42,
    interactiveProps: { text: 'Start checkout' },
    fills: [solid(BLUE)]
  })
  const actions: ActionDef[] = [
    {
      id: 'start-checkout',
      kind: 'stripeCheckout',
      endpoint: '/api/demo-checkout',
      payloadEntries: [
        { key: 'plan', valueExpr: 'plan' },
        { key: 'email', valueExpr: 'email' }
      ],
      errorTarget: 'checkoutError'
    },
    {
      id: 'track-checkout',
      kind: 'trackEvent',
      eventNameExpr: '"checkout_start"',
      properties: { plan: 'plan' }
    }
  ]
  graph.updateNode(button.id, { events: { onClick: actions } })
}

function card(graph: SceneGraph, parentId: string, name: string): SceneNode {
  return frame(graph, parentId, name, {
    width: 704,
    height: 180,
    itemSpacing: 10,
    paddingTop: 18,
    paddingRight: 18,
    paddingBottom: 18,
    paddingLeft: 18,
    fills: [solid(PANEL)]
  })
}

function frame(
  graph: SceneGraph,
  parentId: string,
  name: string,
  opts: Partial<SceneNode> = {}
): SceneNode {
  return graph.createNode('FRAME', parentId, {
    name,
    width: 640,
    height: 120,
    layoutMode: 'VERTICAL',
    primaryAxisSizingMode: 'AUTO',
    counterAxisSizingMode: 'FIXED',
    itemSpacing: 8,
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    ...opts
  })
}

function text(
  graph: SceneGraph,
  parentId: string,
  content: string,
  opts: Partial<SceneNode> = {}
): SceneNode {
  return graph.createNode('TEXT', parentId, {
    name: opts.name ?? content,
    width: 660,
    height: 22,
    text: content,
    fontFamily: 'Inter',
    fontSize: 14,
    fills: [solid(INK)],
    ...opts
  })
}

export function compileLowcodeOnboardingDemo() {
  const graph = buildLowcodeOnboardingDemo()
  const pageIds = graph.getPages().map((page) => page.id)
  return compile({
    graph,
    pageIds,
    options: withDefaults({
      packageName: 'openpencil-lowcode-onboarding',
      i18n: true,
      locales: ['zh-CN'],
      uiKit: 'shadcn'
    })
  })
}

if (import.meta.main) {
  const out = await writeLowcodeOnboardingDemo()
  const compiled = compileLowcodeOnboardingDemo()
  if (compiled.warnings.length > 0) {
    console.log('compile warnings:')
    for (const warning of compiled.warnings) {
      console.log(`  [${warning.code}] ${warning.message}`)
    }
  }
  console.log(`wrote ${out.path} (${out.byteLength} bytes)`)
}
