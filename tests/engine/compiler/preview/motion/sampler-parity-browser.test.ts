/* eslint-disable max-lines -- one real-browser parity fixture covers CSS, WAAPI, nesting, a11y and cleanup */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Locator, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import type { Vector } from '@open-pencil/core'
import type { MotionSpec, MotionTrack } from '@open-pencil/scene-graph'

import { sampleMotionSpec, type MotionVisualState } from '#core/motion'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

interface ParityFixture {
  files: Map<string, string | Uint8Array>
  complex: { nodeId: string; spec: MotionSpec }
  precedence: { nodeId: string; spec: MotionSpec }
  parent: { nodeId: string; spec: MotionSpec }
  child: { nodeId: string; spec: MotionSpec }
  controlled: { nodeId: string; spec: MotionSpec; trackId: string }
  reduced: { nodeId: string; spec: MotionSpec }
  pathCombined: { nodeId: string; spec: MotionSpec }
  cubicPath: { nodeId: string; spec: MotionSpec }
  responsiveVector: { nodeId: string; parentId: string; spec: MotionSpec }
  plateau: { nodeId: string; spec: MotionSpec }
  fullTrim: { nodeId: string; spec: MotionSpec }
  emptyVector: { nodeId: string; spec: MotionSpec }
  resolvedBoolean: { nodeId: string; spec: MotionSpec }
  unresolvedBoolean: { nodeId: string }
  opacityVector: { nodeId: string; spec: MotionSpec }
  opacityBoolean: { nodeId: string; spec: MotionSpec }
  staticOpacityVector: { nodeId: string }
  rotationVector: { nodeId: string; spec: MotionSpec }
  composedV3: { nodeId: string; spec: MotionSpec; opacity: number; rotation: number }
  fractionalV3: { nodeId: string; spec: MotionSpec }
  inactiveV3: { nodeId: string; spec: MotionSpec; opacity: number; rotation: number }
}

interface RuntimeInspection {
  entries: unknown[]
  activeAnimationCount: number
}

type Matrix2D = [number, number, number, number, number, number]

interface RectSnapshot {
  x: number
  y: number
  width: number
  height: number
}

const LINEAR = { easing: 'linear' as const }

function motion(
  tracks: MotionTrack[],
  reducedMotion: MotionSpec['reducedMotion'] = 'allow'
): MotionSpec {
  return { version: 1, reducedMotion, tracks }
}

function track(id: string, overrides: Partial<MotionTrack> = {}): MotionTrack {
  return {
    id,
    trigger: 'mount',
    keyframes: [
      { offset: 0, x: 0 },
      { offset: 1, x: 100 }
    ],
    timing: { durationMs: 200, ...LINEAR },
    exit: 'reset',
    ...overrides
  }
}

function rectangleCommandsBlob(x: number, y: number, width: number, height: number): Uint8Array {
  const blob = new Uint8Array(1 + 4 * 9 + 1)
  const view = new DataView(blob.buffer)
  const points = [
    { command: 1, x, y },
    { command: 2, x: x + width, y },
    { command: 2, x: x + width, y: y + height },
    { command: 2, x, y: y + height }
  ]
  let offset = 0
  for (const point of points) {
    blob[offset] = point.command
    view.setFloat32(offset + 1, point.x, true)
    view.setFloat32(offset + 5, point.y, true)
    offset += 9
  }
  blob[offset] = 0
  return blob
}

function triangleCommandsBlob(width: number, height: number): Uint8Array {
  const blob = new Uint8Array(1 + 4 * 9 + 1)
  const view = new DataView(blob.buffer)
  const points = [
    { command: 1, x: 0, y: 0 },
    { command: 2, x: width, y: height / 3 },
    { command: 2, x: width / 4, y: height },
    { command: 2, x: 0, y: 0 }
  ]
  let offset = 0
  for (const point of points) {
    blob[offset] = point.command
    view.setFloat32(offset + 1, point.x, true)
    view.setFloat32(offset + 5, point.y, true)
    offset += 9
  }
  blob[offset] = 0
  return blob
}

function buildParityFixture(): ParityFixture {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const complexSpec = motion([
    track('complex', {
      keyframes: [
        { offset: 0, x: 0, y: 8, scaleX: 0.8, scaleY: 0.9, rotate: -20, opacity: 0.2 },
        { offset: 1, x: 80, y: 28, scaleX: 1.2, scaleY: 1.1, rotate: 40, opacity: 0.8 }
      ],
      timing: {
        durationMs: 200,
        delayMs: 50,
        easing: 'linear',
        iterations: 2,
        direction: 'alternate',
        fill: 'both'
      }
    })
  ])
  const complexNode = graph.createNode('RECTANGLE', pageId, {
    name: 'ParityComplex',
    x: 20,
    y: 20,
    width: 80,
    height: 40,
    motion: complexSpec
  })

  const precedenceSpec = motion([
    track('first', {
      keyframes: [
        { offset: 0, x: 0, opacity: 0.1 },
        { offset: 1, x: 100, opacity: 0.5 }
      ],
      timing: { durationMs: 200, ...LINEAR, fill: 'both' }
    }),
    track('later', {
      keyframes: [
        { offset: 0, x: 10, opacity: 0.3 },
        { offset: 1, x: 30, opacity: 0.9 }
      ],
      timing: { durationMs: 200, ...LINEAR, fill: 'both' }
    })
  ])
  const precedenceNode = graph.createNode('RECTANGLE', pageId, {
    name: 'ParityLaterTrackWins',
    x: 120,
    y: 20,
    width: 80,
    height: 40,
    motion: precedenceSpec
  })

  const parentSpec = motion([
    track('parent-motion', {
      keyframes: [
        { offset: 0, x: -20, scaleX: 0.5, scaleY: 0.75 },
        { offset: 1, x: 20, scaleX: 1.5, scaleY: 1.25 }
      ],
      timing: { durationMs: 200, ...LINEAR, fill: 'both' }
    })
  ])
  const childSpec = motion([
    track('child-motion', {
      keyframes: [
        { offset: 0, rotate: -30, opacity: 0.2 },
        { offset: 1, rotate: 30, opacity: 1 }
      ],
      timing: { durationMs: 200, ...LINEAR, fill: 'both' }
    })
  ])
  const parentNode = graph.createNode('FRAME', pageId, {
    name: 'ParityParent',
    x: 20,
    y: 100,
    width: 120,
    height: 80,
    opacity: 0.8,
    motion: parentSpec
  })
  const childNode = graph.createNode('RECTANGLE', parentNode.id, {
    name: 'ParityChild',
    x: 20,
    y: 20,
    width: 40,
    height: 30,
    opacity: 0.5,
    motion: childSpec
  })

  const controlledTrackId = 'controlled-click'
  const controlledSpec = motion([
    track(controlledTrackId, {
      trigger: 'click',
      keyframes: [
        { offset: 0, x: -10, y: 5, scaleX: 0.75, scaleY: 0.5, rotate: -10, opacity: 0.4 },
        { offset: 1, x: 30, y: 25, scaleX: 1.25, scaleY: 1.5, rotate: 30, opacity: 1 }
      ],
      timing: { durationMs: 200, ...LINEAR, fill: 'both' }
    })
  ])
  const controlledNode = graph.createNode('RECTANGLE', pageId, {
    name: 'ParityControlled',
    x: 220,
    y: 20,
    width: 80,
    height: 40,
    motion: controlledSpec
  })

  const reducedSpec = motion(
    [
      track('reduced-mixed', {
        keyframes: [
          { offset: 0, x: 90, opacity: 0 },
          { offset: 1, x: 0, opacity: 1 }
        ],
        timing: { durationMs: 1_000, delayMs: 400, ...LINEAR, fill: 'both' }
      })
    ],
    'reduce'
  )
  const reducedNode = graph.createNode('RECTANGLE', pageId, {
    name: 'ParityReduced',
    x: 220,
    y: 100,
    width: 80,
    height: 40,
    motion: reducedSpec
  })

  const pathCombinedSpec: MotionSpec = {
    version: 2,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'path-combined',
        trigger: 'mount',
        path: {
          points: [
            { x: 0, y: 0 },
            { x: 80, y: 0 },
            { x: 80, y: 60 }
          ],
          autoRotate: true
        },
        keyframes: [
          {
            offset: 0,
            pathProgress: 0,
            x: 4,
            y: 6,
            rotate: 5,
            scaleX: 0.8,
            scaleY: 0.9,
            easing: 'ease-in'
          },
          {
            offset: 0.5,
            pathProgress: 0.5,
            x: 14,
            y: -4,
            rotate: 20,
            scaleX: 1.1,
            scaleY: 0.7,
            easing: { type: 'cubicBezier', x1: 0.2, y1: 0.8, x2: 0.6, y2: 1 }
          },
          {
            offset: 1,
            pathProgress: 1,
            x: 24,
            y: 10,
            rotate: 35,
            scaleX: 1.3,
            scaleY: 1.2
          }
        ],
        timing: { durationMs: 200, easing: 'linear', fill: 'both' }
      }
    ]
  }
  const pathCombinedNode = graph.createNode('RECTANGLE', pageId, {
    name: 'ParityPathCombined',
    x: 320,
    y: 100,
    width: 40,
    height: 20,
    motion: pathCombinedSpec
  })

  const cubicPathSpec: MotionSpec = {
    version: 3,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'cubic-path',
        trigger: 'mount',
        path: {
          version: 2,
          start: { x: 0, y: 0 },
          segments: [
            {
              control1: { x: 0, y: 120 },
              control2: { x: 120, y: -40 },
              end: { x: 120, y: 80 }
            },
            {
              control1: { x: 120, y: 150 },
              control2: { x: 20, y: 150 },
              end: { x: 40, y: 200 }
            }
          ],
          autoRotate: true
        },
        keyframes: [
          { offset: 0, pathProgress: 0 },
          { offset: 1, pathProgress: 1 }
        ],
        timing: { durationMs: 200, easing: 'linear', fill: 'both' }
      }
    ]
  }
  const cubicPathNode = graph.createNode('RECTANGLE', pageId, {
    name: 'ParityCubicPath',
    x: 440,
    y: 100,
    width: 30,
    height: 20,
    motion: cubicPathSpec
  })

  const responsiveVectorSpec: MotionSpec = {
    version: 2,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'responsive-vector-parent',
        trigger: 'mount',
        keyframes: [
          { offset: 0, width: 40 },
          { offset: 1, width: 80 }
        ],
        timing: { durationMs: 200, easing: 'linear', fill: 'both' }
      }
    ]
  }
  const responsiveParent = graph.createNode('FRAME', pageId, {
    name: 'ParityResponsiveVectorParent',
    x: 380,
    y: 20,
    width: 40,
    height: 20,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    motion: responsiveVectorSpec
  })
  const responsiveVector = graph.createNode('VECTOR', responsiveParent.id, {
    name: 'ParityResponsiveVector',
    width: 10,
    height: 20,
    layoutGrow: 1,
    vectorNetwork: {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 20 },
        { x: 0, y: 20 }
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }
      ],
      regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }]
    },
    fills: [
      {
        type: 'SOLID',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })

  const plateauSpec: MotionSpec = {
    version: 2,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'plateau-corner',
        trigger: 'mount',
        path: {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 }
          ],
          autoRotate: true
        },
        keyframes: [
          { offset: 0, pathProgress: 0 },
          { offset: 0.4, pathProgress: 0.5, easing: { type: 'hold' } },
          { offset: 0.657, pathProgress: 0.5, easing: 'linear' },
          { offset: 1, pathProgress: 1 }
        ],
        timing: { durationMs: 1_000, easing: 'linear', fill: 'both' }
      }
    ]
  }
  const plateauNode = graph.createNode('RECTANGLE', pageId, {
    name: 'ParityPlateauCorner',
    x: 20,
    y: 220,
    width: 40,
    height: 20,
    motion: plateauSpec
  })

  const fullTrimSpec: MotionSpec = {
    version: 2,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'full-trim',
        trigger: 'mount',
        keyframes: [
          {
            offset: 0,
            strokeColor: { r: 0, g: 0, b: 1, a: 1 },
            trimStart: 0,
            trimEnd: 1
          },
          {
            offset: 1,
            strokeColor: { r: 0, g: 0, b: 1, a: 1 },
            trimStart: 0,
            trimEnd: 1
          }
        ],
        timing: { durationMs: 100, easing: 'linear', fill: 'both' }
      }
    ]
  }
  const fullTrimNode = graph.createNode('LINE', pageId, {
    name: 'ParityFullTrim',
    x: 220,
    y: 220,
    width: 80,
    height: 0,
    strokes: [
      {
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 0.5,
        visible: true,
        weight: 2,
        align: 'CENTER',
        dashPattern: [2, 3]
      }
    ],
    motion: fullTrimSpec
  })

  const geometryMotionSpec: MotionSpec = {
    version: 2,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'geometry-motion',
        trigger: 'mount',
        keyframes: [
          {
            offset: 0,
            opacity: 0.5,
            width: 20,
            height: 20,
            fillColor: { r: 1, g: 0, b: 0, a: 1 },
            strokeColor: { r: 0, g: 0, b: 0, a: 1 },
            strokeWidth: 2,
            trimStart: 0,
            trimEnd: 0.25,
            blur: 0
          },
          {
            offset: 1,
            opacity: 1,
            width: 36,
            height: 28,
            fillColor: { r: 0, g: 0, b: 1, a: 1 },
            strokeColor: { r: 0, g: 1, b: 0, a: 1 },
            strokeWidth: 5,
            trimStart: 0,
            trimEnd: 1,
            blur: 2
          }
        ],
        timing: { durationMs: 100, easing: 'linear', fill: 'both' }
      }
    ]
  }
  const commonGeometryPaint = {
    fills: [
      {
        type: 'SOLID' as const,
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ],
    strokes: [
      {
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        weight: 2,
        align: 'CENTER' as const
      }
    ]
  }
  const emptyVector = graph.createNode('VECTOR', pageId, {
    name: 'ParityEmptyVector',
    x: 320,
    y: 220,
    width: 20,
    height: 20,
    ...commonGeometryPaint,
    motion: structuredClone(geometryMotionSpec)
  })
  const resolvedBoolean = graph.createNode('BOOLEAN_OPERATION', pageId, {
    name: 'ParityResolvedBoolean',
    x: 360,
    y: 220,
    width: 20,
    height: 20,
    fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(2, 2, 16, 16) }],
    ...commonGeometryPaint,
    motion: structuredClone(geometryMotionSpec)
  })
  graph.createNode('RECTANGLE', resolvedBoolean.id, {
    name: 'ResolvedBooleanOperandMustNotRender',
    width: 4,
    height: 4,
    fills: commonGeometryPaint.fills
  })
  const unresolvedBoolean = graph.createNode('BOOLEAN_OPERATION', pageId, {
    name: 'ParityChildOnlyBoolean',
    x: 400,
    y: 220,
    width: 20,
    height: 20,
    ...commonGeometryPaint,
    motion: structuredClone(geometryMotionSpec)
  })
  graph.createNode('RECTANGLE', unresolvedBoolean.id, {
    name: 'ChildOnlyBooleanOperand',
    width: 16,
    height: 16,
    fills: commonGeometryPaint.fills
  })
  const opacitySpec: MotionSpec = {
    version: 2,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'opacity-one',
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 1 },
          { offset: 1, opacity: 1 }
        ],
        timing: { durationMs: 100, easing: 'linear', fill: 'both' }
      }
    ]
  }
  const opacityVector = graph.createNode('VECTOR', pageId, {
    name: 'ParityOpacityVector',
    x: 20,
    y: 260,
    width: 20,
    height: 20,
    opacity: 0.5,
    fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(0, 0, 20, 20) }],
    fills: commonGeometryPaint.fills,
    motion: structuredClone(opacitySpec)
  })
  const opacityBoolean = graph.createNode('BOOLEAN_OPERATION', pageId, {
    name: 'ParityOpacityBoolean',
    x: 60,
    y: 260,
    width: 20,
    height: 20,
    opacity: 0.5,
    fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(0, 0, 20, 20) }],
    fills: commonGeometryPaint.fills,
    motion: structuredClone(opacitySpec)
  })
  const staticOpacityVector = graph.createNode('VECTOR', pageId, {
    name: 'ParityStaticOpacityVector',
    x: 100,
    y: 260,
    width: 20,
    height: 20,
    opacity: 0.5,
    fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(0, 0, 20, 20) }],
    fills: commonGeometryPaint.fills
  })
  const rotationSpec: MotionSpec = {
    version: 2,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'rotation-delta',
        trigger: 'mount',
        keyframes: [
          { offset: 0, rotate: 10 },
          { offset: 1, rotate: 10 }
        ],
        timing: { durationMs: 100, easing: 'linear', fill: 'both' }
      }
    ]
  }
  const rotationVector = graph.createNode('VECTOR', pageId, {
    name: 'ParityAuthoredAndMotionRotation',
    x: 150,
    y: 260,
    width: 30,
    height: 20,
    rotation: 30,
    fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: triangleCommandsBlob(30, 20) }],
    fills: commonGeometryPaint.fills,
    motion: rotationSpec
  })
  const composedV3Spec: MotionSpec = {
    version: 3,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'high-first',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 100, opacity: 0.2, rotate: 10, scaleX: 1.2, scaleY: 1.2 },
          { offset: 1, x: 120, opacity: 0.6, rotate: 20, scaleX: 1.4, scaleY: 1.4 }
        ],
        timing: { durationMs: 100, easing: 'linear', fill: 'both' },
        composition: { mode: 'replace', weight: 0.25, priority: 10 }
      },
      {
        id: 'low',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 20, opacity: 0.5, rotate: 20, scaleX: 2, scaleY: 3 },
          { offset: 1, x: 40, opacity: 0.75, rotate: 40, scaleX: 3, scaleY: 4 }
        ],
        timing: { durationMs: 100, easing: 'linear', fill: 'both' },
        composition: { mode: 'add', weight: 0.5, priority: -5 }
      },
      {
        id: 'high-tie',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0, opacity: 1, rotate: 0, scaleX: 1, scaleY: 1 },
          { offset: 1, x: 10, opacity: 0.8, rotate: 20, scaleX: 1.5, scaleY: 1.5 }
        ],
        timing: {
          durationMs: 100,
          easing: 'linear',
          iterations: 3,
          fill: 'forwards'
        },
        composition: { mode: 'accumulate', priority: 10 }
      }
    ]
  }
  const composedOpacity = 0.6
  const composedRotation = 15
  const composedV3 = graph.createNode('RECTANGLE', pageId, {
    name: 'ParityComposedV3',
    x: 220,
    y: 260,
    width: 40,
    height: 30,
    opacity: composedOpacity,
    rotation: composedRotation,
    motion: composedV3Spec
  })
  const fractionalV3Spec: MotionSpec = {
    version: 3,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'fractional-accumulate',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0 },
          { offset: 1, x: 10 }
        ],
        timing: {
          durationMs: 100,
          easing: 'linear',
          iterations: 1.5,
          fill: 'forwards'
        },
        composition: { mode: 'accumulate' }
      }
    ]
  }
  const fractionalV3 = graph.createNode('RECTANGLE', pageId, {
    name: 'ParityFractionalV3',
    x: 280,
    y: 260,
    width: 30,
    height: 30,
    motion: fractionalV3Spec
  })
  const inactiveV3Spec: MotionSpec = {
    version: 3,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'inactive-replace',
        trigger: 'click',
        keyframes: [
          { offset: 0, x: 100, opacity: 0.2, rotate: 10 },
          { offset: 1, x: 120, opacity: 0.6, rotate: 20 }
        ],
        timing: { durationMs: 100, easing: 'linear', fill: 'none' },
        composition: { mode: 'replace', weight: 0.5 }
      }
    ]
  }
  const inactiveOpacity = 0.6
  const inactiveRotation = 15
  const inactiveV3 = graph.createNode('RECTANGLE', pageId, {
    name: 'ParityInactiveV3',
    x: 320,
    y: 260,
    width: 30,
    height: 30,
    opacity: inactiveOpacity,
    rotation: inactiveRotation,
    motion: inactiveV3Spec
  })
  return {
    files: compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-sampler-parity', devMode: false })
    }).files,
    complex: { nodeId: complexNode.id, spec: complexSpec },
    precedence: { nodeId: precedenceNode.id, spec: precedenceSpec },
    parent: { nodeId: parentNode.id, spec: parentSpec },
    child: { nodeId: childNode.id, spec: childSpec },
    controlled: {
      nodeId: controlledNode.id,
      spec: controlledSpec,
      trackId: controlledTrackId
    },
    reduced: { nodeId: reducedNode.id, spec: reducedSpec },
    pathCombined: { nodeId: pathCombinedNode.id, spec: pathCombinedSpec },
    cubicPath: { nodeId: cubicPathNode.id, spec: cubicPathSpec },
    responsiveVector: {
      nodeId: responsiveVector.id,
      parentId: responsiveParent.id,
      spec: responsiveVectorSpec
    },
    plateau: { nodeId: plateauNode.id, spec: plateauSpec },
    fullTrim: { nodeId: fullTrimNode.id, spec: fullTrimSpec },
    emptyVector: { nodeId: emptyVector.id, spec: geometryMotionSpec },
    resolvedBoolean: { nodeId: resolvedBoolean.id, spec: geometryMotionSpec },
    unresolvedBoolean: { nodeId: unresolvedBoolean.id },
    opacityVector: { nodeId: opacityVector.id, spec: opacitySpec },
    opacityBoolean: { nodeId: opacityBoolean.id, spec: opacitySpec },
    staticOpacityVector: { nodeId: staticOpacityVector.id },
    rotationVector: { nodeId: rotationVector.id, spec: rotationSpec },
    composedV3: {
      nodeId: composedV3.id,
      spec: composedV3Spec,
      opacity: composedOpacity,
      rotation: composedRotation
    },
    fractionalV3: { nodeId: fractionalV3.id, spec: fractionalV3Spec },
    inactiveV3: {
      nodeId: inactiveV3.id,
      spec: inactiveV3Spec,
      opacity: inactiveOpacity,
      rotation: inactiveRotation
    }
  }
}

async function svgPixelSnapshot(
  page: Page,
  nodeId: string
): Promise<{
  present: boolean
  geometryCount: number
  nonTransparentPixels: number
  hasMotion: boolean
}> {
  const locator = page.locator(`[data-node-id="${nodeId}"]`)
  if ((await locator.count()) === 0) {
    return { present: false, geometryCount: 0, nonTransparentPixels: 0, hasMotion: false }
  }
  return locator.evaluate(async (element) => {
    const svg = element.querySelector('svg')
    if (!svg) throw new Error('compiled inline SVG missing')
    const geometryCount = svg.querySelectorAll(
      'path,line,polyline,polygon,rect,circle,ellipse'
    ).length
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', '40')
    clone.setAttribute('height', '40')
    const source = new XMLSerializer().serializeToString(clone)
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
    try {
      const image = new Image()
      image.src = url
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('failed to rasterize compiled SVG'))
      })
      const canvas = document.createElement('canvas')
      canvas.width = 40
      canvas.height = 40
      const context = canvas.getContext('2d')
      if (!context) throw new Error('2D canvas unavailable')
      context.drawImage(image, 0, 0, 40, 40)
      const pixels = context.getImageData(0, 0, 40, 40).data
      let nonTransparentPixels = 0
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 0) nonTransparentPixels++
      }
      return {
        present: true,
        geometryCount,
        nonTransparentPixels,
        hasMotion: element.hasAttribute('data-op-motion')
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  })
}

interface ScreenshotPixelSnapshot {
  width: number
  height: number
  nonTransparentPixels: number
  maxAlpha: number
  pixelBounds: { width: number; height: number } | null
}

async function screenshotPixelSnapshot(
  page: Page,
  nodeId: string
): Promise<ScreenshotPixelSnapshot> {
  const locator = await compiledNodeLocator(page, nodeId)
  const png = await locator.screenshot({
    animations: 'allow',
    omitBackground: true
  })
  const source = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
  return page.evaluate(async (url) => {
    const image = new Image()
    image.src = url
    await new Promise<void>((resolve, reject) => {
      image.onload = () => {
        resolve()
      }
      image.onerror = () => {
        reject(new Error('failed to decode element screenshot'))
      }
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas unavailable')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    let nonTransparentPixels = 0
    let maxAlpha = 0
    let minX = image.width
    let minY = image.height
    let maxX = -1
    let maxY = -1
    for (let index = 3; index < pixels.length; index += 4) {
      const alpha = pixels[index]
      if (alpha === 0) continue
      const pixelIndex = (index - 3) / 4
      const x = pixelIndex % image.width
      const y = Math.floor(pixelIndex / image.width)
      nonTransparentPixels++
      maxAlpha = Math.max(maxAlpha, alpha)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    return {
      width: image.width,
      height: image.height,
      nonTransparentPixels,
      maxAlpha,
      pixelBounds: maxX === -1 ? null : { width: maxX - minX + 1, height: maxY - minY + 1 }
    }
  }, source)
}

describe('preview browser — Motion sampler parity', () => {
  const hookTimeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 480, height: 320 }, deviceScaleFactor: 1 })
  }, hookTimeoutMs)

  afterEach(async () => {
    try {
      if (page) await page.close()
    } finally {
      try {
        if (browser) await browser.close()
      } finally {
        if (server) await server.close()
        page = null
        browser = null
        server = null
      }
    }
  }, hookTimeoutMs)

  test('matches CSS checkpoints for timing, fill, precedence, and nested nodes', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })

    for (const elapsedMs of [25, 100, 300, 475]) {
      await setAnimationTime(currentPage, fixture.complex.nodeId, elapsedMs)
      expectVisualNear(
        await computedVisual(currentPage, fixture.complex.nodeId),
        sampleMotionSpec(fixture.complex.spec, elapsedMs).visual
      )
    }

    await setAnimationTime(currentPage, fixture.precedence.nodeId, 100)
    expectVisualNear(
      await computedVisual(currentPage, fixture.precedence.nodeId),
      sampleMotionSpec(fixture.precedence.spec, 100).visual
    )

    const nestedElapsedMs = 150
    const staticGeometry = await measureStaticNestedGeometry(
      currentPage,
      fixture.parent.nodeId,
      fixture.child.nodeId
    )
    await setAnimationTime(currentPage, fixture.parent.nodeId, nestedElapsedMs)
    await setAnimationTime(currentPage, fixture.child.nodeId, nestedElapsedMs)
    const parentSample = sampleMotionSpec(fixture.parent.spec, nestedElapsedMs).visual
    const childSample = sampleMotionSpec(fixture.child.spec, nestedElapsedMs).visual
    expectVisualNear(await computedVisual(currentPage, fixture.parent.nodeId), {
      ...parentSample,
      opacity: 0.8 * parentSample.opacity
    })
    expectVisualNear(await computedVisual(currentPage, fixture.child.nodeId), {
      ...childSample,
      opacity: 0.5 * childSample.opacity
    })
    expect(
      await computedEffectiveOpacity(currentPage, [fixture.parent.nodeId, fixture.child.nodeId])
    ).toBeCloseTo(0.8 * parentSample.opacity * 0.5 * childSample.opacity, 2)
    expectMatrixNear(
      await composedMotionMatrix(currentPage, [fixture.parent.nodeId, fixture.child.nodeId]),
      multiplyMatrices(motionMatrix(parentSample), motionMatrix(childSample))
    )
    expectRectNear(
      await computedRect(currentPage, fixture.child.nodeId),
      expectedNestedRect(staticGeometry.parent, staticGeometry.child, parentSample, childSample)
    )
  }, 30_000)

  test('matches v3 priority, weight, add, and completed-iteration accumulation', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })
    await currentPage.waitForFunction(() => '__OPENPENCIL_MOTION_RUNTIME__' in window)
    expectVisualNear(await computedVisual(currentPage, fixture.inactiveV3.nodeId), {
      ...sampleMotionSpec(fixture.inactiveV3.spec, 0).visual,
      opacity: fixture.inactiveV3.opacity,
      rotate: fixture.inactiveV3.rotation
    })
    await currentPage.evaluate(
      ({ composedId, fractionalId, inactiveId }) => {
        const runtime = (
          window as Window & {
            __OPENPENCIL_MOTION_RUNTIME__?: { play: (nodeId: string) => void }
          }
        ).__OPENPENCIL_MOTION_RUNTIME__
        runtime?.play(composedId)
        runtime?.play(fractionalId)
        runtime?.play(inactiveId)
      },
      {
        composedId: fixture.composedV3.nodeId,
        fractionalId: fixture.fractionalV3.nodeId,
        inactiveId: fixture.inactiveV3.nodeId
      }
    )

    for (const elapsedMs of [50, 250, 300]) {
      await setAnimationTime(currentPage, fixture.composedV3.nodeId, elapsedMs)
      const sampled = sampleMotionSpec(fixture.composedV3.spec, elapsedMs).visual
      expectVisualNear(await computedVisual(currentPage, fixture.composedV3.nodeId), {
        ...sampled,
        opacity: fixture.composedV3.opacity * sampled.opacity,
        rotate: fixture.composedV3.rotation + sampled.rotate
      })
    }

    for (const elapsedMs of [149, 150]) {
      await setAnimationTime(currentPage, fixture.fractionalV3.nodeId, elapsedMs)
      const expected = sampleMotionSpec(fixture.fractionalV3.spec, elapsedMs).visual
      if (elapsedMs === 150) expect(expected.x).toBe(15)
      expectVisualNear(await computedVisual(currentPage, fixture.fractionalV3.nodeId), expected)
    }

    await setAnimationTime(currentPage, fixture.inactiveV3.nodeId, 50)
    const inactiveSample = sampleMotionSpec(fixture.inactiveV3.spec, 50, {
      trigger: 'click'
    }).visual
    expectVisualNear(await computedVisual(currentPage, fixture.inactiveV3.nodeId), {
      ...inactiveSample,
      opacity: fixture.inactiveV3.opacity * inactiveSample.opacity,
      rotate: fixture.inactiveV3.rotation + inactiveSample.rotate
    })
  }, 30_000)

  test('matches a controlled WAAPI checkpoint for every visual channel', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })
    await currentPage.waitForFunction(() => '__OPENPENCIL_MOTION_RUNTIME__' in window)

    await currentPage.evaluate(
      ({ nodeId, trackId }) => {
        const runtime = (
          window as Window & {
            __OPENPENCIL_MOTION_RUNTIME__?: {
              play(targetNodeId: string, trackId?: string): void
            }
          }
        ).__OPENPENCIL_MOTION_RUNTIME__
        if (!runtime) throw new Error('missing Motion runtime')
        runtime.play(nodeId, trackId)
      },
      { nodeId: fixture.controlled.nodeId, trackId: fixture.controlled.trackId }
    )
    await setAnimationTime(currentPage, fixture.controlled.nodeId, 100)
    expectVisualNear(
      await computedVisual(currentPage, fixture.controlled.nodeId),
      sampleMotionSpec(fixture.controlled.spec, 100, { trigger: 'click' }).visual
    )
  }, 30_000)

  test('matches reduced-motion opacity-only timing and suppresses transforms', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    await currentPage.emulateMedia({ reducedMotion: 'reduce' })
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })

    await setAnimationTime(currentPage, fixture.reduced.nodeId, 60)
    expectVisualNear(
      await computedVisual(currentPage, fixture.reduced.nodeId),
      sampleMotionSpec(fixture.reduced.spec, 60, { prefersReducedMotion: true }).visual
    )
  }, 30_000)

  test('keeps v2 path, translate, rotate, and scale composed in the real DOM rect', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })

    const staticRect = await measureStaticRect(currentPage, fixture.pathCombined.nodeId)
    const elapsedMs = 100
    await setAnimationTime(currentPage, fixture.pathCombined.nodeId, elapsedMs)
    const expected = sampleMotionSpec(fixture.pathCombined.spec, elapsedMs).visual
    expectVisualNear(await computedVisual(currentPage, fixture.pathCombined.nodeId), expected)
    expectRectNear(
      await computedRect(currentPage, fixture.pathCombined.nodeId),
      expectedSingleRect(staticRect, expected)
    )
    expect(
      await currentPage
        .locator(`[data-node-id="${fixture.pathCombined.nodeId}"]`)
        .evaluate((element) => getComputedStyle(element).offsetPath)
    ).toBe('none')
  }, 30_000)

  test('matches v3 cubic path arc-length progress and auto-rotation in the real DOM', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })

    for (const elapsedMs of [50, 100, 150]) {
      await setAnimationTime(currentPage, fixture.cubicPath.nodeId, elapsedMs)
      expectVisualNear(
        await computedVisual(currentPage, fixture.cubicPath.nodeId),
        sampleMotionSpec(fixture.cubicPath.spec, elapsedMs).visual
      )
    }
    expect(
      await currentPage
        .locator(`[data-node-id="${fixture.cubicPath.nodeId}"]`)
        .evaluate((element) => getComputedStyle(element).offsetPath)
    ).toBe('none')
  }, 30_000)

  test('stretches inline vector geometry when animated parent layout changes its box', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })

    await setAnimationTime(currentPage, fixture.responsiveVector.parentId, 200)
    const geometry = await currentPage
      .locator(`[data-op-node-id="${fixture.responsiveVector.nodeId}"]`)
      .first()
      .evaluate((path) => {
        const svg = path.closest('svg')
        const wrapperElement = svg?.parentElement
        if (!svg || !wrapperElement) throw new Error('responsive vector SVG geometry missing')
        const wrapper = wrapperElement.getBoundingClientRect()
        const renderedPath = path.getBoundingClientRect()
        return {
          wrapperWidth: wrapper.width,
          pathWidth: renderedPath.width,
          preserveAspectRatio: svg.getAttribute('preserveAspectRatio')
        }
      })
    expect(geometry.preserveAspectRatio).toBe('none')
    expect(geometry.wrapperWidth).toBeCloseTo(80, 1)
    expect(geometry.pathWidth).toBeCloseTo(geometry.wrapperWidth, 1)
  }, 30_000)

  test('keeps a non-grid hold plateau corner discontinuous in real DOM geometry', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })
    const staticRect = await measureStaticRect(currentPage, fixture.plateau.nodeId)

    for (const elapsedMs of [656.99, 657.01]) {
      await setAnimationTime(currentPage, fixture.plateau.nodeId, elapsedMs)
      const expected = sampleMotionSpec(fixture.plateau.spec, elapsedMs).visual
      expectVisualNear(await computedVisual(currentPage, fixture.plateau.nodeId), expected)
      expectRectNear(
        await computedRect(currentPage, fixture.plateau.nodeId),
        expectedSingleRect(staticRect, expected)
      )
    }
  }, 30_000)

  test('lets a full trim interval override authored dashes in the real SVG DOM', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })
    await setAnimationTime(currentPage, fixture.fullTrim.nodeId, 50)

    const trim = await currentPage
      .locator(`[data-node-id="${fixture.fullTrim.nodeId}"]`)
      .evaluate((element) => {
        const line = element.querySelector('line')
        if (!line) throw new Error('full trim line geometry missing')
        const style = getComputedStyle(line)
        return {
          dasharray: style.strokeDasharray,
          stroke: style.stroke,
          strokeOpacity: style.strokeOpacity,
          visible: style.getPropertyValue('--op-motion-vector-trim-visible').trim(),
          hidden: style.getPropertyValue('--op-motion-vector-trim-hidden').trim()
        }
      })
    expect(trim.visible).toBe('1')
    expect(trim.hidden).toBe('0')
    expect(trim.stroke).toBe('rgba(0, 0, 255, 0.5)')
    expect(trim.strokeOpacity).toBe('1')
    expect(trim.dasharray.replace(/px/g, '')).toMatch(/^1(?:\.0+)?,\s*0(?:\.0+)?$/)
  }, 30_000)

  test('renders only resolved vector and boolean geometry in real Chromium pixels', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })
    await setAnimationTime(currentPage, fixture.emptyVector.nodeId, 50)
    await setAnimationTime(currentPage, fixture.resolvedBoolean.nodeId, 50)

    const emptyVector = await svgPixelSnapshot(currentPage, fixture.emptyVector.nodeId)
    expect(emptyVector.present).toBe(true)
    expect(emptyVector.hasMotion).toBe(true)
    expect(emptyVector.geometryCount).toBe(0)
    expect(emptyVector.nonTransparentPixels).toBe(0)

    const resolvedBoolean = await svgPixelSnapshot(currentPage, fixture.resolvedBoolean.nodeId)
    expect(resolvedBoolean.present).toBe(true)
    expect(resolvedBoolean.hasMotion).toBe(true)
    expect(resolvedBoolean.geometryCount).toBe(1)
    expect(resolvedBoolean.nonTransparentPixels).toBeGreaterThan(0)

    const unresolvedBoolean = await svgPixelSnapshot(currentPage, fixture.unresolvedBoolean.nodeId)
    expect(unresolvedBoolean.hasMotion).toBe(false)
    expect(unresolvedBoolean.geometryCount).toBe(0)
    expect(unresolvedBoolean.nonTransparentPixels).toBe(0)
  }, 30_000)

  test('applies folded root opacity exactly once for static and Motion geometry', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })
    await setAnimationTime(currentPage, fixture.opacityVector.nodeId, 50)
    await setAnimationTime(currentPage, fixture.opacityBoolean.nodeId, 50)

    for (const nodeId of [
      fixture.opacityVector.nodeId,
      fixture.opacityBoolean.nodeId,
      fixture.staticOpacityVector.nodeId
    ]) {
      const pixels = await screenshotPixelSnapshot(currentPage, nodeId)
      expect(pixels.nonTransparentPixels).toBeGreaterThan(0)
      expect(pixels.maxAlpha).toBeGreaterThanOrEqual(126)
      expect(pixels.maxAlpha).toBeLessThanOrEqual(129)
    }
  }, 30_000)

  test('composes authored and Motion rotation over an intrinsic local SVG viewBox', async () => {
    const currentPage = requirePage(page)
    const currentServer = requireServer(server)
    const fixture = buildParityFixture()
    currentServer.updateFiles(fixture.files)
    await currentPage.goto(currentServer.url, { waitUntil: 'networkidle' })
    await setAnimationTime(currentPage, fixture.rotationVector.nodeId, 50)

    const presentation = await currentPage
      .locator(`[data-node-id="${fixture.rotationVector.nodeId}"]`)
      .evaluate((element) => {
        const svg = element.querySelector('svg')
        const sourceGroup = svg?.querySelector('[data-op-node-group]')
        const rect = element.getBoundingClientRect()
        const html = element as HTMLElement
        const style = getComputedStyle(element)
        if (!svg || !sourceGroup) throw new Error('rotation vector SVG missing')
        return {
          viewBox: svg.getAttribute('viewBox'),
          sourceTransform: sourceGroup.getAttribute('transform'),
          sourceOpacity: sourceGroup.getAttribute('opacity'),
          offsetWidth: html.offsetWidth,
          offsetHeight: html.offsetHeight,
          transform: style.transform,
          rotate: style.rotate,
          width: rect.width,
          height: rect.height
        }
      })
    expect(presentation.viewBox).toBe('0 0 30 20')
    expect(presentation.sourceTransform).toBeNull()
    expect(presentation.sourceOpacity).toBeNull()
    expect(presentation.offsetWidth).toBe(30)
    expect(presentation.offsetHeight).toBe(20)
    expect(presentation.rotate).toBe('40deg')
    expect(presentation.width).toBeCloseTo(35.84, 1)
    expect(presentation.height).toBeCloseTo(34.6, 1)
    const pixels = await screenshotPixelSnapshot(currentPage, fixture.rotationVector.nodeId)
    expect(pixels.nonTransparentPixels).toBeGreaterThan(250)
    expect(pixels.pixelBounds?.width ?? 0).toBeGreaterThan(25)
    expect(pixels.pixelBounds?.height ?? 0).toBeGreaterThan(15)
  }, 30_000)
})

describe('preview browser — Motion inspection cleanup', () => {
  test('keeps 100/500 element snapshots bounded and releases removed containers', async () => {
    const server = await createPreviewServer({})
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 360, height: 240 } })
    try {
      for (const count of [100, 500]) {
        const fixture = buildInspectionFixture(count)
        server.updateFiles(fixture.files)
        await page.goto(server.url, { waitUntil: 'networkidle' })
        await page.waitForFunction(() => {
          const runtime = (
            window as Window & {
              __OPENPENCIL_MOTION_RUNTIME__?: { inspect?: () => unknown }
            }
          ).__OPENPENCIL_MOTION_RUNTIME__
          return typeof runtime?.inspect === 'function'
        })

        const before = await inspectRuntime(page)
        expect(before.entries.length).toBeGreaterThanOrEqual(count)
        expect(before.entries.length).toBeLessThanOrEqual(count * 2)
        expect(before.activeAnimationCount).toBe(count)
        expect(await page.evaluate(() => document.getAnimations().length)).toBeLessThanOrEqual(
          count
        )

        await page.evaluate((expectedCount) => {
          const elements = [...document.querySelectorAll('[data-op-motion]')]
          if (elements.length !== expectedCount) {
            throw new Error(`expected ${expectedCount} Motion elements, found ${elements.length}`)
          }
          const container = elements[0]?.parentElement
          if (container && elements.every((element) => container.contains(element))) {
            container.remove()
          } else {
            for (const element of elements) element.remove()
          }
        }, count)
        await page.waitForFunction(() => document.getAnimations().length === 0)
        await page.waitForFunction(() => {
          const runtime = (
            window as Window & {
              __OPENPENCIL_MOTION_RUNTIME__?: { inspect?: () => RuntimeInspection }
            }
          ).__OPENPENCIL_MOTION_RUNTIME__
          return (runtime?.inspect?.().entries?.length ?? -1) === 0
        })
        const after = await inspectRuntime(page)
        expect(after.entries).toEqual([])
        expect(after.activeAnimationCount).toBe(0)
      }
    } finally {
      await page.close()
      await browser.close()
      await server.close()
    }
  }, 60_000)
})

function buildInspectionFixture(count: number): {
  files: Map<string, string | Uint8Array>
  containerId: string
} {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const container = graph.createNode('FRAME', pageId, {
    name: `MotionInspection${count}`,
    width: 400,
    height: Math.ceil(count / 10) * 12
  })
  const sharedMotion = motion([
    track('automatic', {
      keyframes: [
        { offset: 0, opacity: 0.8 },
        { offset: 1, opacity: 1 }
      ],
      timing: { durationMs: 10_000, ...LINEAR, fill: 'both' }
    }),
    track('interactive', {
      trigger: 'hover',
      keyframes: [
        { offset: 0, x: 0 },
        { offset: 1, x: 4 }
      ],
      timing: { durationMs: 100, ...LINEAR }
    })
  ])
  for (let index = 0; index < count; index++) {
    graph.createNode('RECTANGLE', container.id, {
      name: `MotionItem${index}`,
      x: (index % 10) * 12,
      y: Math.floor(index / 10) * 12,
      width: 10,
      height: 10,
      motion: sharedMotion
    })
  }
  return {
    containerId: container.id,
    files: compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: `motion-inspection-${count}`, devMode: false })
    }).files
  }
}

async function inspectRuntime(page: Page): Promise<RuntimeInspection> {
  return page.evaluate(() => {
    const runtime = (
      window as Window & {
        __OPENPENCIL_MOTION_RUNTIME__?: { inspect?: () => RuntimeInspection }
      }
    ).__OPENPENCIL_MOTION_RUNTIME__
    const snapshot = runtime?.inspect?.()
    if (!snapshot) throw new Error('Motion inspection runtime is unavailable')
    return snapshot
  })
}

async function setAnimationTime(page: Page, nodeId: string, elapsedMs: number): Promise<void> {
  await page.locator(`[data-node-id="${nodeId}"]`).evaluate((element, time) => {
    const animations = element.getAnimations()
    if (animations.length === 0) throw new Error('missing Motion animation')
    for (const animation of animations) {
      animation.pause()
      animation.currentTime = time
    }
  }, elapsedMs)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
  )
}

async function computedVisual(page: Page, nodeId: string): Promise<MotionVisualState> {
  return page.locator(`[data-node-id="${nodeId}"]`).evaluate((element) => {
    const style = getComputedStyle(element)
    const numbers = (value: string): number[] =>
      [...value.matchAll(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)].map((match) =>
        Number.parseFloat(match[0])
      )
    const translate = numbers(style.translate)
    const scale = numbers(style.scale)
    const rotate = numbers(style.rotate)
    return {
      x: translate[0] ?? 0,
      y: translate[1] ?? 0,
      scaleX: scale[0] ?? 1,
      scaleY: scale[1] ?? scale[0] ?? 1,
      rotate: rotate[0] ?? 0,
      opacity: Number.parseFloat(style.opacity)
    }
  })
}

async function computedEffectiveOpacity(page: Page, nodeIds: string[]): Promise<number> {
  return page.evaluate((ids) => {
    return ids.reduce((opacity, id) => {
      const element = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
      if (!element) throw new Error(`missing nested Motion element: ${id}`)
      return opacity * Number.parseFloat(getComputedStyle(element).opacity)
    }, 1)
  }, nodeIds)
}

async function measureStaticNestedGeometry(
  page: Page,
  parentNodeId: string,
  childNodeId: string
): Promise<{ parent: RectSnapshot; child: RectSnapshot }> {
  return page.evaluate(
    async ({ parentId, childId }) => {
      const elements = [parentId, childId].map((id) => {
        const element = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
        if (!(element instanceof HTMLElement))
          throw new Error(`missing nested Motion element: ${id}`)
        return element
      })
      const authoredAnimation = elements.map((element) => ({
        value: element.style.getPropertyValue('animation'),
        priority: element.style.getPropertyPriority('animation')
      }))
      for (const element of elements) element.style.setProperty('animation', 'none', 'important')
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      const snapshot = (element: Element): RectSnapshot => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
      const geometry = { parent: snapshot(elements[0]), child: snapshot(elements[1]) }
      for (const [index, element] of elements.entries()) {
        const authored = authoredAnimation[index]
        if (authored.value)
          element.style.setProperty('animation', authored.value, authored.priority)
        else element.style.removeProperty('animation')
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      return geometry
    },
    { parentId: parentNodeId, childId: childNodeId }
  )
}

async function computedRect(page: Page, nodeId: string): Promise<RectSnapshot> {
  return page.locator(`[data-node-id="${nodeId}"]`).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
}

async function measureStaticRect(page: Page, nodeId: string): Promise<RectSnapshot> {
  return page.locator(`[data-node-id="${nodeId}"]`).evaluate(async (element) => {
    const html = element as HTMLElement
    const value = html.style.getPropertyValue('animation')
    const priority = html.style.getPropertyPriority('animation')
    html.style.setProperty('animation', 'none', 'important')
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    const rect = element.getBoundingClientRect()
    const snapshot = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    if (value) html.style.setProperty('animation', value, priority)
    else html.style.removeProperty('animation')
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    return snapshot
  })
}

async function compiledNodeLocator(page: Page, nodeId: string): Promise<Locator> {
  const instrumented = page.locator(`[data-node-id="${nodeId}"]`).first()
  if ((await instrumented.count()) > 0) return instrumented

  const sourceGroup = page.locator(`[data-op-node-group="${nodeId}"]`).first()
  if ((await sourceGroup.count()) === 0) throw new Error(`compiled node missing: ${nodeId}`)
  const wrapper = page.locator(`svg:has([data-op-node-group="${nodeId}"])`).first().locator('..')
  if ((await wrapper.count()) === 0) throw new Error(`compiled node wrapper missing: ${nodeId}`)
  return wrapper
}

async function composedMotionMatrix(page: Page, nodeIds: string[]): Promise<Matrix2D> {
  return page.evaluate((ids) => {
    let result = new DOMMatrix()
    for (const id of ids) {
      const element = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
      if (!element) throw new Error(`missing nested Motion element: ${id}`)
      const style = getComputedStyle(element)
      const values = (value: string): number[] =>
        [...value.matchAll(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)].map((match) =>
          Number.parseFloat(match[0])
        )
      const translate = values(style.translate)
      const scale = values(style.scale)
      const rotate = values(style.rotate)
      const local = new DOMMatrix()
        .translate(translate[0] ?? 0, translate[1] ?? 0)
        .rotate(rotate[0] ?? 0)
        .scale(scale[0] ?? 1, scale[1] ?? scale[0] ?? 1)
      result = result.multiply(local)
    }
    return [result.a, result.b, result.c, result.d, result.e, result.f]
  }, nodeIds)
}

function expectVisualNear(actual: MotionVisualState, expected: MotionVisualState): void {
  expect(actual.opacity).toBeCloseTo(expected.opacity, 2)
  expect(actual.x).toBeCloseTo(expected.x, 0)
  expect(actual.y).toBeCloseTo(expected.y, 0)
  expect(actual.scaleX).toBeCloseTo(expected.scaleX, 2)
  expect(actual.scaleY).toBeCloseTo(expected.scaleY, 2)
  expect(actual.rotate).toBeCloseTo(expected.rotate, 0)
}

function motionMatrix(visual: MotionVisualState): Matrix2D {
  const radians = (visual.rotate * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return [
    cosine * visual.scaleX,
    sine * visual.scaleX,
    -sine * visual.scaleY,
    cosine * visual.scaleY,
    visual.x,
    visual.y
  ]
}

function multiplyMatrices(left: Matrix2D, right: Matrix2D): Matrix2D {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ]
}

function expectedNestedRect(
  parent: RectSnapshot,
  child: RectSnapshot,
  parentVisual: MotionVisualState,
  childVisual: MotionVisualState
): RectSnapshot {
  const parentOrigin = { x: parent.x + parent.width / 2, y: parent.y + parent.height / 2 }
  const childOrigin = { x: child.x + child.width / 2, y: child.y + child.height / 2 }
  const corners = [
    { x: child.x, y: child.y },
    { x: child.x + child.width, y: child.y },
    { x: child.x + child.width, y: child.y + child.height },
    { x: child.x, y: child.y + child.height }
  ].map((point) =>
    transformPoint(transformPoint(point, childOrigin, childVisual), parentOrigin, parentVisual)
  )
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function expectedSingleRect(rect: RectSnapshot, visual: MotionVisualState): RectSnapshot {
  const origin = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height }
  ].map((point) => transformPoint(point, origin, visual))
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function transformPoint(point: Vector, origin: Vector, visual: MotionVisualState): Vector {
  const radians = (visual.rotate * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const scaledX = (point.x - origin.x) * visual.scaleX
  const scaledY = (point.y - origin.y) * visual.scaleY
  return {
    x: origin.x + scaledX * cosine - scaledY * sine + visual.x,
    y: origin.y + scaledX * sine + scaledY * cosine + visual.y
  }
}

function expectMatrixNear(actual: Matrix2D, expected: Matrix2D): void {
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index], index < 4 ? 2 : 0)
  }
}

function expectRectNear(actual: RectSnapshot, expected: RectSnapshot): void {
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual[field] - expected[field])).toBeLessThan(1.5)
  }
}

function requirePage(page: Page | null): Page {
  if (!page) throw new Error('missing preview page')
  return page
}

function requireServer(server: PreviewServer | null): PreviewServer {
  if (!server) throw new Error('missing preview server')
  return server
}
