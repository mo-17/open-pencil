import type { IRLayout } from '#compiler/ir/layout'
import type { IRNode, IRStyleAttr, IRTree } from '#compiler/ir/types'

function cssToken(id: string): string {
  return Array.from(id, (character) => character.codePointAt(0)?.toString(16) ?? '').join('-')
}

function frameHeight(layout: IRLayout): string {
  return layout.layoutMode !== 'NONE' ? 'auto' : `${layout.height}px`
}

function isPageFrame(node: IRNode): node is Extract<IRNode, { kind: 'element' | 'componentRef' }> {
  return (
    (node.kind === 'element' || node.kind === 'componentRef') &&
    node.layout?.parentType === 'CANVAS' &&
    ['FRAME', 'COMPONENT', 'INSTANCE'].includes(node.layout.sourceType)
  )
}

export function pageViewportStyleOptions(ir: IRTree): { styleKey: string; frameCSS: string } {
  const styleKey = 'page-' + cssToken(ir.pageId)
  if (ir.pageViewport?.mode !== 'responsive') return { styleKey, frameCSS: '' }
  const rules: string[] = []
  const visit = (node: IRNode): void => {
    if (node.kind === 'conditional') return visit(node.consequent)
    if (node.kind === 'list') return visit(node.template)
    if (!isPageFrame(node) || !node.layout) return
    const selector = `[data-op-page-viewport-style-key="${styleKey}"]`
    const property = '--op-page-frame-height-' + cssToken(node.sourceId)
    const bands = node.responsiveLayout?.length
      ? node.responsiveLayout
      : [{ minWidth: 0, layout: node.layout }]
    for (const band of bands) {
      const rule = `${selector}{${property}:${frameHeight(band.layout)}}`
      rules.push(band.minWidth === 0 ? rule : `@media(min-width:${band.minWidth}px){${rule}}`)
    }
  }
  ir.children.forEach(visit)
  return { styleKey, frameCSS: rules.join('\n') }
}

/** Page-owned presentation only: authored classes, behaviors and component bodies stay intact. */
export function pageViewportNodes(ir: IRTree): IRNode[] {
  if (ir.pageViewport?.mode !== 'responsive') return ir.children
  return ir.children.map(projectPageFrame)
}

function projectPageFrame(node: IRNode): IRNode {
  if (node.kind === 'conditional') return { ...node, consequent: projectPageFrame(node.consequent) }
  if (node.kind === 'list') return { ...node, template: projectPageFrame(node.template) }
  if (node.kind !== 'element' && node.kind !== 'componentRef') return node
  const layout = node.layout
  if (!isPageFrame(node) || !layout) return node
  const previous = node.kind === 'componentRef' ? node.styleAttr : node.attrs.style
  const style: IRStyleAttr = {
    kind: 'styleAttr',
    declarations: {
      ...(typeof previous === 'object' && previous.kind === 'styleAttr'
        ? previous.declarations
        : {}),
      position: 'relative',
      left: '0px',
      top: '0px',
      width: '100%',
      minWidth: '0px',
      maxWidth: 'none',
      height: `var(--op-page-frame-height-${cssToken(node.sourceId)},${frameHeight(node.responsiveLayout?.[0]?.layout ?? layout)})`
    }
  }
  return node.kind === 'componentRef'
    ? { ...node, styleAttr: style }
    : { ...node, attrs: { ...node.attrs, style } }
}

export function hasPageViewport(irs: readonly IRTree[]): boolean {
  return irs.some((ir) => ir.pageViewport && ir.pageViewport.mode !== 'fixed')
}
