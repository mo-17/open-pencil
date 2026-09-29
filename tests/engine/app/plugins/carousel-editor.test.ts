import { afterEach, describe, expect, test } from 'bun:test'

import { omit } from 'es-toolkit/object'
import { computed, effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import {
  CAROUSEL_MODULE_LIMITS,
  CAROUSEL_STYLE_DEFAULTS,
  CAROUSEL_NAVIGATION_DEFAULTS,
  createCarouselModuleFrameOverrides,
  createCarouselModuleInstance,
  resolveCarouselModule
} from '@open-pencil/core/plugins'

import {
  carouselSlidesValue,
  carouselPropertyVisible,
  commitCarouselSlides,
  editCarouselSlides,
  validCarouselSlides,
  type CarouselSlidesCommit
} from '@/app/lowcode/carousel-editor'
import { useCarouselSlidesDraft } from '@/app/lowcode/carousel-editor/use'

const editors: ReturnType<typeof createEditor>[] = []
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  for (const editor of editors.splice(0)) editor.dispose()
})

function fixture() {
  const editor = createEditor()
  editors.push(editor)
  const owner = editor.graph.createNode(
    'FRAME',
    editor.state.currentPageId,
    createCarouselModuleFrameOverrides({ initialIndex: 1 })
  )
  editor.select([owner.id])
  editor.undo.clear()
  const resolved = resolveCarouselModule(owner.interactiveProps?.module)
  if (!resolved?.ok) throw new Error('Missing carousel')
  const config = resolved.config
  const value = carouselSlidesValue(config)
  function request(next = value): CarouselSlidesCommit {
    return { owner, previousModule: structuredClone(owner.interactiveProps?.module), value: next }
  }
  return { editor, owner, config, value, request }
}

describe('carousel card editing', () => {
  test('shows only applicable settings while preserving hidden style preferences', () => {
    const { config } = fixture()
    expect(carouselPropertyVisible('textPosition', config)).toBe(false)
    expect(carouselPropertyVisible('overlayOpacity', config)).toBe(false)
    const overlay = { ...config, layout: 'overlay', textPosition: 'top', overlayOpacity: 0.25 }
    expect(carouselPropertyVisible('textPosition', overlay)).toBe(true)
    expect(carouselPropertyVisible('overlayOpacity', overlay)).toBe(true)
    expect(carouselPropertyVisible('paginationStyle', { ...overlay, showDots: false })).toBe(false)
    expect(carouselPropertyVisible('paginationStyle', overlay)).toBe(true)
    expect(carouselPropertyVisible('arrowPosition', { ...overlay, showArrows: false })).toBe(false)
    expect(carouselPropertyVisible('arrowPosition', overlay)).toBe(true)
    expect(carouselPropertyVisible('swipeEnabled', { ...overlay, showArrows: false })).toBe(true)
    for (const key of ['intervalMs', 'pauseOnHover']) {
      expect(carouselPropertyVisible(key, config)).toBe(false)
      expect(carouselPropertyVisible(key, { ...config, autoplay: true })).toBe(true)
    }
    expect(overlay).toMatchObject({ textPosition: 'top', overlayOpacity: 0.25 })
    expect(config).toMatchObject({
      intervalMs: 5_000,
      pauseOnHover: true,
      arrowPosition: 'bottom-corners'
    })
  })

  test.each([1, 2])(
    'editing v%i slides upgrades to v3, retains swipe off, and undo restores the original',
    (version) => {
      const { editor, owner, value } = fixture()
      const current = createCarouselModuleInstance({ initialIndex: 1 })
      const keys =
        version === 1
          ? { ...CAROUSEL_STYLE_DEFAULTS, ...CAROUSEL_NAVIGATION_DEFAULTS }
          : CAROUSEL_NAVIGATION_DEFAULTS
      const config = omit(current.config, Object.keys(keys))
      const legacy = { ...current, configVersion: version, config }
      editor.graph.updateNode(owner.id, { interactiveProps: { module: legacy } })
      const before = structuredClone(owner.interactiveProps)
      expect(
        commitCarouselSlides(editor, {
          owner,
          previousModule: legacy,
          value: editCarouselSlides(value, {
            kind: 'update',
            index: 0,
            field: 'title',
            value: 'Edited legacy title'
          })
        })
      ).toBe(true)
      const resolved = resolveCarouselModule(owner.interactiveProps?.module)
      expect(resolved?.ok && resolved.instance.configVersion).toBe(3)
      expect(resolved?.ok && resolved.config).toMatchObject(CAROUSEL_STYLE_DEFAULTS)
      expect(resolved?.ok && resolved.config).toMatchObject({
        arrowPosition: 'bottom-corners',
        swipeEnabled: false
      })
      editor.undo.undo()
      expect(owner.interactiveProps).toEqual(before)
    }
  )

  test('slide mutations preserve authored layout, navigation and presentation choices', () => {
    const { editor, owner, value } = fixture()
    const module = createCarouselModuleInstance({
      initialIndex: 1,
      layout: 'overlay',
      imageFit: 'fill',
      textPosition: 'center',
      textAlign: 'right',
      overlayOpacity: 0.7,
      paginationStyle: 'numbers',
      arrowPosition: 'bottom-left',
      swipeEnabled: false
    })
    editor.graph.updateNode(owner.id, { interactiveProps: { module } })
    expect(
      commitCarouselSlides(editor, {
        owner,
        previousModule: module,
        value: editCarouselSlides(value, { kind: 'move', index: 1, offset: -1 })
      })
    ).toBe(true)
    const resolved = resolveCarouselModule(owner.interactiveProps?.module)
    expect(resolved?.ok && resolved.config).toMatchObject({
      layout: 'overlay',
      imageFit: 'fill',
      textPosition: 'center',
      textAlign: 'right',
      overlayOpacity: 0.7,
      paginationStyle: 'numbers',
      arrowPosition: 'bottom-left',
      swipeEnabled: false,
      initialIndex: 0
    })
  })
  test('reordering follows the selected item instead of retaining a stale numeric position', () => {
    const { value } = fixture()
    const current = value.slides[1].title
    for (const edit of [
      { kind: 'move', index: 1, offset: -1 },
      { kind: 'move', index: 1, offset: 1 },
      { kind: 'move', index: 0, offset: 1 },
      { kind: 'move', index: 2, offset: -1 },
      { kind: 'add', title: 'Extra' },
      { kind: 'remove', index: 0 }
    ] as const) {
      const next = editCarouselSlides(value, edit)
      expect(next.slides[next.initialIndex].title).toBe(current)
    }
    expect(value.initialIndex).toBe(1)
    expect(value.slides).toHaveLength(3)
  })

  test('deleting the selected item chooses its next neighbor, or the previous at the end', () => {
    const { value } = fixture()
    const middle = editCarouselSlides(value, { kind: 'remove', index: 1 })
    expect(middle.initialIndex).toBe(1)
    expect(middle.slides[1]).toEqual(value.slides[2])
    const end = editCarouselSlides({ ...value, initialIndex: 2 }, { kind: 'remove', index: 2 })
    expect(end.initialIndex).toBe(1)
    expect(end.slides[1]).toEqual(value.slides[1])
  })

  test('bounded additions and deletions never produce zero, thirteen, or invalid indexes', () => {
    let { value } = fixture()
    for (let index = 0; index < 20; index++)
      value = editCarouselSlides(value, { kind: 'add', title: 'Extra' })
    expect(value.slides).toHaveLength(CAROUSEL_MODULE_LIMITS.slides)
    for (let index = 0; index < 20; index++)
      value = editCarouselSlides(value, { kind: 'remove', index: 0 })
    expect(value.slides).toHaveLength(1)
    expect(value.initialIndex).toBe(0)
    expect(editCarouselSlides(value, { kind: 'move', index: 0, offset: -1 })).toBe(value)
    expect(editCarouselSlides(value, { kind: 'initial', index: 1 })).toBe(value)
    expect(editCarouselSlides(value, { kind: 'remove', index: -1 })).toBe(value)
  })

  test('image and alternate text edits stay local until both satisfy the existing strict contract', () => {
    const { config, value } = fixture()
    const image = editCarouselSlides(value, {
      kind: 'update',
      index: 0,
      field: 'imageUrl',
      value: 'https://example.com/cover.png'
    })
    expect(validCarouselSlides(config, image)).toBe(false)
    const paired = editCarouselSlides(image, {
      kind: 'update',
      index: 0,
      field: 'alt',
      value: 'Cover'
    })
    expect(validCarouselSlides(config, paired)).toBe(true)
    for (const imageURL of [
      'http://example.com/a.png',
      'https://localhost/a.png',
      'https://127.0.0.1/a.png',
      'data:image/png;base64,abc',
      'file:///tmp/a.png'
    ]) {
      expect(
        validCarouselSlides(
          config,
          editCarouselSlides(paired, {
            kind: 'update',
            index: 0,
            field: 'imageUrl',
            value: imageURL
          })
        )
      ).toBe(false)
    }
    expect(
      validCarouselSlides(
        config,
        editCarouselSlides(paired, { kind: 'update', index: 0, field: 'imageUrl', value: '' })
      )
    ).toBe(false)
    expect(
      validCarouselSlides(
        config,
        editCarouselSlides(value, { kind: 'update', index: 0, field: 'title', value: '' })
      )
    ).toBe(false)
    expect(
      validCarouselSlides(
        config,
        editCarouselSlides(value, {
          kind: 'update',
          index: 0,
          field: 'href',
          value: ['javascript', 'alert(1)'].join(':')
        })
      )
    ).toBe(false)
  })

  test('one undo restores the slide order and initial selection atomically', () => {
    const { editor, owner, value, request } = fixture()
    const original = structuredClone(owner.interactiveProps)
    expect(
      commitCarouselSlides(
        editor,
        request(editCarouselSlides(value, { kind: 'move', index: 1, offset: -1 }))
      )
    ).toBe(true)
    const committed = resolveCarouselModule(owner.interactiveProps?.module)
    expect(committed?.ok && committed.config.initialIndex).toBe(0)
    expect(editor.undo.canUndo).toBe(true)
    editor.undo.undo()
    expect(owner.interactiveProps).toEqual(original)
    editor.undo.redo()
    expect(resolveCarouselModule(owner.interactiveProps?.module)).toEqual(committed)
  })

  test('selection changes, replaced owners, concurrent config changes and locked parents reject stale commits', () => {
    const { editor, owner, value, request } = fixture()
    const next = editCarouselSlides(value, { kind: 'add', title: 'Extra' })
    const pending = request(next)
    editor.clearSelection()
    expect(commitCarouselSlides(editor, pending)).toBe(false)
    editor.select([owner.id])
    expect(commitCarouselSlides(editor, { ...pending, owner: structuredClone(owner) })).toBe(false)
    editor.graph.updateNode(owner.id, {
      interactiveProps: { module: createCarouselModuleInstance({ initialIndex: 0 }) }
    })
    expect(commitCarouselSlides(editor, pending)).toBe(false)
    editor.graph.updateNode(owner.id, { locked: true })
    expect(commitCarouselSlides(editor, request(next))).toBe(false)
    expect(editor.undo.canUndo).toBe(false)
  })

  test('invalid requests cannot replace valid configuration even when called without the panel', () => {
    const { editor, owner, value, request } = fixture()
    const before = structuredClone(owner.interactiveProps)
    expect(
      commitCarouselSlides(
        editor,
        request(
          editCarouselSlides(value, {
            kind: 'update',
            index: 0,
            field: 'href',
            value: '//evil.example.com'
          })
        )
      )
    ).toBe(false)
    expect(owner.interactiveProps).toEqual(before)
    expect(editor.undo.canUndo).toBe(false)
  })
})

describe('carousel draft lifecycle', () => {
  function draftFixture() {
    const { editor, owner, config } = fixture()
    const target = shallowRef(owner)
    const saved = shallowRef(config)
    const active = ref(true)
    const scope = effectScope()
    scopes.push(scope)
    const commits: CarouselSlidesCommit[] = []
    const state = scope.run(() =>
      useCarouselSlidesDraft(
        () => target.value,
        () => saved.value,
        (request) => commits.push(request),
        active
      )
    )
    if (!state) throw new Error('Missing draft scope')
    const savedConfig = computed(() => carouselSlidesValue(saved.value))
    return { editor, owner, target, saved, savedConfig, active, scope, commits, state }
  }

  test('an invalid intermediate image edit can be completed and committed without losing either field', () => {
    const { state, commits } = draftFixture()
    state.beginInput()
    state.input(0, 'imageUrl', 'https://example.com/cover.png')
    state.commit()
    expect(state.invalid.value).toBe(true)
    expect(commits).toHaveLength(0)
    state.beginInput()
    state.input(0, 'alt', 'A cover')
    state.commit()
    expect(state.invalid.value).toBe(false)
    expect(commits).toHaveLength(1)
    expect(commits[0].value.slides[0]).toMatchObject({
      imageUrl: 'https://example.com/cover.png',
      alt: 'A cover'
    })
    state.input(0, 'alt', 'Later draft')
    expect(commits[0].value.slides[0].alt).toBe('A cover')
  })

  test('deactivation, restore and disposal discard drafts before late blur can commit', () => {
    const { state, savedConfig, active, scope, commits } = draftFixture()
    state.beginInput()
    state.input(0, 'title', 'Unsaved')
    active.value = false
    state.commit()
    expect(state.draft.value).toEqual(savedConfig.value)
    active.value = true
    state.input(0, 'title', 'Late input')
    state.commit()
    expect(commits).toHaveLength(0)
    state.beginInput()
    state.input(0, 'title', 'Discard')
    state.restore()
    state.commit()
    expect(commits).toHaveLength(0)
    state.beginInput()
    state.input(0, 'title', 'Unmounted')
    scope.stop()
    state.commit()
    expect(commits).toHaveLength(0)
  })

  test('owner and external saved-config changes invalidate both draft and late input', () => {
    const { editor, state, target, saved, commits } = draftFixture()
    state.beginInput()
    state.input(0, 'title', 'For old node')
    target.value = editor.graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createCarouselModuleFrameOverrides()
    )
    state.input(0, 'title', 'Late input for old node')
    state.commit()
    expect(commits).toHaveLength(0)
    state.beginInput()
    state.input(0, 'title', 'Draft before external update')
    saved.value = { ...saved.value, initialIndex: 0 }
    state.input(0, 'title', 'Late input after update')
    state.commit()
    expect(commits).toHaveLength(0)
    expect(state.draft.value.initialIndex).toBe(0)
  })
})
