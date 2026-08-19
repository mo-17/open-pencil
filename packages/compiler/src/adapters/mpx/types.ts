import type { ComponentDef } from '#compiler/ir/types'

import type { MiniProgramAssetPlan, MiniProgramWarningSink } from '../miniprogram-shared'

export interface MpxComponentPlan {
  definition: ComponentDef
  filePath: string
  slug: string
  tag: string
}

export interface MpxEnvironment {
  assets: MiniProgramAssetPlan
  components: ReadonlyMap<string, MpxComponentPlan>
  warn: MiniProgramWarningSink
}
