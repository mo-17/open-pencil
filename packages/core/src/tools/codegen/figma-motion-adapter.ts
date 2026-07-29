import { buildFigmaMotionPluginScript, createFigmaNativeMotionPlan } from '@open-pencil/fig'

import { defineTool, nodeNotFound } from '#core/tools/schema'

const CANONICAL_STORAGE_NOTE =
  'MotionSpec v1/v2 remains canonical OpenPencil pluginData and can round-trip even when native Figma Motion cannot represent it; native conversion currently accepts only the verified v1 subset.'
const NATIVE_SUBSET_NOTE =
  'Native conversion is limited to one mount track using opacity, translation, rotation, and scale.'
const RAW_FIG_BOUNDARY_NOTE =
  'Raw .fig native timeline authoring is disabled; apply the returned plan through the Figma Plugin API or use_figma script.'
const OWNED_REPLACE_NOTE =
  'The generated script replaces only tracks carrying verified OpenPencil shared ownership, rejects foreign/native-edited Motion, rolls back failures, and verifies Figma readback.'
const ALL_REPLACE_NOTE =
  'The generated script has explicit destructive consent to remove foreign animation styles and supported manual property tracks. Indexed or unknown future tracks still fail closed; failures roll back and Figma readback is verified.'

export const getFigmaMotionAdapter = defineTool({
  name: 'get_figma_motion_adapter',
  description:
    'Report whether one node MotionSpec fits the verified Figma Motion Beta subset. Returns structured Plugin API operations and a selection-based script without writing native timeline data into raw .fig files.',
  params: {
    id: {
      type: 'string',
      description: 'OpenPencil node id to inspect',
      required: true
    },
    conflictPolicy: {
      type: 'string',
      enum: ['replace-owned', 'replace-all'],
      description:
        'Native conflict policy. replace-owned is safe/default; replace-all explicitly deletes foreign animation styles and supported manual tracks.',
      required: false
    },
    allowTimelineGrowth: {
      type: 'boolean',
      description:
        'Allow extending a pre-existing top-level Figma timeline. False by default because timelines are shared.',
      required: false
    }
  },
  execute: (figma, { id, conflictPolicy, allowTimelineGrowth }) => {
    const node = figma.graph.getNode(id)
    if (!node) return nodeNotFound(id)

    const nativeConflictPolicy = conflictPolicy === 'replace-all' ? 'replace-all' : 'replace-owned'
    const plan = createFigmaNativeMotionPlan(node.motion, { nodeOpacity: node.opacity })
    return {
      node: { id: node.id, name: node.name, type: node.type },
      compatibility: {
        canonical: {
          format: 'MotionSpec v1/v2 pluginData',
          motionPresent: node.motion !== undefined,
          roundTrip: true,
          note: CANONICAL_STORAGE_NOTE
        },
        native: {
          api: 'Figma Plugin API Motion Beta (2026-06-23)',
          supported: plan.supported,
          subset: NATIVE_SUBSET_NOTE,
          rawFigAuthoring: false,
          note: RAW_FIG_BOUNDARY_NOTE,
          writeSafety:
            nativeConflictPolicy === 'replace-all' ? ALL_REPLACE_NOTE : OWNED_REPLACE_NOTE,
          conflictPolicy: nativeConflictPolicy,
          allowTimelineGrowth: allowTimelineGrowth ?? false,
          ownership: 'sharedPluginData openpencil/nativeMotionAdapterV1'
        }
      },
      durationSeconds: plan.durationSeconds ?? null,
      operations: plan.operations,
      issues: plan.issues,
      warnings: plan.warnings,
      script: plan.supported
        ? buildFigmaMotionPluginScript(plan, {
            conflictPolicy: nativeConflictPolicy,
            allowTimelineGrowth
          })
        : null
    }
  }
})
