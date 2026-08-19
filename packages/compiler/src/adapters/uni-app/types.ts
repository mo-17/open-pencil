import type { ComponentDef } from '#compiler/ir/types'

import type { MiniProgramAssetPlan, MiniProgramWarningSink } from '../miniprogram-shared'

export interface UniAppComponentPlan {
  definition: ComponentDef
  filePath: string
  slug: string
  symbol: string
  tag: string
}

export interface UniAppEmitEnvironment {
  assets: MiniProgramAssetPlan
  components: ReadonlyMap<string, UniAppComponentPlan>
  devMode: boolean
  warn: MiniProgramWarningSink
}
