import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

/** Saved native Figma records and their encoded blob table. */
export interface NestedBindingCapture {
  nodeChanges: NodeChange[]
  blobs: string[]
}

export interface NestedLayoutCapture {
  ids: Record<'page' | 'inner' | 'outer' | 'nested' | 'instance', string>
  before: NodeChange[]
  edited: NodeChange[]
  blobs: string[]
}

/** The component edit observations consumed by binding authoring acceptance. */
export interface NestedBindingAuthoringOracle {
  componentEdit: {
    sourcePaddingTop: number
    paddingTop: number
    height: number
  }
}
