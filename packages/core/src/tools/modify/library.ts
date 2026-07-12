import { publishLibraryComponent } from '@open-pencil/scene-graph'

import { defineTool } from '#core/tools/schema'

type PublishComponentData = Exclude<ReturnType<typeof publishLibraryComponent>, { error: string }>
type PublishComponentResult =
  | { ok: true; data: PublishComponentData }
  | { ok: false; error: string }

export const publishComponent = defineTool({
  name: 'publish_component',
  mutates: true,
  description:
    'Mark a COMPONENT or COMPONENT_SET as a lowcode team-library component (Phase 4 §14). Assigns or preserves a global component key, computes a deterministic subtree version, stores cached-library metadata on the component, and returns a manifest entry that can be written by CLI/library tooling. This only publishes a component inside the current library document; importing into another document is handled by import_library_component in a later step.',
  params: {
    component_id: {
      type: 'string',
      description: 'COMPONENT or COMPONENT_SET node id to publish.',
      required: true
    },
    library_id: {
      type: 'string',
      description: 'Stable library id, e.g. "design-system".',
      required: true
    },
    library_name: {
      type: 'string',
      description: 'Human-readable library name. Defaults to library_id.'
    },
    component_key: {
      type: 'string',
      description:
        'Optional global component key. When omitted, existing libraryComponentKey/componentKey is preserved, otherwise a new 40-char hex key is generated.'
    },
    source_kind: {
      type: 'string',
      enum: ['file', 'url'],
      description: 'Optional source kind for the returned manifest.'
    },
    source_ref: {
      type: 'string',
      description: 'Optional source file path or URL for the returned manifest.'
    },
    readonly: {
      type: 'boolean',
      description:
        'Whether the published cached master should be marked readonly. Defaults to true.'
    }
  },
  execute: (figma, args): PublishComponentResult => {
    if (
      args.source_kind !== undefined &&
      args.source_kind !== 'file' &&
      args.source_kind !== 'url'
    ) {
      return { ok: false, error: 'source_kind must be "file" or "url"' }
    }
    if (args.source_kind !== undefined && args.source_ref === undefined) {
      return { ok: false, error: 'source_ref is required when source_kind is provided' }
    }
    if (args.source_ref !== undefined && args.source_kind === undefined) {
      return { ok: false, error: 'source_kind is required when source_ref is provided' }
    }
    const result = publishLibraryComponent(figma.graph, {
      componentId: args.component_id,
      libraryId: args.library_id,
      libraryName: args.library_name,
      componentKey: args.component_key,
      source:
        args.source_kind && args.source_ref
          ? { kind: args.source_kind, ref: args.source_ref }
          : undefined,
      readonly: args.readonly
    })
    if ('error' in result) return { ok: false, error: result.error }
    return { ok: true, data: result }
  }
})
