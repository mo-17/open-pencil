import type { IRMotion, IRMotionRenderTarget } from '#compiler/ir/motion'

import { colorToCSS } from '@open-pencil/core/color'
import { TRANSPARENT } from '@open-pencil/core/constants'

export const VECTOR_MOTION_FILL = '--op-motion-vector-fill'
export const VECTOR_MOTION_STROKE = '--op-motion-vector-stroke'
export const VECTOR_MOTION_STROKE_WIDTH = '--op-motion-vector-stroke-width'
export const VECTOR_MOTION_TRIM_VISIBLE = '--op-motion-vector-trim-visible'
export const VECTOR_MOTION_TRIM_HIDDEN = '--op-motion-vector-trim-hidden'
export const VECTOR_MOTION_TRIM_OFFSET = '--op-motion-vector-trim-offset'

const GEOMETRY_TAG = /<(?:path|line|polyline|polygon|rect|circle|ellipse)\b[^>]*>/gi

export function motionTargetKind(motion: IRMotion): 'box' | 'text' | 'vector' {
  return motion.target?.kind ?? 'box'
}

export function motionHasChannel(motion: IRMotion, key: string): boolean {
  return motion.tracks.some((track) =>
    track.keyframes.some((frame) => Reflect.get(frame, key) !== undefined)
  )
}

export function vectorMotionPropertyRegistrations(motions: readonly IRMotion[]): string[] {
  if (!motions.some((motion) => motionTargetKind(motion) === 'vector')) return []
  return [
    propertyRegistration(VECTOR_MOTION_FILL, '<color>', 'transparent'),
    propertyRegistration(VECTOR_MOTION_STROKE, '<color>', 'transparent'),
    propertyRegistration(VECTOR_MOTION_STROKE_WIDTH, '<number>', '0'),
    propertyRegistration(VECTOR_MOTION_TRIM_VISIBLE, '<number>', '1'),
    propertyRegistration(VECTOR_MOTION_TRIM_HIDDEN, '<number>', '0'),
    propertyRegistration(VECTOR_MOTION_TRIM_OFFSET, '<number>', '0')
  ]
}

export function vectorMotionBaseDeclarations(motion: IRMotion): string[] {
  const target = motion.target
  if (target?.kind === 'text') return textMotionBaseDeclarations(motion)
  if (target?.kind !== 'vector') return []
  const filters = vectorMotionFilters(motion, target)
  const declarations: string[] = []
  if (target.fillColor) declarations.push(`${VECTOR_MOTION_FILL}: ${colorToCSS(target.fillColor)};`)
  if (target.strokeColor) {
    declarations.push(`${VECTOR_MOTION_STROKE}: ${colorToCSS(target.strokeColor)};`)
  }
  if (target.strokeWidth !== undefined) {
    declarations.push(`${VECTOR_MOTION_STROKE_WIDTH}: ${target.strokeWidth};`)
  }
  if (motionHasChannel(motion, 'trimStart') || motionHasChannel(motion, 'trimEnd')) {
    declarations.push(
      `${VECTOR_MOTION_TRIM_VISIBLE}: 1;`,
      `${VECTOR_MOTION_TRIM_HIDDEN}: 0;`,
      `${VECTOR_MOTION_TRIM_OFFSET}: 0;`
    )
  }
  if (filters.length > 0) declarations.push(`filter: ${filters.join(' ')};`)
  return declarations
}

function vectorMotionFilters(motion: IRMotion, target: IRMotionRenderTarget): string[] {
  const filters: string[] = []
  const hasFilterMotion = motionHasChannel(motion, 'blur') || hasShadowChannel(motion)
  if (hasFilterMotion && target.blur !== undefined) filters.push(`blur(${target.blur}px)`)
  if (hasFilterMotion && target.hasShadow) {
    filters.push(
      `drop-shadow(${target.shadowX ?? 0}px ${target.shadowY ?? 0}px ${textShadowBlur(target.shadowBlur ?? 0, target.shadowSpread ?? 0)}px ${colorToCSS(target.shadowColor ?? TRANSPARENT)})`
    )
  }
  return filters
}

function textMotionBaseDeclarations(motion: IRMotion): string[] {
  const target = motion.target
  if (target?.kind !== 'text') return []
  const hasStroke =
    motionHasChannel(motion, 'strokeColor') || motionHasChannel(motion, 'strokeWidth')
  const hasShadow = hasShadowChannel(motion)
  return [
    ...(hasStroke && target.strokeColor
      ? [
          'border-color: transparent;',
          'border-width: 0;',
          `-webkit-text-stroke-color: ${colorToCSS(target.strokeColor)};`,
          `-webkit-text-stroke-width: ${target.strokeWidth ?? 0}px;`
        ]
      : []),
    ...(hasShadow
      ? [
          'box-shadow: none;',
          `text-shadow: ${target.shadowX ?? 0}px ${target.shadowY ?? 0}px ${textShadowBlur(target.shadowBlur ?? 0, target.shadowSpread ?? 0)}px ${colorToCSS(target.shadowColor ?? TRANSPARENT)};`
        ]
      : [])
  ]
}

function textShadowBlur(blur: number, spread: number): number {
  // CSS text-shadow/drop-shadow have no spread term. Adding spread to blur is
  // a bounded silhouette approximation; box targets retain exact box-shadow.
  return Math.max(0, blur + spread)
}

/** Bind every geometry path belonging to the animated source node. */
export function instrumentVectorMotionHTML(
  html: string,
  motion: IRMotion,
  sourceId: string
): string {
  const target = motion.target
  if (target?.kind !== 'vector') return html
  const hasLiveStrokeGeometry = sourceHasLiveStrokeGeometry(html, sourceId)
  const useLiveStrokeGeometry = hasLiveStrokeGeometry && target.vectorStrokeTarget !== 'outline'
  let result = instrumentVectorFill(html, motion, target, sourceId)
  result = instrumentVectorStroke(result, motion, target, sourceId, useLiveStrokeGeometry)
  result = instrumentVectorStrokeWidth(result, motion, target, sourceId, useLiveStrokeGeometry)
  result = hideUnusedVectorStrokeOutline(result, motion, target, sourceId, useLiveStrokeGeometry)
  result = instrumentVectorTrim(result, motion, sourceId)
  result = instrumentVectorMorph(result, motion, sourceId)
  if (motionHasChannel(motion, 'width') || motionHasChannel(motion, 'height')) {
    result = setRootSVGAttribute(result, 'preserveAspectRatio', 'none')
  }
  return result
}

/** Mark every repeated paint copy of a topology path with its stable path index. */
function instrumentVectorMorph(html: string, motion: IRMotion, sourceId: string): string {
  const pathCount = motion.target?.vectorMorph?.pathCount ?? 0
  if (!motionHasChannel(motion, 'vectorMorph') || pathCount === 0) return html
  const marker = `data-op-node-id="${escapeAttribute(sourceId)}"`
  let pathIndex = 0
  return html.replace(/<path\b[^>]*>/gi, (tag) => {
    if (!tag.includes(marker) || tag.includes('data-op-paint="stroke-outline"')) return tag
    const result = setGeometryAttributes(tag, {
      'data-op-morph-path-index': String(pathIndex % pathCount)
    })
    pathIndex++
    return result
  })
}

function sourceHasLiveStrokeGeometry(html: string, sourceId: string): boolean {
  return sourceGeometryTags(html, sourceId).some(
    (tag) =>
      !tag.includes('data-op-paint="stroke-outline"') &&
      /\bstroke="(?!none(?:"|\s))[^"\n]+"/i.test(tag)
  )
}

function instrumentVectorFill(
  html: string,
  motion: IRMotion,
  target: IRMotionRenderTarget,
  sourceId: string
): string {
  if (target.fillColor && motionHasChannel(motion, 'fillColor')) {
    return replaceGeometryAttribute(
      html,
      sourceId,
      'fill',
      VECTOR_MOTION_FILL,
      (tag) =>
        tag.includes(`data-op-fill-index="${target.fillIndex ?? 0}"`) &&
        !tag.includes('data-op-paint="stroke-outline"')
    )
  }
  return html
}

function instrumentVectorStroke(
  html: string,
  motion: IRMotion,
  target: IRMotionRenderTarget,
  sourceId: string,
  useLiveStrokeGeometry: boolean
): string {
  let result = html
  if (target.strokeColor && motionHasChannel(motion, 'strokeColor')) {
    if (useLiveStrokeGeometry) {
      result = replaceGeometryAttribute(result, sourceId, 'stroke', VECTOR_MOTION_STROKE)
      result = replaceGeometry(result, sourceId, (tag) =>
        tag.includes(`stroke="var(${VECTOR_MOTION_STROKE},`)
          ? removeGeometryAttribute(tag, 'stroke-opacity')
          : tag
      )
    } else {
      result = replaceGeometryAttribute(result, sourceId, 'fill', VECTOR_MOTION_STROKE, (tag) =>
        tag.includes('data-op-paint="stroke-outline"')
      )
      result = replaceGeometry(result, sourceId, (tag) => {
        if (tag.includes('data-op-paint="stroke-outline"')) {
          return removeGeometryAttribute(tag, 'fill-opacity')
        }
        return /\bstroke="(?!none(?:"|\s))[^"\n]+"/i.test(tag)
          ? setGeometryAttributes(tag, { stroke: 'none' })
          : tag
      })
    }
  }
  return result
}

function instrumentVectorStrokeWidth(
  html: string,
  motion: IRMotion,
  target: IRMotionRenderTarget,
  sourceId: string,
  useLiveStrokeGeometry: boolean
): string {
  if (
    useLiveStrokeGeometry &&
    target.strokeWidth !== undefined &&
    motionHasChannel(motion, 'strokeWidth')
  ) {
    return replaceGeometryAttribute(html, sourceId, 'stroke-width', VECTOR_MOTION_STROKE_WIDTH)
  }
  return html
}

function hideUnusedVectorStrokeOutline(
  html: string,
  motion: IRMotion,
  target: IRMotionRenderTarget,
  sourceId: string,
  useLiveStrokeGeometry: boolean
): string {
  if (
    useLiveStrokeGeometry &&
    target.strokeColor &&
    (motionHasChannel(motion, 'strokeColor') ||
      motionHasChannel(motion, 'strokeWidth') ||
      motionHasChannel(motion, 'trimStart') ||
      motionHasChannel(motion, 'trimEnd'))
  ) {
    return replaceGeometry(html, sourceId, (tag) =>
      tag.includes('data-op-paint="stroke-outline"')
        ? setGeometryAttributes(tag, { display: 'none' })
        : tag
    )
  }
  return html
}

function instrumentVectorTrim(html: string, motion: IRMotion, sourceId: string): string {
  if (motionHasChannel(motion, 'trimStart') || motionHasChannel(motion, 'trimEnd')) {
    return replaceGeometry(html, sourceId, (tag) =>
      /\bstroke="(?!none(?:"|\s))[^"\n]+"/i.test(tag)
        ? setGeometryAttributes(tag, {
            pathLength: '1',
            'stroke-dasharray': `var(${VECTOR_MOTION_TRIM_VISIBLE}) var(${VECTOR_MOTION_TRIM_HIDDEN})`,
            'stroke-dashoffset': `var(${VECTOR_MOTION_TRIM_OFFSET})`
          })
        : tag
    )
  }
  return html
}

function sourceGeometryTags(html: string, sourceId: string): string[] {
  const marker = `data-op-node-id="${escapeAttribute(sourceId)}"`
  return [...html.matchAll(GEOMETRY_TAG)]
    .map((match) => match[0])
    .filter((tag) => tag.includes(marker))
}

function propertyRegistration(name: string, syntax: string, initialValue: string): string {
  return `@property ${name} {\n  syntax: "${syntax}";\n  inherits: true;\n  initial-value: ${initialValue};\n}`
}

function replaceGeometryAttribute(
  html: string,
  sourceId: string,
  name: string,
  variable: string,
  eligible: (tag: string) => boolean = () => true
): string {
  return replaceGeometry(html, sourceId, (tag) => {
    if (!eligible(tag)) return tag
    const pattern = new RegExp(`\\b${name}="(?!none(?:"|\\s))([^"]+)"`, 'i')
    if (!pattern.test(tag)) return tag
    return tag.replace(pattern, `${name}="var(${variable}, $1)"`)
  })
}

function replaceGeometry(html: string, sourceId: string, replace: (tag: string) => string): string {
  const marker = `data-op-node-id="${escapeAttribute(sourceId)}"`
  return html.replace(GEOMETRY_TAG, (tag) => (tag.includes(marker) ? replace(tag) : tag))
}

function hasShadowChannel(motion: IRMotion): boolean {
  return ['shadowX', 'shadowY', 'shadowBlur', 'shadowSpread', 'shadowColor'].some((key) =>
    motionHasChannel(motion, key)
  )
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function setRootSVGAttribute(html: string, name: string, value: string): string {
  return html.replace(/<svg\b[^>]*>/i, (tag) => setGeometryAttributes(tag, { [name]: value }))
}

function setGeometryAttributes(tag: string, attrs: Record<string, string>): string {
  let result = tag
  for (const [name, value] of Object.entries(attrs)) {
    const pattern = new RegExp(`\\b${name}="[^"]*"`, 'i')
    if (pattern.test(result)) result = result.replace(pattern, `${name}="${value}"`)
    else result = result.replace(/\s*\/?>(?=$)/, ` ${name}="${value}"$&`)
  }
  return result
}

function removeGeometryAttribute(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s+${name}="[^"]*"`, 'i'), '')
}
