import { describe, expect, test } from 'bun:test'

import {
  createMotionPreset,
  MOTION_LIMITS,
  parseMotionSpec,
  upgradeMotionSpecV3,
  type MotionKeyframe,
  type NodeType,
  type MotionSpec
} from '@open-pencil/scene-graph'

import { createEditorStore } from '@/app/editor/session'
import { addMotionKeyframe } from '@/app/properties/motion/timeline'
import {
  addMotionPathPoint,
  MOTION_V2_COLOR_CHANNELS,
  MOTION_V2_NUMERIC_CHANNELS,
  motionV2ChannelEnabled,
  motionV2NumericLimit,
  removeMotionPathPoint,
  setMotionPathAutoRotate,
  setMotionPathEnabled,
  setMotionPathPoint,
  setMotionPathProgress,
  setMotionV2ColorChannelEnabled,
  setMotionV2ColorComponent,
  setMotionV2NumericChannel,
  setMotionV2NumericChannelEnabled,
  upgradeMotionSpecToV2
} from '@/app/properties/motion/v2'
import {
  motionNodeAuthoringCapabilityReason,
  motionNodeAuthoringSupported,
  motionV2ChannelCapabilityReason,
  motionV2ChannelSupported
} from '@/app/properties/motion/v2-capabilities'
import { motionV2ColorDefault, motionV2NumericDefault } from '@/app/properties/motion/v2-defaults'

describe('MotionSpec v2 timeline authoring', () => {
  test('requires an explicit version upgrade before advanced channel edits', () => {
    const preset = createMotionPreset('slide-up')
    const trackId = preset.tracks[0]?.id ?? ''

    expect(() => setMotionV2NumericChannelEnabled(preset, trackId, 'width', true, 320)).toThrow(
      RangeError
    )

    const upgraded = upgradeMotionSpecToV2(preset)
    expect(upgraded.version).toBe(2)
    expect(upgraded.preset).toBeUndefined()
    expect(upgraded.tracks[0]?.keyframes.some((frame) => frame.width !== undefined)).toBe(false)

    const v3 = upgradeMotionSpecV3(upgraded)
    expect(upgradeMotionSpecToV2(v3)).toBe(v3)
    expect(setMotionV2NumericChannelEnabled(v3, trackId, 'width', true, 320).version).toBe(3)
  })

  test('enables bounded numeric channels on every keyframe and edits one frame safely', () => {
    const upgraded = upgradeMotionSpecToV2(createMotionPreset('slide-up'))
    const trackId = upgraded.tracks[0]?.id ?? ''
    let spec = setMotionV2NumericChannelEnabled(upgraded, trackId, 'width', true, 1_000_000)

    expect(spec.tracks[0]?.keyframes.map((frame) => frame.width)).toEqual([
      MOTION_LIMITS.dimension.max,
      MOTION_LIMITS.dimension.max
    ])
    spec = setMotionV2NumericChannel(spec, trackId, 0, 'width', -10)
    expect(spec.tracks[0]?.keyframes.map((frame) => frame.width)).toEqual([
      MOTION_LIMITS.dimension.min,
      MOTION_LIMITS.dimension.max
    ])

    spec = setMotionV2NumericChannelEnabled(spec, trackId, 'trimStart', true, 0)
    spec = setMotionV2NumericChannelEnabled(spec, trackId, 'trimEnd', true, 0.6)
    spec = setMotionV2NumericChannel(spec, trackId, 0, 'trimStart', 0.9)
    const firstKeyframe = spec.tracks[0]?.keyframes[0]
    if (!firstKeyframe) throw new Error('Expected first MotionSpec v2 keyframe')
    expect(firstKeyframe).toMatchObject({ trimStart: 0.6, trimEnd: 0.6 })
    expect(motionV2ChannelEnabled(firstKeyframe, 'width')).toBe(true)

    spec = setMotionV2NumericChannelEnabled(spec, trackId, 'width', false, 0)
    expect(spec.tracks[0]?.keyframes.every((frame) => frame.width === undefined)).toBe(true)
  })

  test('maps every advanced numeric channel to its shared MotionSpec bound', () => {
    let spec = upgradeMotionSpecToV2(createMotionPreset('slide-up'))
    const trackId = spec.tracks[0]?.id ?? ''

    for (const channel of MOTION_V2_NUMERIC_CHANNELS) {
      const limit = motionV2NumericLimit(channel)
      spec = setMotionV2NumericChannelEnabled(spec, trackId, channel, true, limit.max + 1)
      expect(spec.tracks[0]?.keyframes.every((frame) => frame[channel] === limit.max)).toBe(true)
    }
  })

  test('enables RGBA channels on every keyframe without sharing color objects', () => {
    const upgraded = upgradeMotionSpecToV2(createMotionPreset('fade-in'))
    const trackId = upgraded.tracks[0]?.id ?? ''
    let spec = setMotionV2ColorChannelEnabled(upgraded, trackId, 'fillColor', true, {
      r: -1,
      g: 0.25,
      b: 2,
      a: 0.5
    })

    expect(spec.tracks[0]?.keyframes.map((frame) => frame.fillColor)).toEqual([
      { r: 0, g: 0.25, b: 1, a: 0.5 },
      { r: 0, g: 0.25, b: 1, a: 0.5 }
    ])
    expect(spec.tracks[0]?.keyframes[0]?.fillColor).not.toBe(
      spec.tracks[0]?.keyframes[1]?.fillColor
    )

    spec = setMotionV2ColorComponent(spec, trackId, 1, 'fillColor', 'a', 2)
    expect(spec.tracks[0]?.keyframes.map((frame) => frame.fillColor?.a)).toEqual([0.5, 1])
    spec = setMotionV2ColorChannelEnabled(spec, trackId, 'fillColor', false, {
      r: 0,
      g: 0,
      b: 0,
      a: 1
    })
    expect(spec.tracks[0]?.keyframes.every((frame) => frame.fillColor === undefined)).toBe(true)

    for (const channel of MOTION_V2_COLOR_CHANNELS) {
      spec = setMotionV2ColorChannelEnabled(spec, trackId, channel, true, {
        r: 2,
        g: -1,
        b: 0.5,
        a: 2
      })
      expect(spec.tracks[0]?.keyframes.every((frame) => frame[channel]?.r === 1)).toBe(true)
      expect(spec.tracks[0]?.keyframes.every((frame) => frame[channel]?.g === 0)).toBe(true)
    }
  })

  test('authors bounded paths, progress, auto-rotate, and point lifecycle', () => {
    const upgraded = upgradeMotionSpecToV2(createMotionPreset('slide-up'))
    const trackId = upgraded.tracks[0]?.id ?? ''
    let spec = setMotionPathEnabled(upgraded, trackId, true, { x: 1_000_000, y: -1_000_000 })

    expect(spec.tracks[0]?.path).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: MOTION_LIMITS.translate.max, y: MOTION_LIMITS.translate.min }
      ],
      autoRotate: false
    })
    expect(spec.tracks[0]?.keyframes.map((frame) => frame.pathProgress)).toEqual([0, 1])

    spec = setMotionPathProgress(spec, trackId, 0, 0.35)
    spec = setMotionPathAutoRotate(spec, trackId, true)
    spec = addMotionPathPoint(spec, trackId)
    expect(spec.tracks[0]?.path?.points).toHaveLength(3)
    spec = setMotionPathPoint(spec, trackId, 2, 'y', 1_000_000)
    expect(spec.tracks[0]?.path?.points[2]?.y).toBe(MOTION_LIMITS.translate.max)
    spec = removeMotionPathPoint(spec, trackId, 2)
    expect(spec.tracks[0]?.path?.points).toHaveLength(2)
    expect(() => removeMotionPathPoint(spec, trackId, 1)).toThrow(RangeError)

    spec = setMotionPathEnabled(spec, trackId, false)
    expect(spec.tracks[0]?.path).toBeUndefined()
    expect(spec.tracks[0]?.keyframes.every((frame) => frame.pathProgress === undefined)).toBe(true)
  })

  test('adds a complete interpolated keyframe to a track with every v2 channel', () => {
    const first: MotionKeyframe = {
      offset: 0,
      easing: 'linear',
      pathProgress: 0,
      fillColor: { r: 0, g: 0.25, b: 0.5, a: 0.75 },
      strokeColor: { r: 0.1, g: 0.2, b: 0.3, a: 0.4 },
      shadowColor: { r: 0.2, g: 0.4, b: 0.6, a: 0.8 }
    }
    const last: MotionKeyframe = {
      offset: 1,
      pathProgress: 1,
      fillColor: { r: 1, g: 0.75, b: 0.5, a: 0.25 },
      strokeColor: { r: 0.9, g: 0.8, b: 0.7, a: 0.6 },
      shadowColor: { r: 0.8, g: 0.6, b: 0.4, a: 0.2 }
    }
    for (const channel of MOTION_V2_NUMERIC_CHANNELS) {
      const limit = motionV2NumericLimit(channel)
      first[channel] = limit.min
      last[channel] = limit.max
    }
    const spec: MotionSpec = parseMotionSpec({
      version: 2,
      tracks: [
        {
          id: 'advanced',
          trigger: 'mount',
          keyframes: [first, last],
          timing: {
            durationMs: 400,
            easing: { type: 'hold' }
          },
          path: {
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 }
            ]
          }
        }
      ]
    })

    const inserted = addMotionKeyframe(spec, 'advanced', 0.5).spec
    const keyframes = inserted.tracks[0]?.keyframes
    const middle = keyframes?.[1]
    expect(keyframes).toHaveLength(3)
    expect(middle?.easing).toBe('linear')
    expect(keyframes?.[0]?.easing).toBe('linear')
    expect(middle?.pathProgress).toBe(0.5)
    for (const channel of MOTION_V2_NUMERIC_CHANNELS) {
      const limit = motionV2NumericLimit(channel)
      expect(middle?.[channel]).toBe((limit.min + limit.max) / 2)
      expect(keyframes?.every((frame) => frame[channel] !== undefined)).toBe(true)
    }
    expect(middle?.fillColor).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 })
    expect(middle?.strokeColor).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 })
    expect(middle?.shadowColor).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 })
    expect(() => parseMotionSpec(inserted)).not.toThrow()
  })

  test('maps row and column gaps to the authored auto-layout axes', () => {
    const store = createEditorStore()
    const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
      layoutMode: 'VERTICAL',
      itemSpacing: 18,
      counterAxisSpacing: 7,
      gridRowGap: 31,
      gridColumnGap: 41
    })

    expect(motionV2NumericDefault(frame, 'rowGap')).toBe(18)
    expect(motionV2NumericDefault(frame, 'columnGap')).toBe(7)

    store.graph.updateNode(frame.id, { layoutMode: 'HORIZONTAL' })
    const horizontal = store.graph.getNode(frame.id)
    expect(motionV2NumericDefault(horizontal, 'rowGap')).toBe(7)
    expect(motionV2NumericDefault(horizontal, 'columnGap')).toBe(18)

    store.graph.updateNode(frame.id, { layoutMode: 'GRID' })
    const grid = store.graph.getNode(frame.id)
    expect(motionV2NumericDefault(grid, 'rowGap')).toBe(31)
    expect(motionV2NumericDefault(grid, 'columnGap')).toBe(41)
  })

  test('uses only runtime-compatible outer shadow and layer blur defaults', () => {
    const store = createEditorStore()
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      effects: [
        {
          type: 'INNER_SHADOW',
          color: { r: 1, g: 0, b: 0, a: 1 },
          offset: { x: 91, y: 92 },
          radius: 93,
          spread: 94,
          visible: true
        },
        {
          type: 'BACKGROUND_BLUR',
          color: { r: 0, g: 0, b: 0, a: 0 },
          offset: { x: 0, y: 0 },
          radius: 95,
          spread: 0,
          visible: true
        },
        {
          type: 'DROP_SHADOW',
          color: { r: 0.1, g: 0.2, b: 0.3, a: 0.4 },
          offset: { x: 5, y: 6 },
          radius: 7,
          spread: 8,
          visible: true
        },
        {
          type: 'FOREGROUND_BLUR',
          color: { r: 0, g: 0, b: 0, a: 0 },
          offset: { x: 0, y: 0 },
          radius: 9,
          spread: 0,
          visible: true
        }
      ]
    })

    expect(motionV2ColorDefault(node, 'shadowColor')).toEqual({
      r: 0.1,
      g: 0.2,
      b: 0.3,
      a: 0.4
    })
    expect(motionV2NumericDefault(node, 'shadowX')).toBe(5)
    expect(motionV2NumericDefault(node, 'shadowY')).toBe(6)
    expect(motionV2NumericDefault(node, 'shadowBlur')).toBe(7)
    expect(motionV2NumericDefault(node, 'shadowSpread')).toBe(8)
    expect(motionV2NumericDefault(node, 'blur')).toBe(9)

    const incompatibleOnly = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      effects: node.effects.slice(0, 2)
    })
    expect(motionV2ColorDefault(incompatibleOnly, 'shadowColor')).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0.25
    })
    expect(motionV2NumericDefault(incompatibleOnly, 'shadowX')).toBe(0)
    expect(motionV2NumericDefault(incompatibleOnly, 'blur')).toBe(0)
  })

  test('reports when advanced channels cannot produce a visible result', () => {
    const store = createEditorStore()
    const rectangle = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        },
        {
          type: 'SOLID',
          color: { r: 0, g: 1, b: 0, a: 1 },
          opacity: 1,
          visible: false
        }
      ],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          weight: 2,
          opacity: 1,
          visible: false,
          align: 'CENTER'
        }
      ],
      layoutMode: 'NONE'
    })

    expect(motionV2ChannelCapabilityReason(rectangle, 'fillColor')).toBe('solidFill')
    expect(motionV2ChannelCapabilityReason(rectangle, 'strokeColor')).toBe('stroke')
    expect(motionV2ChannelCapabilityReason(rectangle, 'strokeWidth')).toBe('stroke')
    expect(motionV2ChannelCapabilityReason(rectangle, 'trimStart')).toBe('vectorStroke')
    expect(motionV2ChannelCapabilityReason(rectangle, 'gap')).toBe('autoLayout')
    expect(motionV2ChannelSupported(rectangle, 'blur')).toBe(true)
    expect(motionV2ChannelSupported(rectangle, 'shadowColor')).toBe(true)

    store.graph.updateNode(rectangle.id, {
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          weight: 2,
          opacity: 1,
          visible: true,
          align: 'CENTER'
        }
      ],
      layoutMode: 'VERTICAL'
    })
    const styledRectangle = store.graph.getNode(rectangle.id)
    expect(motionV2ChannelSupported(styledRectangle, 'fillColor')).toBe(true)
    expect(motionV2ChannelSupported(styledRectangle, 'strokeColor')).toBe(true)
    expect(motionV2ChannelSupported(styledRectangle, 'cornerRadius')).toBe(true)
    expect(motionV2ChannelSupported(styledRectangle, 'gap')).toBe(true)
    expect(motionV2ChannelCapabilityReason(styledRectangle, 'trimEnd')).toBe('vectorStroke')

    const vector = store.graph.createNode('VECTOR', store.state.currentPageId, {
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 20, y: 20 }
        ],
        segments: [
          {
            start: 0,
            end: 1,
            tangentStart: { x: 0, y: 0 },
            tangentEnd: { x: 0, y: 0 }
          }
        ],
        regions: []
      },
      strokes: styledRectangle?.strokes
    })
    expect(motionV2ChannelCapabilityReason(vector, 'fillColor')).toBe('solidFill')
    expect(motionV2ChannelSupported(vector, 'strokeColor')).toBe(true)
    expect(motionV2ChannelSupported(vector, 'strokeWidth')).toBe(true)
    expect(motionV2ChannelSupported(vector, 'trimStart')).toBe(true)
    expect(motionV2ChannelSupported(vector, 'trimEnd')).toBe(true)
    expect(motionV2ChannelSupported(vector, 'trimOffset')).toBe(true)
    expect(motionV2ChannelCapabilityReason(vector, 'cornerRadius')).toBe('boxCorners')

    const outlineOnlyVector = store.graph.createNode('VECTOR', store.state.currentPageId, {
      strokeGeometry: [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([0]) }],
      strokes: styledRectangle?.strokes
    })
    expect(motionV2ChannelSupported(outlineOnlyVector, 'strokeColor')).toBe(true)
    expect(motionV2ChannelCapabilityReason(outlineOnlyVector, 'strokeWidth')).toBe(
      'centerlineStroke'
    )
    expect(motionV2ChannelCapabilityReason(outlineOnlyVector, 'trimStart')).toBe('centerlineStroke')

    const importedOutlineVector = store.graph.createNode('VECTOR', store.state.currentPageId, {
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([0]) }],
      strokeGeometry: [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([0]) }],
      fills: styledRectangle?.fills,
      strokes: styledRectangle?.strokes
    })
    expect(motionV2ChannelSupported(importedOutlineVector, 'fillColor')).toBe(true)
    expect(motionV2ChannelSupported(importedOutlineVector, 'strokeColor')).toBe(true)
    expect(motionV2ChannelCapabilityReason(importedOutlineVector, 'strokeWidth')).toBe(
      'centerlineStroke'
    )
    expect(motionV2ChannelCapabilityReason(importedOutlineVector, 'trimEnd')).toBe(
      'centerlineStroke'
    )

    const fillOutlineOnly = store.graph.createNode('VECTOR', store.state.currentPageId, {
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([0]) }],
      fills: styledRectangle?.fills,
      strokes: styledRectangle?.strokes
    })
    expect(motionV2ChannelSupported(fillOutlineOnly, 'fillColor')).toBe(true)
    expect(motionV2ChannelCapabilityReason(fillOutlineOnly, 'strokeColor')).toBe('vectorGeometry')

    const strokeOutlineOnly = store.graph.createNode('VECTOR', store.state.currentPageId, {
      strokeGeometry: [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([0]) }],
      fills: styledRectangle?.fills,
      strokes: styledRectangle?.strokes
    })
    expect(motionV2ChannelCapabilityReason(strokeOutlineOnly, 'fillColor')).toBe('vectorGeometry')
    expect(motionV2ChannelSupported(strokeOutlineOnly, 'strokeColor')).toBe(true)

    const emptyVector = store.graph.createNode('VECTOR', store.state.currentPageId, {
      fills: styledRectangle?.fills,
      strokes: styledRectangle?.strokes
    })
    expect(motionV2ChannelCapabilityReason(emptyVector, 'fillColor')).toBe('vectorGeometry')
    expect(motionV2ChannelCapabilityReason(emptyVector, 'strokeColor')).toBe('vectorGeometry')
    expect(motionV2ChannelCapabilityReason(emptyVector, 'strokeWidth')).toBe('centerlineStroke')
    expect(motionV2ChannelCapabilityReason(emptyVector, 'trimOffset')).toBe('centerlineStroke')

    const unresolvedBoolean = store.graph.createNode('BOOLEAN_OPERATION', store.state.currentPageId)
    expect(motionNodeAuthoringCapabilityReason(unresolvedBoolean)).toBe('booleanResult')
    expect(motionNodeAuthoringSupported(unresolvedBoolean)).toBe(false)
    expect(motionV2ChannelCapabilityReason(unresolvedBoolean, 'blur')).toBe('booleanResult')

    const resolvedBoolean = store.graph.createNode('BOOLEAN_OPERATION', store.state.currentPageId, {
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([0]) }]
    })
    expect(motionNodeAuthoringCapabilityReason(resolvedBoolean)).toBeNull()
    expect(motionNodeAuthoringSupported(resolvedBoolean)).toBe(true)
    expect(motionV2ChannelSupported(resolvedBoolean, 'blur')).toBe(true)

    const supportedBoxTypes: NodeType[] = [
      'FRAME',
      'RECTANGLE',
      'ROUNDED_RECTANGLE',
      'COMPONENT',
      'INSTANCE',
      'SHAPE_WITH_TEXT',
      'INPUT',
      'BUTTON',
      'SELECT',
      'CHECKBOX',
      'FORM',
      'LIST',
      'RADIO',
      'TEXTAREA',
      'DATEPICKER',
      'SWITCH'
    ]
    const unsupportedCornerTypes: NodeType[] = [
      'CANVAS',
      'ELLIPSE',
      'TEXT',
      'LINE',
      'STAR',
      'POLYGON',
      'VECTOR',
      'BOOLEAN_OPERATION',
      'GROUP',
      'SECTION',
      'COMPONENT_SET',
      'CONNECTOR'
    ]
    for (const type of supportedBoxTypes) {
      expect(motionV2ChannelSupported({ ...rectangle, type }, 'cornerRadius')).toBe(true)
    }
    for (const type of unsupportedCornerTypes) {
      const node = {
        ...rectangle,
        type,
        ...(type === 'BOOLEAN_OPERATION'
          ? {
              fillGeometry: [{ windingRule: 'NONZERO' as const, commandsBlob: new Uint8Array([0]) }]
            }
          : {})
      }
      expect(motionV2ChannelCapabilityReason(node, 'cornerRadius')).toBe('boxCorners')
    }
  })
})
