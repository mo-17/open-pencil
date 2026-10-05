import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createSSRApp, h, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import {
  adaptationDiagnosticMessage,
  adaptationDiagnosticStatus,
  type AdaptationDiagnosticMessages
} from '@/app/lowcode/preview-pane/adaptation/use'

const messages: AdaptationDiagnosticMessages = {
  previewAdaptationDiagnosticsDisabled: 'Disabled',
  previewAdaptationDiagnosticsWaiting: 'Checking current preview',
  previewAdaptationDiagnosticsEmpty: 'No detectable issues found',
  previewAdaptationDiagnosticsTruncated: 'Check limit reached; results may be incomplete',
  previewAdaptationHorizontalOverflow: 'Content exceeds available width',
  previewAdaptationTextClipping: 'Text may be clipped',
  previewAdaptationFixedHeightRisk: 'Fixed height may not fit larger text'
}
const state = { enabled: true, waiting: false, truncated: false, itemCount: 0 }

async function renderDiagnostics(props: {
  items: { nodeId: string; kind: 'text-clipping'; nodeName: string }[]
  waiting?: boolean
  truncated?: boolean
  enabled?: boolean
}) {
  const filename = resolve('src/app/lowcode/preview-pane/adaptation/Diagnostics.vue')
  const source = await Bun.file(filename).text()
  const parsed = parse(source, { filename })
  if (parsed.errors.length) throw new Error('Invalid adaptation diagnostics SFC')
  const script = compileScript(parsed.descriptor, {
    id: 'adaptation-diagnostics-test',
    inlineTemplate: true,
    templateOptions: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('icon-') } }
  }).content
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-adaptation-diagnostics-'))
  try {
    await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir')
    await writeFile(
      join(directory, 'messages.ts'),
      `import {ref} from 'vue'; export const useCodeMessages = () => ref(${JSON.stringify({
        ...messages,
        previewAdaptationDiagnosticsTitle: 'Adaptation diagnostics',
        previewAdaptationLocateNode: 'Locate node'
      })});`
    )
    await writeFile(
      join(directory, 'Alert.ts'),
      `import {defineComponent,h} from 'vue'; export default defineComponent({props:['heading','description','tone'],setup:props=>()=>h('div',{role:'alert','data-tone':props.tone},[h('p',props.heading),h('p',props.description)])});`
    )
    const path = join(directory, 'Diagnostics.ts')
    await writeFile(
      path,
      script
        .replace("from '@open-pencil/vue'", "from './messages'")
        .replace("from '@/components/ui/feedback/AppAlert.vue'", "from './Alert'")
        .replace(
          "from './use'",
          `from ${JSON.stringify(resolve('src/app/lowcode/preview-pane/adaptation/use.ts'))}`
        )
    )
    const component = (await import(pathToFileURL(path).href)) as { default: Component }
    const app = createSSRApp({
      render: () => h(component.default, { waiting: false, truncated: false, ...props })
    })
    app.component('icon-lucide-triangle-alert', { render: () => h('span') })
    return await renderToString(app)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('adaptation diagnostic presentation', () => {
  test('renders only trusted translated copy for the closed diagnostic kinds', () => {
    expect(adaptationDiagnosticMessage(messages, 'horizontal-overflow')).toBe(
      messages.previewAdaptationHorizontalOverflow
    )
    expect(adaptationDiagnosticMessage(messages, 'text-clipping')).toBe(
      messages.previewAdaptationTextClipping
    )
    expect(adaptationDiagnosticMessage(messages, 'fixed-height-risk')).toBe(
      messages.previewAdaptationFixedHeightRisk
    )
  })

  test('does not present a stale success while disabled or waiting', () => {
    expect(adaptationDiagnosticStatus(messages, { ...state, enabled: false })).toBe('Disabled')
    expect(
      adaptationDiagnosticStatus(messages, {
        ...state,
        enabled: false,
        waiting: true,
        truncated: true
      })
    ).toBe('Disabled')
    expect(adaptationDiagnosticStatus(messages, { ...state, waiting: true })).toBe(
      'Checking current preview'
    )
  })

  test('reports an incomplete scan even when no diagnostic item was returned', () => {
    expect(adaptationDiagnosticStatus(messages, { ...state, truncated: true })).toBe(
      'Check limit reached; results may be incomplete'
    )
    expect(
      adaptationDiagnosticStatus(messages, { ...state, itemCount: 128, truncated: true })
    ).toBe('Check limit reached; results may be incomplete')
  })

  test('reserves the empty result copy for a completed nontruncated scan', () => {
    expect(adaptationDiagnosticStatus(messages, state)).toBe('No detectable issues found')
    expect(adaptationDiagnosticStatus(messages, { ...state, itemCount: 1 })).toBe('')
  })

  test('renders an accessible locator button and escapes authored names', async () => {
    const html = await renderDiagnostics({
      items: [{ nodeId: 'node-1', kind: 'text-clipping', nodeName: '<script>alert(1)</script>' }]
    })
    expect(html).toContain('<h3')
    expect(html).toContain('aria-labelledby=')
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-label="Locate node: &lt;script&gt;')
    expect(html).toContain('data-node-id="node-1"')
    expect(html).toContain('data-diagnostic-kind="text-clipping"')
    expect(html).toContain('Text may be clipped')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  test('hides stale locator buttons while waiting or disabled', async () => {
    const items = [{ nodeId: 'node-1', kind: 'text-clipping' as const, nodeName: 'Old result' }]
    const waiting = await renderDiagnostics({ items, waiting: true })
    expect(waiting).toContain('aria-busy="true"')
    expect(waiting).toContain('Checking current preview')
    expect(waiting).not.toContain('preview-adaptation-jump')
    expect(waiting).not.toContain('Old result')
    const disabled = await renderDiagnostics({ items, enabled: false })
    expect(disabled).toContain('Disabled')
    expect(disabled).not.toContain('preview-adaptation-jump')
  })

  test('announces scan limits instead of empty success in the actual component', async () => {
    const html = await renderDiagnostics({ items: [], truncated: true })
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-tone="warning"')
    expect(html).not.toContain('role="status"')
    expect(html).toContain('Check limit reached; results may be incomplete')
    expect(html).not.toContain('No detectable issues found')
    const withItems = await renderDiagnostics({
      items: [{ nodeId: 'node-1', kind: 'text-clipping', nodeName: 'Label' }],
      truncated: true
    })
    expect(withItems).toContain('preview-adaptation-jump')
    expect(withItems).toContain('Check limit reached; results may be incomplete')
  })
})
