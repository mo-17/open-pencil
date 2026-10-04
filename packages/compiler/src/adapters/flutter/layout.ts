import type { IRLayout, IRNode, IRPageViewport } from '#compiler/ir/types'

import { walkNativeNodes } from '../native-shared'
import type { FlutterStyle, FlutterWarningSink } from './types'
import { emitFlutterWrap } from './wrap'

const RESPONSIVE_WIDTHS = [0, 640, 768, 1024, 1280] as const
const DESIGN_FRAMES = new Set(['FRAME', 'COMPONENT', 'INSTANCE'])

function mapNode(node: IRNode, project: (node: IRNode) => IRNode): IRNode {
  if (node.kind === 'conditional') {
    return { ...node, consequent: mapNode(node.consequent, project) }
  }
  if (node.kind === 'list') return { ...node, template: mapNode(node.template, project) }
  if (node.kind === 'element') {
    return project({ ...node, children: node.children.map((child) => mapNode(child, project)) })
  }
  return project(node)
}

/** Resolve media ranges before Widget projection, including parent positioning changes. */
export function resolveFlutterLayout(nodes: readonly IRNode[], width: number): IRNode[] {
  return nodes.map((node) =>
    mapNode(node, (current) => {
      if (current.kind !== 'element' && current.kind !== 'componentRef') return current
      const variant = current.responsiveLayout?.find(
        (range) =>
          width >= range.minWidth && (range.maxWidth === undefined || width < range.maxWidth)
      )
      return variant
        ? { ...current, layout: variant.layout, className: variant.className }
        : current
    })
  )
}

/** Keep state outside the bounded layout branches. No generic native CSS interpreter. */
export function emitResponsiveFlutterBody(
  nodes: readonly IRNode[],
  emit: (nodes: readonly IRNode[]) => string,
  widthName = 'opViewportWidth'
): string {
  const variantSources = new Set<string>()
  walkNativeNodes(nodes, (node) => {
    if ((node.kind === 'element' || node.kind === 'componentRef') && node.responsiveLayout?.length)
      variantSources.add(node.sourceId)
  })
  if (variantSources.size === 0) return emit(nodes)
  let body = emit(resolveFlutterLayout(nodes, RESPONSIVE_WIDTHS.at(-1) ?? 1280))
  for (let index = RESPONSIVE_WIDTHS.length - 2; index >= 0; index--) {
    const width = RESPONSIVE_WIDTHS[index]
    const next = RESPONSIVE_WIDTHS[index + 1]
    const branch = emit(resolveFlutterLayout(nodes, width))
    if (branch !== body) body = `(${widthName} < ${next}.0 ? ${branch} : ${body})`
  }
  return body
}

export function prepareFlutterPageFrames(nodes: readonly IRNode[]): IRNode[] {
  return nodes.map((node) => {
    if (node.kind === 'conditional')
      return {
        ...node,
        consequent: prepareFlutterPageFrames([node.consequent])[0] ?? node.consequent
      }
    if (node.kind !== 'element' && node.kind !== 'componentRef') return node
    const layout = node.layout
    if (layout?.parentType !== 'CANVAS' || !DESIGN_FRAMES.has(layout.sourceType)) return node
    return {
      ...node,
      layout: {
        ...layout,
        position: 'flow',
        widthSizing: 'FILL',
        ...(layout.layoutMode !== 'NONE' ? { heightSizing: 'HUG' as const } : {})
      }
    }
  })
}

/** Normalize only page-level absolute coordinates; child geometry and state are untouched. */
export function fitWidthFlutterNodes(nodes: readonly IRNode[], viewport: IRPageViewport): IRNode[] {
  return nodes.map((node) => {
    if (node.kind === 'conditional')
      return {
        ...node,
        consequent: fitWidthFlutterNodes([node.consequent], viewport)[0] ?? node.consequent
      }
    if (node.kind !== 'element' && node.kind !== 'componentRef') return node
    if (node.layout?.position !== 'absolute') return node
    const classes = node.className.split(/\s+/).filter((token) => !/^-?(?:left|top)-/.test(token))
    classes.push(
      `left-[${node.layout.x - viewport.originX}px]`,
      `top-[${node.layout.y - viewport.originY}px]`
    )
    return { ...node, className: classes.join(' ') }
  })
}

export function projectFlutterLayout(
  style: FlutterStyle,
  layout: IRLayout | undefined
): FlutterStyle {
  if (!layout) return style
  const result: FlutterStyle = {
    ...style,
    layout,
    width: layout.widthSizing === 'FIXED' ? layout.width : undefined,
    height: layout.heightSizing === 'FIXED' ? layout.height : undefined,
    position: layout.position === 'absolute' ? 'absolute' : undefined,
    left: layout.position === 'absolute' ? layout.x : undefined,
    top: layout.position === 'absolute' ? layout.y : undefined,
    right: undefined,
    bottom: undefined,
    minWidth: layout.minWidth ?? undefined,
    maxWidth: layout.maxWidth ?? undefined,
    minHeight: layout.minHeight ?? undefined,
    maxHeight: layout.maxHeight ?? undefined,
    padding: {
      top: layout.paddingTop,
      right: layout.paddingRight,
      bottom: layout.paddingBottom,
      left: layout.paddingLeft
    },
    flexDirection: layout.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
    mainAxisAlignment: axisAlignment(layout.primaryAxisAlign),
    crossAxisAlignment: counterAlignment(layout.counterAxisAlign),
    gap: Math.max(0, layout.itemSpacing)
  }
  if (layout.sourceType === 'TEXT' && Number.isFinite(layout.fontSize) && layout.fontSize > 0)
    result.fontSize = layout.fontSize
  if (
    layout.sourceType === 'TEXT' &&
    layout.lineHeight !== null &&
    Number.isFinite(layout.lineHeight) &&
    layout.lineHeight > 0
  )
    result.lineHeight = layout.lineHeight
  return result
}

function axisAlignment(
  value: IRLayout['primaryAxisAlign']
): 'start' | 'end' | 'center' | 'spaceBetween' {
  const alignments = {
    MIN: 'start',
    MAX: 'end',
    CENTER: 'center',
    SPACE_BETWEEN: 'spaceBetween'
  } as const
  return alignments[value]
}

function counterAlignment(
  value: IRLayout['counterAxisAlign']
): 'start' | 'end' | 'center' | 'stretch' {
  const alignments = {
    MIN: 'start',
    MAX: 'end',
    CENTER: 'center',
    STRETCH: 'stretch',
    BASELINE: 'start'
  } as const
  return alignments[value]
}

export function wrapAdaptiveFlutterStyle(child: string, layout: IRLayout | undefined): string {
  if (!layout) return child
  let value = layout.clipsContent ? `ClipRect(child: ${child})` : child
  if (layout.widthSizing === 'FILL' || layout.heightSizing === 'FILL')
    value = `OpenPencilFill(width: ${layout.widthSizing === 'FILL'}, height: ${layout.heightSizing === 'FILL'}, child: ${value})`
  return value
}

export function flutterNodeLayout(node: IRNode): IRLayout | undefined {
  if (node.kind === 'conditional') return flutterNodeLayout(node.consequent)
  return node.kind === 'element' || node.kind === 'componentRef' ? node.layout : undefined
}

export function emitAdaptiveFlutterChildren(
  nodes: readonly IRNode[],
  style: FlutterStyle,
  emit: (node: IRNode) => string,
  warn: FlutterWarningSink,
  sourceId: string
): string {
  const shown = nodes.filter((node) => flutterNodeLayout(node)?.visible !== false)
  if (!shown.length) return 'const SizedBox.shrink()'
  warnAdaptiveCrossAxis(style, warn, sourceId)
  const positioned = shown.some((node) => flutterNodeLayout(node)?.position === 'absolute')
  const children = shown.map(emit)
  if (positioned) {
    const absoluteNodes = shown.filter((node) => flutterNodeLayout(node)?.position === 'absolute')
    const flowNodes = shown.filter((node) => flutterNodeLayout(node)?.position !== 'absolute')
    const height = Math.max(
      1,
      ...absoluteNodes.map((node) => {
        const layout = flutterNodeLayout(node)
        return layout ? layout.y + layout.height : 1
      })
    )
    const width = Math.max(
      1,
      ...shown.map((node) => {
        const layout = flutterNodeLayout(node)
        return layout ? layout.x + layout.width : 1
      })
    )
    const positionedChildren = absoluteNodes.map(emit)
    if (!flowNodes.length)
      return `OpenPencilStack(naturalWidth: ${width}, minimumHeight: ${height}, children: [${positionedChildren.join(', ')}])`
    const flow = emitAdaptiveFlutterChildren(flowNodes, style, emit, warn, sourceId)
    return `OpenPencilStack(naturalWidth: ${width}, minimumHeight: ${height}, flow: ${flow}, children: [${positionedChildren.join(', ')}])`
  }
  if (style.layout?.layoutMode === 'GRID')
    return emitFlutterGrid(shown, children, style.layout, warn, sourceId)
  for (const node of shown) {
    const layout = flutterNodeLayout(node)
    if (layout && layout.layoutAlignSelf !== 'AUTO')
      warn({
        code: 'flutter-align-self-unsupported',
        message:
          'Flutter responsive flow uses the parent cross-axis alignment; per-child alignment remains unsupported.',
        nodeId: node.kind === 'element' || node.kind === 'componentRef' ? node.sourceId : sourceId
      })
  }
  if (style.layout?.layoutWrap === 'WRAP') {
    if (style.flexDirection !== 'row' && style.height === undefined) {
      warn({
        code: 'flutter-vertical-wrap-unbounded',
        message: 'Flutter cannot wrap a content-sized vertical axis; emitted a scrolling column.',
        nodeId: sourceId
      })
    } else {
      return emitFlutterWrap(children, style, warn, sourceId)
    }
  }
  const horizontal = style.flexDirection === 'row'
  const items = shown.map((node, index) => {
    const layout = flutterNodeLayout(node)
    const fill = horizontal ? layout?.widthSizing === 'FILL' : layout?.heightSizing === 'FILL'
    const grow = layout?.layoutGrow ?? 0
    const flex = fill || grow > 0 ? Math.max(1, Math.round(Math.min(1000, grow || 1) * 1000)) : 0
    return `OpenPencilFlexItem(flex: ${flex}, child: ${children[index]})`
  })
  return `OpenPencilFlex(axis: Axis.${horizontal ? 'horizontal' : 'vertical'}, gap: ${style.gap ?? 0}, mainAxisAlignment: MainAxisAlignment.${style.mainAxisAlignment ?? 'start'}, crossAxisAlignment: CrossAxisAlignment.${style.crossAxisAlignment ?? (horizontal ? 'start' : 'stretch')}, children: [${items.join(', ')}])`
}

function emitFlutterGrid(
  shown: readonly IRNode[],
  children: readonly string[],
  layout: IRLayout,
  warn: FlutterWarningSink,
  sourceId: string
): string {
  const columns = layout.gridTemplateColumns
  const unsupported =
    columns.some((track) => track.sizing === 'AUTO') ||
    layout.gridTemplateRows.length > 0 ||
    shown.some(
      (node) =>
        flutterNodeLayout(node)?.gridPosition !== null &&
        flutterNodeLayout(node)?.gridPosition !== undefined
    )
  if (unsupported)
    warn({
      code: 'flutter-grid-placement-unsupported',
      message:
        'Flutter responsive grid uses source-order columns; AUTO columns, authored row tracks and explicit grid placement remain unsupported.',
      nodeId: sourceId
    })
  const tracks = columns.length ? columns : [{ sizing: 'FR', value: 1 }]
  return `OpenPencilGrid(columnTracks: [${tracks.map((track) => (track.sizing === 'FIXED' ? track.value : -Math.max(0.001, track.value))).join(', ')}], gap: ${Math.max(0, layout.gridColumnGap)}, runGap: ${Math.max(0, layout.gridRowGap)}, children: [${children.join(', ')}])`
}

function warnAdaptiveCrossAxis(
  style: FlutterStyle,
  warn: FlutterWarningSink,
  sourceId: string
): void {
  if (style.crossAxisAlignment === 'stretch') {
    const crossSizing =
      style.flexDirection === 'row' ? style.layout?.heightSizing : style.layout?.widthSizing
    if (crossSizing === 'HUG')
      warn({
        code: 'flutter-stretch-content-axis',
        message:
          'Flutter stretches only a bounded cross axis; an unbounded content-sized axis keeps natural child sizes.',
        nodeId: sourceId
      })
  }
}
