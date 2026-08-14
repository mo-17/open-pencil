import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createDefaultDesignPanelStudioLayout,
  DEFAULT_DESIGN_PANEL_SECTION_ORDER,
  DEFAULT_DESIGN_PANEL_WORKSPACE,
  DESIGN_PANEL_STUDIO_LAYOUT_STORAGE_KEY,
  DESIGN_PANEL_WORKSPACE_STORAGE_KEY,
  DESIGN_PANEL_WORKSPACES,
  designPanelStudioLayout,
  designPanelWorkspace,
  getDesignPanelSectionOrder,
  isDesignPanelSectionHidden,
  moveDesignPanelStudioSection,
  normalizeDesignPanelStudioLayout,
  repairStoredDesignPanelStudioLayout,
  repairStoredDesignPanelWorkspace,
  resetDesignPanelStudioLayout,
  toggleDesignPanelStudioSection,
  type DesignPanelStudioLayout
} from '@/app/settings/design-panel-workspace'

describe('design panel workspace settings', () => {
  beforeEach(() => {
    designPanelWorkspace.value = 'classic'
    resetDesignPanelStudioLayout()
  })

  test('uses versioned feature-specific storage keys', () => {
    expect(DESIGN_PANEL_WORKSPACE_STORAGE_KEY).toBe('open-pencil:design-panel-workspace:v1')
    expect(DESIGN_PANEL_STUDIO_LAYOUT_STORAGE_KEY).toBe('open-pencil:design-panel-studio-layout:v1')
  })

  test.each(DESIGN_PANEL_WORKSPACES)('accepts and preserves the %s workspace', (value) => {
    const writes: string[] = []

    expect(repairStoredDesignPanelWorkspace(value, (workspace) => writes.push(workspace))).toBe(
      value
    )
    expect(writes).toEqual([])
  })

  test.each([undefined, null, '', 'photoshop', 3, { workspace: 'studio' }])(
    'repairs invalid workspace %# to classic',
    (value) => {
      const writes: string[] = []

      expect(repairStoredDesignPanelWorkspace(value, (workspace) => writes.push(workspace))).toBe(
        DEFAULT_DESIGN_PANEL_WORKSPACE
      )
      expect(writes).toEqual([DEFAULT_DESIGN_PANEL_WORKSPACE])
    }
  )

  test('keeps the legacy single, multi, and empty section order as the defaults', () => {
    expect(DEFAULT_DESIGN_PANEL_SECTION_ORDER).toEqual({
      single: [
        'component',
        'interaction-states',
        'module',
        'position',
        'layout',
        'appearance',
        'motion',
        'export',
        'lowcode-bindings',
        'lowcode-events',
        'lowcode-validation',
        'lowcode-advanced'
      ],
      multi: ['component', 'position', 'appearance', 'motion', 'export'],
      empty: [
        'page',
        'lowcode-document-state',
        'lowcode-document-services',
        'lowcode-document-content',
        'assets-variables',
        'export'
      ]
    })
  })

  test('preserves a complete canonical studio layout without rewriting it', () => {
    const value: DesignPanelStudioLayout = {
      single: {
        order: [
          'appearance',
          ...DEFAULT_DESIGN_PANEL_SECTION_ORDER.single.filter((id) => id !== 'appearance')
        ],
        hidden: ['motion', 'lowcode-advanced']
      },
      multi: {
        order: [...DEFAULT_DESIGN_PANEL_SECTION_ORDER.multi],
        hidden: ['export']
      },
      empty: {
        order: [...DEFAULT_DESIGN_PANEL_SECTION_ORDER.empty],
        hidden: []
      }
    }
    const writes: DesignPanelStudioLayout[] = []

    expect(repairStoredDesignPanelStudioLayout(value, (layout) => writes.push(layout))).toEqual(
      value
    )
    expect(writes).toEqual([])
  })

  test('strictly repairs incomplete, duplicate, unknown, and extra studio layout fields', () => {
    const value = {
      single: {
        order: ['appearance', 'appearance', 'unknown'],
        hidden: ['motion', 'unknown', 'motion'],
        extra: true
      },
      extraContext: {}
    }
    const writes: DesignPanelStudioLayout[] = []
    const repaired = repairStoredDesignPanelStudioLayout(value, (layout) => writes.push(layout))

    expect(repaired.single.order).toEqual([
      'appearance',
      ...DEFAULT_DESIGN_PANEL_SECTION_ORDER.single.filter((id) => id !== 'appearance')
    ])
    expect(repaired.single.hidden).toEqual(['motion'])
    expect(repaired.multi).toEqual(createDefaultDesignPanelStudioLayout().multi)
    expect(repaired.empty).toEqual(createDefaultDesignPanelStudioLayout().empty)
    expect(writes).toEqual([repaired])
  })

  test('normalization returns fresh complete layouts without mutating the input', () => {
    const source = { multi: { order: ['export'], hidden: ['appearance'] } }
    const normalized = normalizeDesignPanelStudioLayout(source)

    expect(normalized.multi.order).toEqual([
      'export',
      ...DEFAULT_DESIGN_PANEL_SECTION_ORDER.multi.filter((id) => id !== 'export')
    ])
    expect(normalized.multi.hidden).toEqual(['appearance'])
    expect(source).toEqual({ multi: { order: ['export'], hidden: ['appearance'] } })
    expect(normalized.single.order).not.toBe(DEFAULT_DESIGN_PANEL_SECTION_ORDER.single)
  })

  test('classic remains unchanged while focused hides only its secondary sections', () => {
    expect(getDesignPanelSectionOrder('single', 'classic')).toEqual(
      DEFAULT_DESIGN_PANEL_SECTION_ORDER.single
    )
    expect(isDesignPanelSectionHidden('single', 'lowcode-advanced')).toBe(false)

    designPanelWorkspace.value = 'focused'
    expect(getDesignPanelSectionOrder('single', 'focused')).toEqual(
      DEFAULT_DESIGN_PANEL_SECTION_ORDER.single
    )
    expect(isDesignPanelSectionHidden('single', 'position')).toBe(false)
    expect(isDesignPanelSectionHidden('single', 'lowcode-advanced')).toBe(true)
    expect(isDesignPanelSectionHidden('empty', 'assets-variables')).toBe(false)
    expect(isDesignPanelSectionHidden('empty', 'lowcode-document-services')).toBe(true)
  })

  test('moves, hides, reveals, and resets studio sections per context', () => {
    designPanelWorkspace.value = 'studio'
    moveDesignPanelStudioSection('single', 'appearance', 'up')
    expect(getDesignPanelSectionOrder('single', 'studio').slice(3, 6)).toEqual([
      'position',
      'appearance',
      'layout'
    ])

    toggleDesignPanelStudioSection('single', 'motion')
    expect(isDesignPanelSectionHidden('single', 'motion')).toBe(true)
    toggleDesignPanelStudioSection('single', 'motion')
    expect(isDesignPanelSectionHidden('single', 'motion')).toBe(false)

    toggleDesignPanelStudioSection('multi', 'export')
    resetDesignPanelStudioLayout('single')
    expect(designPanelStudioLayout.value.single).toEqual(
      createDefaultDesignPanelStudioLayout().single
    )
    expect(designPanelStudioLayout.value.multi.hidden).toEqual(['export'])

    resetDesignPanelStudioLayout()
    expect(designPanelStudioLayout.value).toEqual(createDefaultDesignPanelStudioLayout())
  })

  test('ignores moves and toggles for unknown sections and bounded edges', () => {
    const before = createDefaultDesignPanelStudioLayout()
    moveDesignPanelStudioSection('empty', 'page', 'up')
    moveDesignPanelStudioSection('empty', 'export', 'down')
    moveDesignPanelStudioSection('empty', 'unknown', 1)
    toggleDesignPanelStudioSection('empty', 'unknown')

    expect(designPanelStudioLayout.value).toEqual(before)
    expect(isDesignPanelSectionHidden('empty', 'unknown')).toBe(false)
  })
})
