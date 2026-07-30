export interface RenderOptions {
  x?: number
  y?: number
  parentId?: string
  signal?: AbortSignal
  /** Defer layout to a host that already performs one page-scoped post-tool pass. */
  layout?: boolean
}
