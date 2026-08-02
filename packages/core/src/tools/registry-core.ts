import { evalCode } from './analyze'
import { calc } from './calc'
import { render } from './create'
import { describe } from './describe'
import {
  applyMotionPreset,
  applyMotionRecipe,
  applyMotionSpec,
  applyTeamMotionLibraryEntry,
  clearGeneratedEffect,
  clearMotion,
  clearMotionDrivers,
  clearMotionScene,
  clearMotionTransitionKey,
  clearPrototype,
  manageTeamMotionLibraryRegistry,
  reviewTeamMotionLibraryUpdate,
  setMotionTransitionKey,
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
  updateLowcodeNodes,
  updateGeneratedEffect,
  updateMotion,
  updateMotionDrivers,
  updateMotionScene,
  updatePrototype,
  updatePageRoute,
  updateNode,
  verifyTeamMotionLibrary
} from './modify'
import {
  findNodes,
  auditNavigation,
  getJsx,
  getNode,
  getSelection,
  listMotionPresets,
  readDocStates,
  readLowcodeNode,
  readLowcodeNodes,
  readGeneratedEffect,
  readMotion,
  readMotions,
  readMotionDrivers,
  readMotionScene,
  readMotionTransitionKey,
  readPageRoute,
  readPrototype,
  readSupabaseConfig,
  readTranslations,
  readWorkflows
} from './read'
import type { ToolDef } from './schema'
import { stockPhoto } from './stock-photo'
import { batchUpdate, deleteNode, nodeResize, reparentNode, reparentNodes } from './structure'
import { exportMotionAnimation, viewportZoomToFit } from './vector'

/**
 * Curated 50+ tools registered by default in AI chat with a smaller schema than ALL_TOOLS.
 * Covers common design sessions: render, describe, modify, structure, lowcode, and Motion.
 */
export const CORE_TOOLS: ToolDef[] = [
  // Read
  getSelection,
  getNode,
  findNodes,
  getJsx,
  readPageRoute,
  auditNavigation,
  // Read — lowcode (Phase 3 §3)
  readLowcodeNode,
  readLowcodeNodes,
  readDocStates,
  readSupabaseConfig,
  readTranslations,
  readWorkflows,
  readGeneratedEffect,
  readMotion,
  readMotions,
  readMotionDrivers,
  readMotionScene,
  readPrototype,
  readMotionTransitionKey,
  listMotionPresets,
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
  updateLowcodeNodes,
  updatePageRoute,
  setDocStates,
  setSupabaseConfig,
  setTranslations,
  setWorkflows,
  applyMotionPreset,
  applyMotionRecipe,
  verifyTeamMotionLibrary,
  reviewTeamMotionLibraryUpdate,
  manageTeamMotionLibraryRegistry,
  applyTeamMotionLibraryEntry,
  applyMotionSpec,
  updateMotion,
  clearMotion,
  updateMotionScene,
  clearMotionScene,
  updateMotionDrivers,
  clearMotionDrivers,
  updatePrototype,
  clearPrototype,
  setMotionTransitionKey,
  clearMotionTransitionKey,
  updateGeneratedEffect,
  clearGeneratedEffect,
  // Structure
  deleteNode,
  reparentNode,
  reparentNodes,
  nodeResize,
  batchUpdate,
  // Stock photos
  stockPhoto,
  // Inspect & utility
  describe,
  calc,
  evalCode,
  exportMotionAnimation,
  viewportZoomToFit
]
