import { normalizedFilename } from '#lint/support/context.ts'
import type { RuleDefinition } from '#lint/support/types.ts'
import { sourceLineCount } from '#lint/support/vue.ts'

const PROPERTY_SECTION_LINE_ALLOWLIST = new Set([
  '/src/components/properties/layout/size/SizeControls.vue',
  // Legacy Supabase integration surface. Its schema/review/staging/source-migration views are
  // already split into focused components and composables; this file only coordinates their
  // shared credential, authority, and stale-review lifecycle.
  '/src/components/properties/Lowcode/SupabaseSchemaInspector.vue'
])

const noLargePropertySectionComponents = {
  meta: {
    docs: {
      description: 'Disallow oversized property-section Vue components'
    }
  },
  create(context) {
    const file = normalizedFilename(context)
    if (!file.endsWith('.vue') || !file.includes('/src/components/properties/')) return {}
    if ([...PROPERTY_SECTION_LINE_ALLOWLIST].some((suffix) => file.endsWith(suffix))) return {}

    return {
      Program(node) {
        const lineCount = sourceLineCount(context.sourceCode.getText())
        if (lineCount <= 250) return
        context.report({
          node,
          message:
            'Split property-section components over 250 lines into focused controls or document an explicit allowlist.'
        })
      }
    }
  }
} satisfies RuleDefinition

export { noLargePropertySectionComponents }
