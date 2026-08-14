import { findCodePenSecretKinds } from '@open-pencil/core/lowcode-validation'
import {
  createStaticHTMLShowcaseFragment,
  sceneGraphToDesignDocument
} from '@open-pencil/dom-css/static-export'
import { inspectImageBytes, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { CodePenShowcaseError } from './error'
import { finalizeCodePenShowcase } from './prefill'
import type {
  CodePenShowcaseDiagnostic,
  CodePenShowcaseOptions,
  CodePenShowcaseResult
} from './types'

const MAX_STATIC_SHOWCASE_NODES = 50_000
const MAX_STATIC_IMAGE_REFERENCES = 4_096
const MAX_STATIC_IMAGE_DATA_BYTES = 900_000
const MAX_STATIC_IMAGE_SIDE = 32_768
const MAX_STATIC_IMAGE_PIXELS = 50_000_000
const binaryDecoder = new TextDecoder('latin1')
const STATIC_CONTROL_TYPES = new Set<SceneNode['type']>([
  'BUTTON',
  'CHECKBOX',
  'DATEPICKER',
  'FORM',
  'INPUT',
  'LIST',
  'RADIO',
  'SELECT',
  'SWITCH',
  'TEXTAREA'
])
const COMPLEX_VISUAL_TYPES = new Set<SceneNode['type']>([
  'BOOLEAN_OPERATION',
  'CONNECTOR',
  'ELLIPSE',
  'LINE',
  'POLYGON',
  'SHAPE_WITH_TEXT',
  'STAR',
  'VECTOR'
])

export interface CodePenStaticShowcaseSource {
  graph: SceneGraph
  pageId: string
}

export type CodePenStaticShowcaseOptions = CodePenShowcaseOptions

function hasEntries(value: Record<string, unknown> | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0
}

function hasRuntimeBehavior(node: SceneNode): boolean {
  return (
    (node.state?.length ?? 0) > 0 ||
    hasEntries(node.bindings) ||
    hasEntries(node.events) ||
    hasEntries(node.interactiveProps) ||
    Boolean(node.renderCondition) ||
    node.responsiveOverrides !== undefined ||
    node.stateOverrides !== undefined
  )
}

function hasMotionBehavior(node: SceneNode): boolean {
  return (
    node.motion !== undefined ||
    node.motionScene !== undefined ||
    node.motionDrivers !== undefined ||
    node.prototype !== undefined
  )
}

function hasUnsupportedVisual(node: SceneNode): boolean {
  return (
    COMPLEX_VISUAL_TYPES.has(node.type) ||
    node.generatedEffect !== undefined ||
    node.fills.some((fill) => ['CUSTOM', 'NOISE', 'PATTERN', 'VIDEO'].includes(fill.type))
  )
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    (bytes[offset + 1] ?? 0) * 0x10000 +
    (bytes[offset + 2] ?? 0) * 0x100 +
    (bytes[offset + 3] ?? 0)
  )
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function exactPNGContainer(bytes: Uint8Array): boolean {
  let offset = 8
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32BE(bytes, offset)
    if (length > bytes.byteLength - offset - 12) return false
    const type = ascii(bytes, offset + 4, 4)
    offset += 12 + length
    if (type === 'IEND') return length === 0 && offset === bytes.byteLength
  }
  return false
}

function staticImageError(code: string, message: string): CodePenShowcaseDiagnostic {
  return { code, severity: 'error', message }
}

function assertStaticPNG(bytes: Uint8Array): void {
  const inspection = inspectImageBytes(bytes)
  const dimensions = inspection.dimensions
  if (
    inspection.mimeType !== 'image/png' ||
    inspection.headerValidation !== 'valid' ||
    inspection.dimensionStatus !== 'parsed' ||
    !dimensions ||
    !exactPNGContainer(bytes) ||
    dimensions.width > MAX_STATIC_IMAGE_SIDE ||
    dimensions.height > MAX_STATIC_IMAGE_SIDE ||
    dimensions.width * dimensions.height > MAX_STATIC_IMAGE_PIXELS
  ) {
    throw new CodePenShowcaseError([
      staticImageError(
        'codepen-static-image-rejected',
        'CodePen static export blocked an invalid or unsupported image asset.'
      )
    ])
  }
}

function auditStaticImages(graph: SceneGraph, pageId: string): void {
  const page = graph.getNode(pageId)
  if (!page) return
  const pending = [page]
  const visited = new Set<string>()
  const validated = new Set<string>()
  let references = 0
  let encodedBytes = 0
  for (const node of pending) {
    if (visited.has(node.id)) continue
    visited.add(node.id)
    if (node !== page && (!node.visible || node.internalOnly)) continue
    for (const fill of node.fills) {
      if (fill.type !== 'IMAGE' || !fill.imageHash) continue
      references++
      if (references > MAX_STATIC_IMAGE_REFERENCES) {
        throw new CodePenShowcaseError([
          staticImageError(
            'codepen-static-image-limit',
            'CodePen static export blocked images that exceed the Prefill safety limit.'
          )
        ])
      }
      const bytes = graph.images.get(fill.imageHash)
      if (!bytes) {
        throw new CodePenShowcaseError([
          staticImageError(
            'codepen-static-image-rejected',
            'CodePen static export blocked a missing image asset.'
          )
        ])
      }
      encodedBytes += 'data:image/png;base64,'.length + 4 * Math.ceil(bytes.byteLength / 3)
      if (encodedBytes > MAX_STATIC_IMAGE_DATA_BYTES) {
        throw new CodePenShowcaseError([
          staticImageError(
            'codepen-static-image-limit',
            'CodePen static export blocked images that exceed the Prefill safety limit.'
          )
        ])
      }
      if (validated.has(fill.imageHash)) continue
      if (findCodePenSecretKinds(binaryDecoder.decode(bytes)).length > 0) {
        throw new CodePenShowcaseError([
          staticImageError(
            'codepen-secret-detected',
            'CodePen static export blocked a secret detected in an image asset.'
          )
        ])
      }
      assertStaticPNG(bytes)
      validated.add(fill.imageHash)
    }
    for (const childId of node.childIds) {
      const child = graph.getNode(childId)
      if (child) pending.push(child)
    }
  }
}

function rootRuntimeConfigured(root: SceneNode | undefined): boolean {
  if (!root) return false
  return (
    (root.lowcodeDocumentState?.length ?? 0) > 0 ||
    root.lowcodeSupabaseConfig !== undefined ||
    root.lowcodeAnalyticsConfig !== undefined ||
    root.lowcodeHeadMetadata !== undefined ||
    Boolean(root.lowcodeCustomCss) ||
    root.lowcodeTranslations !== undefined ||
    (root.lowcodeWorkflows?.length ?? 0) > 0 ||
    (root.lowcodeServerWorkflows?.length ?? 0) > 0
  )
}

function addOnce(
  diagnostics: CodePenShowcaseDiagnostic[],
  diagnostic: CodePenShowcaseDiagnostic
): void {
  if (!diagnostics.some((item) => item.code === diagnostic.code)) diagnostics.push(diagnostic)
}

function compatibilityDiagnostics(graph: SceneGraph, pageId: string): CodePenShowcaseDiagnostic[] {
  const diagnostics: CodePenShowcaseDiagnostic[] = [
    {
      code: 'codepen-static-visual-only',
      severity: 'warning',
      message:
        'This browser-safe showcase emits static HTML/CSS only. No framework, source compiler, or JavaScript runtime is published.'
    }
  ]
  const page = graph.getNode(pageId)
  if (page?.type !== 'CANVAS') {
    diagnostics.push({
      code: 'codepen-static-page-invalid',
      severity: 'error',
      message: 'CodePen static export requires one existing page ID.'
    })
    return diagnostics
  }

  if (rootRuntimeConfigured(graph.getNode(graph.rootId))) {
    addOnce(diagnostics, {
      code: 'codepen-static-document-runtime-omitted',
      severity: 'warning',
      path: `scene:${graph.rootId}`,
      message:
        'Document state, integrations, workflows, translations, analytics, head metadata, and custom CSS are omitted by the static showcase.'
    })
  }
  if (page.lowcodeRoutePattern || page.lowcodeRequiresAuth) {
    addOnce(diagnostics, {
      code: 'codepen-static-routing-omitted',
      severity: 'warning',
      path: `scene:${page.id}`,
      message: 'Dynamic routes and authentication guards are omitted by the static showcase.'
    })
  }

  const pending = [page]
  const visited = new Set<string>()
  for (const node of pending) {
    if (visited.has(node.id)) continue
    visited.add(node.id)
    if (visited.size > MAX_STATIC_SHOWCASE_NODES) {
      diagnostics.push({
        code: 'codepen-static-node-limit',
        severity: 'error',
        message: `CodePen static export supports at most ${MAX_STATIC_SHOWCASE_NODES} nodes.`
      })
      break
    }
    if (hasRuntimeBehavior(node)) {
      addOnce(diagnostics, {
        code: 'codepen-static-runtime-omitted',
        severity: 'warning',
        path: `scene:${node.id}`,
        message:
          'Low-code state, bindings, conditions, responsive variants, interaction styles, and event actions are shown only in their authored static state.'
      })
    }
    if (STATIC_CONTROL_TYPES.has(node.type)) {
      addOnce(diagnostics, {
        code: 'codepen-static-controls-inert',
        severity: 'warning',
        path: `scene:${node.id}`,
        message: 'Form and list controls retain their static appearance but are not interactive.'
      })
    }
    if (hasMotionBehavior(node)) {
      addOnce(diagnostics, {
        code: 'codepen-static-motion-omitted',
        severity: 'warning',
        path: `scene:${node.id}`,
        message: 'Motion, continuous drivers, and prototype transitions are omitted.'
      })
    }
    if (hasUnsupportedVisual(node)) {
      addOnce(diagnostics, {
        code: 'codepen-static-visual-degraded',
        severity: 'warning',
        path: `scene:${node.id}`,
        message:
          'Complex vector geometry, generated effects, and non-raster media may be represented by a CSS bounding-box fallback.'
      })
    }
    if (
      node.pluginData.some(
        (entry) =>
          entry.pluginId === 'open-pencil-dom-css' &&
          entry.key === 'image-source-url' &&
          /^https:\/\//i.test(entry.value)
      )
    ) {
      addOnce(diagnostics, {
        code: 'codepen-static-network-image',
        severity: 'warning',
        path: `scene:${node.id}`,
        message:
          'This static showcase references a remote HTTPS image; CodePen does not host or guarantee that external asset.'
      })
    }
    for (const childId of node.childIds) pending.push(graph.getNode(childId))
  }
  return diagnostics
}

/**
 * Create a framework-independent CodePen Prefill payload without evaluating or
 * compiling generated React/Vue source. The result is a static visual fallback
 * intended for browser and packaged-desktop environments where Vite is absent.
 */
export function createCodePenStaticShowcase(
  source: CodePenStaticShowcaseSource,
  options: CodePenStaticShowcaseOptions = {}
): CodePenShowcaseResult {
  const diagnostics = compatibilityDiagnostics(source.graph, source.pageId)
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new CodePenShowcaseError(diagnostics)
  }
  auditStaticImages(source.graph, source.pageId)

  try {
    const document = sceneGraphToDesignDocument(source.graph, {
      rootId: source.pageId,
      includeSourceIds: false
    })
    const fragment = createStaticHTMLShowcaseFragment(document)
    return finalizeCodePenShowcase(fragment.html, fragment.css, '', options, diagnostics)
  } catch (error) {
    if (error instanceof CodePenShowcaseError) throw error
    diagnostics.push({
      code: 'codepen-static-export-rejected',
      severity: 'error',
      message: 'CodePen static export blocked an unsupported element, style value, or image source.'
    })
    throw new CodePenShowcaseError(diagnostics)
  }
}

export { CodePenShowcaseError } from './error'
export type {
  CodePenPrefillData,
  CodePenPrefillRequest,
  CodePenShowcaseDiagnostic,
  CodePenShowcaseResult
} from './types'
export { CODEPEN_PREFILL_ENDPOINT, CODEPEN_SHOWCASE_LIMITS } from './types'
