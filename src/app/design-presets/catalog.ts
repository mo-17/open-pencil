import { parseColor } from '@open-pencil/core/color'
import type { VariableValue } from '@open-pencil/scene-graph'

export type DesignPresetId = 'business' | 'soft' | 'contrast'

export interface DesignPresetToken {
  name: string
  type: 'COLOR' | 'FLOAT'
  light: VariableValue
  dark: VariableValue
}

interface DesignPresetPalette {
  light: readonly string[]
  dark: readonly string[]
  radius: number
}

export const DESIGN_PRESET_IDS: readonly DesignPresetId[] = ['business', 'soft', 'contrast']

const COLOR_NAMES = ['brand', 'background', 'surface', 'text', 'muted', 'border'] as const
const PALETTES: Record<DesignPresetId, DesignPresetPalette> = {
  business: {
    light: ['#2563eb', '#f8fafc', '#ffffff', '#0f172a', '#475569', '#cbd5e1'],
    dark: ['#60a5fa', '#0f172a', '#1e293b', '#f8fafc', '#cbd5e1', '#64748b'],
    radius: 8
  },
  soft: {
    light: ['#7c3aed', '#faf8ff', '#ffffff', '#292236', '#62576e', '#d8cfe5'],
    dark: ['#c4b5fd', '#201a2b', '#30283d', '#faf8ff', '#d8cfe5', '#81708f'],
    radius: 16
  },
  contrast: {
    light: ['#1d4ed8', '#ffffff', '#f1f5f9', '#020617', '#334155', '#475569'],
    dark: ['#93c5fd', '#020617', '#0f172a', '#ffffff', '#e2e8f0', '#cbd5e1'],
    radius: 4
  }
}

/** Fresh values keep document edits isolated from the catalog and other imports. */
export function getDesignPresetTokens(id: DesignPresetId): DesignPresetToken[] {
  const palette = PALETTES[id]
  return [
    ...COLOR_NAMES.map((name, index): DesignPresetToken => {
      const light = parseColor(palette.light[index] ?? '')
      const dark = parseColor(palette.dark[index] ?? '')
      return { name: `color/${name}`, type: 'COLOR', light, dark }
    }),
    ...[
      ['radius/small', palette.radius / 2],
      ['radius/medium', palette.radius],
      ['spacing/small', 8],
      ['spacing/medium', 16],
      ['font/body', 16],
      ['font/heading', 24]
    ].map(([name, value]): DesignPresetToken => ({
      name: String(name),
      type: 'FLOAT',
      light: Number(value),
      dark: Number(value)
    }))
  ]
}
