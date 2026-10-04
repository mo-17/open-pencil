import { describe, expect, test } from 'bun:test'

import { effectScope, reactive, shallowReactive, shallowRef } from 'vue'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  applyWebPreviewWidthRequest,
  expireWebPreviewWidthRequest,
  requestWebPreviewWidth,
  setWebPreviewWidthAvailability,
  useWebPreviewWidthRequest
} from '@/app/lowcode/preview-pane/viewport/request'
import { usePreviewViewport } from '@/app/lowcode/preview-pane/viewport/use'

function editor() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Missing fixture page')
  return shallowReactive({
    graph,
    state: reactive({ currentPageId: page.id, sceneVersion: 0 })
  })
}

function setup() {
  const first = editor()
  const active = shallowRef(first)
  const scope = effectScope()
  const requests = scope.run(() => useWebPreviewWidthRequest(() => active.value))
  if (!requests) throw new Error('Missing request session')
  const queue = (width = 768) =>
    requestWebPreviewWidth(active.value, width, {
      graph: active.value.graph,
      pageId: active.value.state.currentPageId
    })
  return { first, active, scope, requests, queue }
}

describe('Web breakpoint preview width requests', () => {
  test('unknown availability queues a hidden initial preview and waits for readiness', () => {
    const s = setup()
    try {
      expect(s.requests.available.value).toBeNull()
      expect(s.queue().status).toBe('pending')
      const request = s.requests.pending.value
      if (!request) throw new Error('Request was not queued')
      let writes = 0
      expect(
        applyWebPreviewWidthRequest(
          s.first,
          request,
          { target: 'react', phase: 'starting', graph: s.first.graph },
          () => writes++
        )
      ).toBe(false)
      expect(writes).toBe(0)
      expect(s.requests.state.value.status).toBe('pending')
    } finally {
      s.scope.stop()
    }
  })

  test('resizes only width, retaining height and simulation state without document writes', () => {
    const s = setup()
    try {
      const viewport = usePreviewViewport()
      viewport.height.value = 700
      viewport.textScale.value = 1.6
      viewport.keyboard.value = true
      const originalPage = structuredClone(s.first.graph.getNode(s.first.state.currentPageId))
      s.queue(640)
      const request = s.requests.pending.value
      if (!request) throw new Error('Request was not queued')
      expect(
        applyWebPreviewWidthRequest(
          s.first,
          request,
          { target: 'react', phase: 'ready', graph: s.first.graph },
          (width) => (viewport.width.value = width)
        )
      ).toBe(true)
      expect(viewport.viewport.value).toBe('custom')
      expect(viewport.width.value).toBe(640)
      expect(viewport.height.value).toBe(700)
      expect(viewport.textScale.value).toBe(1.6)
      expect(viewport.keyboard.value).toBe(true)
      expect(s.requests.state.value.status).toBe('applied')
      expect(s.requests.pending.value).toBeNull()
      expect(s.first.graph.getNode(s.first.state.currentPageId)).toEqual(originalPage)
      expect(s.first.state.sceneVersion).toBe(0)
    } finally {
      s.scope.stop()
    }
  })

  test('repeating the same width issues new work and an older callback cannot acknowledge it', () => {
    const s = setup()
    try {
      const first = s.queue()
      const old = s.requests.pending.value
      const next = s.queue()
      expect(next.serial).toBeGreaterThan(first.serial)
      if (!old) throw new Error('Missing original request')
      let writes = 0
      expect(
        applyWebPreviewWidthRequest(
          s.first,
          old,
          { target: 'react', phase: 'ready', graph: s.first.graph },
          () => writes++
        )
      ).toBe(false)
      expect(writes).toBe(0)
      expect(s.requests.state.value.serial).toBe(next.serial)
      expect(s.requests.state.value.status).toBe('pending')
    } finally {
      s.scope.stop()
    }
  })

  test('the same width can be applied again after the previous request completed', () => {
    const s = setup()
    try {
      let writes = 0
      const applyWidth = () => writes++
      for (let index = 0; index < 2; index++) {
        s.queue(768)
        const request = s.requests.pending.value
        if (!request) throw new Error('Missing repeated request')
        applyWebPreviewWidthRequest(
          s.first,
          request,
          { target: 'vue', phase: 'ready', graph: s.first.graph },
          applyWidth
        )
        expect(s.requests.state.value.status).toBe('applied')
      }
      expect(writes).toBe(2)
    } finally {
      s.scope.stop()
    }
  })

  test.each([239, 2561, Number.NaN, Infinity, -Infinity, 768.5])(
    'rejects an invalid width %s without pending work',
    (width) => {
      const s = setup()
      try {
        expect(s.queue(width)).toMatchObject({ status: 'unavailable', reason: 'invalid-width' })
        expect(s.requests.pending.value).toBeNull()
      } finally {
        s.scope.stop()
      }
    }
  )

  test('rejects stale caller graph/page captures before opening a preview', () => {
    const s = setup()
    try {
      expect(
        requestWebPreviewWidth(s.first, 768, {
          graph: new SceneGraph(),
          pageId: s.first.state.currentPageId
        })
      ).toMatchObject({ status: 'unavailable', reason: 'stale-context' })
      expect(
        requestWebPreviewWidth(s.first, 768, { graph: s.first.graph, pageId: 'missing' })
      ).toMatchObject({ status: 'unavailable', reason: 'stale-context' })
      expect(s.requests.pending.value).toBeNull()
    } finally {
      s.scope.stop()
    }
  })

  test('same-ID graph replacement expires a pending request synchronously', () => {
    const s = setup()
    try {
      s.queue()
      const previous = s.requests.pending.value
      s.first.graph = new SceneGraph()
      expect(s.requests.pending.value).toBeNull()
      expect(s.requests.state.value.status).toBe('expired')
      if (!previous) throw new Error('Missing original request')
      let writes = 0
      applyWebPreviewWidthRequest(
        s.first,
        previous,
        { target: 'react', phase: 'ready', graph: s.first.graph },
        () => writes++
      )
      expect(writes).toBe(0)
    } finally {
      s.scope.stop()
    }
  })

  test('switching a page away and back never revives its old pending request', () => {
    const s = setup()
    try {
      const initial = s.first.state.currentPageId
      const second = s.first.graph.createNode('CANVAS', s.first.graph.rootId, { name: 'Second' })
      s.queue()
      s.first.state.currentPageId = second.id
      s.first.state.currentPageId = initial
      expect(s.requests.pending.value).toBeNull()
      expect(s.requests.state.value.status).toBe('expired')
    } finally {
      s.scope.stop()
    }
  })

  test('isolates editor channels and expires the previous tab during an active change', () => {
    const s = setup()
    try {
      const second = editor()
      requestWebPreviewWidth(second, 1024, {
        graph: second.graph,
        pageId: second.state.currentPageId
      })
      s.queue(640)
      expect(s.requests.pending.value?.width).toBe(640)
      s.active.value = second
      expect(s.requests.pending.value?.width).toBe(1024)
      s.active.value = s.first
      expect(s.requests.pending.value).toBeNull()
      expect(s.requests.state.value.status).toBe('expired')
    } finally {
      s.scope.stop()
    }
  })

  test.each(['flutter', 'expo'])('does not reinterpret %s as a Web preview', (target) => {
    const s = setup()
    try {
      s.queue()
      const request = s.requests.pending.value
      if (!request) throw new Error('Missing request')
      let writes = 0
      applyWebPreviewWidthRequest(
        s.first,
        request,
        { target, phase: 'ready', graph: s.first.graph },
        () => writes++
      )
      expect(writes).toBe(0)
      expect(s.requests.state.value).toMatchObject({
        status: 'unavailable',
        reason: 'unsupported-target'
      })
    } finally {
      s.scope.stop()
    }
  })

  test('unavailable Browser Vue fails without changing target or requesting another build', () => {
    const s = setup()
    try {
      s.queue()
      setWebPreviewWidthAvailability(s.first, false)
      expect(s.requests.state.value.status).toBe('unavailable')
      expect(s.queue().status).toBe('unavailable')
      setWebPreviewWidthAvailability(s.first, null)
      expect(s.queue().status).toBe('pending')
    } finally {
      s.scope.stop()
    }
  })

  test('an old document frame cannot resize for a replacement document', () => {
    const s = setup()
    try {
      s.queue()
      const request = s.requests.pending.value
      if (!request) throw new Error('Missing request')
      let writes = 0
      applyWebPreviewWidthRequest(
        s.first,
        request,
        { target: 'react', phase: 'ready', graph: new SceneGraph() },
        () => writes++
      )
      expect(writes).toBe(0)
      expect(s.requests.state.value).toMatchObject({
        status: 'unavailable',
        reason: 'stale-preview'
      })
    } finally {
      s.scope.stop()
    }
  })

  test('closing the owning preview expires work, while normal edits do not', () => {
    const s = setup()
    try {
      s.queue()
      s.first.state.sceneVersion++
      expect(s.requests.state.value.status).toBe('pending')
      expireWebPreviewWidthRequest(s.first)
      expect(s.requests.pending.value).toBeNull()
      expect(s.requests.state.value.status).toBe('expired')
    } finally {
      s.scope.stop()
    }
  })
})
