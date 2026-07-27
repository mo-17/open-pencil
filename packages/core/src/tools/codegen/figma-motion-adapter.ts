import { buildFigmaMotionPluginScript, createFigmaNativeMotionPlan } from '@open-pencil/fig'

import { defineTool, nodeNotFound } from '#core/tools/schema'

const CANONICAL_STORAGE_NOTE =
  'MotionSpec v1 remains canonical OpenPencil pluginData and can round-trip even when native Figma Motion cannot represent it.'
const NATIVE_SUBSET_NOTE =
  'Native conversion is limited to one mount track using opacity, translation, rotation, and scale.'
const RAW_FIG_BOUNDARY_NOTE =
  'Raw .fig native timeline authoring is disabled; apply the returned plan through the Figma Plugin API or use_figma script.'

export const getFigmaMotionAdapter = defineTool({
  name: 'get_figma_motion_adapter',
  description:
    'Report whether one node MotionSpec fits the verified Figma Motion Beta subset. Returns structured Plugin API operations and a selection-based script without writing native timeline data into raw .fig files.',
  params: {
    id: {
      type: 'string',
      description: 'OpenPencil node id to inspect',
      required: true
    }
  },
  execute: (figma, { id }) => {
    const node = figma.graph.getNode(id)
    if (!node) return nodeNotFound(id)

    const plan = createFigmaNativeMotionPlan(node.motion, { nodeOpacity: node.opacity })
    return {
      node: { id: node.id, name: node.name, type: node.type },
      compatibility: {
        canonical: {
          format: 'MotionSpec v1 pluginData',
          motionPresent: node.motion !== undefined,
          roundTrip: true,
          note: CANONICAL_STORAGE_NOTE
        },
        native: {
          api: 'Figma Plugin API Motion Beta (2026-06-23)',
          supported: plan.supported,
          subset: NATIVE_SUBSET_NOTE,
          rawFigAuthoring: false,
          note: RAW_FIG_BOUNDARY_NOTE
        }
      },
      durationSeconds: plan.durationSeconds ?? null,
      operations: plan.operations,
      issues: plan.issues,
      warnings: plan.warnings,
      script: plan.supported ? buildFigmaMotionPluginScript(plan) : null
    }
  }
})
