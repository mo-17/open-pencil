import { isEqual } from 'es-toolkit'

import type { Editor } from '@open-pencil/core/editor'
import {
  CAROUSEL_MODULE_LIMITS,
  createCarouselModuleInstance,
  resolveCarouselModule,
  type CarouselSlideV1
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  currentModuleEditorOwner,
  type ModuleEditorCommit
} from '@/app/lowcode/module-editor/owner'

export interface CarouselSlidesValue {
  slides: CarouselSlideV1[]
  initialIndex: number
}

export function carouselPropertyVisible(key: string, config: JSONObject): boolean {
  if (key === 'initialIndex') return false
  if (key === 'textPosition' || key === 'overlayOpacity') return config.layout === 'overlay'
  if (key === 'paginationStyle') return config.showDots !== false
  if (key === 'arrowPosition') return config.showArrows !== false
  if (key === 'intervalMs' || key === 'pauseOnHover') return config.autoplay === true
  return true
}

export type CarouselSlideField = 'title' | 'description' | 'imageUrl' | 'alt' | 'href'
export type CarouselSlidesEdit =
  | { kind: 'update'; index: number; field: CarouselSlideField; value: string }
  | { kind: 'add'; title: string }
  | { kind: 'remove'; index: number }
  | { kind: 'move'; index: number; offset: -1 | 1 }
  | { kind: 'initial'; index: number }

export type CarouselSlidesCommit = ModuleEditorCommit<CarouselSlidesValue>

export function copyCarouselSlides(value: CarouselSlidesValue): CarouselSlidesValue {
  return {
    initialIndex: value.initialIndex,
    slides: value.slides.map(({ title, description, imageUrl: imageURL, alt, href }) => ({
      title,
      description,
      imageUrl: imageURL,
      alt,
      href
    }))
  }
}

export function carouselSlidesValue(config: JSONObject): CarouselSlidesValue {
  const instance = createCarouselModuleInstance(config)
  const resolved = resolveCarouselModule(instance)
  if (!resolved?.ok) throw new Error('Invalid carousel configuration')
  return {
    slides: structuredClone(resolved.config.slides),
    initialIndex: resolved.config.initialIndex
  }
}

/** Preserve the selected slide by position through list operations; no persisted IDs are added. */
export function editCarouselSlides(
  current: CarouselSlidesValue,
  edit: CarouselSlidesEdit
): CarouselSlidesValue {
  const slides = [...current.slides]
  const initial = slides[current.initialIndex]
  if (edit.kind === 'add') {
    if (slides.length >= CAROUSEL_MODULE_LIMITS.slides) return current
    slides.push({ title: edit.title, description: '', imageUrl: '', alt: '', href: '' })
  } else {
    if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= slides.length)
      return current
    if (edit.kind === 'initial') return { slides, initialIndex: edit.index }
    if (edit.kind === 'update') {
      slides[edit.index] = { ...slides[edit.index], [edit.field]: edit.value }
      return { slides, initialIndex: current.initialIndex }
    }
    if (edit.kind === 'remove') {
      if (slides.length <= 1) return current
      slides.splice(edit.index, 1)
    } else {
      const target = edit.index + edit.offset
      if (target < 0 || target >= slides.length) return current
      ;[slides[edit.index], slides[target]] = [slides[target], slides[edit.index]]
    }
  }
  const retainedIndex = slides.indexOf(initial)
  return {
    slides,
    initialIndex:
      retainedIndex !== -1 ? retainedIndex : Math.min(current.initialIndex, slides.length - 1)
  }
}

export function validCarouselSlides(config: JSONObject, value: CarouselSlidesValue): boolean {
  try {
    createCarouselModuleInstance({ ...config, ...value })
    return true
  } catch {
    return false
  }
}

type CarouselEditor = Pick<Editor, 'graph' | 'state' | 'updateNodeWithUndo'>

export function commitCarouselSlides(
  editor: CarouselEditor,
  request: CarouselSlidesCommit
): boolean {
  const { previousModule, value } = request
  const owner = currentModuleEditorOwner(editor, request)
  if (!owner) return false
  const resolved = resolveCarouselModule(previousModule)
  if (!resolved?.ok || !validCarouselSlides(resolved.config, value)) return false
  const module = createCarouselModuleInstance({ ...resolved.config, ...value })
  if (isEqual(module, previousModule)) return true
  editor.updateNodeWithUndo(
    owner.id,
    {
      interactiveProps: { ...owner.interactiveProps, module }
    },
    'Update carousel slides'
  )
  return true
}
