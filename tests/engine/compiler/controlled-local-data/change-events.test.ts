import { describe, expect, test } from 'bun:test'

import { buildOpenPencilRichTextComponent } from '#compiler/adapters/react/modules/rich-text'

const runtime = buildOpenPencilRichTextComponent()
const source = runtime.slice(
  runtime.indexOf('  function syncDocument(): void {'),
  runtime.indexOf('  function runCommand(')
)
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
const doc = (text: string) => ({
  type: 'doc',
  blocks: [{ type: 'paragraph', align: 'left', children: [{ type: 'text', text, marks: [] }] }]
})

/** Execute the generated handler rather than mirroring its change conditions. */
function harness() {
  const documentRef = { current: doc('Seed') }
  const hidden = { value: JSON.stringify(documentRef.current) }
  const composing = { current: false }
  let next = { document: doc('Seed'), truncated: false }
  let changes = 0
  let events = 0
  let refreshes = 0
  let reads = 0
  let status = ''
  const run = new Function(
    'editorRef',
    'readOnly',
    'composingRef',
    'readDocument',
    'documentRef',
    'hiddenInputRef',
    'onDocumentChange',
    'hostRef',
    'setStatus',
    'controlled',
    'refreshProjection',
    compiled + '\nreturn syncDocument'
  )(
    { current: {} },
    false,
    composing,
    () => {
      reads++
      return next
    },
    documentRef,
    { current: hidden },
    () => {
      changes++
    },
    {
      current: {
        dispatchEvent: () => {
          events++
        }
      }
    },
    (value: string) => {
      status = value
    },
    true,
    () => {
      refreshes++
    }
  ) as () => void
  return {
    run,
    composing,
    hidden,
    setNext: (value: typeof next) => {
      next = value
    },
    counts: () => ({ changes, events, refreshes, reads, status })
  }
}

describe('generated RichText controlled change notification', () => {
  test('notifies a changed AST once and ignores equivalent blur reads', () => {
    const state = harness()
    state.run()
    expect(state.counts()).toEqual({ changes: 0, events: 0, refreshes: 0, reads: 1, status: '' })
    state.setNext({ document: doc('Changed'), truncated: false })
    state.run()
    expect(state.counts()).toEqual({
      changes: 1,
      events: 1,
      refreshes: 1,
      reads: 2,
      status: 'Changes ready'
    })
    expect(JSON.parse(state.hidden.value)).toEqual(doc('Changed'))
    state.setNext({ document: doc('Changed'), truncated: false })
    state.run()
    expect(state.counts()).toEqual({
      changes: 1,
      events: 1,
      refreshes: 1,
      reads: 3,
      status: 'Changes ready'
    })
  })

  test('does not publish composition drafts and retains truncation feedback for unchanged data', () => {
    const state = harness()
    state.composing.current = true
    state.setNext({ document: doc('中文组合草稿'), truncated: false })
    state.run()
    expect(state.counts()).toEqual({ changes: 0, events: 0, refreshes: 0, reads: 0, status: '' })
    state.composing.current = false
    state.run()
    state.run()
    expect(state.counts()).toEqual({
      changes: 1,
      events: 1,
      refreshes: 1,
      reads: 2,
      status: 'Changes ready'
    })
    state.setNext({ document: doc('中文组合草稿'), truncated: true })
    state.run()
    expect(state.counts()).toEqual({
      changes: 1,
      events: 1,
      refreshes: 1,
      reads: 3,
      status: 'Content limit reached'
    })
  })
})

describe('generated RichText composition authority changes', () => {
  test('composition end forces owner projection when write authority is removed', () => {
    const start = runtime.indexOf('onCompositionEnd={') + 'onCompositionEnd={'.length
    const end = runtime.indexOf('          onDrop={handleDrop}', start)
    const arrow = runtime.slice(start, end).trim().slice(0, -1)
    const composing = { current: true }
    const forced = { current: false }
    let refreshes = 0
    let writes = 0
    const finish = new Function(
      'composingRef',
      'controlled',
      'readOnly',
      'projection',
      'compositionValueRef',
      'forceProjectionRef',
      'refreshProjection',
      'syncDocument',
      new Bun.Transpiler({ loader: 'ts' }).transformSync('const finish = ' + arrow) +
        '\nreturn finish'
    )(
      composing,
      true,
      true,
      doc('Seed'),
      { current: JSON.stringify(doc('Seed')) },
      forced,
      () => {
        refreshes++
      },
      () => {
        writes++
      }
    ) as () => void
    finish()
    expect(composing.current).toBe(false)
    expect(forced.current).toBe(true)
    expect(refreshes).toBe(1)
    expect(writes).toBe(0)
  })

  test('forced owner projection replaces unaccepted DOM even when its AST equals the last accepted AST', () => {
    const start = runtime.indexOf('  useLayoutEffect(() => {')
    const end = runtime.indexOf('  function captureSelection()', start)
    const effect = new Bun.Transpiler({ loader: 'ts' }).transformSync(runtime.slice(start, end))
    const documentRef = { current: doc('Seed') }
    const forced = { current: true }
    const editor = { text: 'Unaccepted composition draft' }
    const hidden = { value: '' }
    let mounts = 0
    new Function(
      'useLayoutEffect',
      'editorRef',
      'composingRef',
      'unavailable',
      'controlled',
      'projection',
      'documentRef',
      'mountedRef',
      'forceProjectionRef',
      'mountDocument',
      'config',
      'selectionRef',
      'hiddenInputRef',
      effect
    )(
      (callback: () => void) => callback(),
      { current: editor },
      { current: false },
      false,
      true,
      doc('Seed'),
      documentRef,
      { current: true },
      forced,
      (_editor: typeof editor, document: ReturnType<typeof doc>) => {
        mounts++
        _editor.text = document.blocks[0].children[0].text
      },
      { linkColor: '#2563EB' },
      { current: null },
      { current: hidden }
    )
    expect(editor.text).toBe('Seed')
    expect(mounts).toBe(1)
    expect(forced.current).toBe(false)
    expect(JSON.parse(hidden.value)).toEqual(doc('Seed'))
  })
})
