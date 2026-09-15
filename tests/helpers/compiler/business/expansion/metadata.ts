import { execFileSync } from 'node:child_process'

import type { BusinessTemplateDefinition } from '@/app/lowcode/backend/business/types'

export const expansionKinds = [
  'procurement-inventory',
  'enterprise-approvals',
  'survey-forms',
  'online-courses',
  'community-forum',
  'asset-management',
  'quote-contracts',
  'recruitment-hr'
] as const

export function expansionDefinition(
  kind: (typeof expansionKinds)[number]
): BusinessTemplateDefinition {
  return JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        `import {businessTemplateDefinition} from './src/app/lowcode/backend/business/definitions'; process.stdout.write(JSON.stringify(businessTemplateDefinition('${kind}')))`
      ],
      { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024 }
    )
  )
}

export const expansionId = (value: number) =>
  '00000000-0000-4000-8000-' + String(value).padStart(12, '0')
export const expansionDate = '2030-01-01T09:00:00.000Z'
