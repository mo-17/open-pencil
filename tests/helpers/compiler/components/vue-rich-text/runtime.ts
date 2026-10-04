import { RICH_TEXT_CONTROLLED_RUNTIME } from '#compiler/adapters/rich-text/controlled'
import {
  buildRichTextSchemaTypes,
  RICH_TEXT_PARSE_RUNTIME
} from '#compiler/adapters/rich-text/schema'
import { buildOpenPencilVueRichText } from '#compiler/adapters/vue/modules/rich-text'
import {
  computed,
  effectScope,
  markRaw,
  nextTick,
  reactive,
  ref,
  shallowRef,
  toRaw,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef
} from 'vue'

import type { RichTextDocumentV1 } from '@open-pencil/core/plugins'

export function richTextDocument(text: string): RichTextDocumentV1 {
  return {
    type: 'doc',
    blocks: [{ type: 'paragraph', align: 'left', children: [{ type: 'text', text, marks: [] }] }]
  }
}

interface EditorStub {
  document: RichTextDocumentV1
  querySelectorAll(selector: string): LinkStub[]
}
interface LinkStub {
  style: { color: string }
}
interface RuntimeState {
  editor: Ref<EditorStub | null>
  host: Ref<{ dispatchEvent(): void } | null>
  hiddenInput: Ref<{ value: string } | null>
  controlled: ComputedRef<boolean>
  unavailable: ComputedRef<boolean>
  readOnly: ComputedRef<boolean>
  documentValue: ShallowRef<RichTextDocumentV1>
  syncDocument(): void
  projectDocument(): void
  startComposition(): void
  endComposition(): void
}

const transpiler = new Bun.Transpiler({ loader: 'ts' })
const generated = buildOpenPencilVueRichText()
const dependencies = generated.slice(
  generated.indexOf('function trackRichTextDependencies('),
  generated.indexOf('defineOptions(')
)
const project = new Function(
  'reactive',
  transpiler.transformSync(
    buildRichTextSchemaTypes(false) +
      '\n' +
      RICH_TEXT_PARSE_RUNTIME +
      RICH_TEXT_CONTROLLED_RUNTIME +
      dependencies
  ) + '\nreturn projectReactiveRichText'
)(reactive) as (value: unknown) => RichTextDocumentV1 | null

/** Execute the actual emitted Vue state program with Vue reactivity and injected DOM projections. */
export function vueRichTextRuntime(
  extra: Record<string, unknown> = {},
  normalize = (value: RichTextDocumentV1) => value
) {
  const source = buildOpenPencilVueRichText()
  const state = source.slice(
    source.indexOf('const host = ref<'),
    source.indexOf('function captureSelection()')
  )
  const hooks: Record<string, (() => void)[]> = { mounted: [], updated: [], unmounted: [] }
  const scope = effectScope()
  let changes = 0,
    events = 0,
    mounts = 0,
    reads = 0,
    ignore = false
  const props = reactive<Record<string, unknown>>({
    config: { content: richTextDocument('Authored'), linkColor: '#2563EB' },
    value: richTextDocument('Seed'),
    valueBound: true,
    'onUpdate:value': (value: RichTextDocumentV1) => {
      changes++
      if (!ignore) props.value = value
    },
    ...extra
  })
  const run = new Function(
    'props',
    'ref',
    'shallowRef',
    'computed',
    'watch',
    'nextTick',
    'onMounted',
    'onUpdated',
    'onBeforeUnmount',
    'projectReactiveRichText',
    'mountDocument',
    'readDocument',
    'emit',
    transpiler.transformSync(state) +
      '\nreturn { editor, host, hiddenInput, controlled, unavailable, readOnly, documentValue, syncDocument, projectDocument, startComposition, endComposition }'
  )
  const runtime = scope.run(() =>
    run(
      props,
      ref,
      shallowRef,
      computed,
      watch,
      nextTick,
      (fn: () => void) => hooks.mounted.push(fn),
      (fn: () => void) => hooks.updated.push(fn),
      (fn: () => void) => hooks.unmounted.push(fn),
      project,
      (editor: EditorStub, value: RichTextDocumentV1) => {
        mounts++
        editor.document = structuredClone(toRaw(normalize(value)))
      },
      (editor: EditorStub) => {
        reads++
        return { document: structuredClone(toRaw(editor.document)), truncated: false }
      },
      (_event: string, document: RichTextDocumentV1) => {
        const listener = props['onUpdate:value']
        if (typeof listener === 'function') listener(document)
      }
    )
  ) as RuntimeState
  let links: LinkStub[] = []
  const dom = markRaw({ document: richTextDocument(''), querySelectorAll: () => links }),
    hidden = { value: '' }
  runtime.editor.value = dom
  runtime.host.value = {
    dispatchEvent: () => {
      events++
    }
  }
  runtime.hiddenInput.value = hidden
  hooks.mounted.forEach((fn) => fn())
  return {
    runtime,
    props,
    hidden,
    setDOM: (value: RichTextDocumentV1) => {
      if (runtime.editor.value) runtime.editor.value.document = value
    },
    getDOM: () => runtime.editor.value?.document,
    setLinks: (value: LinkStub[]) => {
      links = value
    },
    counts: () => ({ changes, events, mounts, reads }),
    flush: nextTick,
    rerender: () => hooks.updated.forEach((fn) => fn()),
    ignore: (value: boolean) => {
      ignore = value
    },
    dispose: () => {
      hooks.unmounted.forEach((fn) => fn())
      scope.stop()
    }
  }
}
