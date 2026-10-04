import { describe, expect, test } from 'bun:test'

import {
  richTextDocument as doc,
  vueRichTextRuntime
} from '#tests/helpers/compiler/components/vue-rich-text/runtime'

describe('generated Vue RichText local control program', () => {
  test('projects external values without notifying and accepts user changes once', async () => {
    const state = vueRichTextRuntime()
    try {
      expect(state.getDOM()).toEqual(doc('Seed'))
      expect(state.counts().changes).toBe(0)
      state.props.value = doc('External')
      await state.flush()
      expect(state.getDOM()).toEqual(doc('External'))
      expect(state.counts().changes).toBe(0)
      state.setDOM(doc('Changed'))
      state.runtime.syncDocument()
      state.runtime.syncDocument()
      await state.flush()
      expect(state.props.value).toEqual(doc('Changed'))
      expect(state.counts().changes).toBe(1)
      expect(state.counts().events).toBe(1)
      expect(JSON.parse(state.hidden.value)).toEqual(doc('Changed'))
    } finally {
      state.dispose()
    }
  })

  test('keeps local drafts through ordinary parent rerenders and ignores an unaccepted controlled change', async () => {
    const local = vueRichTextRuntime({
      valueBound: false,
      value: undefined,
      'onUpdate:value': undefined
    })
    const controlled = vueRichTextRuntime()
    try {
      local.setDOM(doc('Local draft'))
      local.runtime.syncDocument()
      local.rerender()
      expect(local.getDOM()).toEqual(doc('Local draft'))
      expect(JSON.parse(local.hidden.value)).toEqual(doc('Local draft'))
      controlled.ignore(true)
      controlled.setDOM(doc('Rejected draft'))
      controlled.runtime.syncDocument()
      await controlled.flush()
      expect(controlled.getDOM()).toEqual(doc('Seed'))
      expect(controlled.counts().changes).toBe(1)
    } finally {
      local.dispose()
      controlled.dispose()
    }
  })

  test('locks missing or invalid present values without falling back to config', async () => {
    const state = vueRichTextRuntime()
    try {
      for (const value of [undefined, { type: 'doc', blocks: [{ type: 'html', value: 'bad' }] }]) {
        state.props.value = value
        await state.flush()
        expect(state.runtime.unavailable.value).toBe(true)
        expect(state.runtime.readOnly.value).toBe(true)
        expect(state.getDOM()).toEqual({ type: 'doc', blocks: [] })
      }
      state.props.value = doc('Recovered')
      await state.flush()
      expect(state.runtime.unavailable.value).toBe(false)
      expect(state.getDOM()).toEqual(doc('Recovered'))
      expect(state.counts().changes).toBe(0)
    } finally {
      state.dispose()
    }
  })

  test('defers external projection during composition and does not echo the final input', async () => {
    const state = vueRichTextRuntime()
    try {
      const mounts = state.counts().mounts
      state.runtime.startComposition()
      state.setDOM(doc('中文组合草稿'))
      state.runtime.syncDocument()
      state.rerender()
      state.props.value = doc('External')
      await state.flush()
      expect(state.getDOM()).toEqual(doc('中文组合草稿'))
      expect(state.counts().mounts).toBe(mounts)
      state.runtime.endComposition()
      state.runtime.syncDocument()
      expect(state.getDOM()).toEqual(doc('External'))
      expect(state.counts().changes).toBe(0)
      state.runtime.startComposition()
      state.setDOM(doc('中文已完成'))
      state.runtime.endComposition()
      state.runtime.syncDocument()
      await state.flush()
      expect(state.props.value).toEqual(doc('中文已完成'))
      expect(state.counts().changes).toBe(1)
    } finally {
      state.dispose()
    }
  })

  test.each(['listener', 'readOnly', 'disabled'] as const)(
    'withdraws %s editing authority during composition and restores the accepted AST',
    async (reason) => {
      const state = vueRichTextRuntime()
      try {
        state.runtime.startComposition()
        state.setDOM(doc('未经接受的组合草稿'))
        if (reason === 'listener') state.props['onUpdate:value'] = undefined
        else state.props[reason] = true
        await state.flush()
        state.runtime.endComposition()
        state.runtime.syncDocument()
        expect(state.getDOM()).toEqual(doc('Seed'))
        expect(JSON.parse(state.hidden.value)).toEqual(doc('Seed'))
        expect(state.counts().changes).toBe(0)
      } finally {
        state.dispose()
      }
    }
  )

  test('treats canonical DOM readback of an external AST as projection, not a user change', () => {
    const state = vueRichTextRuntime({ value: { type: 'doc', blocks: [] } }, (value) =>
      value.blocks.length ? value : doc('')
    )
    try {
      state.runtime.syncDocument()
      state.rerender()
      expect(state.counts().changes).toBe(0)
      expect(JSON.parse(state.hidden.value)).toEqual({ type: 'doc', blocks: [] })
    } finally {
      state.dispose()
    }
  })

  test.each(['listener', 'readOnly', 'disabled'] as const)(
    'keeps the current composition cancelled after %s authority is restored before its end',
    async (reason) => {
      const state = vueRichTextRuntime()
      try {
        const listener = state.props['onUpdate:value']
        state.runtime.startComposition()
        state.setDOM(doc('撤销后恢复权限仍不可接受的草稿'))
        if (reason === 'listener') state.props['onUpdate:value'] = undefined
        else state.props[reason] = true
        await state.flush()
        if (reason === 'listener') state.props['onUpdate:value'] = listener
        else state.props[reason] = false
        await state.flush()
        expect(state.runtime.readOnly.value).toBe(false)
        state.runtime.endComposition()
        state.runtime.syncDocument()
        expect(state.getDOM()).toEqual(doc('Seed'))
        expect(state.counts().changes).toBe(0)
        state.runtime.startComposition()
        state.setDOM(doc('下一次完整输入'))
        state.runtime.endComposition()
        await state.flush()
        expect(state.props.value).toEqual(doc('下一次完整输入'))
        expect(state.counts().changes).toBe(1)
      } finally {
        state.dispose()
      }
    }
  )

  test('refreshes existing link colors without replacing content or composition drafts', async () => {
    const state = vueRichTextRuntime()
    try {
      const link = { style: { color: '#2563EB' } },
        mounts = state.counts().mounts
      state.setLinks([link])
      state.runtime.startComposition()
      state.setDOM(doc('保留组合草稿'))
      state.props.config = { content: doc('Authored'), linkColor: '#DC2626' }
      await state.flush()
      expect(link.style.color).toBe('#DC2626')
      expect(state.getDOM()).toEqual(doc('保留组合草稿'))
      expect(state.counts().mounts).toBe(mounts)
      expect(state.counts().changes).toBe(0)
    } finally {
      state.dispose()
    }
  })

  test('projects reactive nested SET changes automatically and still rejects unsafe in-place marks', async () => {
    const state = vueRichTextRuntime()
    try {
      const paragraph = (state.props.value as ReturnType<typeof doc>).blocks[0]
      if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph fixture')
      paragraph.children[0].text = 'Reactive nested change'
      await state.flush()
      expect(state.getDOM()).toEqual(doc('Reactive nested change'))
      expect(JSON.parse(state.hidden.value)).toEqual(doc('Reactive nested change'))
      expect(state.counts().changes).toBe(0)
      paragraph.children[0].marks.push({ type: 'link', href: ['javascript', 'bad'].join(':') })
      await state.flush()
      expect(state.runtime.unavailable.value).toBe(true)
      expect(state.counts().changes).toBe(0)
    } finally {
      state.dispose()
    }
  })

  test('rejects own-data accessors before reactive dependency tracking can read them', async () => {
    const state = vueRichTextRuntime()
    try {
      let reads = 0
      const value = doc('Accessor'),
        paragraph = value.blocks[0]
      if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph fixture')
      Object.defineProperty(paragraph.children[0], 'text', {
        enumerable: true,
        get: () => {
          reads++
          return 'Unsafe getter'
        }
      })
      state.props.value = value
      await state.flush()
      expect(state.runtime.unavailable.value).toBe(true)
      expect(reads).toBe(0)
    } finally {
      state.dispose()
    }
  })

  test('keeps composition cancelled when the external owner changes then restores its original AST', async () => {
    const state = vueRichTextRuntime()
    try {
      state.runtime.startComposition()
      state.setDOM(doc('旧组合草稿'))
      state.props.value = doc('Temporary owner value')
      await state.flush()
      state.props.value = doc('Seed')
      await state.flush()
      state.runtime.endComposition()
      state.runtime.syncDocument()
      expect(state.getDOM()).toEqual(doc('Seed'))
      expect(state.counts().changes).toBe(0)
    } finally {
      state.dispose()
    }
  })

  test('observes same-tick owner AST replacement and restoration before composition ends', async () => {
    const state = vueRichTextRuntime()
    try {
      state.runtime.startComposition()
      state.setDOM(doc('同tick仍必须放弃的草稿'))
      state.props.value = doc('Temporary owner value')
      state.props.value = doc('Seed')
      await state.flush()
      state.runtime.endComposition()
      state.runtime.syncDocument()
      expect(state.getDOM()).toEqual(doc('Seed'))
      expect(state.counts().changes).toBe(0)
    } finally {
      state.dispose()
    }
  })
})
