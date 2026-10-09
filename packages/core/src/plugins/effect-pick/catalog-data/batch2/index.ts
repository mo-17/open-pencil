import type { EffectPickCatalogEntry } from '#core/plugins/effect-pick/types'

import { EFFECT_PICK_BACKGROUNDS_BATCH2 } from './backgrounds'
import { EFFECT_PICK_BUTTONS_BATCH2 } from './buttons'
import { EFFECT_PICK_CARDS_BATCH2 } from './cards'
import { EFFECT_PICK_LOADERS_BATCH2 } from './loaders'
import { EFFECT_PICK_TEXT_BATCH2 } from './text'

export const EFFECT_PICK_CATALOG_BATCH2_DATA: readonly EffectPickCatalogEntry[] = [
  ...EFFECT_PICK_BUTTONS_BATCH2,
  ...EFFECT_PICK_BACKGROUNDS_BATCH2,
  ...EFFECT_PICK_TEXT_BATCH2,
  ...EFFECT_PICK_CARDS_BATCH2,
  ...EFFECT_PICK_LOADERS_BATCH2
]
