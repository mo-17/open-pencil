import { defineCommand } from 'citty'

import apply from './apply'
import clear from './clear'
import exportAnimation from './export'
import figmaAdapter from './figma-adapter'
import inspect from './inspect'
import presets from './presets'
import recipe from './recipe'
import team from './team'

export default defineCommand({
  meta: { description: 'Inspect and adapt OpenPencil MotionSpec data' },
  subCommands: {
    apply,
    clear,
    export: exportAnimation,
    'figma-adapter': figmaAdapter,
    inspect,
    presets,
    recipe,
    team
  }
})
