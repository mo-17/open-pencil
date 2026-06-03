import { evalCode } from './analyze'
import { calc } from './calc'
import { render } from './create'
import { describe } from './describe'
import {
  setDocStates,
  setFill,
  setLayout,
  setLayoutChild,
  setRadius,
  setStroke,
  setSupabaseConfig,
  setText,
  setTextProperties,
  setTranslations,
  setWorkflows,
  updateLowcodeNode,
  updateNode
} from './modify'
import {
  findNodes,
  getJsx,
  getNode,
  getSelection,
  readDocStates,
  readLowcodeNode,
  readSupabaseConfig,
  readTranslations,
  readWorkflows
} from './read'
import type { ToolDef } from './schema'
import { stockPhoto } from './stock-photo'
import { batchUpdate, deleteNode, nodeResize, reparentNode } from './structure'
import { viewportZoomToFit } from './vector'

/**
 * Core tools registered by default in AI chat (~30 tools, ~3K schema tokens).
 * Covers 90%+ of design sessions: render, describe, modify, structure, icons.
 */
export const CORE_TOOLS: ToolDef[] = [
  // Read
  getSelection,
  getNode,
  findNodes,
  getJsx,
  // Read — lowcode (Phase 3 §3)
  readLowcodeNode,
  readDocStates,
  readSupabaseConfig,
  readTranslations,
  readWorkflows,
  // Create
  render,
  // Modify
  updateNode,
  setLayout,
  setLayoutChild,
  setRadius,
  setFill,
  setStroke,
  setText,
  setTextProperties,
  // Modify — lowcode (Phase 3 §3)
  updateLowcodeNode,
  setDocStates,
  setSupabaseConfig,
  setTranslations,
  setWorkflows,
  // Structure
  deleteNode,
  reparentNode,
  nodeResize,
  batchUpdate,
  // Stock photos
  stockPhoto,
  // Inspect & utility
  describe,
  calc,
  evalCode,
  viewportZoomToFit
]
